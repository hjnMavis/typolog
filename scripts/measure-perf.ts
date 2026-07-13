// Phase 3 Day 10 (3-18) — 성능 기준선 측정 스크립트 (read-only).
//
// 무엇을 측정하나:
//   Part 1 — 피드 쿼리(A7 Q1) DB 왕복 타이밍(웜 10회, p50/p95) + EXPLAIN ANALYZE로
//            부분 인덱스 idx_submissions_feed 사용 확인. 반응 배치(Q2/Q3) 타이밍 포함.
//   Part 2 — Storage 고아 파일 카운트(#40-D): letter-pieces·collages 버킷의 실제 객체를
//            DB 참조(letter_pieces.image_url / submissions.collage_image_url)와 대조.
//
// 왜 API가 아닌 DB 레벨인가: /api/feed는 인증 필수(401)라 스크립트 단독으로는 측정 불가.
//   API 레벨(p50/p95)은 인증 세션이 있는 브라우저에서 fetch 루프로 측정하고
//   (docs/verification/phase3-integration.md 참조), 이 스크립트는 그 하위 레이어인
//   DB 쿼리·Storage를 고정 조건에서 반복 측정하는 회귀 기준선이다 (Phase 4~5 재실행).
//
// 안전 규칙: 모든 쿼리는 SELECT/EXPLAIN(read-only), Storage는 list만 사용.
//   어떤 secret(키·DATABASE_URL)도 출력하지 않는다 — presence boolean만 (verify-rls.ts와 동일).
//
// 실행 (프로젝트 루트, .env.local 필요):
//   pnpm dlx tsx scripts/measure-perf.ts                     # 오늘(KST) 챌린지 기준
//   pnpm dlx tsx scripts/measure-perf.ts --challenge <uuid>  # 특정 챌린지 기준

import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// ─────────────────────────────────────────────
// 환경 변수 (값은 절대 출력하지 않는다 — presence boolean만)
// ─────────────────────────────────────────────
function loadEnv() {
  const req = createRequire(import.meta.url);
  const nextEnvPath = req.resolve('@next/env', {
    paths: [path.dirname(req.resolve('next/package.json'))],
  });
  const { loadEnvConfig } = req(nextEnvPath) as {
    loadEnvConfig: (dir: string, dev?: boolean) => unknown;
  };
  loadEnvConfig(process.cwd(), true);

  const env = {
    databaseUrl: process.env.DATABASE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  };
  console.log('환경 변수 presence:', {
    DATABASE_URL: Boolean(env.databaseUrl),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(env.supabaseUrl),
    SUPABASE_SECRET_KEY: Boolean(env.secretKey),
  });
  if (!env.databaseUrl || !env.supabaseUrl || !env.secretKey) {
    throw new Error('필수 환경 변수 누락 — .env.local을 확인하세요.');
  }
  return env as { databaseUrl: string; supabaseUrl: string; secretKey: string };
}

// ─────────────────────────────────────────────
// 통계 유틸
// ─────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(label: string, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const fmt = (n: number) => n.toFixed(1);
  console.log(
    `  ${label}: n=${samples.length} min=${fmt(sorted[0])}ms p50=${fmt(percentile(sorted, 50))}ms p95=${fmt(percentile(sorted, 95))}ms max=${fmt(sorted[sorted.length - 1])}ms`,
  );
}

// ─────────────────────────────────────────────
// Part 1 — 피드 쿼리 타이밍 + EXPLAIN
// ─────────────────────────────────────────────
// A7 Q1을 그대로 재현 (src/app/api/feed/route.ts §4 — keyset 없는 1페이지, limit+1=21)
const FEED_Q1 = `
  SELECT s.id, s.user_id, s.challenge_id, s.is_public, s.created_at, s.completed_at,
         s.collage_image_url, p.id AS prof_id, p.nickname, p.avatar_url
  FROM submissions s
  INNER JOIN profiles p ON s.user_id = p.id
  WHERE s.challenge_id = $1 AND s.status = 'completed' AND s.is_public = true
  ORDER BY s.created_at DESC, s.id ASC
  LIMIT 21
`;

