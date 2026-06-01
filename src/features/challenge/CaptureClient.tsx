"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Link from "next/link"
import { useChallengeStore } from "@/stores/challenge-store"
import { LetterSlot } from "./LetterSlot"
import { ImagePickerSheet } from "./ImagePickerSheet"
import { ImageCropperModal } from "./ImageCropperModal"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  saveImageBlob,
  getImageBlob,
  deleteImageBlobs,
} from "@/lib/image/indexed-image-store"
import { getCollageLines } from "@/lib/collage/sentence-lines"
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
    setSlotImageUrl,
    clearImageUrls,
    resetDraft,
  } = useChallengeStore()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [cropperOpen, setCropperOpen] = useState(false)
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null)
  /** User-facing error message when IDB save fails */
  const [saveError, setSaveError] = useState<string | null>(null)

  /** Map from slotIndex → live Object URL (runtime-only, never persisted) */
  const objectUrlsRef = useRef<Map<number, string>>(new Map())
  const cropSourceUrlRef = useRef<string | null>(null)
  const transitionToCropperRef = useRef(false)

  // Init slots (idempotent guard is inside the store)
  useEffect(() => {
    initSlots(challenge)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- challenge.id가 바뀔 때만 재초기화
  }, [challenge.id, initSlots])

  // Restore Object URLs from IDB when persisted metadata is available
  useEffect(() => {
    let isMounted = true

    const restore = async () => {
      const currentSlots = useChallengeStore.getState().slots
      for (const slot of currentSlots) {
        // Note: rehydrated slots may carry `undefined` (partialize omits the key),
        // so use a truthy check rather than `=== null`.
        if (slot.status === "filled" && slot.imageKey && !slot.imageDataUrl) {
          try {
            const blob = await getImageBlob(slot.imageKey)
            if (!isMounted) return
            if (blob) {
              const url = URL.createObjectURL(blob)
              objectUrlsRef.current.set(slot.index, url)
              setSlotImageUrl(slot.index, url)
            }
            // If blob is null (IDB missing), slot shows character fallback — acceptable
          } catch {
            // Non-critical: leave slot showing character fallback
          }
        }
      }
    }

    restore()

    return () => {
      isMounted = false
    }
  }, [challenge.id, setSlotImageUrl])

  // Revoke all Object URLs on unmount or challenge change
  useEffect(() => {
    const urls = objectUrlsRef.current
    const sourceRef = cropSourceUrlRef
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
      // 폐기한 URL 문자열이 스토어에 남으면 재진입 시 죽은 blob:을 렌더하므로 함께 비운다.
      // (재진입 시 복원 이펙트가 IDB에서 새 URL을 다시 만들도록)
      clearImageUrls()
      if (sourceRef.current) {
        URL.revokeObjectURL(sourceRef.current)
        sourceRef.current = null
      }
    }
  }, [challenge.id, clearImageUrls])

  const handleSlotTap = useCallback(
    (index: number) => {
      if (cropperOpen) return
      setSaveError(null)
      if (activeSlotIndex === index) {
        deselectSlot()
        setSheetOpen(false)
      } else {
        selectSlot(index)
        setSheetOpen(true)
      }
    },
    [activeSlotIndex, selectSlot, deselectSlot, cropperOpen]
  )

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      setSheetOpen(open)
      if (!open && !transitionToCropperRef.current) {
        deselectSlot()
      }
      transitionToCropperRef.current = false
    },
    [deselectSlot]
  )

  const handleFileSelected = useCallback(
    (file: File) => {
      if (activeSlotIndex === null) return
      transitionToCropperRef.current = true
      const url = URL.createObjectURL(file)
      cropSourceUrlRef.current = url
      setCropSourceUrl(url)
      setSheetOpen(false)
      setCropperOpen(true)
    },
    [activeSlotIndex]
  )

  /**
   * imageKey scheme: `${challengeId}:${slotIndex}` — deterministic so replacing
   * a slot is an idempotent overwrite with no orphan Blobs.
   */
  const handleCropConfirm = useCallback(
    async (croppedBlob: Blob) => {
      if (activeSlotIndex === null) return

      // Deterministic key — overwrite is safe, no orphan accumulation
      const imageKey = `${challenge.id}:${activeSlotIndex}`
      const fileType = croppedBlob.type || "image/png"
      const ext = fileType.split("/")[1] ?? "png"
      const fileName = `${activeSlotIndex}.${ext}`

      // Revoke old Object URL for this slot
      const oldUrl = objectUrlsRef.current.get(activeSlotIndex)
      if (oldUrl) URL.revokeObjectURL(oldUrl)

      try {
        await saveImageBlob(imageKey, croppedBlob)
      } catch (err) {
        // IDB unavailable — show error, do NOT mark slot as filled
        const message =
          err instanceof Error
            ? err.message
            : "이미지를 저장할 수 없습니다."
        setSaveError(message)
        // Still clean up the crop source URL
        if (cropSourceUrlRef.current) {
          URL.revokeObjectURL(cropSourceUrlRef.current)
          cropSourceUrlRef.current = null
        }
        setCropSourceUrl(null)
        setCropperOpen(false)
        return
      }

      setSaveError(null)
      const croppedUrl = URL.createObjectURL(croppedBlob)
      objectUrlsRef.current.set(activeSlotIndex, croppedUrl)
      fillSlot(activeSlotIndex, { imageKey, fileName, fileType }, croppedUrl)

      if (cropSourceUrlRef.current) {
        URL.revokeObjectURL(cropSourceUrlRef.current)
        cropSourceUrlRef.current = null
      }
      setCropSourceUrl(null)
      setCropperOpen(false)
    },
    [activeSlotIndex, challenge.id, fillSlot]
  )

  const handleCropCancel = useCallback(() => {
    if (cropSourceUrlRef.current) {
      URL.revokeObjectURL(cropSourceUrlRef.current)
      cropSourceUrlRef.current = null
    }
    setCropSourceUrl(null)
    setCropperOpen(false)
    deselectSlot()
  }, [deselectSlot])

  /** Collect filled imageKeys, revoke all URLs, wipe IDB entries, then reset store. */
  const handleResetDraft = useCallback(async () => {
    const currentSlots = useChallengeStore.getState().slots
    const keysToDelete = currentSlots
      .filter((s) => s.imageKey !== null)
      .map((s) => s.imageKey as string)

    // Revoke all live Object URLs
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrlsRef.current.clear()

    // Delete Blobs from IDB (fire-and-forget; UI reset proceeds regardless)
    try {
      await deleteImageBlobs(keysToDelete)
    } catch {
      // Non-critical: orphaned IDB entries don't affect UX
    }

    resetDraft()
    setSaveError(null)
  }, [resetDraft])

  const filledCount = slots.filter((s) => s.status === "filled").length
  const totalCount = slots.length
  const activeCharacter =
    activeSlotIndex !== null ? slots[activeSlotIndex]?.character ?? null : null

  // 작성자 지정 줄 배치 → 슬롯 index 행 배열 + index로 슬롯을 찾는 맵
  const collageLines = getCollageLines(challenge.lines)
  const slotByIndex = new Map(slots.map((slot) => [slot.index, slot]))

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

      {/* 글자 슬롯 — 작성자 지정 줄 배치(challenge.lines)대로 행 스택 */}
      <section className="flex-1 px-6 py-6">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
          {collageLines.map((row) => (
            <div key={row[0]} className="flex w-full justify-center gap-3">
              {row.map((slotIndex) => {
                const slot = slotByIndex.get(slotIndex)
                if (!slot) return null
                return (
                  // A2: 슬롯을 w-16 min-w-0 shrink 래퍼로 감싸 flex 행에서 폭0 붕괴를 막는다.
                  // (LetterSlot 내부 aspect-square w-full이 래퍼 폭을 채워 정사각 유지)
                  <div key={slot.index} className="w-16 min-w-0 shrink">
                    <LetterSlot
                      character={slot.character}
                      status={slot.status}
                      isActive={activeSlotIndex === slot.index}
                      imageDataUrl={slot.imageDataUrl ?? null}
                      onTap={() => handleSlotTap(slot.index)}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>

      {/* 안내 + 액션 */}
      <section className="px-6 pb-6 pb-safe-bottom space-y-3">
        {/* IDB 저장 실패 에러 메시지 */}
        {saveError && (
          <p className="text-center text-sm text-destructive" role="alert">
            {saveError}
          </p>
        )}

        {activeSlotIndex === null && !isComplete && !saveError && (
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

        {/* 다시 시작 버튼 — 슬롯이 하나라도 채워졌을 때만 표시 */}
        {filledCount > 0 && (
          <button
            type="button"
            onClick={handleResetDraft}
            className="w-full text-sm text-muted-foreground underline underline-offset-4 py-1"
          >
            다시 시작
          </button>
        )}
      </section>

      {/* 이미지 선택 시트 */}
      <ImagePickerSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        character={activeCharacter}
        onImageSelected={handleFileSelected}
      />

      {/* 이미지 크롭 모달 */}
      {cropSourceUrl && activeCharacter && (
        <ImageCropperModal
          open={cropperOpen}
          imageSrc={cropSourceUrl}
          character={activeCharacter}
          onCropComplete={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  )
}
