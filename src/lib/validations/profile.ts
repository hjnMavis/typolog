import { z } from 'zod';

// updateProfile Server Action 입력 검증 (S3, §6.2/§7.2). 닉네임 2~20자(트림·XSS 문자 제거).
// 클라이언트(프로필 수정 Sheet)와 서버(S3)가 같은 스키마를 공유한다 — 즉시 피드백 + 서버 재검증.
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

// 제어문자(\p{Cc})·포맷문자(\p{Cf}: zero-width·RTL override 등 보이지 않는 스푸핑 문자)와
// 꺾쇠(<,>)를 제거한 뒤 길이를 검증한다. transform이 먼저 정제하고 pipe가 정제된 문자열의
// 길이를 검사하므로, "<<<" 같은 입력은 빈 문자열이 되어 min 위반으로 거부된다(닉네임은 unique 아님).
export const updateProfileSchema = z.object({
  nickname: z
    .string()
    .transform((s) => s.trim().replace(/[\p{Cc}\p{Cf}<>]/gu, ''))
    .pipe(
      z
        .string()
        .min(NICKNAME_MIN, `닉네임은 ${NICKNAME_MIN}자 이상이어야 해요.`)
        .max(NICKNAME_MAX, `닉네임은 ${NICKNAME_MAX}자 이하여야 해요.`),
    ),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
