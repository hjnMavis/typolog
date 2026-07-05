'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import type { ApiMySubmissionsResponse } from '@/types/api';

// 내 제출 목록 쿼리 (/my). queryKey ['my','submissions'] — visibility 토글의 낙관적 캐시 대상.
// 챌린지당 1개라 무한 스크롤 없이 단일 useQuery로 충분하다(서버가 상한 100 전량 반환).
// fetch는 이 훅에 인라인한다 — api-client.ts를 건드리지 않아 U2 변경 파일을 좁게 유지(ApiError만 재사용).
export function useMySubmissions() {
  return useQuery<ApiMySubmissionsResponse, Error>({
    queryKey: ['my', 'submissions'],
    queryFn: async () => {
      const res = await fetch('/api/me/submissions');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        throw new ApiError(
          res.status,
          body.code ?? 'UNKNOWN',
          body.error ?? '내 제출을 불러오지 못했어요.',
        );
      }
      return (await res.json()) as ApiMySubmissionsResponse;
    },
    staleTime: 60_000,
  });
}
