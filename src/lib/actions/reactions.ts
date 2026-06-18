'use server';

// Server Action 모듈 — Day 7 첫 도입(§6.4: 단순 mutation → Server Action).
// db(Drizzle)·createClient는 서버 전용이므로 클라이언트 번들 유입을 빌드 타임에 차단.
import 'server-only';

import { and, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { reactions } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { toggleReactionSchema } from '@/lib/validations/reaction';

// 토글 후 권위 상태 — 클라이언트는 이 값으로 낙관적 캐시를 정정한다(동시성 드리프트 보정).
export type ToggleReactionResult = {
  user_reacted: boolean;
  reaction_count: number;
};

// S1 toggleReaction — 좋아요 토글(INSERT or DELETE, UPDATE 없음). §6.2/§6.3.
//
// DB는 Drizzle 직결(RLS 우회)이라 본인 강제를 코드로 한다: user_id는 항상 서버의 인증
// 사용자 id로 고정하고, 클라이언트가 보낸 값은 submissionId(UUID)뿐이다.
// UNIQUE(user_id, submission_id)가 멱등성의 근거 — 동시 INSERT 경합은 onConflictDoNothing으로
// 흡수하고, DELETE는 0행이어도 무해하다. 토글 직후 실제 상태/카운트를 재조회해 반환하므로
// 경합 상황에서도 반환값은 항상 DB의 권위값이다.
//
// 동시성 주의: 동일 사용자의 두 토글 요청이 거의 동시에 도착하면 최종 방향(좋아요/취소)은
// 도착 순서에 의존한다. UNIQUE 제약이 무결성을 보존하고 반환 권위값이 UX를 self-correct하며,
// 클라이언트는 isPending으로 카드별 연타를 막는다(use-reaction/FeedCard).
export async function toggleReaction(submissionId: string): Promise<ToggleReactionResult> {
  const parsed = toggleReactionSchema.safeParse(submissionId);
  if (!parsed.success) {
    throw new Error('INVALID_SUBMISSION_ID');
  }
  const id = parsed.data;

  const user = await getAuthUser();
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }

  // 1. 현재 본인 반응 존재 여부
  const existing = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(and(eq(reactions.user_id, user.id), eq(reactions.submission_id, id)))
    .limit(1);

  // 2. 있으면 취소(DELETE), 없으면 좋아요(INSERT). 경합은 멱등 처리.
  if (existing.length > 0) {
    await db
      .delete(reactions)
      .where(and(eq(reactions.user_id, user.id), eq(reactions.submission_id, id)));
  } else {
    await db
      .insert(reactions)
      .values({ user_id: user.id, submission_id: id })
      .onConflictDoNothing();
  }

  // 3. 토글 후 실제 상태/카운트 재조회 → 권위값 반환
  const [countRow] = await db
    .select({ value: count() })
    .from(reactions)
    .where(eq(reactions.submission_id, id));

  const [mine] = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(and(eq(reactions.user_id, user.id), eq(reactions.submission_id, id)))
    .limit(1);

  return {
    user_reacted: mine !== undefined,
    reaction_count: countRow?.value ?? 0,
  };
}
