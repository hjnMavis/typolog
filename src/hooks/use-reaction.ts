'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toggleReaction, type ToggleReactionResult } from '@/lib/actions/reactions';
import { optimisticToggleReaction, reconcileReaction } from '@/features/feed/reaction-cache';
import type { ApiFeedResponse } from '@/types/api';

type FeedData = InfiniteData<ApiFeedResponse>;

// 좋아요 토글 mutation (optimistic update, 게이트 A 결정 3).
// queryKey는 ['feed', challengeId] — useInfiniteQuery가 커서를 키에 넣지 않으므로(Day 6) 키가 명확.
// onMutate: 진행 중 쿼리 취소 → 스냅샷 백업 → 낙관적 ±1 반영
// onError: 스냅샷으로 롤백
// onSuccess: 서버 권위값으로 해당 항목만 정정
// onSettled 없음: 무한쿼리 전체 invalidate는 모든 페이지 재fetch(signed URL 재서명·스크롤
//   점프·재정렬)라 의도적으로 하지 않는다 — 단일 항목 정정으로 충분.
export function useToggleReaction(challengeId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['feed', challengeId ?? ''] as const;

  return useMutation<ToggleReactionResult, Error, string, { previous: FeedData | undefined }>({
    mutationFn: (submissionId: string) => toggleReaction(submissionId),
    onMutate: async (submissionId: string) => {
      // 진행 중 리페치가 낙관값을 덮어쓰지 않도록 먼저 취소
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FeedData>(queryKey);
      if (previous) {
        queryClient.setQueryData<FeedData>(queryKey, optimisticToggleReaction(previous, submissionId));
      }
      return { previous };
    },
    onError: (_error, _submissionId, context) => {
      if (context?.previous) {
        queryClient.setQueryData<FeedData>(queryKey, context.previous);
      }
    },
    onSuccess: (result, submissionId) => {
      const current = queryClient.getQueryData<FeedData>(queryKey);
      if (current) {
        queryClient.setQueryData<FeedData>(queryKey, reconcileReaction(current, submissionId, result));
      }
    },
  });
}
