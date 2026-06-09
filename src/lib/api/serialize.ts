import type { Submission } from '@/db/schema';

// 응답에 노출해도 안전한 submission 필드만 추리는 단일 투영.
// 버킷 내 원시 경로(collage_image_url)는 제외한다 — 읽기 URL은 signed URL로 별도 제공(§9 Day4-(c)).
// GET·PATCH·collage 업로드 응답이 이 한 함수를 공유해 "무엇을 노출하는가"를 한 곳에서 관리한다.
export type SubmissionResponse = {
  id: string;
  user_id: string;
  challenge_id: string;
  status: string;
  is_public: boolean;
  created_at: Date;
  completed_at: Date | null;
};

export function serializeSubmission(s: Submission): SubmissionResponse {
  return {
    id: s.id,
    user_id: s.user_id,
    challenge_id: s.challenge_id,
    status: s.status,
    is_public: s.is_public,
    created_at: s.created_at,
    completed_at: s.completed_at,
  };
}
