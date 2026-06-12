"use client"

import { useEffect, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTodayChallenge } from "@/hooks/use-today-challenge"
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

  if (isPending || isMismatch) {
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
