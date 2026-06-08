// 클라이언트 번들에 유입되면 빌드 타임에 실패하도록 가드 (게이트 A 결정 g)
import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Admin Client — RLS 완전 우회 (sb_secret_ 키). 서버 전용.
// 챌린지 등록, 신고 처리 등 관리 작업에만 제한적으로 사용한다.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is not set in .env.local.',
    );
  }

  // 서버에서는 세션을 보관·갱신할 필요가 없다 (요청 단위 일회성 클라이언트)
  return createSupabaseClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
