// 클라이언트(브라우저)에서 Route Handler를 호출하는 typed fetcher 모음.
// TanStack Query의 queryFn/mutationFn에서 사용한다.
// 서버 전용 모듈(@/lib/api/* — 'server-only' 가드)은 import하지 않는다.
// 응답 와이어 타입은 @/types/api에서 서버와 공유한다.

import type { Challenge } from '@/types';
import type {
  ApiCollageUploadResult,
  ApiErrorResponse,
  ApiFeedResponse,
  ApiSubmission,
  ApiSubmissionConflict,
  ApiSubmissionDetail,
  ApiTodayChallenge,
  ApiUploadedLetter,
} from '@/types/api';

// 표준 에러 바디(§7.4)를 담는 클라이언트 에러.
// code로 분기해 UI 메시지·재시도 여부를 판단한다 (예: CHALLENGE_NOT_FOUND, SUBMISSION_INCOMPLETE).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// 실패 응답 → ApiError. 바디가 표준 형식이 아니어도(프록시 HTML 에러 페이지 등) 안전하게 변환한다.
async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorResponse> = {};
  try {
    body = (await res.json()) as Partial<ApiErrorResponse>;
  } catch {
    // 비-JSON 바디 — 상태 코드만으로 에러를 만든다
  }
  return new ApiError(
    res.status,
    body.code ?? 'UNKNOWN',
    body.error ?? `요청에 실패했습니다 (HTTP ${res.status})`,
  );
}

// A1 — 오늘의 챌린지. 와이어(active_date)를 기존 클라이언트 Challenge(activeDate)로 매핑해
// 화면 컴포넌트가 Phase 1과 같은 타입을 그대로 쓰게 한다.
export async function fetchTodayChallenge(): Promise<Challenge> {
  const res = await fetch('/api/challenges/today');
  if (!res.ok) throw await toApiError(res);
  const data = (await res.json()) as ApiTodayChallenge;
  return {
    id: data.id,
    lines: data.lines,
    sentence: data.sentence,
    letters: data.letters,
    activeDate: data.active_date,
  };
}

// A2 — draft 생성. 이미 있으면(409 SUBMISSION_EXISTS) 기존 submission을 돌려준다(create-or-get).
// DB UNIQUE(user_id, challenge_id)가 멱등성을 보장하므로 클라이언트는 submission id를
// 따로 저장하지 않고 제출 시점마다 이 함수로 얻는다 (게이트 A-(c)).
export async function createOrGetSubmission(challengeId: string): Promise<ApiSubmission> {
  const res = await fetch('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: challengeId }),
  });
  if (res.status === 201) return (await res.json()) as ApiSubmission;
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiSubmissionConflict>;
    if (body.code === 'SUBMISSION_EXISTS' && body.submission) return body.submission;
    return Promise.reject(
      new ApiError(409, body.code ?? 'UNKNOWN', body.error ?? '이미 제출이 존재합니다.'),
    );
  }
  throw await toApiError(res);
}

// A3 — 상세(+signed URL). letter_pieces[].image_url은 null일 수 있다(@/types/api 참고).
export async function fetchSubmissionDetail(submissionId: string): Promise<ApiSubmissionDetail> {
  const res = await fetch(`/api/submissions/${submissionId}`);
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as ApiSubmissionDetail;
}

export type UploadLetterInput = {
  slotIndex: number;
  character: string;
  width: number;
  height: number;
  /** WebP(기본) 또는 JPEG(Safari 폴백) Blob — A5 규격 ≤500KB (게이트 A Day4.5 옵션 A) */
  image: Blob;
};

// A5 — 글자 조각 업로드. FormData 숫자 필드는 문자열로 보낸다(서버 zod coerce가 변환).
export async function uploadLetter(
  submissionId: string,
  input: UploadLetterInput,
): Promise<ApiUploadedLetter> {
  const ext = input.image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const form = new FormData();
  form.append('slot_index', String(input.slotIndex));
  form.append('character', input.character);
  form.append('width', String(input.width));
  form.append('height', String(input.height));
  form.append('image', input.image, `${input.slotIndex}.${ext}`);
  const res = await fetch(`/api/submissions/${submissionId}/letters`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as ApiUploadedLetter;
}

// A6 — 콜라주 PNG 업로드 (A6 규격: image/png, ≤2MB)
export async function uploadCollage(
  submissionId: string,
  image: Blob,
): Promise<ApiCollageUploadResult> {
  const form = new FormData();
  form.append('image', image, 'collage.png');
  const res = await fetch(`/api/submissions/${submissionId}/collage`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as ApiCollageUploadResult;
}

// A7 — 오늘의 피드 (cursor 기반 페이지네이션). cursor 없으면 첫 페이지.
// collage_url은 signed URL(1h) 또는 null — 클라이언트가 null 폴백을 처리해야 한다.
export async function fetchFeed(
  challengeId: string,
  cursor?: string,
): Promise<ApiFeedResponse> {
  const params = new URLSearchParams({ challenge_id: challengeId });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/feed?${params.toString()}`);
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as ApiFeedResponse;
}

export type UpdateSubmissionInput = {
  status?: 'completed';
  is_public?: boolean;
};

// A4 — 완성 전이/공개 토글. 이미 completed인 제출에 status:'completed'를 다시 보내면
// 서버가 재전이 없이 현재 상태를 반환하므로(멱등) 재시도에 안전하다.
export async function updateSubmission(
  submissionId: string,
  input: UpdateSubmissionInput,
): Promise<ApiSubmission> {
  const res = await fetch(`/api/submissions/${submissionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as ApiSubmission;
}
