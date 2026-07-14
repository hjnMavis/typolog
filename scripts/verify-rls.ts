// Phase 2 Day 5 (2-20) — RLS·Storage 권한 검증 스크립트.
//
// 왜 이 스크립트가 필요한가:
//   우리 앱은 데이터를 두 군데에서, 완전히 다른 방식으로 지킨다.
//   - DB(테이블): 서버가 Drizzle 직결(postgres role)로 접근 → RLS를 "우회"하고
//     소유권은 코드(getOwnedSubmission 등)가 검증한다. 그래서 앱을 클릭하는 것만으로는
//     테이블 RLS 정책이 한 번도 실행되지 않는다 → 정책을 직접 두드리는 SQL 시뮬레이션이 필요.
//   - Storage(이미지): supabase 클라이언트(유저 JWT)로 접근 → 버킷 정책(RLS)이 실제 발동.
//     실계정 JWT로 타인 파일 접근을 시도해야 검증된다.
//
// 따라서 검증은 두 파트로 나뉜다:
//   Part 1 — 테이블 RLS 매트릭스: SET LOCAL ROLE + request.jwt.claims 주입으로
//            §3 정책 표 + GRANT 레이어 + 회귀 2종(H2, letter_pieces 재할당)을 검증.
//            모든 프로브는 savepoint로 격리하고 트랜잭션 전체를 ROLLBACK → 라이브 DB 무변경.
//   Part 2 — Storage 크로스 유저: A/B 실계정 JWT + anon으로 버킷 정책을 검증.
//            커밋된 fixture(제출 2건 + 객체 3개)를 만들고 finally에서 정리.
//
// 테스트 계정 A·B는 admin API로 즉석 생성→사용→삭제(--keep로 유지 가능).
// 비밀번호는 in-process 랜덤 생성, 어떤 secret(키·JWT·DATABASE_URL·비밀번호)도 출력하지 않는다.
//
// 실행 (프로젝트 루트, .env.local 필요):
//   pnpm dlx tsx scripts/verify-rls.ts            # 생성→검증→삭제
//   pnpm dlx tsx scripts/verify-rls.ts --keep     # 검증 후 테스트 계정 유지(디버깅용)
//
// 참고: docs/backend-design-plan.md §3(RLS)·§5(Storage), src/db/migrations/0001·0003.

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// ─────────────────────────────────────────────
// 결과 수집
// ─────────────────────────────────────────────
type CheckResult = { part: string; name: string; expected: string; actual: string; pass: boolean };
const results: CheckResult[] = [];

