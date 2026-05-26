"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Link from "next/link"
import { useChallengeStore } from "@/stores/challenge-store"
import { LetterSlot } from "./LetterSlot"
import { ImagePickerSheet } from "./ImagePickerSheet"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Challenge } from "@/types"

interface CaptureClientProps {
  challenge: Challenge
}

export function CaptureClient({ challenge }: CaptureClientProps) {
  const {
    slots,
    activeSlotIndex,
    isComplete,
    initSlots,
    selectSlot,
    deselectSlot,
    fillSlot,
  } = useChallengeStore()

  const [sheetOpen, setSheetOpen] = useState(false)
  const objectUrlsRef = useRef<Map<number, string>>(new Map())

  useEffect(() => {
    initSlots(challenge)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- challenge.id가 바뀔 때만 재초기화
  }, [challenge.id, initSlots])

  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [challenge.id])

  const handleSlotTap = useCallback(
    (index: number) => {
      if (activeSlotIndex === index) {
        deselectSlot()
        setSheetOpen(false)
      } else {
        selectSlot(index)
        setSheetOpen(true)
      }
    },
    [activeSlotIndex, selectSlot, deselectSlot]
  )

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      setSheetOpen(open)
      if (!open) deselectSlot()
    },
    [deselectSlot]
  )

  const handleImageSelected = useCallback(
    (file: File) => {
      if (activeSlotIndex === null) return

      const oldUrl = objectUrlsRef.current.get(activeSlotIndex)
      if (oldUrl) URL.revokeObjectURL(oldUrl)

      const objectUrl = URL.createObjectURL(file)
      objectUrlsRef.current.set(activeSlotIndex, objectUrl)
      fillSlot(activeSlotIndex, objectUrl)
      setSheetOpen(false)
    },
    [activeSlotIndex, fillSlot]
  )

  const filledCount = slots.filter((s) => s.status === "filled").length
  const totalCount = slots.length
  const activeCharacter =
    activeSlotIndex !== null ? slots[activeSlotIndex]?.character ?? null : null

  if (slots.length === 0) return null

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-4 pt-safe-top h-14 shrink-0">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← 홈
        </Link>
        <span className="text-sm font-medium text-muted-foreground">
          {filledCount} / {totalCount} 글자
        </span>
      </header>

      {/* 문장 표시 */}
      <section className="px-6 py-4 text-center">
        <p className="text-sm text-muted-foreground">오늘의 문장</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {challenge.sentence}
        </h1>
      </section>

      {/* 진행률 바 */}
      <div className="mx-6 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{
            width: `${totalCount > 0 ? (filledCount / totalCount) * 100 : 0}%`,
          }}
        />
      </div>

      {/* 글자 슬롯 그리드 */}
      <section className="flex-1 px-6 py-6">
        <div
          className={cn(
            "grid gap-3 mx-auto max-w-sm",
            totalCount <= 4 && "grid-cols-4",
            totalCount >= 5 && totalCount <= 6 && "grid-cols-3",
            totalCount >= 7 && "grid-cols-4"
          )}
        >
          {slots.map((slot) => (
            <LetterSlot
              key={slot.index}
              character={slot.character}
              status={slot.status}
              isActive={activeSlotIndex === slot.index}
              imageDataUrl={slot.imageDataUrl}
              onTap={() => handleSlotTap(slot.index)}
            />
          ))}
        </div>
      </section>

      {/* 안내 + 액션 */}
      <section className="px-6 pb-6 pb-safe-bottom space-y-3">
        {activeSlotIndex === null && !isComplete && (
          <p className="text-center text-sm text-muted-foreground">
            슬롯을 터치해서 글자를 모아보세요
          </p>
        )}

        {isComplete && (
          <p className="text-center text-sm text-primary font-medium">
            모든 글자를 모았어요!
          </p>
        )}

        <Link
          href={isComplete ? `/challenge/${challenge.id}/preview` : "#"}
          aria-disabled={!isComplete}
          className={cn(
            buttonVariants({ size: "lg" }),
            "w-full",
            !isComplete && "pointer-events-none opacity-40"
          )}
        >
          콜라주 만들기
        </Link>
      </section>

      {/* 이미지 선택 시트 */}
      <ImagePickerSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        character={activeCharacter}
        onImageSelected={handleImageSelected}
      />
    </div>
  )
}
