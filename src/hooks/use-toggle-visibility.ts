'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSubmissionVisibility } from '@/lib/actions/submissions';
import { setSubmissionVisibility } from '@/features/profile/visibility-cache';
import type { ApiMySubmissionsResponse } from '@/types/api';

const MY_KEY = ['my', 'submissions'] as const;

type ToggleVars = { submissionId: string; isPublic: boolean };
type MyData = ApiMySubmissionsResponse;

// 공개/비공개 토글 mutation (S4, optimistic — Day 7 좋아요 토글 패턴 재사용).
// onMutate: 진행 중 쿼리 취소 → 스냅샷 백업 → 낙관적으로 is_public 세팅
// onError: 스냅샷으로 롤백
// onSuccess: 서버 권위값(result.is_public)으로 정정 + 피드 캐시 무효화
//   (공개↔비공개는 피드 멤버십이 생기거나 사라지는 구조 변화라, 좋아요와 달리 ['feed'] invalidate가 옳다.
//    /s·OG는 단일 가시성 소스(getSharedSubmission)가 같은 is_public을 읽어 서버에서 즉시 반영된다.)
export function useToggleVisibility() {
  const queryClient = useQueryClient();

  return useMutation<{ is_public: boolean }, Error, ToggleVars, { previous: MyData | undefined }>({
    mutationFn: ({ submissionId, isPublic }: ToggleVars) =>
      updateSubmissionVisibility({ submissionId, isPublic }),
    onMutate: async ({ submissionId, isPublic }: ToggleVars) => {
      await queryClient.cancelQueries({ queryKey: MY_KEY });
      const previous = queryClient.getQueryData<MyData>(MY_KEY);
      if (previous) {
        queryClient.setQueryData<MyData>(
          MY_KEY,
          setSubmissionVisibility(previous, submissionId, isPublic),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData<MyData>(MY_KEY, context.previous);
      }
    },
    onSuccess: (result, { submissionId }: ToggleVars) => {
      const current = queryClient.getQueryData<MyData>(MY_KEY);
      if (current) {
        queryClient.setQueryData<MyData>(
          MY_KEY,
          setSubmissionVisibility(current, submissionId, result.is_public),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
