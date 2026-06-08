import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { challenges, submissions } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { jsonError, validationError } from '@/lib/api/errors';
import { createSubmissionSchema } from '@/lib/validations/submission';

// Drizzle(postgres) 직결을 쓰므로 Node 전용 런타임을 명시한다.
export const runtime = 'nodejs';

// KST(Asia/Seoul) 기준 YYYY-MM-DD — Phase 1 mock과 동일 규칙.
function getKSTDateString(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// POST /api/submissions — 새 draft 생성 (§6.3 A2)
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', '요청 본문을 해석할 수 없습니다.');
  }

  const parsed = createSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const { challenge_id } = parsed.data;

  // 오늘의 챌린지가 맞는지 확인 — 존재하지 않거나 오늘이 아니면 404
  const today = getKSTDateString();
  const [challenge] = await db
    .select({ active_date: challenges.active_date })
    .from(challenges)
    .where(eq(challenges.id, challenge_id))
    .limit(1);
  if (!challenge || challenge.active_date !== today) {
    return jsonError(404, 'CHALLENGE_NOT_FOUND', '오늘의 챌린지가 아닙니다.');
  }

  // 중복 방지 — UNIQUE(user_id, challenge_id) 경합까지 원자적으로 처리한다.
  // user_id는 인증 사용자로 서버가 지정(클라이언트 입력 무시) → 타인 명의 생성 불가.
  const [created] = await db
    .insert(submissions)
    .values({ user_id: user.id, challenge_id, status: 'draft' })
    .onConflictDoNothing({ target: [submissions.user_id, submissions.challenge_id] })
    .returning();

  if (!created) {
    // 이미 존재 → 409. 기존 제출을 함께 돌려줘 클라이언트가 이어서 진행하도록 한다.
    const [existing] = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.user_id, user.id), eq(submissions.challenge_id, challenge_id)))
      .limit(1);
    return NextResponse.json(
      { error: '이미 제출이 존재합니다.', code: 'SUBMISSION_EXISTS', submission: existing ?? null },
      { status: 409 },
    );
  }

  return NextResponse.json(created, { status: 201 });
}
