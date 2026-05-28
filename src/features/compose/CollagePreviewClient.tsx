"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useChallengeStore } from "@/stores/challenge-store"
import { getImageBlob } from "@/lib/image/indexed-image-store"
import { getPieceLayout, canPreview } from "./collage-layout"
import { SLOT_BACKGROUND_COLORS, type BackgroundColor } from "@/lib/constants"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Challenge } from "@/types"

interface CollagePreviewClientProps {
  challenge: Challenge
}

/** 콜라주 카드 배경이 어두운지 판단 — 카드 '내부' 글자 폴백 대비에만 사용 */
function isDarkBackground(color: BackgroundColor): boolean {
  return color === "#1a1a1a"
}

export function CollagePreviewClient({ challenge }: CollagePreviewClientProps) {
  const { slots, initSlots } = useChallengeStore()

  /** 복원된 Object URL: key = slotIndex, value = 'blob:...' URL */
  const [restoredUrls, setRestoredUrls] = useState<Record<number, string>>({})
  /** 복원 중 로딩 상태 */
  const [isRestoring, setIsRestoring] = useState(true)
  /** 콜라주 카드 배경색 로컬 상태 — 기본값: 흰색 */
  const [bgColor, setBgColor] = useState<BackgroundColor>("#ffffff")

  /** 이 컴포넌트가 생성한 Object URL을 추적해 unmount 시 전부 revoke한다 */
  const objectUrlsRef = useRef<Map<number, string>>(new Map())

  // 슬롯 초기화 (idempotent — 이미 같은 challenge이면 store가 유지)
  useEffect(() => {
    initSlots(challenge)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- challenge.id가 바뀔 때만 재초기화
  }, [challenge.id, initSlots])

  // IndexedDB에서 Blob을 읽어 Object URL을 '항상 새로' 생성한다 (SSR-safe: useEffect 내부).
  // store의 slot.imageDataUrl은 capture 화면 언마운트 시 revoke될 수 있으므로 재사용하지 않는다.
  useEffect(() => {
    let isMounted = true

    const restore = async () => {
      setIsRestoring(true)

      const currentSlots = useChallengeStore.getState().slots
      const newUrls: Record<number, string> = {}

      for (const slot of currentSlots) {
        if (slot.status === "filled" && slot.imageKey) {
          try {
            const blob = await getImageBlob(slot.imageKey)
            if (!isMounted) return
            if (blob) {
              const url = URL.createObjectURL(blob)
              objectUrlsRef.current.set(slot.index, url)
              newUrls[slot.index] = url
            }
            // blob이 null이면 → 해당 슬롯은 글자 텍스트 폴백으로 표시
          } catch {
            // 비필수: IDB 오류 시 글자 텍스트 폴백
          }
        }
      }

      if (!isMounted) return
      setRestoredUrls(newUrls)
      setIsRestoring(false)
    }

    restore()

    return () => {
      isMounted = false
    }
  }, [challenge.id])

  // unmount/challenge 변경 시 이 컴포넌트가 만든 Object URL 전부 revoke
  useEffect(() => {
    const urlMap = objectUrlsRef.current
    return () => {
      urlMap.forEach((url) => URL.revokeObjectURL(url))
      urlMap.clear()
    }
  }, [challenge.id])

  const allFilled = canPreview(slots)
  // 카드 '내부' 글자 폴백 대비용 (페이지 전체에는 적용하지 않음)
  const cardIsDark = isDarkBackground(bgColor)

  // ─────────────────────────────────────────────
  // 슬롯 미준비 상태 폴백 UI
  // ─────────────────────────────────────────────
  if (!isRestoring && !allFilled) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-lg font-medium">아직 모든 글자가 준비되지 않았어요.</p>
        <p className="text-sm text-muted-foreground">
          모든 글자 슬롯을 채운 후 콜라주를 만들 수 있어요.
        </p>
        <Link
          href={`/challenge/${challenge.id}`}
          className={cn(buttonVariants({ size: "lg" }), "mt-2")}
        >
          글자 다시 채우기
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* 헤더 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <Link
          href={`/challenge/${challenge.id}`}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← 다시 수정
        </Link>
        <span className="text-sm font-medium text-muted-foreground">미리보기</span>
      </header>

      {/* 문장 표시 */}
      <section className="px-6 pb-3 pt-5 text-center">
        <p className="text-xs text-muted-foreground">오늘의 문장</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight">
          {challenge.sentence}
        </h1>
      </section>

      {/* 콜라주 카드 — 복원 중이면 스켈레톤, 배경색은 이 카드에만 적용 */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 pb-4">
        {isRestoring ? (
          <div className="aspect-square w-full max-w-xs animate-pulse rounded-2xl bg-black/10" />
        ) : (
          <div
            className={cn(
              "w-full max-w-xs overflow-hidden rounded-2xl shadow-xl",
              cardIsDark ? "shadow-black/60" : "shadow-black/20"
            )}
            style={{ backgroundColor: bgColor }}
          >
            {/* 글자 조각 배열 — 문장 순서(slot.index) 기준 */}
            <div className="flex flex-wrap items-center justify-center gap-1 p-4">
              {[...slots]
                .sort((a, b) => a.index - b.index)
                .map((slot) => {
                  const layout = getPieceLayout(slot.index)
                  const imageUrl = restoredUrls[slot.index] ?? null

                  return (
                    <div
                      key={slot.index}
                      style={{
                        transform: `rotate(${layout.rotateDeg}deg) scale(${layout.scale})`,
                        marginTop: `${layout.marginTopPx}px`,
                        willChange: "transform",
                      }}
                      className="relative shrink-0"
                    >
                      {imageUrl ? (
                        <div className="size-16 overflow-hidden rounded-xl ring-1 ring-black/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageUrl}
                            alt={slot.character}
                            className="size-full object-cover"
                            draggable={false}
                          />
                        </div>
                      ) : (
                        // IDB Blob 없음 → 글자 텍스트 폴백 (카드 배경 대비 유지)
                        <div
                          className={cn(
                            "flex size-16 items-center justify-center rounded-xl text-2xl font-bold ring-1",
                            cardIsDark
                              ? "bg-white/10 text-white ring-white/20"
                              : "bg-black/5 text-foreground ring-black/10"
                          )}
                        >
                          {slot.character}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </section>

      {/* 배경색 선택 */}
      <section className="flex flex-col items-center gap-3 px-6 pb-4">
        <p className="text-xs text-muted-foreground">배경색 선택</p>
        <div className="flex gap-3">
          {SLOT_BACKGROUND_COLORS.map((color) => {
            const isSelected = color === bgColor
            return (
              <button
                key={color}
                type="button"
                aria-label={`배경색 ${color}`}
                aria-pressed={isSelected}
                onClick={() => setBgColor(color)}
                className={cn(
                  "size-9 rounded-full border-2 transition-all",
                  isSelected
                    ? "scale-110 border-primary shadow-md"
                    : "border-black/20 hover:border-black/40"
                )}
                style={{ backgroundColor: color }}
              />
            )
          })}
        </div>
      </section>

      {/* 액션 버튼 */}
      <section className="space-y-3 px-6 pb-8 pb-safe-bottom">
        {/* Day 7 예정: PNG 저장 — 현재는 disabled */}
        <Button
          disabled
          size="lg"
          className="w-full cursor-not-allowed opacity-40"
          aria-label="PNG 저장은 Day 7에 제공됩니다"
        >
          저장하기 (Day 7 예정)
        </Button>

        <Link
          href={`/challenge/${challenge.id}`}
          className="block w-full py-2 text-center text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          다시 수정
        </Link>
      </section>
    </div>
  )
}
