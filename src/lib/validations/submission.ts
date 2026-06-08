import { z } from 'zod';
import { challengeIdSchema } from './challenge';

// route param [id] 검증용 (submission UUID)
export const submissionIdSchema = z.uuid();

// POST /api/submissions body (§6.3 A2)
export const createSubmissionSchema = z.object({
  challenge_id: challengeIdSchema,
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
