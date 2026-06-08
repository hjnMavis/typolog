import { z } from 'zod';

export const LETTER_IMAGE_MIME = 'image/webp';
export const LETTER_IMAGE_MAX_BYTES = 500 * 1024; // 512000 (500KB)

// POST /api/submissions/[id]/letters 의 FormData 비-파일 필드 (§6.3 A5).
// FormData 값은 문자열로 도착하므로 coerce로 숫자 변환한다.
// width/height: 클라이언트 crop 단계에서 산출되는 실제 픽셀 크기 (letter_pieces.width/height NOT NULL,
// 콜라주 비율 계산용 §1.4). 서버 디코딩은 MVP 제외라 클라이언트가 함께 전송한다.
export const uploadLetterSchema = z.object({
  slot_index: z.coerce.number().int().min(0),
  character: z
    .string()
    .refine((s) => [...s].length === 1, { message: 'character must be exactly one character' }),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
});

export type UploadLetterInput = z.infer<typeof uploadLetterSchema>;

export type LetterImageError = { status: 400 | 413; code: string; message: string };

// 이미지 파일 검증 — MVP는 MIME 타입 + 크기까지만 (게이트 A Day3-(f), §7.5).
// magic-byte 검사·서버측 EXIF strip·디코딩 유효성은 리스크로 기록 후 이관.
export function validateLetterImage(file: File): LetterImageError | null {
  if (file.type !== LETTER_IMAGE_MIME) {
    return { status: 400, code: 'INVALID_IMAGE_TYPE', message: 'WebP 이미지만 업로드할 수 있습니다.' };
  }
  if (file.size > LETTER_IMAGE_MAX_BYTES) {
    return { status: 413, code: 'IMAGE_TOO_LARGE', message: '이미지는 500KB 이하만 업로드할 수 있습니다.' };
  }
  return null;
}
