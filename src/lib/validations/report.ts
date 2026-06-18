import { z } from 'zod';

// createReport Server Action 입력 검증 (S2, §6.2/§7.2). reason 1~500자(트림).
export const REPORT_REASON_MAX = 500;

export const createReportSchema = z.object({
  submission_id: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1, '신고 사유를 입력해 주세요.')
    .max(REPORT_REASON_MAX, `신고 사유는 ${REPORT_REASON_MAX}자 이하여야 합니다.`),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
