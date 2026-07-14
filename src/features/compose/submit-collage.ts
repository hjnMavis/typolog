/**
 * 제출 동기화 오케스트레이터 — A2(draft) → A5(letters×N 병렬) → A6(collage) → A4(complete).
 *
 * 모든 단계가 멱등이라(409 기존 재사용 · letters UPSERT · collage upsert · 조건부 UPDATE)
 * 중간 실패 시 "처음부터 다시 실행"이 안전한 재시도 전략이다 (게이트 A-(f)).
 *
 * 글자 업로드(A5)는 서로 독립(slot_index 상이·UPSERT)이라 동시성 cap 3으로 병렬 실행한다
 * (#50, Day 10.5). 배치 내 개별 실패는 모아서 실패분만 1회 재시도하고, 재시도도 실패하면
 * 에러를 전파한다 — 그 경우 전체 재실행(기존 재시도 전략)이 그대로 안전망이다.
 *
 * 단계 함수들을 deps로 주입받는다 — 네트워크·Canvas 없이 병렬 실행/실패 처리/멱등 단축을
 * 단위 테스트하기 위함 (tests/unit/submit-collage.test.ts). 실제 배선은
 * use-submission.ts의 useSubmitCollage가 담당한다.
 */

import type { ApiSubmission } from "@/types/api"

export type SubmitPhase =
  | "creating"
  | "uploading-letters"
  | "uploading-collage"
  | "completing"

export interface SubmitProgress {
  phase: SubmitPhase
  /** uploading-letters 단계에서 업로드가 끝난 글자 수 (병렬 완료 누적, 0부터 — #50) */
  current?: number
  /** uploading-letters 단계의 전체 글자 수 */
  total?: number
}

export interface LetterSource {
  slotIndex: number
  character: string
  /** IndexedDB에서 읽은 크롭 원본 Blob (PNG) */
  blob: Blob
}

export interface SubmitCollageDeps {
  createOrGetSubmission: (challengeId: string) => Promise<ApiSubmission>
  /** 크롭 Blob → A5 규격(WebP, Safari는 JPEG 폴백 + width/height) 변환 */
  toLetterUploadImage: (
    source: Blob
  ) => Promise<{ blob: Blob; width: number; height: number }>
  uploadLetter: (
    submissionId: string,
    input: {
      slotIndex: number
      character: string
      width: number
      height: number
      image: Blob
    }
  ) => Promise<unknown>
  uploadCollage: (submissionId: string, image: Blob) => Promise<unknown>
  updateSubmission: (
    submissionId: string,
    input: { status: "completed"; is_public: boolean }
  ) => Promise<ApiSubmission>
}

export interface SubmitCollageOptions {
  challengeId: string
  letters: LetterSource[]
  collageBlob: Blob
  isPublic: boolean
  onProgress?: (progress: SubmitProgress) => void
}

/** A5 글자 업로드 동시성 상한 — 모바일 회선·Storage 과부하 방지 (#50 게이트 A) */
export const LETTER_UPLOAD_CONCURRENCY = 3

/** 변환(Canvas) + 업로드 1글자 — 병렬 워커가 공유하는 단위 작업 */
async function uploadOneLetter(
  deps: SubmitCollageDeps,
  submissionId: string,
  letter: LetterSource
): Promise<void> {
  const { blob, width, height } = await deps.toLetterUploadImage(letter.blob)
  await deps.uploadLetter(submissionId, {
    slotIndex: letter.slotIndex,
    character: letter.character,
    width,
    height,
    image: blob,
  })
}

/**
 * 글자들을 동시성 cap 안에서 병렬 업로드한다 (#50).
 * 1차 배치에서 실패한 글자만 모아 1회 재시도(각 A5는 UPSERT 멱등이라 안전),
 * 재시도도 실패하면 첫 에러를 전파한다 — 호출자는 전체 재실행으로 복구한다.
 */
async function uploadLettersConcurrently(
  deps: SubmitCollageDeps,
  submissionId: string,
  letters: LetterSource[],
  onLetterDone: () => void
): Promise<void> {
  const runBatch = async (batch: LetterSource[], collectFailures: boolean) => {
    const queue = [...batch]
    const failed: LetterSource[] = []
    // 워커 풀: cap개의 워커가 큐를 소비 — 항상 최대 cap개만 동시 진행
    const workers = Array.from(
      { length: Math.min(LETTER_UPLOAD_CONCURRENCY, queue.length) },
      async () => {
        let letter: LetterSource | undefined
        while ((letter = queue.shift()) !== undefined) {
          try {
            await uploadOneLetter(deps, submissionId, letter)
            onLetterDone()
          } catch (error) {
            if (!collectFailures) throw error
            failed.push(letter)
          }
        }
      }
    )
    await Promise.all(workers)
    return failed
  }

  const failed = await runBatch(letters, true)
  if (failed.length > 0) {
    await runBatch(failed, false) // 재시도 실패는 즉시 전파 → 전체 재실행 안전망
  }
}

export async function submitCollage(
  deps: SubmitCollageDeps,
  opts: SubmitCollageOptions
): Promise<ApiSubmission> {
  const { challengeId, letters, collageBlob, isPublic, onProgress } = opts

  onProgress?.({ phase: "creating" })
  const submission = await deps.createOrGetSubmission(challengeId)

  // 이미 완성된 제출(재진입 후 다시 제출 등) — 업로드는 409 SUBMISSION_NOT_DRAFT로
  // 막히므로 진행하지 않고 현재 상태를 그대로 돌려준다(멱등 단축).
  if (submission.status === "completed") {
    return submission
  }

  // A5 병렬(cap 3, #50) — 진행 표시는 순번 대신 완료 누적 수 (병렬에선 순번이 무의미)
  let completedCount = 0
  onProgress?.({ phase: "uploading-letters", current: 0, total: letters.length })
  await uploadLettersConcurrently(deps, submission.id, letters, () => {
    completedCount += 1
    onProgress?.({
      phase: "uploading-letters",
      current: completedCount,
      total: letters.length,
    })
  })

  onProgress?.({ phase: "uploading-collage" })
  await deps.uploadCollage(submission.id, collageBlob)

  // A6 성공 후에만 A4 — completed 전이의 전제(collage_image_url != null) 충족 (게이트 A-(f))
  onProgress?.({ phase: "completing" })
  return deps.updateSubmission(submission.id, {
    status: "completed",
    is_public: isPublic,
  })
}
