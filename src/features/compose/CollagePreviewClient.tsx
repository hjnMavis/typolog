"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useChallengeStore } from "@/stores/challenge-store"
import { getImageBlob, deleteImageBlobs } from "@/lib/image/indexed-image-store"
import { loadImage } from "@/lib/image/crop-image"
import { TodayChallengeGate } from "@/features/challenge/TodayChallengeGate"
import { useSubmissionDetail, useSubmitCollage } from "@/hooks/use-submission"
import { useMySubmissions } from "@/hooks/use-my-submissions"
import type { LetterSource, SubmitProgress } from "./submit-collage"
import { getPieceLayout, canPreview } from "./collage-layout"
import { canExport, buildCollageFilename, downloadCollage, shouldUseIosFallbackWithTouch } from "./export-collage"
import { SLOT_BACKGROUND_COLORS, type BackgroundColor } from "@/lib/constants"
import { renderCollageToBlob } from "@/lib/collage/render-collage-to-blob"
import { getCollageLines } from "@/lib/collage/sentence-lines"
import { debugLog } from "@/lib/debug/log"
import { getKSTDateString } from "@/lib/constants/challenges"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Challenge } from "@/types"

interface CollagePreviewClientProps {
  challengeId: string
}

/** 콜라주 카드 배경이 어두운지 판단 — 카드 '내부' 글자 폴백 대비에만 사용 */
function isDarkBackground(color: BackgroundColor): boolean {
  return color === "#1a1a1a"
}

/** 제출 진행 단계 → 버튼 라벨 (게이트 A-(f): 진행 표시) */
function submitProgressLabel(progress: SubmitProgress | null): string {
  if (!progress) return "제출 중…"
  switch (progress.phase) {
    case "creating":
      return "제출 준비 중…"
    case "uploading-letters":
      // #50 병렬 업로드 — 순번 대신 완료 누적 수 표시
      return `글자 ${progress.total ?? 0}장 업로드 중… (${progress.current ?? 0}/${progress.total ?? 0})`
    case "uploading-collage":
      return "콜라주 업로드 중…"
    case "completing":
      return "완성 처리 중…"
  }
}

/**
 * 미리보기 화면 — TodayChallengeGate가 챌린지 서버 상태의 로딩/에러/URL 불일치를 처리하고,
 * 준비되면 CollagePreviewView(기존 미리보기 UI + Day 4.5 제출 흐름)를 렌더한다.
 */
export function CollagePreviewClient({ challengeId }: CollagePreviewClientProps) {
  return (
    <TodayChallengeGate challengeId={challengeId}>
      {(challenge) => <CollagePreviewView challenge={challenge} />}
    </TodayChallengeGate>
  )
}

interface CollagePreviewViewProps {
  challenge: Challenge
}

