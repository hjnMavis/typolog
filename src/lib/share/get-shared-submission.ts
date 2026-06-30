// 비인증 공유(`/s/[id]`)와 OG 이미지(`/api/og/[id]`)가 함께 쓰는 단일 데이터 취득 함수.
// "무엇을 공개 대상으로 보여줄지"의 가시성 판정을 여기 한 곳에 모은다 — 화면과 OG가 각자
// 판정하면 한쪽은 보여주고 한쪽은 막는 누수/불일치가 생기므로 단일 소스로 둔다(§7.4 존재 은폐).
// DB(Drizzle)·Storage SDK 모두 서버 전용이라 클라이언트 번들 유입을 빌드 타임에 차단한다.
import 'server-only';

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { challenges, profiles, submissions } from '@/db/schema';
import { createSignedUrl, SIGNED_URL_TTL } from '@/lib/storage/signed-url';
import { createClient } from '@/lib/supabase/server';
import { submissionIdSchema } from '@/lib/validations/submission';

// 공유 화면·OG가 쓰는 최소 데이터. 콜라주는 24h signed URL(서명 실패 시 null), 문장·닉네임은
// 메타태그/화면 표시용. 버킷 내 원시 경로(collage_image_url)는 절대 노출하지 않는다.
// 서버 컴포넌트/Route Handler가 직접 호출(JSON 경계 없음)하므로 와이어 타입이 아닌 서버 반환 타입이다.
export type SharedSubmission = {
  id: string;
  sentence: string;
  nickname: string;
  avatar_url: string | null;
  collage_url: string | null;
};

// 비인증 공유 대상 조회. 가시성은 코드로 강제한다 — DB는 Drizzle 직결(RLS 우회)이라
// `status='completed' AND is_public=true`가 아니면(타인 비공개·draft·hidden·미존재·잘못된 UUID)
// 모두 null을 반환한다. 호출부는 null을 404(페이지 notFound / OG 404)로 처리해 존재 자체를 은폐한다.
//
// React cache로 감싼다 — `/s/[id]`는 generateMetadata와 본문 렌더가 같은 요청에서 같은 id로
// 두 번 호출하므로, 요청 단위 메모이즈로 중복 DB 조회·중복 서명을 막는다(같은 id면 1회 실행).
export const getSharedSubmission = cache(async (id: string): Promise<SharedSubmission | null> => {
  // 잘못된 형식의 id도 미존재와 동일하게 null — 존재 은폐(A3 GET과 동일 규칙).
  const parsed = submissionIdSchema.safeParse(id);
  if (!parsed.success) return null;
  const submissionId = parsed.data;

  // submissions ⨝ profiles(닉네임·아바타) ⨝ challenges(문장). 가시성 술어를 WHERE에 직접 강제.
  const [row] = await db
    .select({
      id: submissions.id,
      collage_image_url: submissions.collage_image_url,
      sentence: challenges.sentence,
      nickname: profiles.nickname,
      avatar_url: profiles.avatar_url,
    })
    .from(submissions)
    .innerJoin(profiles, eq(submissions.user_id, profiles.id))
    .innerJoin(challenges, eq(submissions.challenge_id, challenges.id))
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.status, 'completed'),
        eq(submissions.is_public, true),
      ),
    )
    .limit(1);

  if (!row) return null;

  // 콜라주 서명 — 쿠키 인식 server client. 비인증 방문자/크롤러는 anon role이 되어
  // collages_read_anon(§5.2)이 공개 완성 콜라주만 서명을 허용한다(최소 권한, service key 미사용).
  // TTL은 공유용 24h(Day 4-(c)). 서명 실패 시 null → 화면/OG가 폴백을 보여준다.
  const supabase = await createClient();
  const collage_url = row.collage_image_url
    ? await createSignedUrl(supabase, 'collages', row.collage_image_url, SIGNED_URL_TTL.SHARE)
    : null;

  return {
    id: row.id,
    sentence: row.sentence,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    collage_url,
  };
});
