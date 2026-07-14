'use server';

import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { reports, submissions } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { createReportSchema } from '@/lib/validations/report';

// 결과는 구조화 객체로 반환한다 — Next.js가 throw한 에러 메시지를 production에서 마스킹하므로,
// 다이얼로그가 사유별 메시지를 보이려면 throw가 아니라 반환값으로 분기해야 한다.
export type CreateReportResult =
  | { ok: true }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'INVALID' | 'SELF_REPORT' | 'NOT_FOUND' | 'REPORT_ALREADY_EXISTS';
    };

// S2 createReport — 신고 생성(reports INSERT). §6.2/§1.6.
// 정책(게이트 A 결정 5): 본인 글 신고 차단(self-report). 중복 신고는 UNIQUE(reporter, submission)
// 제약이 원천 차단(#48, Day 10.5) — onConflictDoNothing으로 멱등 처리해 경합에도 안전하다.
// DB는 Drizzle 직결(RLS 우회)이라 reporter_id 본인 강제·소유권 검증을 코드로 한다.
export async function createReport(input: {
  submissionId: string;
  reason: string;
}): Promise<CreateReportResult> {
  const parsed = createReportSchema.safeParse({
    submission_id: input.submissionId,
    reason: input.reason,
  });
  if (!parsed.success) {
    return { ok: false, code: 'INVALID' };
  }
  const { submission_id: submissionId, reason } = parsed.data;

  // 피드는 인증 필수라 정상 흐름에선 도달이 드물다 — 다이얼로그 작성 중 세션 만료 대비 방어 분기.
  const user = await getAuthUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }

  // 대상 제출 존재 확인 + 본인 글 신고 차단 (존재 자체는 피드에 공개된 항목이므로 은폐 불필요)
  const [target] = await db
    .select({ user_id: submissions.user_id })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!target) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  if (target.user_id === user.id) {
    return { ok: false, code: 'SELF_REPORT' };
  }

  // UNIQUE(reporter_id, submission_id) 충돌 시 조용히 스킵하고 반환 0행으로 감지한다 —
  // "확인 후 삽입"과 달리 동시 요청 경합에서도 정확히 1건만 적재된다 (#48).
  const inserted = await db
    .insert(reports)
    .values({
      reporter_id: user.id,
      submission_id: submissionId,
      reason,
    })
    .onConflictDoNothing({ target: [reports.reporter_id, reports.submission_id] })
    .returning({ id: reports.id });

  if (inserted.length === 0) {
    return { ok: false, code: 'REPORT_ALREADY_EXISTS' };
  }

  return { ok: true };
}