function CollagePreviewView({ challenge }: CollagePreviewViewProps) {
  const { slots, initSlots } = useChallengeStore()

  /** 복원된 Object URL: key = slotIndex, value = 'blob:...' URL */
  const [restoredUrls, setRestoredUrls] = useState<Record<number, string>>({})
  /** 복원 중 로딩 상태 */
  const [isRestoring, setIsRestoring] = useState(true)
  /** 콜라주 카드 배경색 로컬 상태 — 기본값: 흰색 */
  const [bgColor, setBgColor] = useState<BackgroundColor>("#ffffff")

  /** PNG export 진행 중 여부 */
  const [isExporting, setIsExporting] = useState(false)
  /** export 에러 메시지 (null이면 에러 없음) */
  const [exportError, setExportError] = useState<string | null>(null)
  /**
   * iOS Safari fallback 안내 표시 여부.
   * iOS에서는 <a download>가 동작하지 않으므로 새 탭으로 열고 사용자에게 저장 방법을 안내한다.
   */
  const [showIosSaveHint, setShowIosSaveHint] = useState(false)

  /** 이 컴포넌트가 생성한 Object URL을 추적해 unmount 시 전부 revoke한다 */
  const objectUrlsRef = useRef<Map<number, string>>(new Map())

  // ── 제출(서버 동기화) 상태 — Day 4.5 ──
  /** 피드 공개 여부 (A4 is_public) — 기본 공개 */
  const [isPublic, setIsPublic] = useState(true)
  /** 제출 체인 진행 단계 (버튼 라벨용) */
  const [submitProgress, setSubmitProgress] = useState<SubmitProgress | null>(null)
  /** 제출 실패 메시지 (전 단계 멱등이라 "다시 시도"는 같은 핸들러 재실행) */
  const [submitError, setSubmitError] = useState<string | null>(null)
  /** 제출 완료된 submission id — 설정되면 완료 UI로 전환 */
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const submitMutation = useSubmitCollage()
  // 제출 완료 후 A3 상세를 조회해 서버가 내려준 콜라주 signed URL로 완료 상태를 확인한다
  const { data: submittedDetail } = useSubmissionDetail(submittedId)
  // #60 결정 (B): 완성 콜라주는 확정 — 재진입 시 서버 완성 상태를 복원한다. /my 목록(공개+비공개,
  // 서버 is_public·signed URL 포함)에서 이 챌린지의 완성 제출을 찾는다. submittedId(방금 제출)는
  // 로컬 state라 재마운트 시 소실되므로, 이 조회가 "이미 제출함(확정)" 표시의 서버 권위 소스다.
  const { data: mySubmissions, isPending: isMyListPending } = useMySubmissions()
  const completedItem =
    mySubmissions?.items.find((item) => item.challenge.id === challenge.id) ?? null

  // 슬롯 초기화 (idempotent — 이미 같은 challenge이면 store가 유지)
  useEffect(() => {
    initSlots(challenge)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- challenge.id가 바뀔 때만 재초기화
  }, [challenge.id, initSlots])

  // #78: 확정(완성) 상태로 진입하면 이 챌린지의 로컬 draft(슬롯 메타 + IDB Blob)를 정리한다.
  // 수집 화면 리다이렉트(#78 CaptureClient)와 짝 — 잔존 로컬 데이터가 "편집되는 것처럼
  // 보이는" 혼란의 뿌리를 제거한다. 방금 제출한 화면(submittedId)은 콜라주 카드가 로컬
  // URL을 계속 쓰므로 제외하고, 다음 확정 화면 진입 때 정리된다.
  const shouldCleanupLocalDraft = !submittedId && completedItem !== null
  useEffect(() => {
    if (!shouldCleanupLocalDraft) return
    const store = useChallengeStore.getState()
    if (store.challengeId !== challenge.id) return
    const keys = store.slots
      .map((slot) => slot.imageKey)
      .filter((key): key is string => key !== null)
    if (keys.length === 0) return
    // 메타를 먼저 비워 stale 편집 진입을 즉시 차단하고, Blob 삭제는 fire-and-forget
    // (실패해도 메타가 비워져 화면에 노출되지 않는다 — handleResetDraft와 동일 방침)
    store.resetDraft()
    void deleteImageBlobs(keys).catch(() => {})
  }, [shouldCleanupLocalDraft, challenge.id])

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
      debugLog("preview", "restored", {
        challengeId: challenge.id,
        restored: Object.keys(newUrls).length,
        lines: challenge.lines,
      })
    }

    restore()

    return () => {
      isMounted = false
    }
  }, [challenge.id, challenge.lines])

  // unmount/challenge 변경 시 이 컴포넌트가 만든 Object URL 전부 revoke
  useEffect(() => {
    const urlMap = objectUrlsRef.current
    return () => {
      urlMap.forEach((url) => URL.revokeObjectURL(url))
      urlMap.clear()
    }
  }, [challenge.id])

  const allFilled = canPreview(slots)
  // 모든 슬롯 복원 완료 + 슬롯이 채워져 있으면 export 버튼 활성화
  const exportReady = !isRestoring && canExport(slots)
  // 카드 '내부' 글자 폴백 대비용 (페이지 전체에는 적용하지 않음)
  const cardIsDark = isDarkBackground(bgColor)

  // 작성자 지정 줄 배치 → 슬롯 index 행 배열 + index로 슬롯을 찾는 맵
  const collageLines = getCollageLines(challenge.lines)
  const slotByIndex = new Map(slots.map((slot) => [slot.index, slot]))

  /**
   * 각 슬롯의 HTMLImageElement를 로드해(없으면 텍스트 폴백) 콜라주 PNG Blob을 만든다.
   * 저장하기(PNG 다운로드)와 제출하기(A6 업로드)가 같은 파이프라인을 공유한다.
   */
  const renderCollageBlob = async (): Promise<Blob> => {
    const sortedSlots = [...slots].sort((a, b) => a.index - b.index)
    const items = await Promise.all(
      sortedSlots.map(async (slot) => {
        const url = restoredUrls[slot.index] ?? null
        if (!url) return { imageEl: null, character: slot.character }
        try {
          const imageEl = await loadImage(url)
          return { imageEl, character: slot.character }
        } catch {
          // 이미지 로드 실패 시 텍스트 폴백
          return { imageEl: null, character: slot.character }
        }
      })
    )
    // Canvas 렌더링 → PNG Blob 생성 (작성자 지정 줄 배치를 그대로 전달)
    return renderCollageToBlob({ items, bgColor, lines: challenge.lines })
  }

  /**
   * PNG export 핸들러.
   * 사용자 제스처(버튼 클릭) 내에서 직접 호출돼야 iOS 팝업 차단을 최대한 피할 수 있다.
   */
  const handleExport = async () => {
    if (!exportReady || isExporting) return

    setIsExporting(true)
    setExportError(null)
    setShowIosSaveHint(false)

    try {
      const blob = await renderCollageBlob()

      // 파일명: typolog-{challengeId}-{YYYYMMDD}.png (Asia/Seoul 기준 날짜)
      const filename = buildCollageFilename(challenge.id, getKSTDateString())

      // iOS fallback 여부 판단 (UA + maxTouchPoints).
      // 데스크톱 Chrome/Firefox/Edge는 maxTouchPoints 값과 무관하게 직접 다운로드한다.
      const useIosFallback = shouldUseIosFallbackWithTouch(
        navigator.userAgent,
        navigator.maxTouchPoints
      )

      const result = await downloadCollage({ blob, filename, useIosFallback })

      debugLog("export", "collage exported", {
        challengeId: challenge.id,
        lines: challenge.lines,
        filename,
        mode: result.mode,
        blobSize: blob.size,
        useIosFallback,
      })

      if (result.mode === "ios-fallback") {
        // iOS: 새 탭으로 이미지가 열렸으므로 사용자에게 저장 방법 안내
        setShowIosSaveHint(true)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "이미지 저장 중 오류가 발생했습니다"
      setExportError(message)
    } finally {
      setIsExporting(false)
    }
  }

  /**
   * 제출 핸들러 — Zustand 로컬 draft를 서버로 동기화한다 (게이트 A-(f)).
   * IDB에서 슬롯 Blob을 모아 A2(draft)→A5(letters×N)→A6(collage)→A4(complete)를
   * 순차 실행한다. 전 단계가 멱등이라 실패 시 같은 버튼으로 처음부터 재시도해도 안전하다.
   */
  const handleSubmit = async () => {
    // completedItem·isMyListPending 가드: 확정된 제출의 재제출 차단(#60 (B)) + 복원 조회 중 오클릭 방지.
    // 서버도 completed 재제출을 no-op로 막지만(submit-collage 멱등 단축), UI에서 1차로 막는다.
    if (!exportReady || submitMutation.isPending || submittedId || completedItem || isMyListPending)
      return

    setSubmitError(null)
    try {
      // 1) 슬롯별 크롭 Blob 수집 (IndexedDB)
      const sortedSlots = [...slots].sort((a, b) => a.index - b.index)
      const letters: LetterSource[] = []
      for (const slot of sortedSlots) {
        const blob = slot.imageKey ? await getImageBlob(slot.imageKey) : null
        if (!blob) {
          throw new Error("글자 이미지를 찾을 수 없어요. 수집 화면에서 다시 채워주세요.")
        }
        letters.push({ slotIndex: slot.index, character: slot.character, blob })
      }

      // 2) 콜라주 PNG 렌더 — 저장하기와 동일 파이프라인 (A6 규격: PNG ≤2MB)
      const collageBlob = await renderCollageBlob()

      // 3) 순차 mutation 실행 (진행 단계는 버튼 라벨로 표시)
      const submission = await submitMutation.mutateAsync({
        challengeId: challenge.id,
        letters,
        collageBlob,
        isPublic,
        onProgress: setSubmitProgress,
      })

      setSubmittedId(submission.id)
      debugLog("submit", "collage submitted", {
        submissionId: submission.id,
        status: submission.status,
        isPublic: submission.is_public,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "제출 중 오류가 발생했습니다."
      setSubmitError(message)
    } finally {
      setSubmitProgress(null)
    }
  }

  // ─────────────────────────────────────────────
  // 이미 완성한 챌린지 — 확정 화면 (#60 결정 (B))
  // ─────────────────────────────────────────────
  // 재진입(재마운트) 시 로컬 submittedId가 없어도 서버 완성 상태를 복원해 재제출 UI를 막는다.
  // 로컬 슬롯(IndexedDB) 유무와 무관하게 동작해야 하므로 슬롯 폴백보다 먼저 판정한다.
  // 콜라주·is_public은 /my 목록의 서버 값(signed URL 포함)을 그대로 쓴다.
  if (!submittedId && completedItem) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <div
          role="status"
          className="w-full max-w-sm space-y-3 rounded-lg bg-primary/10 px-4 py-5 text-sm text-primary"
        >
          <p className="text-base font-medium">이미 완성한 콜라주예요</p>
          {completedItem.collage_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={completedItem.collage_url}
              alt="완성된 콜라주"
              className="mx-auto w-40 rounded-lg ring-1 ring-black/10"
            />
          )}
          <p>
            {completedItem.submission.is_public
              ? "오늘의 피드에 공개돼요."
              : "비공개로 저장돼 있어요."}
          </p>
          <p className="text-xs text-muted-foreground">
            완성한 콜라주는 확정돼요. 공개 여부는 마이 탭에서 바꿀 수 있어요.
          </p>
        </div>
        <Link href="/feed/today" className={cn(buttonVariants({ size: "lg" }), "w-full max-w-sm")}>
          피드 보러가기
        </Link>
        <Link
          href="/my"
          className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          마이에서 공개 여부 바꾸기
        </Link>
      </div>
    )
  }

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
            {/* 글자 조각 — 작성자 지정 줄 배치(challenge.lines)대로 행 스택 */}
            <div className="flex flex-col gap-1 p-4">
              {collageLines.map((row) => (
                <div key={row[0]} className="flex w-full justify-center gap-1">
                  {row.map((slotIndex) => {
                    const slot = slotByIndex.get(slotIndex)
                    if (!slot) return null
                    const layout = getPieceLayout(slotIndex)
                    const imageUrl = restoredUrls[slotIndex] ?? null

                    return (
                      <div
                        key={slotIndex}
                        style={{
                          transform: `rotate(${layout.rotateDeg}deg) scale(${layout.scale})`,
                          marginTop: `${layout.marginTopPx}px`,
                          willChange: "transform",
                        }}
                        className="w-16 min-w-0 shrink"
                      >
                        {imageUrl ? (
                          <div className="aspect-square w-full overflow-hidden rounded-xl ring-1 ring-black/10">
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
                              "flex aspect-square w-full items-center justify-center rounded-xl text-2xl font-bold ring-1",
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
              ))}
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
        {/* export 에러 메시지 */}
        {exportError && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-4 py-2 text-center text-sm text-destructive"
          >
            {exportError}
          </p>
        )}

        {/* iOS Safari fallback 안내: 새 탭에서 이미지를 길게 눌러 저장 */}
        {showIosSaveHint && !exportError && (
          <p
            role="status"
            className="rounded-lg bg-primary/10 px-4 py-2 text-center text-sm text-primary"
          >
            새 탭에서 이미지를 길게 눌러 사진에 저장하세요.
          </p>
        )}

        {/* 제출 실패 메시지 — 전 단계 멱등이라 같은 버튼으로 재시도 */}
        {submitError && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-4 py-2 text-center text-sm text-destructive"
          >
            {submitError}
          </p>
        )}

        {submittedId ? (
          // 제출 완료 — A3 상세(invalidate 후 재조회)가 내려준 상태·signed URL로 확인
          <div
            role="status"
            className="space-y-2 rounded-lg bg-primary/10 px-4 py-3 text-center text-sm text-primary"
          >
            <p className="font-medium">제출 완료!</p>
            <p>
              {(submittedDetail?.submission.is_public ?? isPublic)
                ? "오늘의 피드에 공개돼요."
                : "비공개로 저장했어요."}
            </p>
            <p className="text-xs text-muted-foreground">
              완성한 콜라주는 확정돼요. 공개 여부는 마이 탭에서 바꿀 수 있어요.
            </p>
            {submittedDetail?.collage_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={submittedDetail.collage_url}
                alt="제출된 콜라주"
                className="mx-auto mt-1 w-28 rounded-lg ring-1 ring-black/10"
              />
            )}
            {/* #51: 제출 완료 후 막다른 길 방지 — 피드로 가는 동선 제공 */}
            <Link
              href="/feed/today"
              className={cn(buttonVariants({ size: "lg" }), "mt-2 w-full")}
            >
              피드 보러가기
            </Link>
          </div>
        ) : (
          <>
            <label className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                disabled={submitMutation.isPending}
                className="size-4 accent-primary"
              />
              오늘의 피드에 공개
            </label>
            <Button
              size="lg"
              className="w-full"
              // isMyListPending: 완성 상태 복원 조회가 끝나기 전 제출 방지 (#60 — 확정 여부 미확인 상태)
              disabled={!exportReady || submitMutation.isPending || isMyListPending}
              aria-label={
                submitMutation.isPending ? submitProgressLabel(submitProgress) : "제출하기"
              }
              onClick={handleSubmit}
            >
              {submitMutation.isPending ? submitProgressLabel(submitProgress) : "제출하기"}
            </Button>
          </>
        )}

        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={!exportReady || isExporting}
          aria-label={isExporting ? "PNG 저장 중…" : "PNG로 저장하기"}
          onClick={handleExport}
        >
          {isExporting ? "저장 중…" : "저장하기"}
        </Button>

        {/* 완성 후에는 글자 재수집이 막히므로(#60 (B): 확정) 수정 동선을 숨긴다 */}
        {!submittedId && (
          <Link
            href={`/challenge/${challenge.id}`}
            className="block w-full py-2 text-center text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            다시 수정
          </Link>
        )}
      </section>
    </div>
  )
}
