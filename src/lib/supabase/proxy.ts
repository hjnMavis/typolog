import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// proxy 전용 세션 갱신 헬퍼 — 만료된 토큰을 갱신하고 인증 여부를 돌려준다.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 중요: createServerClient와 getClaims() 사이에 다른 로직을 두지 않는다.
  // getClaims()가 JWT를 검증하고 만료된 토큰을 갱신한다 — 서버에서 getSession()을 신뢰하지 않는다 (현행 공식 가이드).
  let isAuthenticated = false;
  try {
    const { data } = await supabase.auth.getClaims();
    isAuthenticated = Boolean(data?.claims);
  } catch {
    // 검증 실패·네트워크 오류 시 미인증으로 폴백 (fail-closed) — 보호 라우트는 /login으로 redirect된다.
  }

  // 갱신된 세션 쿠키가 실린 supabaseResponse를 그대로 반환해야 쿠키가 유실되지 않는다.
  return { supabaseResponse, isAuthenticated };
}
