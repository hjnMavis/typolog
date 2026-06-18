/**
 * reaction-cache 단위 테스트 — optimistic 토글 캐시 갱신 (Day 7 결정 3)
 *
 * useInfiniteQuery 캐시(pages[].items[] 중첩)에서 해당 submission 1개만 갱신하고,
 * 나머지 항목·페이지는 참조를 보존하는지 검증한다. 렌더 없이 순수 함수로 테스트.
 */

import { describe, it, expect } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import { optimisticToggleReaction, reconcileReaction } from '@/features/feed/reaction-cache';
import type { ApiFeedItem, ApiFeedResponse } from '@/types/api';

function makeItem(id: string, reacted: boolean, count: number): ApiFeedItem {
  return {
    submission: {
      id,
      user_id: 'u1',
      challenge_id: 'c1',
      status: 'completed',
      is_public: true,
      created_at: '2026-06-17T00:00:00.000Z',
      completed_at: '2026-06-17T00:00:00.000Z',
    },
    profile: { id: 'u1', nickname: 'nick', avatar_url: null },
    collage_url: null,
    reaction_count: count,
    user_reacted: reacted,
  };
}

function makeData(pages: ApiFeedItem[][]): InfiniteData<ApiFeedResponse> {
  return {
    pages: pages.map((items, i) => ({
      items,
      next_cursor: i < pages.length - 1 ? `cur${i}` : null,
    })),
    pageParams: pages.map((_, i) => (i === 0 ? undefined : `cur${i - 1}`)),
  };
}

describe('optimisticToggleReaction', () => {
  it('미반응 → 반응: user_reacted true, count +1', () => {
    const next = optimisticToggleReaction(makeData([[makeItem('s1', false, 2)]]), 's1');
    expect(next.pages[0].items[0].user_reacted).toBe(true);
    expect(next.pages[0].items[0].reaction_count).toBe(3);
  });

  it('반응 → 미반응: user_reacted false, count -1', () => {
    const next = optimisticToggleReaction(makeData([[makeItem('s1', true, 2)]]), 's1');
    expect(next.pages[0].items[0].user_reacted).toBe(false);
    expect(next.pages[0].items[0].reaction_count).toBe(1);
  });

  it('count 0에서 취소해도 0 미만으로 내려가지 않는다 (클램프)', () => {
    const next = optimisticToggleReaction(makeData([[makeItem('s1', true, 0)]]), 's1');
    expect(next.pages[0].items[0].reaction_count).toBe(0);
    expect(next.pages[0].items[0].user_reacted).toBe(false);
  });

  it('대상 외 항목·페이지는 참조까지 그대로 둔다', () => {
    const other = makeItem('s2', false, 5);
    const data = makeData([[makeItem('s1', false, 1)], [other]]);
    const next = optimisticToggleReaction(data, 's1');
    expect(next.pages[1].items[0]).toBe(other); // 다른 항목 참조 동일
    expect(next.pages[1]).toBe(data.pages[1]); // 대상 없는 페이지 참조 보존
  });

  it('존재하지 않는 submission이면 모든 페이지를 그대로 둔다 (no-op)', () => {
    const data = makeData([[makeItem('s1', false, 1)]]);
    const next = optimisticToggleReaction(data, 'nope');
    expect(next.pages[0]).toBe(data.pages[0]);
  });

  it('pageParams를 보존한다', () => {
    const data = makeData([[makeItem('s1', false, 1)], [makeItem('s2', false, 1)]]);
    const next = optimisticToggleReaction(data, 's1');
    expect(next.pageParams).toEqual(data.pageParams);
  });
});

describe('reconcileReaction', () => {
  it('서버 권위값으로 해당 항목을 덮어쓴다', () => {
    const data = makeData([[makeItem('s1', true, 3)]]);
    const next = reconcileReaction(data, 's1', { user_reacted: false, reaction_count: 7 });
    expect(next.pages[0].items[0].user_reacted).toBe(false);
    expect(next.pages[0].items[0].reaction_count).toBe(7);
  });
});
