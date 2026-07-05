import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { MyClient } from '@/features/profile/MyClient';

// 마이페이지 — 서버 컴포넌트에서 본인 프로필(닉네임·아바타)을 읽어 계정 표시용으로 주입한다.
// 제출 목록 자체는 클라이언트(useMySubmissions → GET /api/me/submissions)가 들고 토글 낙관 캐시를 쓴다.
// 보호 라우트(proxy가 비로그인을 /login으로). 페이지에서도 방어적으로 재확인한다.
export default async function MyPage() {
  const user = await getAuthUser();
  if (!user) {
    redirect('/login');
  }

  const [profile] = await db
    .select({ nickname: profiles.nickname, avatar_url: profiles.avatar_url })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  return (
    <MyClient initialNickname={profile?.nickname ?? '나'} avatarUrl={profile?.avatar_url ?? null} />
  );
}
