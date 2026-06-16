'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchFeed } from '@/lib/api-client';
import type { ApiFeedResponse } from '@/types/api';

// A7 피드 무한 스크롤 쿼리.
// queryKey에 cursor를 포함하지 않는다 — cursor는 pageParam으로만 흐른다.
// staleTime: 60s (providers 전역 기본값과 동일하지만 명시적으로 설정).
// enabled: challengeId가 확정되어야 쿼리를 시작한다 (useTodayChallenge 결과 의존).
export function useFeed(challengeId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['feed', challengeId ?? ''] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }): Promise<ApiFeedResponse> =>
      fetchFeed(challengeId as string, pageParam),
    enabled: !!challengeId,
    staleTime: 60_000,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ApiFeedResponse): string | undefined =>
      lastPage.next_cursor ?? undefined,
  });
}