async function part1FeedQuery(sql: postgres.Sql, challengeId: string) {
  console.log('\n── Part 1: 피드 쿼리 (A7 Q1) ──');
  console.log(`  challenge_id: ${challengeId}`);

  // EXPLAIN ANALYZE — 인덱스 사용 확인 (SELECT 실행이므로 read-only)
  const plan = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${FEED_Q1}`, [challengeId]);
  const planText = plan.map((r) => String(Object.values(r)[0])).join('\n');
  const usesIndex = planText.includes('idx_submissions_feed');
  console.log(`  실제 플랜의 idx_submissions_feed 사용: ${usesIndex}`);
  console.log('  ── EXPLAIN ANALYZE ──');
  for (const line of planText.split('\n')) console.log(`    ${line}`);

  // 소형 테이블에서는 플래너가 Seq Scan을 선택하는 것이 정상이다(인덱스 고장 아님).
  // 인덱스가 "스케일 시 사용 가능한 상태"인지는 seqscan을 끄고 강제해 확인한다.
  // BEGIN…ROLLBACK 안의 SET LOCAL이라 세션 설정을 오염시키지 않는다 (read-only 유지).
  let indexUsable = usesIndex;
  if (!usesIndex) {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL enable_seqscan = off`);
      const forced = await tx.unsafe(`EXPLAIN ${FEED_Q1}`, [challengeId]);
      const forcedText = forced.map((r) => String(Object.values(r)[0])).join('\n');
      indexUsable = forcedText.includes('idx_submissions_feed');
      console.log(
        `  [${indexUsable ? 'PASS' : 'FAIL'}] enable_seqscan=off 강제 시 idx_submissions_feed 사용: ${indexUsable}`,
      );
      throw new Error('rollback'); // 트랜잭션을 롤백해 SET LOCAL 잔존 차단
    }).catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== 'rollback') throw e;
    });
  }

  // 타이밍 — 워밍업 1회 + 측정 10회
  await sql.unsafe(FEED_Q1, [challengeId]);
  const q1Samples: number[] = [];
  let pageIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const rows = await sql.unsafe(FEED_Q1, [challengeId]);
    q1Samples.push(performance.now() - t0);
    if (i === 0) pageIds = rows.map((r) => String(r.id));
  }
  summarize('Q1 (submissions⨝profiles, LIMIT 21)', q1Samples);
  console.log(`  페이지 행 수: ${pageIds.length}`);

  // Q2/Q3 반응 배치 (페이지가 비어있지 않을 때만)
  if (pageIds.length > 0) {
    const q23Samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await Promise.all([
        sql`SELECT submission_id, count(*) FROM reactions
            WHERE submission_id IN ${sql(pageIds)} GROUP BY submission_id`,
        sql`SELECT submission_id FROM reactions
            WHERE submission_id IN ${sql(pageIds)} LIMIT 100`,
      ]);
      q23Samples.push(performance.now() - t0);
    }
    summarize('Q2+Q3 (반응 배치, Promise.all)', q23Samples);
  }
  return { indexUsable };
}

// ─────────────────────────────────────────────
// Part 2 — Storage 고아 파일 카운트 (#40-D)
// ─────────────────────────────────────────────
// 버킷 구조: <user_id>/<submission_id>/<file> (§4). 3단계를 순회해 전체 객체 경로를 수집한다.
async function listAllFiles(
  storage: ReturnType<typeof createClient>['storage'],
  bucket: string,
): Promise<string[]> {
  const files: string[] = [];
  const listDir = async (prefix: string): Promise<{ name: string; isFile: boolean }[]> => {
    const out: { name: string; isFile: boolean }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`Storage list 실패(${bucket}/${prefix}): ${error.message}`);
      if (!data || data.length === 0) break;
      // 파일은 id가 있고, "폴더"(경로 프리픽스)는 id가 null이다
      for (const e of data) out.push({ name: e.name, isFile: e.id !== null });
      if (data.length < 1000) break;
    }
    return out;
  };

  for (const user of await listDir('')) {
    if (user.isFile) {
      files.push(user.name);
      continue;
    }
    for (const sub of await listDir(user.name)) {
      const subPrefix = `${user.name}/${sub.name}`;
      if (sub.isFile) {
        files.push(subPrefix);
        continue;
      }
      for (const f of await listDir(subPrefix)) {
        if (f.isFile) files.push(`${subPrefix}/${f.name}`);
      }
    }
  }
  return files;
}

async function part2StorageOrphans(sql: postgres.Sql, env: { supabaseUrl: string; secretKey: string }) {
  console.log('\n── Part 2: Storage 고아 파일 (#40-D) ──');
  const admin = createClient(env.supabaseUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const letterRefs = await sql`SELECT image_url FROM letter_pieces`;
  const collageRefs = await sql`SELECT collage_image_url FROM submissions WHERE collage_image_url IS NOT NULL`;
  const referenced = {
    'letter-pieces': new Set(letterRefs.map((r) => String(r.image_url))),
    collages: new Set(collageRefs.map((r) => String(r.collage_image_url))),
  } as const;

  for (const bucket of ['letter-pieces', 'collages'] as const) {
    const files = await listAllFiles(admin.storage, bucket);
    const orphans = files.filter((f) => !referenced[bucket].has(f));
    console.log(
      `  ${bucket}: 객체 ${files.length}개 / DB 참조 ${referenced[bucket].size}개 / 고아 ${orphans.length}개`,
    );
  }
}

// ─────────────────────────────────────────────
// main
// ─────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  // prepare:false — transaction-mode pooler 호환 (Day 1 확정 결정과 동일)
  // max:2 — Q2/Q3가 앱(A7)처럼 Promise.all로 병렬 실행되도록 커넥션 2개 확보
  const sql = postgres(env.databaseUrl, { prepare: false, max: 2, onnotice: () => {} });

  try {
    // 대상 챌린지: --challenge <uuid> 또는 오늘(KST)의 챌린지
    const argIdx = process.argv.indexOf('--challenge');
    let challengeId = argIdx >= 0 ? process.argv[argIdx + 1] : undefined;
    if (!challengeId) {
      const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const rows = await sql`SELECT id FROM challenges WHERE active_date = ${kstDate}`;
      if (rows.length === 0) throw new Error(`오늘(${kstDate}) 챌린지가 없습니다 — --challenge <uuid>로 지정하세요.`);
      challengeId = String(rows[0].id);
    }

    const { indexUsable } = await part1FeedQuery(sql, challengeId);
    await part2StorageOrphans(sql, env);

    console.log(`\n════ 측정 완료 ════`);
    if (!indexUsable) {
      console.error('경고: idx_submissions_feed가 강제 조건에서도 사용되지 않았습니다 — 인덱스 정의를 점검하세요.');
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('측정 실패:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
