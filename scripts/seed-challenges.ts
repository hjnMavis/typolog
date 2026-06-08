// 챌린지 seed — 마이그레이션 lineage 밖의 별도 데이터 주입 (게이트 A Day3-(d)).
// 데이터는 스키마와 분리(마이그레이션 INSERT는 모든 환경 강제). 수동 1회 실행.
//
// 실행: pnpm dlx tsx scripts/seed-challenges.ts   (프로젝트 루트에서, .env.local 필요)
//
// 불변식: sentence = lines.join(' '), letters = lines.flatMap(parseSentence).
// 06-04까지는 Phase 1 mock(src/lib/constants/challenges.ts)과 1:1 정합,
// 06-05 이후(오늘 2026-06-08 포함 ±며칠)는 작성자가 lines를 직접 지정해 추가한다.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { challenges, type NewChallenge } from '../src/db/schema';
import { MOCK_CHALLENGES } from '../src/lib/constants/challenges';
import { parseSentence } from '../src/lib/utils/sentence-parser';
import { challengeContentSchema } from '../src/lib/validations/challenge';

// 작성자 지정 lines를 단일 소스로 sentence/letters를 파생 (mock의 challenge() 빌더와 동일).
function fromLines(lines: string[], activeDate: string): NewChallenge {
  return {
    lines,
    sentence: lines.join(' '),
    letters: lines.flatMap(parseSentence),
    active_date: activeDate,
  };
}

// Phase 1 mock 10건 (2026-05-26 ~ 2026-06-04) — 파생값 그대로 재사용해 정합 보장.
const MOCK_ROWS: NewChallenge[] = MOCK_CHALLENGES.map((c) => ({
  lines: c.lines,
  sentence: c.sentence,
  letters: c.letters,
  active_date: c.activeDate,
}));

// 2026-06-05 이후 (오늘 2026-06-08 포함 ±며칠) — `/today`가 동작하도록 충분한 마진을 둔다.
const EXTRA_ROWS: NewChallenge[] = [
  fromLines(['좋은 하루'], '2026-06-05'),
  fromLines(['천천히', '걸어요'], '2026-06-06'),
  fromLines(['여기 있어'], '2026-06-07'),
  fromLines(['오늘 햇살'], '2026-06-08'),
  fromLines(['고마운 하루'], '2026-06-09'),
  fromLines(['잠깐 쉬어', '가요'], '2026-06-10'),
  fromLines(['수고했어요'], '2026-06-11'),
];

async function main() {
  const rows = [...MOCK_ROWS, ...EXTRA_ROWS];

  // 불변식·빈 배열 금지(.min(1))를 주입 전에 검증한다.
  for (const row of rows) {
    challengeContentSchema.parse(row);
  }

  process.loadEnvFile('.env.local');
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add the Session pooler URI (5432) to .env.local.');
  }

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema: { challenges } });

  try {
    // active_date UNIQUE 기준 UPSERT — 재실행 시 본문을 최신 lines로 갱신(idempotent).
    await db
      .insert(challenges)
      .values(rows)
      .onConflictDoUpdate({
        target: challenges.active_date,
        set: {
          sentence: sql`excluded.sentence`,
          lines: sql`excluded.lines`,
          letters: sql`excluded.letters`,
        },
      });

    const [{ count }] = await client`SELECT count(*)::int AS count FROM challenges`;
    console.log(`Seeded ${rows.length} rows. challenges total = ${count}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
