// Phase 3 Day 10.5 (#50) — A6 콜라주 업로드 프로파일링 스크립트 (자체 정리형).
//
// 왜 이 스크립트가 필요한가:
//   Day 10 실측에서 A6(콜라주 업로드)가 10,560ms로 제출 체인의 지배 비용이었지만 **단일
//   표본**이라 결론이 유보됐다 (docs/verification/phase3-integration.md §3·§5 P-1).
//   재측정에는 draft 제출이 필요한데 본계정·보조계정 모두 오늘 제출이 completed라
//   라우트 반복 호출이 불가하다 → 테스트 계정 + 직접 Storage/DB 접근으로 A6의 구성 요소
//   (Storage 업로드 왕복 / DB UPDATE / signed URL / 인증 왕복)를 콜드·웜 분리해 반복 측정한다.
//   Next 핸들러 내부 분해는 라우트의 Server-Timing 헤더(같은 Day 계측)가 실제 제출에서 보완한다.
//
// 안전 등급: verify-rls.ts와 같은 자체 정리형(self-cleaning) — 테스트 계정·draft 제출·
//   Storage 객체를 만들지만 finally에서 전부 삭제해 순 변화 0. 웜 측정은 같은 path에
//   upsert 덮어쓰기라 객체가 늘지 않는다. 어떤 secret도 출력하지 않는다(presence boolean만).
//
// 실행 (프로젝트 루트, .env.local 필요):
//   pnpm dlx tsx scripts/profile-collage-upload.ts             # 웜 10회
//   pnpm dlx tsx scripts/profile-collage-upload.ts --runs 20   # 웜 20회

import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
    throw new Error('필수 환경 변수 누락 — .env.local을 확인하세요.');
  }
  return env as {
    databaseUrl: string;
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  };
}

// ─────────────────────────────────────────────
// 통계 유틸 (measure-perf.ts와 동일)
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
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

async function timed(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

// A6 실측 payload와 동일한 199KB PNG (Storage는 declared content-type + size만 검사 —
// verify-rls.ts의 1x1 픽셀 프로브와 같은 근거. 랜덤 바이트라 압축 이득 없음 = 전송량 보수적).
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DUMMY_COLLAGE = Buffer.concat([
  PNG_SIGNATURE,
  randomBytes(199 * 1024 - PNG_SIGNATURE.length),
]);

// ─────────────────────────────────────────────
// 테스트 계정 (verify-rls.ts와 동일 라이프사이클)
// ─────────────────────────────────────────────
async function createTestUser(
  admin: SupabaseClient,
): Promise<{ id: string; email: string; password: string }> {
  const email = `collage-perf-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`; // in-process only — 절대 출력하지 않는다
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`테스트 계정 생성 실패: ${error?.message ?? 'no user'}`);
  return { id: data.user.id, email, password };
}

