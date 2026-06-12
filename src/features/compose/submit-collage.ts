/**
 * 제출 동기화 오케스트레이터 — A2(draft) → A5(letters×N) → A6(collage) → A4(complete).
 *
 * 모든 단계가 멱등이라(409 기존 재사용 · letters UPSERT · collage upsert · 조건부 UPDATE)
 * 중간 실패 시 "처음부터 다시 실행"이 안전한 재시도 전략이다 (게이트 A-(f)).
 *
 * 단계 함수들을 deps로 주입받는다 — 네트워크·Canvas 없이 순차 실행/실패 처리/멱등 단축을
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
  /** uploading-letters 단계의 현재 순번 (1-base) */
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

  for (const [i, letter] of letters.entries()) {
    onProgress?.({
      phase: "uploading-letters",
      current: i + 1,
      total: letters.length,
    })
    const { blob, width, height } = await deps.toLetterUploadImage(letter.blob)
    await deps.uploadLetter(submission.id, {
      slotIndex: letter.slotIndex,
      character: letter.character,
      width,
      height,
      image: blob,
    })
  }

  onProgress?.({ phase: "uploading-collage" })
  await deps.uploadCollage(submission.id, collageBlob)

  // A6 성공 후에만 A4 — completed 전이의 전제(collage_image_url != null) 충족 (게이트 A-(f))
  onProgress?.({ phase: "completing" })
  return deps.updateSubmission(submission.id, {
    status: "completed",
    is_public: isPublic,
  })
}
