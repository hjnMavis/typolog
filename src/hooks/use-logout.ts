'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/browser';

// 로그아웃 (#52) — 세션 종료 + 서버 상태 캐시 정리 후 /login으로 이동.
//
// 로컬 draft(글자 크롭)는 일부러 지우지 않는다 — 본인이 재로그인하면 이어서 작업할 수 있게
// 보존한다. 계정 전환 시 타인에게 draft가 노출되는 문제는 TodayChallengeGate의 owner-scope
// 가드(#53)가 진입 시점에 막으므로, 로그아웃이 draft를 비울 필요가 없다.
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  const logout = useCallback(async () => {
    setIsPending(true);

    // 1) Supabase 세션 종료 (쿠키 제거)
    try {
      await createClient().auth.signOut();
    } catch {
      // 세션 종료가 실패해도 캐시 정리·이동은 계속한다
    }

    // 2) 서버 상태 캐시(TanStack Query) 비우기 — 이전 사용자의 피드·제출 등이 남지 않게
    queryClient.clear();

    // 3) 로그인 화면으로 (replace — 뒤로가기로 보호 화면 재진입 차단)
    router.replace('/login');
  }, [queryClient, router]);

  return { logout, isPending };
}
