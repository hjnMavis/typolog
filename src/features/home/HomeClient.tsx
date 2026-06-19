"use client"

import Link from "next/link"
import { useTodayChallenge } from "@/hooks/use-today-challenge"
import { useLogout } from "@/hooks/use-logout"
import { ApiError } from "@/lib/api-client"
import { buttonVariants, Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * 홈(오늘의 챌린지) — Phase 1 mock에서 A1 GET /api/challenges/today로 전환 (Day 4.5).
 * 데이터는 TanStack Query(['challenge','today'])가 들고, 이 컴포넌트는 상태별 UI만 그린다.
 */
export function HomeClient() {
  const { data: challenge, isPending, isError, error, refetch, isRefetching } = useTodayChallenge()
  const { logout, isPending: isLoggingOut } = useLogout()

  // 임시 로그아웃 진입(#52) — 정식 위치는 Day 9 마이페이지. 잠김 방지를 위해 성공·에러 상태 모두 노출.
  const logoutButton = (
    <button
      type="button"
      onClick={() => void logout()}
      disabled={isLoggingOut}
      className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-60"
    >
      {isLoggingOut ? "로그아웃 중…" : "로그아웃"}
    </button>
  )

  // 로딩 — 성공 상태와 같은 골격의 스켈레톤 (레이아웃 점프 방지)
  if (isPending) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8 text-center" aria-busy="true">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">오늘의 문장</p>
            <div className="mx-auto h-9 w-3/4 animate-pulse rounded-lg bg-muted" />
            <div className="mx-auto h-5 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
          <div className="h-11 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    )
  }

  if (isError) {
    const isNoChallenge = error instanceof ApiError && error.code === "CHALLENGE_NOT_FOUND"
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <h1 className="text-xl font-bold">
          {isNoChallenge ? "오늘의 챌린지가 아직 없어요" : "챌린지를 불러오지 못했어요"}
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
        <div className="mt-6">{logoutButton}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">오늘의 문장</p>
          <h1 className="text-3xl font-bold tracking-tight">
            {challenge.sentence}
          </h1>
          <p className="text-sm text-muted-foreground">
            {challenge.letters.length}글자
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {challenge.letters.map((letter, i) => (
            <div
              key={i}
              className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-lg font-medium text-muted-foreground"
            >
              {letter}
            </div>
          ))}
        </div>

        <Link
          href={`/challenge/${challenge.id}`}
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          시작하기
        </Link>

        {logoutButton}
      </div>
    </div>
  )
}
