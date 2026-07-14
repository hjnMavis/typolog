'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createOrGetSubmission,
  fetchSubmissionDetail,
  updateSubmission,
  uploadCollage,
  uploadLetter,
} from '@/lib/api-client';
import { toLetterUploadImage } from '@/lib/image/to-webp';
import {
  submitCollage,
  type LetterSource,
  type SubmitProgress,
} from '@/features/compose/submit-collage';

// A3 상세(+signed URL) 서버 상태. 게이트 A-(e): staleTime 30분 = signed URL TTL(1h)의
// 절반 — stale 이후 재마운트/포커스 시 만료 전에 새 URL이 재발급되도록 한다.
export function useSubmissionDetail(submissionId: string | null) {
  return useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => fetchSubmissionDetail(submissionId as string),
    enabled: submissionId !== null,
    staleTime: 30 * 60 * 1000,
  });
}

export interface SubmitCollageVariables {
  challengeId: string;
  letters: LetterSource[];
  collageBlob: Blob;
  isPublic: boolean;
  onProgress?: (progress: SubmitProgress) => void;
}

// 제출 오케스트레이션(A2→A5×N→A6→A4) mutation. 체인 전체가 한 mutation이므로
// invalidate는 최종 성공 시 1회 — ['submission', id] 캐시를 무효화해 A3 재조회
// (완성 상태 + 콜라주 signed URL)를 트리거한다 (게이트 A-(e)의 invalidate 흐름).
export function useSubmitCollage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: SubmitCollageVariables) =>
      submitCollage(
        {
          createOrGetSubmission,
          toLetterUploadImage,
          uploadLetter: (submissionId, input) => uploadLetter(submissionId, input),
          uploadCollage,
          updateSubmission,
        },
        vars,
      ),
    onSuccess: (submission) => {
      void queryClient.invalidateQueries({ queryKey: ['submission', submission.id] });
      // 완성 제출은 /my 목록의 멤버십을 바꾼다 — 미리보기 재진입 시 완성 상태 복원(#60)이
      // stale 목록 때문에 놓치지 않도록 함께 무효화한다.
      void queryClient.invalidateQueries({ queryKey: ['my', 'submissions'] });
      // 피드 멤버십도 바뀐다(내 카드가 새로 등장) — staleTime(60s) 이내에 피드를 봤던 경우
      // "피드 보러가기"에서 내 카드가 안 보이는 갭(V-1, #74)을 막는다. S4 토글과 동일 근거.
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