function record(part: string, name: string, expected: string, actual: string, pass: boolean) {
  results.push({ part, name, expected, actual, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name} — expected ${expected}, got ${actual}`);
}

// ─────────────────────────────────────────────
// 환경 변수 (값은 절대 출력하지 않는다 — presence boolean만)
// ─────────────────────────────────────────────
function loadEnv() {
  // 앱과 동일한 로더(@next/env loadEnvConfig)로 .env*를 읽는다 (킥오프 §1 마이그레이션 래퍼와 동일).
  // Node 내장 process.loadEnvFile은 키 앞 공백을 안 깎아 들여쓴 줄(예: "  DATABASE_URL=")을 놓치지만,
  // dotenv 기반인 이 로더는 앞 공백·따옴표를 견고하게 처리하고 .env/.env.local을 앱과 같게 병합한다.
  // pnpm에서 @next/env가 최상위로 호이스트되지 않으므로 next 경유로 resolve한다.
  const req = createRequire(import.meta.url);
  const nextEnvPath = req.resolve('@next/env', {
    paths: [path.dirname(req.resolve('next/package.json'))],
  });
  const { loadEnvConfig } = req(nextEnvPath) as { loadEnvConfig: (dir: string, dev?: boolean) => unknown };
  loadEnvConfig(process.cwd(), true);

  const env = {
    databaseUrl: process.env.DATABASE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  };
  console.log('환경 변수 presence:', {
    DATABASE_URL: Boolean(env.databaseUrl),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(env.supabaseUrl),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(env.publishableKey),
    SUPABASE_SECRET_KEY: Boolean(env.secretKey),
  });
  if (!env.databaseUrl || !env.supabaseUrl || !env.publishableKey || !env.secretKey) {
    throw new Error('필수 환경 변수 누락 — .env.local을 확인하세요 (위 presence가 모두 true여야 함).');
  }
  return env as { databaseUrl: string; supabaseUrl: string; publishableKey: string; secretKey: string };
}

// ─────────────────────────────────────────────
// 1x1 minimal 이미지 (Storage는 declared content-type + size만 검사)
// ─────────────────────────────────────────────
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const WEBP_1x1 = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
  'base64',
);

// 최상위 연결(Sql)과 트랜잭션/savepoint 스코프(TransactionSql)를 구분 — savepoint는 후자에만 존재.
type PgSql = postgres.Sql;
type PgTx = postgres.TransactionSql;

// ─────────────────────────────────────────────
// Part 1 — 테이블 RLS 매트릭스 (SQL 시뮬레이션, 전부 ROLLBACK)
// ─────────────────────────────────────────────
const ROLLBACK = Symbol('savepoint-rollback');

type Role = 'authenticated' | 'anon' | 'postgres';
type Expect =
  | { kind: 'rows'; value: number } // 정확히 N행 (USING 필터로 0행 차단 검증 등)
  | { kind: 'rowsAtLeast'; value: number } // ≥N행 (조회 허용 검증)
  | { kind: 'error'; code: string }; // 특정 SQLSTATE 에러 (GRANT 거부·WITH CHECK 위반: 42501)

type ProbeOutcome = { rows: number } | { errorCode: string };

// 하나의 프로브를 savepoint 안에서 실행하고 항상 롤백한다 (프로브 간 격리 + 라이브 무변경).
async function probe(
  sql: PgTx,
  opts: { name: string; role: Role; sub: string | null; run: (sp: PgTx) => Promise<ProbeOutcome>; expect: Expect },
) {
  let outcome: ProbeOutcome | undefined;
  try {
    await sql.savepoint(async (sp) => {
      // 역할 전환: SET LOCAL ROLE은 트랜잭션/savepoint 스코프 — 롤백 시 자동 복원.
      await sp.unsafe(`SET LOCAL ROLE ${opts.role}`); // role은 화이트리스트 상수만 전달
      // auth.uid() 호환: Supabase 버전에 따라 request.jwt.claim.sub(구) 또는
      // request.jwt.claims->>'sub'(신)를 읽으므로 둘 다 주입한다.
      // anon은 빈 문자열 → auth.uid()의 nullif(current_setting(...), '')가 NULL로 흡수
      //   ('' ::jsonb 파싱 에러가 나지 않음). Supabase auth.uid() 정의에 의존한다.
      const claims = opts.sub ? JSON.stringify({ sub: opts.sub, role: opts.role }) : '';
      await sp`SELECT set_config('request.jwt.claims', ${claims}, true)`;
      await sp`SELECT set_config('request.jwt.claim.sub', ${opts.sub ?? ''}, true)`;
      outcome = await opts.run(sp);
      throw ROLLBACK; // 프로브가 만든 변경을 되돌린다
    });
  } catch (e) {
    if (e === ROLLBACK) {
      // 정상: run()이 성공했고 우리가 롤백했다 — outcome 유지
    } else if (e && typeof e === 'object' && 'code' in e) {
      outcome = { errorCode: String((e as { code: unknown }).code) };
    } else {
      throw e;
    }
  }

  if (!outcome) {
    record('Part1', opts.name, describeExpect(opts.expect), 'no-outcome', false);
    return;
  }

  const { actualStr, pass } = classify(outcome, opts.expect);
  record('Part1', opts.name, describeExpect(opts.expect), actualStr, pass);
}

function describeExpect(e: Expect): string {
  if (e.kind === 'rows') return `${e.value} rows`;
  if (e.kind === 'rowsAtLeast') return `>=${e.value} rows`;
  return `error ${e.code}`;
}

function classify(outcome: ProbeOutcome, expect: Expect): { actualStr: string; pass: boolean } {
  if ('errorCode' in outcome) {
    const actualStr = `error ${outcome.errorCode}`;
    return { actualStr, pass: expect.kind === 'error' && outcome.errorCode === expect.code };
  }
  const actualStr = `${outcome.rows} rows`;
  if (expect.kind === 'rows') return { actualStr, pass: outcome.rows === expect.value };
  if (expect.kind === 'rowsAtLeast') return { actualStr, pass: outcome.rows >= expect.value };
  return { actualStr, pass: false }; // error를 기대했는데 성공함 = 정책 누수
}

async function selectCount(sp: PgTx, table: string, idCol: string, id: string): Promise<ProbeOutcome> {
  const rows = await sp.unsafe<{ c: number }[]>(
    `SELECT count(*)::int AS c FROM ${table} WHERE ${idCol} = $1`,
    [id],
  );
  return { rows: rows[0].c };
}

async function runTableMatrix(sql: PgSql, A: string, B: string) {
  console.log('\n── Part 1: 테이블 RLS 매트릭스 (SQL 시뮬레이션, 전부 ROLLBACK) ──');

  try {
    await sql.begin(async (tx) => {
      // ── fixtures: postgres(owner)로 삽입 → RLS 우회. 트랜잭션 전체가 마지막에 ROLLBACK된다.
      const chals = await tx<{ id: string }[]>`SELECT id FROM challenges ORDER BY active_date LIMIT 4`;
      if (chals.length < 4) throw new Error('검증용 challenge가 부족합니다 (seed-challenges.ts 먼저 실행).');
      const [c0, c1, c2, c3] = chals.map((r) => r.id);

      // A의 제출 3종 + B의 제출 1종 (UNIQUE(user,challenge) 충돌 회피 위해 서로 다른 challenge)
      const sApriv = randomUUID();
      const sApub = randomUUID();
      const sAhidden = randomUUID();
      const sB = randomUUID();
      await tx`INSERT INTO submissions (id, user_id, challenge_id, status, is_public) VALUES
        (${sApriv}, ${A}, ${c0}, 'draft', false),
        (${sApub}, ${A}, ${c1}, 'completed', true),
        (${sAhidden}, ${A}, ${c2}, 'hidden', false),
        (${sB}, ${B}, ${c0}, 'draft', false)`;

      const lpApriv = randomUUID();
      const lpApub = randomUUID();
      const lpB = randomUUID();
      await tx`INSERT INTO letter_pieces (id, submission_id, character, slot_index, image_url, width, height) VALUES
        (${lpApriv}, ${sApriv}, '가', 0, 'letter-pieces/x/0.webp', 100, 100),
        (${lpApub}, ${sApub}, '나', 0, 'letter-pieces/x/0.webp', 100, 100),
        (${lpB}, ${sB}, '다', 0, 'letter-pieces/x/0.webp', 100, 100)`;

      // ── submissions SELECT ──
      await probe(tx, {
        name: 'submissions: B는 A의 비공개 제출을 못 본다 (API 404의 DB 토대)',
        role: 'authenticated', sub: B, expect: { kind: 'rows', value: 0 },
        run: (sp) => selectCount(sp, 'submissions', 'id', sApriv),
      });
      await probe(tx, {
        name: 'submissions: B는 A의 공개·완성 제출을 본다',
        role: 'authenticated', sub: B, expect: { kind: 'rows', value: 1 },
        run: (sp) => selectCount(sp, 'submissions', 'id', sApub),
      });
      await probe(tx, {
        name: 'submissions: A는 본인 비공개 제출을 본다',
        role: 'authenticated', sub: A, expect: { kind: 'rows', value: 1 },
        run: (sp) => selectCount(sp, 'submissions', 'id', sApriv),
      });
      await probe(tx, {
        name: 'submissions: anon은 공개·완성 제출을 본다',
        role: 'anon', sub: null, expect: { kind: 'rows', value: 1 },
        run: (sp) => selectCount(sp, 'submissions', 'id', sApub),
      });
      await probe(tx, {
        name: 'submissions: anon은 비공개 제출을 못 본다',
        role: 'anon', sub: null, expect: { kind: 'rows', value: 0 },
        run: (sp) => selectCount(sp, 'submissions', 'id', sApriv),
      });

      // ── submissions INSERT (WITH CHECK: user_id = auth.uid()) ──
      await probe(tx, {
        name: 'submissions: B는 user_id=A로 위조 생성 불가 (WITH CHECK)',
        role: 'authenticated', sub: B, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`INSERT INTO submissions (user_id, challenge_id, status, is_public) VALUES (${A}, ${c3}, 'draft', false)`;
          return { rows: 1 };
        },
      });
      await probe(tx, {
        name: 'submissions: B는 본인 제출 생성 가능',
        role: 'authenticated', sub: B, expect: { kind: 'rowsAtLeast', value: 1 },
        run: async (sp) => {
          const r = await sp`INSERT INTO submissions (user_id, challenge_id, status, is_public) VALUES (${B}, ${c3}, 'draft', false)`;
          return { rows: r.count };
        },
      });

      // ── submissions UPDATE: H2 회귀 ──
      await probe(tx, {
        name: 'submissions[H2]: A의 hidden→completed 복원 차단 (USING status!=hidden → 0행)',
        role: 'authenticated', sub: A, expect: { kind: 'rows', value: 0 },
        run: async (sp) => {
          const r = await sp`UPDATE submissions SET status='completed' WHERE id=${sAhidden}`;
          return { rows: r.count };
        },
      });
      await probe(tx, {
        name: 'submissions: A가 본인 제출을 hidden으로 변경 차단 (WITH CHECK status!=hidden)',
        role: 'authenticated', sub: A, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`UPDATE submissions SET status='hidden' WHERE id=${sApub}`;
          return { rows: 1 };
        },
      });
      await probe(tx, {
        name: 'submissions: B는 A의 제출을 수정 불가 (USING user_id=auth.uid() → 0행)',
        role: 'authenticated', sub: B, expect: { kind: 'rows', value: 0 },
        run: async (sp) => {
          const r = await sp`UPDATE submissions SET is_public=false WHERE id=${sApub}`;
          return { rows: r.count };
        },
      });
      // 양성: A는 본인 제출을 수정할 수 있어야 한다 (over-restrictive RLS 탐지 — QA Medium)
      await probe(tx, {
        name: 'submissions: A는 본인 제출 수정 가능 (허용 경로)',
        role: 'authenticated', sub: A, expect: { kind: 'rowsAtLeast', value: 1 },
        run: async (sp) => {
          const r = await sp`UPDATE submissions SET is_public=true WHERE id=${sApriv}`;
          return { rows: r.count };
        },
      });

      // ── submissions DELETE: GRANT 없음 → permission denied ──
      await probe(tx, {
        name: 'submissions: A도 DELETE 불가 (authenticated에 DELETE GRANT 없음)',
        role: 'authenticated', sub: A, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`DELETE FROM submissions WHERE id=${sApriv}`;
          return { rows: 1 };
        },
      });

      // ── letter_pieces SELECT ──
      await probe(tx, {
        name: 'letter_pieces: B는 A 비공개 제출의 글자조각을 못 본다',
        role: 'authenticated', sub: B, expect: { kind: 'rows', value: 0 },
        run: (sp) => selectCount(sp, 'letter_pieces', 'id', lpApriv),
      });
      await probe(tx, {
        name: 'letter_pieces: B는 A 공개 제출의 글자조각을 본다',
        role: 'authenticated', sub: B, expect: { kind: 'rows', value: 1 },
        run: (sp) => selectCount(sp, 'letter_pieces', 'id', lpApub),
      });
      // 양성: A는 본인 제출의 글자조각을 삭제할 수 있어야 한다 (허용 경로 — QA Medium)
      await probe(tx, {
        name: 'letter_pieces: A는 본인 글자조각 삭제 가능 (허용 경로)',
        role: 'authenticated', sub: A, expect: { kind: 'rowsAtLeast', value: 1 },
        run: async (sp) => {
          const r = await sp`DELETE FROM letter_pieces WHERE id=${lpApriv}`;
          return { rows: r.count };
        },
      });

      // ── letter_pieces INSERT/UPDATE: 재할당 회귀 §8.4-② ──
      await probe(tx, {
        name: 'letter_pieces: B는 A의 제출에 글자조각 삽입 불가 (WITH CHECK)',
        role: 'authenticated', sub: B, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`INSERT INTO letter_pieces (submission_id, character, slot_index, image_url, width, height)
                   VALUES (${sApriv}, '라', 1, 'x', 10, 10)`;
          return { rows: 1 };
        },
      });
      // 양성 짝: B가 본인 조각의 무해한 컬럼 변경은 성공해야 한다 (USING 통과 전제 고정).
      // 이게 성공하고 아래 재할당이 실패해야, 재할당 차단이 "USING 차단(0행)"이 아니라
      // 순수 "WITH CHECK 효과"임이 분리 보증된다 (§8.4-②의 변별력).
      await probe(tx, {
        name: 'letter_pieces: B는 본인 조각의 무해한 변경 가능 (USING 통과 전제)',
        role: 'authenticated', sub: B, expect: { kind: 'rowsAtLeast', value: 1 },
        run: async (sp) => {
          const r = await sp`UPDATE letter_pieces SET slot_index=9 WHERE id=${lpB}`;
          return { rows: r.count };
        },
      });
      await probe(tx, {
        name: 'letter_pieces[재할당]: B가 본인 조각을 A 제출로 재할당 차단 (WITH CHECK)',
        role: 'authenticated', sub: B, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`UPDATE letter_pieces SET submission_id=${sApriv} WHERE id=${lpB}`;
          return { rows: 1 };
        },
      });

      // ── reactions ──
      await probe(tx, {
        name: 'reactions: B는 user_id=A로 위조 좋아요 불가 (WITH CHECK)',
        role: 'authenticated', sub: B, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`INSERT INTO reactions (user_id, submission_id, type) VALUES (${A}, ${sApub}, 'like')`;
          return { rows: 1 };
        },
      });
      await probe(tx, {
        name: 'reactions: UPDATE GRANT 없음 → permission denied',
        role: 'authenticated', sub: A, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`UPDATE reactions SET type='x' WHERE submission_id=${sApub}`;
          return { rows: 1 };
        },
      });

      // ── reports ──
      await probe(tx, {
        name: 'reports: 일반 사용자 SELECT 불가 (SELECT GRANT 없음 → permission denied)',
        role: 'authenticated', sub: A, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          const r = await sp<{ c: number }[]>`SELECT count(*)::int AS c FROM reports`;
          return { rows: r[0].c };
        },
      });
      await probe(tx, {
        name: 'reports: B는 reporter_id=A로 위조 신고 불가 (WITH CHECK)',
        role: 'authenticated', sub: B, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`INSERT INTO reports (reporter_id, submission_id, reason) VALUES (${A}, ${sApub}, 'x')`;
          return { rows: 1 };
        },
      });
      // #48 회귀(Day 10.5): 같은 (reporter, submission) 2회 신고는 UNIQUE가 차단한다.
      // 첫 INSERT는 정상 경로(본인 신고, WITH CHECK 통과) — 둘째가 23505(unique_violation)여야 한다.
      await probe(tx, {
        name: 'reports[중복]: 같은 (reporter, submission) 2회 신고 차단 (UNIQUE 23505)',
        role: 'authenticated', sub: B, expect: { kind: 'error', code: '23505' },
        run: async (sp) => {
          await sp`INSERT INTO reports (reporter_id, submission_id, reason) VALUES (${B}, ${sApub}, 'dup-1')`;
          await sp`INSERT INTO reports (reporter_id, submission_id, reason) VALUES (${B}, ${sApub}, 'dup-2')`;
          return { rows: 2 };
        },
      });

      // ── profiles ──
      await probe(tx, {
        name: 'profiles: B는 A의 프로필 수정 불가 (USING id=auth.uid() → 0행)',
        role: 'authenticated', sub: B, expect: { kind: 'rows', value: 0 },
        run: async (sp) => {
          const r = await sp`UPDATE profiles SET nickname='hacked' WHERE id=${A}`;
          return { rows: r.count };
        },
      });
      await probe(tx, {
        name: 'profiles: anon은 프로필 조회 불가 (anon에 SELECT GRANT 없음)',
        role: 'anon', sub: null, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          const r = await sp<{ c: number }[]>`SELECT count(*)::int AS c FROM profiles`;
          return { rows: r[0].c };
        },
      });
      // 양성: authenticated는 프로필을 조회할 수 있어야 한다 (USING true, 피드 카드 — QA Medium)
      await probe(tx, {
        name: 'profiles: authenticated는 프로필 조회 가능 (허용 경로)',
        role: 'authenticated', sub: A, expect: { kind: 'rowsAtLeast', value: 1 },
        run: (sp) => selectCount(sp, 'profiles', 'id', A),
      });

      // ── challenges ──
      await probe(tx, {
        name: 'challenges: anon은 챌린지 조회 가능',
        role: 'anon', sub: null, expect: { kind: 'rowsAtLeast', value: 1 },
        run: (sp) => selectCount(sp, 'challenges', 'id', c0),
      });
      await probe(tx, {
        name: 'challenges: authenticated는 챌린지 생성 불가 (INSERT GRANT 없음)',
        role: 'authenticated', sub: A, expect: { kind: 'error', code: '42501' },
        run: async (sp) => {
          await sp`INSERT INTO challenges (sentence, lines, letters, active_date) VALUES ('x', ARRAY['x'], ARRAY['x'], '2099-12-31')`;
          return { rows: 1 };
        },
      });

      throw ROLLBACK; // 트랜잭션 전체 롤백 — 라이브 DB 무변경
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

// ─────────────────────────────────────────────
// Part 2 — Storage 정책 크로스 유저 (실 JWT)
// ─────────────────────────────────────────────
async function runStorageMatrix(
  sql: PgSql,
  admin: SupabaseClient,
  clientA: SupabaseClient,
  clientB: SupabaseClient,
  anon: SupabaseClient,
  A: string,
) {
  console.log('\n── Part 2: Storage 정책 크로스 유저 (실 JWT) ──');

  // 커밋된 fixture: A의 공개·완성 제출 + A의 비공개 제출 (storage 정책의 EXISTS 서브쿼리가 본다)
  const chals = await sql<{ id: string }[]>`SELECT id FROM challenges ORDER BY active_date LIMIT 2`;
  const c0 = chals[0].id;
  const c1 = chals[1].id;
  const subPub = randomUUID();
  const subPriv = randomUUID();
  const letterPath = `${A}/${subPriv}/0.webp`;
  const collagePubPath = `${A}/${subPub}/collage.png`;
  const collagePrivPath = `${A}/${subPriv}/collage.png`;

  try {
    await sql`INSERT INTO submissions (id, user_id, challenge_id, status, is_public) VALUES
      (${subPub}, ${A}, ${c0}, 'completed', true),
      (${subPriv}, ${A}, ${c1}, 'draft', false)`;

    // A가 본인 경로에 업로드 (소유자 쓰기 정책 검증 겸 fixture 생성)
    const upLetter = await clientA.storage.from('letter-pieces').upload(letterPath, WEBP_1x1, {
      contentType: 'image/webp',
      upsert: true,
    });
    record('Part2', 'letter-pieces: A는 본인 경로에 업로드 가능', 'success', upLetter.error ? 'error' : 'success', !upLetter.error);

    const upPub = await clientA.storage.from('collages').upload(collagePubPath, PNG_1x1, {
      contentType: 'image/png',
      upsert: true,
    });
    const upPriv = await clientA.storage.from('collages').upload(collagePrivPath, PNG_1x1, {
      contentType: 'image/png',
      upsert: true,
    });
    record('Part2', 'collages: A는 본인 경로에 업로드 가능 (공개·비공개 2건)', 'success',
      upPub.error || upPriv.error ? 'error' : 'success', !upPub.error && !upPriv.error);

    // #80 회귀(Day 10.5): 같은 path 재업로드(upsert 덮어쓰기)는 storage.objects UPDATE 경로라
    // collages_update 정책(0006)이 필요하다 — A6 재시도("실패 시 처음부터 재실행")의 전제.
    // 기존 프로브는 매 실행 새 경로만 업로드해 이 경로가 한 번도 발동되지 않았다.
    const upOverwrite = await clientA.storage.from('collages').upload(collagePubPath, PNG_1x1, {
      contentType: 'image/png',
      upsert: true,
    });
    record('Part2', 'collages[#80]: A는 본인 콜라주 같은 path 재업로드(덮어쓰기) 가능', 'success',
      upOverwrite.error ? 'error' : 'success', !upOverwrite.error);
    // 짝 음성: 새 정책이 타인 덮어쓰기까지 열지 않았는지 (USING 본인 경로 한정)
    const upForeignOverwrite = await clientB.storage.from('collages').upload(collagePubPath, PNG_1x1, {
      contentType: 'image/png',
      upsert: true,
    });
    record('Part2', 'collages[#80]: B는 A의 콜라주 덮어쓰기 차단', 'blocked',
      upForeignOverwrite.error ? 'blocked' : 'allowed', Boolean(upForeignOverwrite.error));

    // 업로드가 fixture의 전제다. 하나라도 실패하면 다운로드 차단 케이스가
    // "정책 차단"이 아니라 "객체 부재"로 통과(거짓 양성)될 수 있으므로 다운로드를 스킵한다 (M-4).
    if (upLetter.error || upPub.error || upPriv.error) {
      record('Part2', 'Storage 다운로드 검증', 'executed', 'skipped (fixture 업로드 실패)', false);
    } else {
      // ── letter-pieces: 본인 경로만 (첫 폴더 = auth.uid()) ──
      await downloadCheck('letter-pieces: A는 본인 글자조각 다운로드 가능', clientA, 'letter-pieces', letterPath, true);
      await downloadCheck('letter-pieces: B는 A의 글자조각 다운로드 차단', clientB, 'letter-pieces', letterPath, false);
      await downloadCheck('letter-pieces: anon은 A의 글자조각 다운로드 차단', anon, 'letter-pieces', letterPath, false);

      // ── collages: 공개·완성이면 타인/anon 읽기 허용, 비공개는 차단 ──
      await downloadCheck('collages: B는 A의 공개 콜라주 다운로드 가능', clientB, 'collages', collagePubPath, true);
      await downloadCheck('collages: anon은 A의 공개 콜라주 다운로드 가능 (공유 페이지)', anon, 'collages', collagePubPath, true);
      await downloadCheck('collages: anon은 A의 비공개 콜라주 다운로드 차단', anon, 'collages', collagePrivPath, false);
      await downloadCheck('collages: B는 A의 비공개 콜라주 다운로드 차단', clientB, 'collages', collagePrivPath, false);
    }
  } finally {
    // fixture 정리 (admin = service role → 정책 우회). 객체 먼저, 그 다음 제출 행.
    await admin.storage.from('letter-pieces').remove([letterPath]).catch(() => {});
    await admin.storage.from('collages').remove([collagePubPath, collagePrivPath]).catch(() => {});
    await sql`DELETE FROM submissions WHERE id IN (${subPub}, ${subPriv})`.catch(() => {});
  }
}

// 다운로드 시도 → 성공/차단을 기대값과 비교. 비공개 차단은 error 또는 빈 응답으로 나타난다.
// 차단 케이스는 status/메시지를 actual에 남겨 "정책 차단(403)"과 "객체 부재(404)"를
// 사후에 사람이 식별할 수 있게 한다 (M-5 — 보안 검증의 거짓 양성 진단용 증거).
async function downloadCheck(
  name: string,
  client: SupabaseClient,
  bucket: string,
  path: string,
  expectAllowed: boolean,
) {
  const { data, error } = await client.storage.from(bucket).download(path);
  const allowed = !error && data != null && data.size > 0;
  // 차단 케이스는 HTTP status만 남긴다(403=정책 차단 vs 404=객체 부재 식별). error.message는
  // 버전에 따라 경로(UUID)를 담을 수 있어 출력하지 않는다 (QA M-4 — 비노출 원칙 일관성).
  let actual: string;
  if (allowed) {
    actual = 'allowed';
  } else {
    const status = (error as { status?: number } | null)?.status;
    actual = status ? `blocked (${status})` : 'blocked';
  }
  record('Part2', name, expectAllowed ? 'allowed' : 'blocked', actual, allowed === expectAllowed);
}

// ─────────────────────────────────────────────
// 테스트 계정 라이프사이클
// ─────────────────────────────────────────────
async function createTestUser(admin: SupabaseClient, label: string): Promise<{ id: string; email: string; password: string }> {
  const email = `rls-verify-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`; // in-process only — 절대 출력하지 않는다
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`테스트 계정(${label}) 생성 실패: ${error?.message ?? 'no user'}`);
  return { id: data.user.id, email, password };
}

async function signIn(url: string, key: string, email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`로그인 실패: ${error.message}`);
  return client;
}

// ─────────────────────────────────────────────
// main
// ─────────────────────────────────────────────
async function main() {
  const keep = process.argv.includes('--keep');
  const env = loadEnv();

  const sql = postgres(env.databaseUrl, { prepare: false });
  const admin = createClient(env.supabaseUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userA: { id: string; email: string; password: string } | undefined;
  let userB: { id: string; email: string; password: string } | undefined;

  try {
    // 1) 테스트 계정 A·B 생성 (trigger가 profiles 자동 생성)
    console.log('테스트 계정 A·B 생성 중...');
    userA = await createTestUser(admin, 'a');
    userB = await createTestUser(admin, 'b');
    // handle_new_user trigger(AFTER INSERT)가 profiles를 생성했는지 단언한다.
    // (없으면 Part 1 fixture의 submissions→profiles FK가 깊은 곳에서 터지므로, 여기서 명확히 잡는다.)
    const prof = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM profiles WHERE id IN (${userA.id}, ${userB.id})`;
    if (prof[0].c !== 2) throw new Error(`profiles trigger 미반영 — A·B 프로필 ${prof[0].c}/2건만 존재.`);

    // 2) Part 1: 테이블 RLS 매트릭스 (로그인 불필요 — 가장 중요한 파트라 먼저)
    await runTableMatrix(sql, userA.id, userB.id);

    // 3) Part 2: Storage 크로스 유저 (실 JWT). 이메일/비밀번호 provider가 꺼져 있으면
    //    로그인이 실패할 수 있다 — 그 경우 Part 1 결과는 보존하고 Part 2만 스킵한다.
    try {
      const clientA = await signIn(env.supabaseUrl, env.publishableKey, userA.email, userA.password);
      const clientB = await signIn(env.supabaseUrl, env.publishableKey, userB.email, userB.password);
      const anon = createClient(env.supabaseUrl, env.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await runStorageMatrix(sql, admin, clientA, clientB, anon, userA.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`\n⚠ Part 2(Storage) 스킵 — 로그인 실패: ${msg}`);
      console.log('  Supabase Auth에서 Email provider가 활성인지 확인 후 재실행하세요.');
      record('Part2', 'Storage 크로스 유저 검증', 'executed', 'skipped (login failed)', false);
    }
  } finally {
    // 4) 정리 — 테스트 계정 삭제 (CASCADE로 profiles·submissions·letter_pieces 동반 삭제)
    if (!keep) {
      if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
      if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
      console.log('\n테스트 계정 A·B 삭제 완료.');
    } else {
      console.log('\n--keep: 테스트 계정 유지됨 (UUID는 출력하지 않음).');
    }
    await sql.end();
  }

  // ── 요약 ──
  const failed = results.filter((r) => !r.pass);
  console.log(`\n════ 검증 요약: 총 ${results.length}건, 통과 ${results.length - failed.length}, 실패 ${failed.length} ════`);
  if (failed.length > 0) {
    console.log('실패 항목:');
    for (const f of failed) console.log(`  - [${f.part}] ${f.name} (expected ${f.expected}, got ${f.actual})`);
    process.exit(1);
  }
  console.log('모든 RLS·Storage 권한 검증 통과 ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
