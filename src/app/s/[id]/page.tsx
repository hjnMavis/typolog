import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ShareActions } from '@/features/share/ShareActions'
import { getSharedSubmission } from '@/lib/share/get-shared-submission'

// 공유는 비인증 공개 라우트(proxy 공개 경계). 서버 컴포넌트에서 가시성 필터된 데이터를
// 직접 조회한다 — getSharedSubmission이 Drizzle 직결(RLS 우회)로 completed+public만 반환하고,
// 그 외(타인 비공개·draft·미존재·잘못된 UUID)는 null → notFound()로 존재 자체를 은폐한다(§7.4).

// og:image의 절대 URL 변환 기준. 크롤러가 절대 주소로 이미지를 가져가므로 origin이 필요하다.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// 닉네임 첫 글자를 아바타/콜라주 폴백 이니셜로 사용(FeedCard와 동일 폴백).
function getInitial(nickname: string): string {
  return nickname.charAt(0).toUpperCase()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const shared = await getSharedSubmission(id)

  // 비공개·미존재면 존재를 노출하지 않는다 — og:image 미포함 + noindex. 본문은 notFound()로 404.
  if (!shared) {
    return { title: 'Typolog', robots: { index: false, follow: false } }
  }

  // 결정 2(게이트 A): 한글 문장·닉네임은 OG 이미지가 아니라 메타태그에 싣는다 —
  // 카톡/X가 링크 옆 제목·설명으로 네이티브 렌더(한글 정상)하고, og:image는 콜라주만 그린다.
  const ogImage = `/api/og/${shared.id}`
  const description = `${shared.nickname}님이 완성한 글자 콜라주 · Typolog`

  return {
    metadataBase: new URL(APP_URL),
    title: `${shared.sentence} · Typolog`,
    description,
    openGraph: {
      title: shared.sentence,
      description,
      url: `/s/${shared.id}`,
      type: 'article',
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: shared.sentence,
      description,
      images: [ogImage],
    },
  }
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const shared = await getSharedSubmission(id)

  // 미존재·비공개·미완성 → 404로 존재 은폐(§7.4). not-found.tsx가 안내 화면을 렌더한다.
  if (!shared) {
    notFound()
  }

  const shareUrl = `${APP_URL}/s/${shared.id}`

  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-8">
      <div className="flex w-full max-w-md flex-col gap-6">
        {/* 콜라주 카드 — 콜라주 이미지 + 작성자 + 문장 */}
        <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="relative aspect-square w-full bg-muted">
            {shared.collage_url ? (
              // next.config에 remotePatterns 미설정 → next/image 불가 → <img> 사용(FeedCard 동일)
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shared.collage_url}
                alt={`${shared.nickname}의 콜라주`}
                className="h-full w-full object-cover"
              />
            ) : (
              // collage_url null 폴백: 닉네임 이니셜(Day 4 M2 · FeedCard 패턴)
              <div
                className="flex h-full w-full items-center justify-center"
                aria-label={`${shared.nickname}의 콜라주 (미리보기 없음)`}
              >
                <span className="text-6xl font-bold text-muted-foreground/40">
                  {getInitial(shared.nickname)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
                {shared.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shared.avatar_url}
                    alt={`${shared.nickname} 프로필`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted-foreground/20">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {getInitial(shared.nickname)}
                    </span>
                  </div>
                )}
              </div>
              <span className="truncate text-sm font-medium">{shared.nickname}</span>
            </div>
            <p className="text-lg font-semibold leading-snug">{shared.sentence}</p>
          </div>
        </article>

        {/* 공유 동작(Web Share/복사) + "나도 만들기" CTA */}
        <ShareActions shareUrl={shareUrl} />
      </div>
    </main>
  )
}
