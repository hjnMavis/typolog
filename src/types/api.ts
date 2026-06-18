// API Route Handler 응답의 와이어(wire) 타입 — 클라이언트·서버가 공유하는 단일 소스.
// 서버 전용 모듈(@/lib/api/*)과 달리 'server-only' 가드를 두지 않는다: 런타임 import 없이
// 타입만 정의하므로 클라이언트 번들에 안전하게 들어간다.
// 날짜 필드는 JSON 직렬화를 거친 뒤의 형태(ISO 문자열)로 표기한다 — 서버의 Date는
// NextResponse.json()에서 문자열이 되므로 클라이언트가 보는 타입은 string이다.

export type SubmissionStatus = 'draft' | 'completed' | 'hidden';

// A2 201·409 동봉, A4 응답, A3/A6의 submission 부분 (serializeSubmission의 와이어 형태)
export type ApiSubmission = {
  id: string;
  user_id: string;
  challenge_id: string;
  status: SubmissionStatus;
  is_public: boolean;
  created_at: string;
  completed_at: string | null;
};

// A1 GET /api/challenges/today 응답
export type ApiTodayChallenge = {
  id: string;
  sentence: string;
  lines: string[];
  letters: string[];
  active_date: string;
};

// A3 응답의 letter_pieces 항목 — 서버(A3 라우트)와 클라이언트가 이 타입을 공유한다.
// image_url은 signed URL 생성이 Storage 정책 거부·오류로 실패하면 null일 수 있다
// (Day 4 QA M2). 클라이언트는 null이면 글자 텍스트 폴백을 보여줘야 한다.
export type ApiLetterPiece = {
  id: string;
  slot_index: number;
  character: string;
  width: number;
  height: number;
  image_url: string | null;
};

// A3 GET /api/submissions/[id] 응답
export type ApiSubmissionDetail = {
  submission: ApiSubmission;
  collage_url: string | null;
  letter_pieces: ApiLetterPiece[];
};

// A5 POST /api/submissions/[id]/letters 응답 (DB row 와이어 형태 —
// 여기의 image_url은 버킷 내 경로다. 읽기용 signed URL은 A3에서만 내려온다.)
export type ApiUploadedLetter = {
  id: string;
  submission_id: string;
  character: string;
  slot_index: number;
  image_url: string;
  width: number;
  height: number;
  created_at: string;
};

// A6 POST /api/submissions/[id]/collage 응답
export type ApiCollageUploadResult = {
  submission: ApiSubmission;
  collage_url: string | null;
};

// 표준 에러 바디 (§7.4 ApiErrorBody의 와이어 형태)
export type ApiErrorResponse = {
  error: string;
  code: string;
  details?: unknown;
};

// A2 중복 409(SUBMISSION_EXISTS) 바디 — 기존 submission을 동봉해 이어서 진행하게 한다.
export type ApiSubmissionConflict = ApiErrorResponse & {
  submission: ApiSubmission | null;
};

// A7 GET /api/feed — 피드 와이어 타입 (§6.3 A7, §9 Day 6 확정)

// 피드 카드에 필요한 최소 프로필 정보
export type ApiFeedProfile = {
  id: string;
  nickname: string;
  avatar_url: string | null;
};

// 피드 1개 항목 — submission(status='completed', is_public=true), 프로필, 반응 집계, signed URL
export type ApiFeedItem = {
  submission: ApiSubmission;
  profile: ApiFeedProfile;
  collage_url: string | null; // signed URL(1h) 또는 서명 실패 폴백 null (Day 4 M2 패턴)
  reaction_count: number;
  user_reacted: boolean;
  is_mine: boolean; // 현재 사용자의 제출인지 — 본인 카드에선 신고 버튼을 숨긴다 (Day 7 결정 5)
};

// A7 응답 바디 — cursor pagination
export type ApiFeedResponse = {
  items: ApiFeedItem[];
  next_cursor: string | null; // base64url 커서, 마지막 페이지면 null
};
