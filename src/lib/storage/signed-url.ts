// private 버킷(letter-pieces·collages)의 경로를 만료 시간 있는 읽기용 signed URL로 변환한다.
// Day 3는 DB(image_url/collage_image_url)에 버킷 내 경로만 저장하고, 읽기 시점에 이 헬퍼로 서명한다
// (§9 Day4-(c)). DB·Storage SDK 모두 서버 전용이므로 클라이언트 번들 유입을 차단한다.
import 'server-only';

import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// 읽기 signed URL TTL 프리셋 (§5·로드맵 #7).
export const SIGNED_URL_TTL = {
  // 본인 편집/미리보기 (인증 상세 조회)
  EDIT: 60 * 60, // 1h
  // 비인증 공유 페이지 (/s/[id] — Phase 3)
  SHARE: 60 * 60 * 24, // 24h
} as const;

// 요청자 JWT가 실린 server client로 서명한다 → Storage 정책(§5)이 그대로 적용된다.
// 권한 없는 경로(예: 타인 letter-pieces)는 정책이 거부하므로 null을 돌려준다 — URL이 새지 않는다.
// path는 버킷 내 상대 경로(예: `{user_id}/{submission_id}/0.webp`).
export async function createSignedUrl(
  supabase: ServerClient,
  bucket: 'letter-pieces' | 'collages',
  path: string,
  ttlSeconds: number,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
