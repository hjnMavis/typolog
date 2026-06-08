import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server Client — Next.js 서버에서 실행, 쿠키의 JWT로 인증, RLS 적용
// Route Handler·Server Component·Server Action에서 요청마다 새로 생성한다.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서는 쿠키 쓰기가 불가능해 setAll이 throw한다.
            // proxy(updateSession)가 세션 갱신을 담당하므로 무시해도 안전하다.
          }
        },
      },
    },
  );
}
