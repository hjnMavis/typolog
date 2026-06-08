import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

// 표준 에러 응답 형식 (§7.4)
export type ApiErrorBody = {
  error: string; // 사용자 표시용 메시지
  code: string; // 프로그래밍용 코드
  details?: unknown; // zod 이슈 등 상세 (개발 모드에서만 노출)
};

// 상태코드 규약 (§7.4): 400 validation / 401 미인증 / 403 권한없음 / 404 미존재 /
// 409 충돌 / 413 파일초과. 비공개 리소스에 타인 접근 시 403이 아니라 404로 존재 은폐.
export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  const body: ApiErrorBody = { error: message, code };
  if (details !== undefined && process.env.NODE_ENV !== 'production') {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

// zod 파싱 실패 → 400. issues는 v3/v4 공통으로 안정적인 표면.
export function validationError(error: ZodError): NextResponse {
  return jsonError(400, 'VALIDATION_ERROR', '요청 형식이 올바르지 않습니다.', error.issues);
}
