import type { InfiniteData } from '@tanstack/react-query';
import type { ApiFeedItem, ApiFeedResponse } from '@/types/api';

// useInfiniteQuery 캐시는 pages[].items[] 중첩 구조다(Day 6 학습 §7). 좋아요 토글은 그
// 중첩 안에서 해당 submission 1개만 갱신하고, 나머지 항목·페이지는 참조를 그대로 둔다
// (불필요한 리렌더 방지). 렌더 없이 단위 테스트 가능하도록 순수 함수로 분리한다.
type FeedData = InfiniteData<ApiFeedResponse>;

// 낙관적 토글(onMutate): user_reacted 반전 + reaction_count ±1, 0 미만은 클램프.
export function optimisticToggleReaction(data: FeedData, submissionId: string): FeedData {
  return mapFeedItem(data, submissionId, (item) => {
    const nextReacted = !item.user_reacted;
    const delta = nextReacted ? 1 : -1;
    return {
      ...item,
      user_reacted: nextReacted,
      reaction_count: Math.max(0, item.reaction_count + delta),
    };
  });
}

// 서버 권위값으로 정정(onSuccess): 낙관값과 실제값의 동시성 드리프트를 바로잡는다.
export function reconcileReaction(
  data: FeedData,
  submissionId: string,
  next: { user_reacted: boolean; reaction_count: number },
): FeedData {
  return mapFeedItem(data, submissionId, (item) => ({
    ...item,
    user_reacted: next.user_reacted,
    reaction_count: next.reaction_count,
  }));
}

// 대상 submission이 들어있는 페이지의 그 항목 1개에만 fn을 적용한다.
function mapFeedItem(
  data: FeedData,
  submissionId: string,
  fn: (item: ApiFeedItem) => ApiFeedItem,
): FeedData {
  return {
    ...data,
    pages: data.pages.map((page) => {
      // 이 페이지에 대상이 없으면 페이지 객체를 그대로 둔다 (참조 보존)
      if (!page.items.some((it) => it.submission.id === submissionId)) {
        return page;
      }
      return {
        ...page,
        items: page.items.map((it) => (it.submission.id === submissionId ? fn(it) : it)),
      };
    }),
  };
}
