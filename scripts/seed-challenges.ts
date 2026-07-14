// 챌린지 seed — 마이그레이션 lineage 밖의 별도 데이터 주입 (게이트 A Day3-(d)).
// 데이터는 스키마와 분리(마이그레이션 INSERT는 모든 환경 강제). 수동 1회 실행.
//
// 실행: pnpm dlx tsx scripts/seed-challenges.ts   (프로젝트 루트에서, .env.local 필요)
//
// 불변식: sentence = lines.join(' '), letters = lines.flatMap(parseSentence).
// 06-04까지는 Phase 1 mock(src/lib/constants/challenges.ts)과 1:1 정합,
// 06-05 이후(오늘 2026-06-09 포함 ~06-30까지)는 작성자가 lines를 직접 지정해 추가한다.
// Day 4: /today 404 방지를 위해 월말까지 넉넉히 연장 (게이트 A Day4-(f)).
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { challenges, type NewChallenge } from '../src/db/schema';
import { MOCK_CHALLENGES } from '../src/lib/constants/challenges';
import { parseSentence } from '../src/lib/utils/sentence-parser';
import { challengeContentSchema } from '../src/lib/validations/challenge';

// .env.local 로더 — Node의 process.loadEnvFile는 '탭 들여쓰기'된 키를 누락한다(Next/dotenv 로더는
// 관대해 dev 서버는 정상 연결됨). 그래서 BOM·CR 제거 + 각 줄 앞 공백 트림으로 정규화한 뒤 parseEnv로
// 읽는다(공백/탭 들여쓰기·CRLF 모두 흡수). 이미 설정된 값(셸 export)은 덮어쓰지 않는다.
function loadEnvLocal(path = '.env.local'): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // 파일이 없으면 스킵 — 아래 DATABASE_URL 체크가 안내 메시지를 던진다.
  }
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const normalized = noBom
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s+/, ''))
    .join('\n');
  for (const [key, value] of Object.entries(parseEnv(normalized))) {
    if (process.env[key] === undefined) process.env[key] = String(value);
  }
}

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

