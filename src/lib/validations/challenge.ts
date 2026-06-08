import { z } from 'zod';

// 챌린지 식별자 — UUID v4 (§7.2)
export const challengeIdSchema = z.uuid();

// 챌린지 본문 불변식 검증 (seed에서 사용).
// Day 1 이관(게이트 A Day3-(g)): lines/letters 빈 배열 금지 → .min(1).
// 불변식: sentence = lines.join(' '), letters = lines.flatMap(parseSentence).
export const challengeContentSchema = z.object({
  sentence: z.string().min(1),
  lines: z.array(z.string().min(1)).min(1),
  letters: z.array(z.string().min(1)).min(1),
  active_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'active_date must be YYYY-MM-DD'),
});

export type ChallengeContent = z.infer<typeof challengeContentSchema>;
