"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTodayChallenge } from "@/hooks/use-today-challenge"
import { useCurrentUser } from "@/hooks/use-current-user"
import { useChallengeStore } from "@/stores/challenge-store"
import { clearAllImages } from "@/lib/image/indexed-image-store"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import type { Challenge } from "@/types"

interface TodayChallengeGateProps {
  /** URL의 [id] 세그먼트 — 오늘 챌린지와 일치해야 한다 */
  challengeId: string
  /** 챌린지가 준비됐을 때 렌더할 화면 (render prop) */
  children: (challenge: Challenge) => ReactNode
}

/**
 * 오늘의 챌린지 쿼리 게이트 — /challenge/[id]와 /challenge/[id]/preview가 공유하는 컨테이너.
 *
 * 별도 GET /api/challenges/[id]가 없으므로(§6.1) ['challenge','today'] 쿼리를 재사용하고,
 * URL id가 오늘 챌린지와 다르면 홈으로 보낸다 — A2(draft 생성)가 오늘 챌린지만
 * 허용하므로 MVP 동작과 정합하다 (게이트 A-(d)).
 */
export function TodayChallengeGate({ challengeId, children }: TodayChallengeGateProps) {
  const router = useRouter()
  const { data: challenge, isPending, isError, error, refetch, isRefetching } =
    useTodayChallenge()

  const isMismatch = !!challenge && challenge.id !== challengeId
  useEffect(() => {
    if (isMismatch) router.replace("/")
  }, [isMismatch, router])

  // draft owner-scope 가드(#53): 저장된 draft가 현재 사용자 것이 아니면(로그아웃 없는 계정
  // 전환·세션 만료 등) IDB 블롭 + store를 비운 뒤에야 children(수집/미리보기)을 렌더한다.
  // 같은 사용자면 즉시 통과해 진행 중 draft를 보존한다.
  const { userId, isResolved } = useCurrentUser()
  const [guarded, setGuarded] = useState(false)
  useEffect(() => {
    if (!isResolved) return
    let active = true
    async function guard() {
      const store = useChallengeStore.getState()
      // owner가 현재 사용자와 다르면 정리한다. userId가 null이어도(getClaims 실패 등)
      // ownerId가 남아 있으면 fail-safe로 비운다 — 서버측 인증은 src/proxy.ts가 1차로
      // 막고(보호 라우트 redirect), 이 가드는 그 위의 보강(defense-in-depth)이다.
      if (store.ownerId !== userId) {
        try {
          await clearAllImages()
        } catch {
          // 비필수: 디스크 잔여 블롭은 슬롯이 비워져 화면엔 노출되지 않는다
        }
        store.reset()
        store.setOwner(userId)
      }
      if (active) setGuarded(true)
    }
    void guard()
    return () => {
      active = false
    }
  }, [isResolved, userId])

  // `!guarded`는 프라이버시 게이트다 — owner-guard가 store/IDB 정리를 마치기 전에는
  // children(수집/미리보기)을 마운트하지 않는다. React 효과는 자식이 부모보다 먼저
  // 실행되므로, 여기서 막지 않으면 정리 전에 자식이 stale draft를 읽는다 (#53).
  if (isPending || isMismatch || !guarded) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6" aria-busy="true">
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      </div>
    )
  }

  if (isError) {
    const isNoChallenge = error instanceof ApiError && error.code === "CHALLENGE_NOT_FOUND"
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <h1 className="text-xl font-bold">
          {isNoChallenge ? "오늘의 챌린지가 없어요" : "챌린지를 불러오지 못했어요"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isNoChallenge
            ? "내일 새로운 문장으로 만나요."
            : "네트워크 상태를 확인하고 다시 시도해 주세요."}
        </p>
        {!isNoChallenge && (
          <Button
            size="lg"
            className="mt-6"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            {isRefetching ? "다시 시도 중…" : "다시 시도"}
          </Button>
        )}
        <Link
          href="/"
          className="mt-4 text-sm text-muted-foreground underline underline-offset-4"
        >
          홈으로 돌아가기
        </Link>
      </div>
    )
  }

  return <>{children(challenge)}</>
}