// 2026-06-05 이후 (오늘 2026-06-09 포함 ~06-30) — `/today`가 한 달간 동작하도록 마진을 둔다.
const EXTRA_ROWS: NewChallenge[] = [
  fromLines(['좋은 하루'], '2026-06-05'),
  fromLines(['천천히', '걸어요'], '2026-06-06'),
  fromLines(['여기 있어'], '2026-06-07'),
  fromLines(['오늘 햇살'], '2026-06-08'),
  fromLines(['고마운 하루'], '2026-06-09'),
  fromLines(['잠깐 쉬어', '가요'], '2026-06-10'),
  fromLines(['수고했어요'], '2026-06-11'),
  fromLines(['좋은 생각'], '2026-06-12'),
  fromLines(['느리게', '걸어도'], '2026-06-13'),
  fromLines(['오늘 한 컷'], '2026-06-14'),
  fromLines(['반가워요'], '2026-06-15'),
  fromLines(['작은 행복'], '2026-06-16'),
  fromLines(['깊게 숨쉬어'], '2026-06-17'),
  fromLines(['맑은 하늘'], '2026-06-18'),
  fromLines(['오늘 기록'], '2026-06-19'),
  fromLines(['함께 걸어'], '2026-06-20'),
  fromLines(['조용한 아침'], '2026-06-21'),
  fromLines(['빛나는 순간'], '2026-06-22'),
  fromLines(['고요한 밤'], '2026-06-23'),
  fromLines(['새로운 길'], '2026-06-24'),
  fromLines(['따뜻한 말'], '2026-06-25'),
  fromLines(['쉬어 가도', '괜찮아'], '2026-06-26'),
  fromLines(['오늘 한 걸음'], '2026-06-27'),
  fromLines(['웃는 하루'], '2026-06-28'),
  fromLines(['마음 한 켠'], '2026-06-29'),
  fromLines(['잘 지냈어'], '2026-06-30'),
  // 2026-07 연장 — /today 404 방지(월이 넘어가면 seed 재실행 필요). Day 9 E2E용 마진.
  fromLines(['오늘 여기'], '2026-07-01'),
  fromLines(['좋은 아침'], '2026-07-02'),
  fromLines(['여름 하루'], '2026-07-03'),
  fromLines(['천천히', '가요'], '2026-07-04'),
  fromLines(['맑은 바람'], '2026-07-05'),
  fromLines(['오늘 한 컷'], '2026-07-06'),
  fromLines(['가벼운 발'], '2026-07-07'),
  fromLines(['시원한 물'], '2026-07-08'),
  fromLines(['조용한 낮'], '2026-07-09'),
  fromLines(['반짝이는 밤'], '2026-07-10'),
  fromLines(['깊은 숨'], '2026-07-11'),
  fromLines(['느긋한 오후'], '2026-07-12'),
  fromLines(['작은 쉼'], '2026-07-13'),
  fromLines(['고마운 날'], '2026-07-14'),
  // 2026-07-15 ~ 08-31 연장 (Day 10.5 사용자 요청 — 8월 말까지. 여름 시즌 문구)
  fromLines(['시원한 바람'], '2026-07-15'),
  fromLines(['여름밤 산책'], '2026-07-16'),
  fromLines(['수박 한 조각'], '2026-07-17'),
  fromLines(['파란 바다'], '2026-07-18'),
  fromLines(['구름 그늘'], '2026-07-19'),
  fromLines(['매미 소리'], '2026-07-20'),
  fromLines(['찬물 한 잔'], '2026-07-21'),
  fromLines(['긴 낮의 끝'], '2026-07-22'),
  fromLines(['소나기', '지나가요'], '2026-07-23'),
  fromLines(['부채질 한 번'], '2026-07-24'),
  fromLines(['여름의 맛'], '2026-07-25'),
  fromLines(['낮잠 한 숨'], '2026-07-26'),
  fromLines(['시원한 그늘'], '2026-07-27'),
  fromLines(['별 헤는 밤'], '2026-07-28'),
  fromLines(['바다 내음'], '2026-07-29'),
  fromLines(['오늘도 무사히'], '2026-07-30'),
  fromLines(['칠월의 끝'], '2026-07-31'),
  fromLines(['팔월의 시작'], '2026-08-01'),
  fromLines(['한여름 밤'], '2026-08-02'),
  fromLines(['얼음 동동'], '2026-08-03'),
  fromLines(['여름 휴가'], '2026-08-04'),
  fromLines(['파도 소리'], '2026-08-05'),
  fromLines(['모래 위 발자국'], '2026-08-06'),
  fromLines(['시원한 저녁'], '2026-08-07'),
  fromLines(['여름 일기'], '2026-08-08'),
  fromLines(['천천히', '흘러가요'], '2026-08-09'),
  fromLines(['그늘 아래서'], '2026-08-10'),
  fromLines(['한 뼘의 여유'], '2026-08-11'),
  fromLines(['빙수 한 그릇'], '2026-08-12'),
  fromLines(['여름 노을'], '2026-08-13'),
  fromLines(['밤바람 산책'], '2026-08-14'),
  fromLines(['잠깐의 휴식'], '2026-08-15'),
  fromLines(['여름의 기록'], '2026-08-16'),
  fromLines(['맑은 아침'], '2026-08-17'),
  fromLines(['소소한 기쁨'], '2026-08-18'),
  fromLines(['오늘의 온도'], '2026-08-19'),
  fromLines(['느린 저녁'], '2026-08-20'),
  fromLines(['별빛 아래'], '2026-08-21'),
  fromLines(['시원한 새벽'], '2026-08-22'),
  fromLines(['남은 여름'], '2026-08-23'),
  fromLines(['가만히 쉬어'], '2026-08-24'),
  fromLines(['늦여름 바람'], '2026-08-25'),
  fromLines(['하루의 끝'], '2026-08-26'),
  fromLines(['작은 설렘'], '2026-08-27'),
  fromLines(['시원한 밤공기'], '2026-08-28'),
  fromLines(['고요한 여름'], '2026-08-29'),
  fromLines(['여름아 안녕'], '2026-08-30'),
  fromLines(['여름의 끝자락'], '2026-08-31'),
];

async function main() {
  const rows = [...MOCK_ROWS, ...EXTRA_ROWS];

  // 불변식·빈 배열 금지(.min(1))를 주입 전에 검증한다.
  for (const row of rows) {
    challengeContentSchema.parse(row);
  }

  loadEnvLocal();
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
