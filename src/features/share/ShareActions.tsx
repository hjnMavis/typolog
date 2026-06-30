'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Web Share API 지원 여부를 hydration-safe하게 읽는다 — 서버·초기 클라 렌더는 false(서버 스냅샷),
// 마운트 후 클라에서만 실제 지원 여부로 갱신. useSyncExternalStore라 effect 내 setState 없이도
// hydration mismatch가 없다. navigator.share 지원은 런타임 중 바뀌지 않아 구독은 no-op이다.
const noopSubscribe = () => () => {}
function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  )
}

// 공유 동작 + "나도 만들기" CTA. 공유 페이지는 서버 컴포넌트라, 브라우저 API
// (navigator.share / navigator.clipboard)를 쓰는 이 부분만 클라이언트 섬으로 분리한다.
export function ShareActions({ shareUrl }: { shareUrl: string }) {
  // 복사 피드백은 인라인(게이트 A 결정) — 버튼 라벨이 "복사됨!"으로 2초간 바뀐다(토스트 미사용).
  const [copied, setCopied] = useState(false)
  // 지원 시에만 네이티브 공유 버튼을 추가한다(모바일 공유 시트).
  const canNativeShare = useCanNativeShare()

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 거부(권한·비보안 컨텍스트) — 조용히 무시. clipboard API는 https/localhost에서만 동작.
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: 'Typolog', url: shareUrl })
    } catch {
      // 사용자가 공유 시트를 취소하면 AbortError — 조용히 무시(폴백 복사하지 않는다).
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {/* 공유 버튼 줄: 네이티브 공유(지원 시) + 링크 복사(항상) */}
      <div className="flex gap-2">
        {canNativeShare && (
          <Button size="lg" variant="outline" className="flex-1" onClick={nativeShare}>
            공유하기
          </Button>
        )}
        <Button
          size="lg"
          variant="outline"
          className="flex-1"
          onClick={copyLink}
          aria-label={copied ? '링크가 복사되었습니다' : '공유 링크 복사'}
        >
          {copied ? '✓ 복사됨!' : '링크 복사'}
        </Button>
      </div>

      {/* 스크린리더용 복사 알림 — 버튼 라벨 변화를 보조기기에 polite하게 전달 */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? '링크가 복사되었습니다.' : ''}
      </span>

      {/* 전환 목표 CTA — 비로그인은 proxy가 /login으로, 로그인은 오늘 챌린지(/)로 보낸다 */}
      <Link href="/" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
        나도 만들기
      </Link>
    </div>
  )
}
