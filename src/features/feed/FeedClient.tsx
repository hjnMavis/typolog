'use client';

import { useCallback } from 'react';
import { useTodayChallenge } from '@/hooks/use-today-challenge';
import { useFeed } from '@/hooks/use-feed';
import { useIntersectionObserver } from '@/hooks/use-intersection-observer';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FeedCard } from './FeedCard';
import type { ApiFeedItem } from '@/types/api';

// 스켈레톤 카드 — 피드 로딩 중 레이아웃 점프 방지
function FeedCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-hidden="true">
      <div className="aspect-square w-full animate-pulse bg-muted" />
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

/**
 * 오늘의 피드 화면 — Phase 3 Day 6.
 * useTodayChallenge → challengeId → useFeed(challengeId) 의존 체인.
 * 무한 스크롤: 센티널 div가 뷰포트에 진입하면 fetchNextPage() 호출.
 */
export function FeedClient() {
  // 1단계: 오늘의 챌린지 id 확보
  const {
    data: challenge,
    isPending: challengePending,
    isError: challengeError,
    error: challengeErr,
  } = useTodayChallenge();

  // 2단계: 피드 쿼리 (challengeId 확정 이후에만 enabled)
  const {
    data,
    isPending: feedPending,
    isError: feedError,
    error: feedErr,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchFeed,
    isRefetching: isFeedRefetching,
  } = useFeed(challenge?.id);

  // 무한 스크롤 센티널 — 다음 페이지가 있고 현재 로딩 중이 아닐 때만 observe
  const shouldObserve = hasNextPage && !isFetchingNextPage;
  const handleIntersect = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const sentinelRef = useIntersectionObserver(handleIntersect, shouldObserve);

  // ─── 챌린지 로딩 상태 ───
  if (challengePending) {
    return (
      <div className="px-4 py-6">
        <div className="mb-4 h-5 w-32 animate-pulse rounded bg-muted" aria-hidden="true" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <FeedCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ─── 챌린지 에러 ───
  if (challengeError) {
    const isNoChallenge =
      challengeErr instanceof ApiError && challengeErr.code === 'CHALLENGE_NOT_FOUND';
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-lg font-semibold">
          {isNoChallenge ? '오늘의 챌린지가 아직 없어요' : '챌린지를 불러오지 못했어요'}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {isNoChallenge
            ? '내일 새로운 문장으로 만나요.'
            : '네트워크 상태를 확인하고 다시 시도해 주세요.'}
        </p>
      </div>
    );
  }

  // ─── 피드 로딩 상태 (챌린지는 있으나 피드 첫 로드 중) ───
  if (feedPending) {
    return (
      <div className="px-4 py-6">
        <h1 className="mb-4 text-base font-semibold text-foreground">오늘의 피드</h1>
        <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="피드 로딩 중">
          {Array.from({ length: 6 }).map((_, i) => (
            <FeedCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ─── 피드 에러 ───
  if (feedError) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-lg font-semibold">피드를 불러오지 못했어요</p>
        <p className="mt-2 text-sm text-muted-foreground">
          네트워크 상태를 확인하고 다시 시도해 주세요.
        </p>
        {feedErr instanceof ApiError && (
          <p className="mt-1 text-xs text-muted-foreground/60">({feedErr.code})</p>
        )}
        <Button
          size="lg"
          className="mt-6"
          onClick={() => void refetchFeed()}
          disabled={isFeedRefetching}
        >
          {isFeedRefetching ? '다시 시도 중…' : '다시 시도'}
        </Button>
      </div>
    );
  }

  // 이 지점에선 피드 데이터가 존재하므로 challenge.id도 반드시 있다 (의존 체인). TS 내로잉용 가드.
  if (!challenge) return null;

  // 모든 페이지의 아이템을 평탄화
  const items: ApiFeedItem[] = data.pages.flatMap((page) => page.items);

  // ─── 빈 피드 ───
  if (items.length === 0) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-4xl" aria-hidden="true">✦</p>
        <p className="mt-4 text-lg font-semibold">아직 제출이 없어요</p>
        <p className="mt-2 text-sm text-muted-foreground">
          오늘의 문장을 가장 먼저 완성해 보세요!
        </p>
      </div>
    );
  }

  // ─── 성공: 피드 목록 ───
  return (
    <div className="px-4 py-6">
      <h1 className="mb-4 text-base font-semibold text-foreground">오늘의 피드</h1>

      {/* 2열 그리드 */}
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <FeedCard key={item.submission.id} item={item} challengeId={challenge.id} />
        ))}
      </div>

      {/* 무한 스크롤 센티널 */}
      <div ref={sentinelRef} className="mt-4" aria-hidden="true" />

      {/* 다음 페이지 로딩 스피너 */}
      {isFetchingNextPage && (
        <div className="mt-2 grid grid-cols-2 gap-3" aria-label="추가 피드 로딩 중">
          {Array.from({ length: 2 }).map((_, i) => (
            <FeedCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* 마지막 페이지 마커 */}
      {!hasNextPage && items.length > 0 && (
        <p className="mt-6 text-center text-xs text-muted-foreground/50">
          모든 콜라주를 다 봤어요
        </p>
      )}
    </div>
  );
}
