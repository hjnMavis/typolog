'use server';

// Server Action 모듈 (§6.4: 단순 mutation → Server Action). Day 7 좋아요 토글 패턴 재사용.
// db(Drizzle)·createClient는 서버 전용이므로 클라이언트 번들 유입을 빌드 타임에 차단.
import 'server-only';

import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { submissions } from '@/db/schema';
import { getAuthUser, getOwnedSubmission } from '@/lib/api/auth';

// 토글 입력 — 클라이언트가 보내는 건 submissionId(UUID) + isPublic(boolean)뿐이다.
// user_id는 서버 인증 사용자로 강제한다(아래). 토글 전용이라 validations/ 공유 스키마 대신
// 액션 로컬에 둔다(클라엔 의미 있는 추가 검증 없음 — 불리언 토글).
const updateVisibilitySchema = z.object({
  submissionId: z.uuid(),
  isPublic: z.boolean(),
});

// 토글 후 권위값 — 클라이언트는 이 값으로 낙관적 캐시를 정정한다(Day 7 onSuccess 패턴).
export type UpdateVisibilityResult = {
  is_public: boolean;
};

// S4 updateSubmissionVisibility — 완성 제출의 공개/비공개 토글. §6.2/§6.3.
// #60 제품결정(B): 완성 = 확정(재편집 불가), 공개여부만 토글한다.
//
// DB는 Drizzle 직결(RLS 우회)이라 소유권을 코드로 강제한다(Day 7 §5):
//  - getOwnedSubmission이 타인 소유·미존재를 동일하게 null로 → NOT_FOUND throw로 존재 은폐(§7.4).
//  - hidden은 소유자도 수정 불가(RLS §3.3 정합, fail-closed) → HIDDEN throw.
//  - 완성작만 토글 대상(draft의 is_public은 공개 정책상 노출 효과가 없음) → NOT_COMPLETED throw.
// 최종 UPDATE는 소유권 + non-hidden을 WHERE에서 재확인하는 조건부 UPDATE라 TOCTOU에 안전하다(A4와 동일).
// 실패는 throw로 전달한다 — 클라이언트가 할 일은 낙관값 롤백뿐이라 사유별 메시지가 불필요하다(Day 7 §6).
export async function updateSubmissionVisibility(input: {
  submissionId: string;
  isPublic: boolean;
}): Promise<UpdateVisibilityResult> {
  const parsed = updateVisibilitySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('INVALID_INPUT');
  }
  const { submissionId, isPublic } = parsed.data;

  const user = await getAuthUser();
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }

  // 소유권 — 타인 소유·미존재 모두 null → 동일 NOT_FOUND로 존재 은폐.
  const submission = await getOwnedSubmission(submissionId, user.id);
  if (!submission) {
    throw new Error('NOT_FOUND');
  }
  if (submission.status === 'hidden') {
    throw new Error('HIDDEN');
  }
  if (submission.status !== 'completed') {
    throw new Error('NOT_COMPLETED');
  }

  // 조건부 UPDATE — 소유권 + completed + non-hidden 가드를 WHERE에서 재확인(TOCTOU 방어, RLS §3.3 정합).
  // 읽기 시점 검사(NOT_COMPLETED/HIDDEN)와 대칭을 맞춰, 그 사이 상태가 바뀐 경합도 0행 → NOT_FOUND로 통일.
  const [updated] = await db
    .update(submissions)
    .set({ is_public: isPublic })
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.user_id, user.id),
        eq(submissions.status, 'completed'),
        ne(submissions.status, 'hidden'),
      ),
    )
    .returning({ is_public: submissions.is_public });

  if (!updated) {
    throw new Error('NOT_FOUND');
  }

  return { is_public: updated.is_public };
}
