import { z } from 'zod';

// toggleReaction Server Action 입력 검증 (S1, §6.2/§7.1).
// 클라이언트는 submissionId(UUID)만 전달한다 — user_id는 서버가 인증 사용자로 강제한다.
export const toggleReactionSchema = z.uuid();

export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;
