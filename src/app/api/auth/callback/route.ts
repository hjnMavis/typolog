import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// M2 (게이트 A Day3-(g)): 로그인 후 복귀 경로를 알려진 내부 경로 prefix로 협소화한다.
// open-redirect(//host, /\host) 차단에 더해, 화이트리스트 밖 경로는 '/'로 폴백 →
// '/login' 무한루프·'/api/*' 직접 복귀 같은 비페이지 경로 방지.
const ALLOWED_NEXT_PREFIXES = ['/challenge', '/feed', '/admin', '/u', '/s'];

function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/';
  }
  const path = raw.split(/[?#]/)[0];
  if (path === '/') return raw;
  const allowed = ALLOWED_NEXT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return allowed ? raw : '/';
}

// Google OAuth 콜백 — 인증 코드를 세션(쿠키)으로 교환한 뒤 next로 복귀시킨다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 코드가 없거나 교환에 실패하면 로그인 페이지로 되돌린다
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
