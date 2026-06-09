import { z } from 'zod';
import { challengeIdSchema } from './challenge';

// route param [id] 검증용 (submission UUID)
export const submissionIdSchema = z.uuid();

// POST /api/submissions body (§6.3 A2)
export const createSubmissionSchema = z.object({
  challenge_id: challengeIdSchema,
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

// PATCH /api/submissions/[id] body (§6.3 A4).
// status는 'completed' 전이만 허용한다 — 'draft'(역전)·'hidden'(서비스 키 전용)은 스키마에서 원천 차단.
// 전이 전제(모든 슬롯 + 콜라주)는 라우트에서 검증한다. is_public은 공개/비공개 토글.
// 최소 하나의 필드는 있어야 한다 (빈 PATCH 방지).
export const updateSubmissionSchema = z
  .object({
    status: z.literal('completed').optional(),
    is_public: z.boolean().optional(),
  })
  .refine((d) => d.status !== undefined || d.is_public !== undefined, {
    message: 'status 또는 is_public 중 하나는 필요합니다.',
  });

export type UpdateSubmissionInput = z.infer<typeof updateSubmissionSchema>;
