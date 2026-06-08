import { createBrowserClient } from '@supabase/ssr';

// Browser Client — 브라우저에서 실행, 사용자 JWT 인증, RLS 적용 (주 용도: Storage 업로드)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