// ─────────────────────────────────────────────
// main
// ─────────────────────────────────────────────
async function main() {
  const runsIdx = process.argv.indexOf('--runs');
  const runs = runsIdx >= 0 ? Math.max(1, Number(process.argv[runsIdx + 1]) || 10) : 10;

  const env = loadEnv();
  const sql = postgres(env.databaseUrl, { prepare: false });
  const admin = createClient(env.supabaseUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let user: { id: string; email: string; password: string } | undefined;
  let submissionId: string | undefined;
  const createdPaths: string[] = [];

  try {
    // 1) 테스트 계정 + draft 제출 fixture (완성하지 않음 — 피드·/s에 노출되지 않는다)
    console.log('테스트 계정·draft 제출 생성 중...');
    user = await createTestUser(admin);
    const chals = await sql<{ id: string }[]>`SELECT id FROM challenges ORDER BY active_date LIMIT 1`;
    if (chals.length === 0) throw new Error('challenge가 없습니다 (seed-challenges.ts 먼저 실행).');
    submissionId = randomUUID();
    await sql`INSERT INTO submissions (id, user_id, challenge_id, status, is_public)
      VALUES (${submissionId}, ${user.id}, ${chals[0].id}, 'draft', false)`;
    // 클로저 안에서 narrowing이 풀리지 않도록 지역 상수로 좁힌다 (단언 회피)
    const uid = user.id;
    const sid = submissionId;
    const mainPath = `${uid}/${sid}/collage.png`;

    // 2) 실계정 JWT 로그인 — 라우트(A6)와 같은 사용자 컨텍스트로 Storage 정책을 통과시킨다
    const client = createClient(env.supabaseUrl, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    if (signInError) throw new Error(`로그인 실패: ${signInError.message}`);

    console.log(`\n측정 조건: 199KB PNG, 웜 ${runs}회, 로컬 → 라이브 Supabase (Day 10 §3과 동일 환경)`);

    // 3) 인증 왕복 (라우트의 getAuthUser = supabase.auth.getUser 상당)
    const authSamples: number[] = [];
    for (let i = 0; i < runs; i++) {
      authSamples.push(
        await timed(async () => {
          const { error } = await client.auth.getUser();
          if (error) throw new Error(`auth.getUser 실패: ${error.message}`);
        }),
      );
    }

    console.log('\n── A6 구성 요소 분해 ──');
    summarize('인증 왕복 (auth.getUser)', authSamples);

    // 4) Storage 업로드 — 콜드 1회(새 객체) + 웜 N회.
    //    웜은 매회 새 경로(INSERT)를 쓴다: 같은 path upsert(UPDATE)는 collages_update 정책(#80,
    //    마이그레이션 0006) 적용 전에는 RLS에 차단되기 때문 — 전송·왕복 비용 측정에는 동일하다.
    //    finally에서 전부 삭제해 순 변화 0.
    const uploadTo = async (targetPath: string) => {
      const { error } = await client.storage
        .from('collages')
        .upload(targetPath, DUMMY_COLLAGE, { contentType: 'image/png', upsert: true });
      if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
      if (!createdPaths.includes(targetPath)) createdPaths.push(targetPath);
    };
    const cold = await timed(() => uploadTo(mainPath));
    console.log(`  Storage 업로드 콜드(첫 요청): ${cold.toFixed(1)}ms`);
    const uploadSamples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const warmPath = `${uid}/${sid}/warm-${i}.png`;
      uploadSamples.push(await timed(() => uploadTo(warmPath)));
    }
    const uploadStats = summarize('Storage 업로드 웜 (199KB, 새 객체)', uploadSamples);

    // 4b) #80 상태 프로브 — 같은 path 덮어쓰기(upsert=UPDATE) 허용 여부.
    //     0006 적용 전: blocked(결함 재현) / 적용 후: allowed(수정 확인) — 회귀 지표를 겸한다.
    const { error: overwriteError } = await client.storage
      .from('collages')
      .upload(mainPath, DUMMY_COLLAGE, { contentType: 'image/png', upsert: true });
    console.log(
      `  같은 path 덮어쓰기(#80, collages_update): ${overwriteError ? `blocked — ${overwriteError.message}` : 'allowed'}`,
    );

    // 5) DB UPDATE (라우트의 collage_image_url 갱신과 동일 레이어 — DATABASE_URL 직결)
    const dbSamples: number[] = [];
    for (let i = 0; i < runs; i++) {
      dbSamples.push(
        await timed(async () => {
          await sql`UPDATE submissions SET collage_image_url = ${mainPath}
            WHERE id = ${sid} AND user_id = ${uid}`;
        }),
      );
    }
    summarize('DB UPDATE (collage_image_url)', dbSamples);

    // 6) signed URL 발급 (라우트의 createSignedUrl 상당)
    const signSamples: number[] = [];
    for (let i = 0; i < runs; i++) {
      signSamples.push(
        await timed(async () => {
          const { error } = await client.storage
            .from('collages')
            .createSignedUrl(mainPath, 3600);
          if (error) throw new Error(`signed URL 실패: ${error.message}`);
        }),
      );
    }
    summarize('signed URL 발급', signSamples);

    // 7) 판정 가이드 — Day 10 단일 표본(10,560ms)과 대조
    console.log('\n── 판정 (Day 10 A6 = 10,560ms 단일 표본 대조) ──');
    console.log(`  웜 업로드 p50 ${uploadStats.p50.toFixed(0)}ms / p95 ${uploadStats.p95.toFixed(0)}ms`);
    if (uploadStats.p50 >= 3000) {
      console.log('  → Storage 왕복이 안정적으로 수 초대 = A6 지배 재확인. 병렬화(~0.5s)보다 A6 원인 대응이 우선.');
    } else {
      console.log('  → 웜 업로드가 정상 범위 = Day 10의 10.6s는 콜드/이상치 가능성. 남은 개선은 글자 병렬화.');
      console.log('    (핸들러 내부 오버헤드는 다음 실제 제출의 Server-Timing 헤더로 검산)');
    }
  } finally {
    // 정리 — Storage 객체 → 제출 행 → 테스트 계정 순 (순 변화 0)
    if (createdPaths.length > 0)
      await admin.storage.from('collages').remove(createdPaths).catch(() => {});
    if (submissionId) await sql`DELETE FROM submissions WHERE id = ${submissionId}`.catch(() => {});
    if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
    console.log('\n테스트 계정·fixture 정리 완료 (순 변화 0).');
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('프로파일링 실패:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
