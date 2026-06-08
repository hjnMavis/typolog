import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Google OAuth 콜백 — 인증 코드를 세션(쿠키)으로 교환한 뒤 next로 복귀시킨다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';

  // open-redirect 방지: '/'로 시작하는 상대 경로만 허용 ('//host', '/\host' 차단)
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.startsWith('/\\')
      ? nextParam
      : '/';

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
