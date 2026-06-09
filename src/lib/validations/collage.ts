// 콜라주 이미지 검증 — MVP는 MIME 타입 + 크기까지만 (게이트 A Day4-(d)·Day3-(f), §7.5).
// magic-byte 검사·서버측 EXIF strip·디코딩 유효성은 리스크로 기록 후 이관 (letter-piece와 동일 범위).
export const COLLAGE_IMAGE_MIME = 'image/png';
export const COLLAGE_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2097152 (2MB)

export type CollageImageError = { status: 400 | 413; code: string; message: string };

export function validateCollageImage(file: File): CollageImageError | null {
  if (file.type !== COLLAGE_IMAGE_MIME) {
    return { status: 400, code: 'INVALID_IMAGE_TYPE', message: 'PNG 이미지만 업로드할 수 있습니다.' };
  }
  if (file.size > COLLAGE_IMAGE_MAX_BYTES) {
    return { status: 413, code: 'IMAGE_TOO_LARGE', message: '콜라주는 2MB 이하만 업로드할 수 있습니다.' };
  }
  return null;
}
