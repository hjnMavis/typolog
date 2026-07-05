/**
 * visibility-cache 단위 테스트 — /my 목록 공개/비공개 낙관 갱신 (Day 9)
 *
 * useMySubmissions 캐시(flat items[])에서 해당 submission 1개의 is_public만 바꾸고,
 * 나머지 항목은 참조를 보존하는지 검증한다. 렌더 없이 순수 함수로 테스트.
 * 참고 패턴: reaction-cache.test.ts (toBe 참조 동일성 검증 방식)
 */

import { describe, it, expect } from 'vitest';
import { setSubmissionVisibility } from '@/features/profile/visibility-cache';
import type { ApiMySubmission, ApiMySubmissionsResponse } from '@/types/api';

function makeItem(id: string, isPublic: boolean): ApiMySubmission {
  return {
    submission: {
      id,
      user_id: 'u1',
      challenge_id: 'c1',
      status: 'completed',
      is_public: isPublic,
      created_at: '2026-06-30T00:00:00.000Z',
      completed_at: '2026-06-30T00:00:00.000Z',
    },
    challenge: { id: 'c1', sentence: '오늘의 문장' },
    collage_url: null,
    reaction_count: 3,
  };
}

function makeData(items: ApiMySubmission[]): ApiMySubmissionsResponse {
  return { items };
}

describe('setSubmissionVisibility', () => {
  it('대상 submission의 is_public을 새 값으로 바꾼다 (공개 → 비공개)', () => {
    const data = makeData([makeItem('s1', true)]);
    const next = setSubmissionVisibility(data, 's1', false);
    expect(next.items[0].submission.is_public).toBe(false);
  });

  it('대상 submission의 is_public을 새 값으로 바꾼다 (비공개 → 공개)', () => {
    const data = makeData([makeItem('s1', false)]);
    const next = setSubmissionVisibility(data, 's1', true);
    expect(next.items[0].submission.is_public).toBe(true);
  });

  it('is_public 외 필드(reaction_count, collage_url 등)는 그대로 유지된다', () => {
    const data = makeData([makeItem('s1', true)]);
    const next = setSubmissionVisibility(data, 's1', false);
    expect(next.items[0].reaction_count).toBe(3);
    expect(next.items[0].collage_url).toBeNull();
    expect(next.items[0].challenge.sentence).toBe('오늘의 문장');
  });

  it('대상이 아닌 항목은 원본 참조를 보존한다 (toBe)', () => {
    const other = makeItem('s2', true);
    const data = makeData([makeItem('s1', true), other]);
    const next = setSubmissionVisibility(data, 's1', false);
    // s2는 변경 대상이 아니므로 참조가 동일해야 한다
    expect(next.items[1]).toBe(other);
  });

  it('대상 항목은 새 참조다 (toBe 실패 — 다른 참조)', () => {
    const target = makeItem('s1', true);
    const data = makeData([target]);
    const next = setSubmissionVisibility(data, 's1', false);
    // 대상은 spread로 새 객체를 만들었으므로 참조가 달라야 한다
    expect(next.items[0]).not.toBe(target);
  });

  it('여러 항목 중 대상 항목만 교체되고 나머지는 참조 보존', () => {
    const a = makeItem('s1', true);
    const b = makeItem('s2', false);
    const c = makeItem('s3', true);
    const data = makeData([a, b, c]);
    const next = setSubmissionVisibility(data, 's2', true);

    expect(next.items[0]).toBe(a); // s1 참조 보존
    expect(next.items[1]).not.toBe(b); // s2 교체됨
    expect(next.items[1].submission.is_public).toBe(true); // 새 값
    expect(next.items[2]).toBe(c); // s3 참조 보존
  });

  it('대상 id가 목록에 없으면 입력 data를 그대로(동일 참조) 반환한다', () => {
    const data = makeData([makeItem('s1', true)]);
    const next = setSubmissionVisibility(data, 'nope', false);
    // 목록에 없으면 원본 data 참조 그대로
    expect(next).toBe(data);
  });

  it('빈 items에서도 안전하게 동일 참조를 반환한다', () => {
    const data = makeData([]);
    const next = setSubmissionVisibility(data, 's1', true);
    expect(next).toBe(data);
    expect(next.items).toHaveLength(0);
  });
});
