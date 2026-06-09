// NextResponse를 쓰는 서버 전용 모듈 — 클라이언트 번들 유입을 빌드 타임에 명시적으로 차단
// (Day 3 QA L1). 실제로도 NextResponse는 클라이언트에서 동작하지 않는다.
import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import type { Submission } from '@/db/schema';

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

// 중복 제출(POST /api/submissions) 409 전용 바디 — 표준 에러(error/code)에 도메인 페이로드
// (기존 submission)를 더한 형태. 클라이언트가 기존 draft를 이어서 진행하도록 함께 내려준다.
// 일반 에러와 구분되는 전용 타입이라 jsonError가 아닌 별도 빌더로 둔다 (Day 3 QA M2).
export type SubmissionConflictBody = ApiErrorBody & {
  submission: Submission | null;
};

export function submissionConflict(existing: Submission | null): NextResponse {
  const body: SubmissionConflictBody = {
    error: '이미 제출이 존재합니다.',
    code: 'SUBMISSION_EXISTS',
    submission: existing,
  };
  return NextResponse.json(body, { status: 409 });
}
