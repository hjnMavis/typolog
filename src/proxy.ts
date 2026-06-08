import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// 보호 라우트 (게이트 A 결정 c): `/`, `/challenge/*`, `/feed/*`, `/admin/*`
// 그 외(`/login`, `/s/*`, `/u/*`, `/api/auth/callback`, `/api/og/*`, `/api/challenges/today`)는 공개.
// API 401 응답은 각 핸들러 책임(Day 3+)이며, proxy는 페이지 redirect만 담당한다.
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
  // 정적 자산·이미지 최적화 경로는 세션 갱신이 불필요하므로 제외 (negative match)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
