import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { challenges } from '@/db/schema';
import { jsonError } from '@/lib/api/errors';
import { getKSTDateString } from '@/lib/utils/date';

// 비인증 공개 라우트 (proxy 공개 목록, §9 Day2-(c)).
// '오늘'은 날짜마다 바뀌므로 정적 캐싱하지 않고 요청 시 DB를 조회한다.
// 향후 날짜 키 기반 ISR(§6 A1)로 최적화 여지.
export const dynamic = 'force-dynamic';
// Drizzle(postgres) 직결을 쓰므로 Node 전용 런타임을 명시한다.
export const runtime = 'nodejs';

export async function GET() {
  const today = getKSTDateString();

  const [row] = await db
    .select()
    .from(challenges)
    .where(eq(challenges.active_date, today))
    .limit(1);

  if (!row) {
    return jsonError(404, 'CHALLENGE_NOT_FOUND', '오늘의 챌린지가 없습니다.');
  }

  // §6.3 A1 응답: lines(작성자 줄 배치) + letters(슬롯 글자)를 함께 내려 클라이언트 중복 로직 제거.
  return NextResponse.json({
    id: row.id,
    sentence: row.sentence,
    lines: row.lines,
    letters: row.letters,
    active_date: row.active_date,
  });
}
