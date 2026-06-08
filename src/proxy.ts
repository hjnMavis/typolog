import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// 보호 라우트 (게이트 A 결정 c): `/`, `/challenge/*`, `/feed/*`, `/admin/*`
// 그 외(`/login`, `/s/*`, `/u/*`, `/api/auth/callback`, `/api/og/*`, `/api/challenges/today`)는 공개.
// M3 (게이트 A Day3-(g)): API 라우트는 자체 인증(getAuthUser)으로 401을 책임지고
// proxy는 페이지 redirect만 담당하므로 matcher에서 `/api/*`를 제외한다(중복 세션 갱신 제거).
const PROTECTED_PREFIXES = ['/challenge', '/feed', '/admin'];

function isProtectedPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Next.js 16: middleware.ts → proxy.ts 개명, 항상 Node.js 런타임 (게이트 A 결정 f)
export async function proxy(request: NextRequest) {
  const { supabaseResponse, isAuthenticated } = await updateSession(request);

  if (!isAuthenticated && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // 세션 갱신이 불필요한 경로 제외 (negative match):
  // `/api/*`(핸들러가 자체 인증, M3) + 정적 자산·이미지 최적화 경로.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
