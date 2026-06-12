/**
 * submitCollage 오케스트레이터 단위 테스트
 *
 * deps 주입 구조라 네트워크·Canvas 없이 검증한다:
 *   - A2 → A5×N → A6 → A4 순차 실행 + submission id 전달
 *   - 진행 콜백(onProgress) 단계 순서
 *   - 이미 completed인 제출의 멱등 단축 (업로드·전이 생략)
 *   - 중간 실패 시 이후 단계 미실행 + 에러 전파
 *   - is_public 전달
 */

import { describe, it, expect, vi } from "vitest"
import {
  submitCollage,
  type LetterSource,
  type SubmitCollageDeps,
  type SubmitProgress,
} from "@/features/compose/submit-collage"
import type { ApiSubmission } from "@/types/api"

const DRAFT: ApiSubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  challenge_id: "33333333-3333-4333-8333-333333333333",
  status: "draft",
  is_public: false,
  created_at: "2026-06-11T00:00:00.000Z",
  completed_at: null,
}

const COMPLETED: ApiSubmission = {
  ...DRAFT,
  status: "completed",
  completed_at: "2026-06-11T01:00:00.000Z",
}

function makeLetters(count: number): LetterSource[] {
  return Array.from({ length: count }, (_, i) => ({
    slotIndex: i,
    character: String(i),
    blob: new Blob([`letter-${i}`], { type: "image/png" }),
  }))
}

/** 호출 순서를 기록하는 fake deps */
function makeDeps(overrides: Partial<SubmitCollageDeps> = {}) {
  const calls: string[] = []
  const deps: SubmitCollageDeps = {
    createOrGetSubmission: vi.fn(async () => {
      calls.push("create")
      return DRAFT
    }),
    toLetterUploadImage: vi.fn(async (source: Blob) => {
      calls.push("convert")
      return { blob: new Blob([source], { type: "image/webp" }), width: 600, height: 600 }
    }),
    uploadLetter: vi.fn(async (_id, input) => {
      calls.push(`letter:${input.slotIndex}`)
      return {}
    }),
    uploadCollage: vi.fn(async () => {
      calls.push("collage")
      return {}
    }),
    updateSubmission: vi.fn(async () => {
      calls.push("complete")
      return COMPLETED
    }),
    ...overrides,
  }
  return { deps, calls }
}

describe("submitCollage", () => {
  it("A2 → A5×N → A6 → A4 순서로 실행하고 submission id를 끝까지 전달한다", async () => {
    const { deps, calls } = makeDeps()
    const letters = makeLetters(3)

    const result = await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters,
      collageBlob: new Blob(["collage"], { type: "image/png" }),
      isPublic: true,
    })

    expect(result.status).toBe("completed")
    expect(calls).toEqual([
      "create",
      "convert",
      "letter:0",
      "convert",
      "letter:1",
      "convert",
      "letter:2",
      "collage",
      "complete",
    ])
    // A2가 돌려준 id가 모든 후속 단계에 전달된다
    expect(deps.uploadLetter).toHaveBeenCalledWith(DRAFT.id, expect.anything())
    expect(deps.uploadCollage).toHaveBeenCalledWith(DRAFT.id, expect.any(Blob))
    expect(deps.updateSubmission).toHaveBeenCalledWith(DRAFT.id, {
      status: "completed",
      is_public: true,
    })
  })

  it("진행 콜백이 단계 순서대로 호출된다", async () => {
    const { deps } = makeDeps()
    const phases: SubmitProgress[] = []

    await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters: makeLetters(2),
      collageBlob: new Blob(["collage"]),
      isPublic: false,
      onProgress: (p) => phases.push(p),
    })

    expect(phases).toEqual([
      { phase: "creating" },
      { phase: "uploading-letters", current: 1, total: 2 },
      { phase: "uploading-letters", current: 2, total: 2 },
      { phase: "uploading-collage" },
      { phase: "completing" },
    ])
  })

  it("기존 제출이 이미 completed면 업로드·전이 없이 그대로 반환한다 (멱등 단축)", async () => {
    const { deps, calls } = makeDeps({
      createOrGetSubmission: vi.fn(async () => COMPLETED),
    })

    const result = await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters: makeLetters(2),
      collageBlob: new Blob(["collage"]),
      isPublic: true,
    })

    expect(result).toEqual(COMPLETED)
    expect(calls).toEqual([]) // fake create는 calls에 안 남기는 별도 mock — 업로드 단계 0회가 핵심
    expect(deps.uploadLetter).not.toHaveBeenCalled()
    expect(deps.uploadCollage).not.toHaveBeenCalled()
    expect(deps.updateSubmission).not.toHaveBeenCalled()
  })

  it("글자 업로드 중간 실패 시 이후 단계가 실행되지 않고 에러가 전파된다", async () => {
    const { deps } = makeDeps({
      uploadLetter: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("업로드 실패")),
    })

    await expect(
      submitCollage(deps, {
        challengeId: DRAFT.challenge_id,
        letters: makeLetters(3),
        collageBlob: new Blob(["collage"]),
        isPublic: true,
      }),
    ).rejects.toThrow("업로드 실패")

    expect(deps.uploadLetter).toHaveBeenCalledTimes(2) // 3개 중 2번째에서 중단
    expect(deps.uploadCollage).not.toHaveBeenCalled()
    expect(deps.updateSubmission).not.toHaveBeenCalled()
  })

  it("isPublic=false가 A4 입력으로 그대로 전달된다", async () => {
    const { deps } = makeDeps()

    await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters: makeLetters(1),
      collageBlob: new Blob(["collage"]),
      isPublic: false,
    })

    expect(deps.updateSubmission).toHaveBeenCalledWith(DRAFT.id, {
      status: "completed",
      is_public: false,
    })
  })
})
