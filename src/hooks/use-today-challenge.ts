'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchTodayChallenge } from '@/lib/api-client';

// 오늘의 챌린지 서버 상태 (A1). 게이트 A-(e): staleTime 5분.
// 하루 단위로 바뀌는 데이터라 길게 잡되, refetchOnWindowFocus(기본 on)가
// KST 자정 전환 직후 재방문을 커버한다. 홈·수집·미리보기 화면이 같은 키를 공유한다 —
// 별도 GET /api/challenges/[id]가 없으므로(§6.1) /challenge/[id] 화면도 이 쿼리를
// 재사용하고 URL id 불일치 시 홈으로 보낸다 (게이트 A-(d)).
export function useTodayChallenge() {
  return useQuery({
    queryKey: ['challenge', 'today'],
    queryFn: fetchTodayChallenge,
    staleTime: 5 * 60 * 1000,
  });
}
