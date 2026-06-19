'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

export interface CurrentUser {
  /** 로그인 사용자 id(JWT sub). 미인증이면 null. */
  userId: string | null;
  /** getClaims 시도가 끝났는지 — 가드 진입 타이밍 판단용(로딩 중엔 false). */
  isResolved: boolean;
}

// 현재 로그인 사용자 id(sub)를 클라이언트에서 읽는다 (browser client getClaims).
// draft owner-scope 가드(#53)용. 이 값은 인가(authorization)가 아니라 로컬 draft 정리
// 트리거 전용이다 — 서버측 인증은 src/proxy.ts가 강제하고, 보호 라우트라 정상 흐름에선
// 곧 값이 채워진다.
export function useCurrentUser(): CurrentUser {
  const [state, setState] = useState<CurrentUser>({ userId: null, isResolved: false });

  useEffect(() => {
    let active = true;
    createClient()
      .auth.getClaims()
      .then(({ data }) => {
        if (!active) return;
        const sub = data?.claims?.sub;
        setState({ userId: typeof sub === 'string' ? sub : null, isResolved: true });
      })
      .catch(() => {
        if (active) setState({ userId: null, isResolved: true });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
