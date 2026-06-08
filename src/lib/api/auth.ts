// DB(Drizzle)·createClient 모두 서버 전용이므로 클라이언트 번들 유입을 빌드 타임에 차단
import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { submissions, type Submission } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type AuthUser = { id: string };

// getClaims()로 JWT를 검증해 현재 사용자 id(sub)를 돌려준다. 미인증이면 null.
// Storage 업로드 등 같은 supabase 클라이언트를 재사용해야 하면 인자로 주입한다
// (Route Handler는 쿠키 쓰기가 가능하므로 getClaims가 만료 토큰도 갱신한다).
export async function getAuthUser(supabase?: ServerClient): Promise<AuthUser | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== 'string') return null;
  return { id: sub };
}

// DB는 Drizzle 직결(RLS 우회)이라 소유권을 코드로 검증한다 (게이트 A Day3-(b)).
// 타인 소유·미존재를 동일하게 null로 반환 → 호출부에서 404로 존재 자체를 은폐한다 (§7.4).
export async function getOwnedSubmission(
  submissionId: string,
  userId: string,
): Promise<Submission | null> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!row || row.user_id !== userId) return null;
  return row;
}
