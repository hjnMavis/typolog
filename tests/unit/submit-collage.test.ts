/**
 * submitCollage 오케스트레이터 단위 테스트
 *
 * deps 주입 구조라 네트워크·Canvas 없이 검증한다:
 *   - A2 → A5×N(병렬, cap 3 — #50) → A6 → A4 실행 + submission id 전달
 *   - A5 동시성 상한(cap 3) 준수
 *   - 진행 콜백(onProgress): 완료 누적 수(0→N) + 단계 순서
 *   - 이미 completed인 제출의 멱등 단축 (업로드·전이 생략)
 *   - A5 부분 실패 → 실패분만 1회 재시도 / 재시도도 실패 시 에러 전파 + 이후 단계 미실행
 *   - is_public 전달
 */

import { describe, it, expect, vi } from "vitest"
import {
  submitCollage,
  LETTER_UPLOAD_CONCURRENCY,
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
  it("A2 → A5×N → A6 → A4 순서를 지키고 submission id를 끝까지 전달한다 (A5는 병렬 — 상호 순서 무관)", async () => {
    const { deps, calls } = makeDeps()
    const letters = makeLetters(3)

    const result = await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters,
      collageBlob: new Blob(["collage"], { type: "image/png" }),
      isPublic: true,
    })

    expect(result.status).toBe("completed")
    // 단계 경계: create가 처음, collage→complete가 마지막 — 글자들은 그 사이에 전부
    expect(calls[0]).toBe("create")
    expect(calls.slice(-2)).toEqual(["collage", "complete"])
    const letterCalls = calls.filter((c) => c.startsWith("letter:"))
    expect(letterCalls.sort()).toEqual(["letter:0", "letter:1", "letter:2"])
    // A6는 모든 글자 완료 이후에만 실행된다
    expect(calls.indexOf("collage")).toBeGreaterThan(
      Math.max(...letterCalls.map((c) => calls.indexOf(c))),
    )
    // A2가 돌려준 id가 모든 후속 단계에 전달된다
    expect(deps.uploadLetter).toHaveBeenCalledWith(DRAFT.id, expect.anything())
    expect(deps.uploadCollage).toHaveBeenCalledWith(DRAFT.id, expect.any(Blob))
    expect(deps.updateSubmission).toHaveBeenCalledWith(DRAFT.id, {
      status: "completed",
      is_public: true,
    })
  })

  it("A5 동시 실행 수가 cap(3)을 넘지 않는다 (#50)", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const { deps } = makeDeps({
      uploadLetter: vi.fn(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return {}
      }),
    })

    await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters: makeLetters(7),
      collageBlob: new Blob(["collage"]),
      isPublic: true,
    })

    expect(deps.uploadLetter).toHaveBeenCalledTimes(7)
    expect(maxInFlight).toBeGreaterThan(1) // 실제로 병렬임
    expect(maxInFlight).toBeLessThanOrEqual(LETTER_UPLOAD_CONCURRENCY)
  })

  it("진행 콜백: 단계 순서 + 글자 완료 누적 수(0→N)를 보고한다", async () => {
    const { deps } = makeDeps()
    const phases: SubmitProgress[] = []

    await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters: makeLetters(2),
      collageBlob: new Blob(["collage"]),
      isPublic: false,
      onProgress: (p) => phases.push(p),
    })

    expect(phases[0]).toEqual({ phase: "creating" })
    expect(phases.slice(-2)).toEqual([{ phase: "uploading-collage" }, { phase: "completing" }])
    // 병렬이라 순번 대신 완료 누적 수 — 0에서 시작해 N까지 단조 증가
    const letterEvents = phases.filter((p) => p.phase === "uploading-letters")
    expect(letterEvents.map((p) => p.current)).toEqual([0, 1, 2])
    expect(letterEvents.every((p) => p.total === 2)).toBe(true)
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

  it("A5 부분 실패 시 실패한 글자만 재시도해 성공하면 체인이 완주한다 (#50)", async () => {
    // slot 1만 첫 시도 실패 → 재시도 성공. UPSERT 멱등이라 재업로드 안전.
    const failedOnce = new Set<number>()
    const { deps } = makeDeps({
      uploadLetter: vi.fn(async (_id, input: { slotIndex: number }) => {
        if (input.slotIndex === 1 && !failedOnce.has(1)) {
          failedOnce.add(1)
          throw new Error("일시 실패")
        }
        return {}
      }),
    })

    const result = await submitCollage(deps, {
      challengeId: DRAFT.challenge_id,
      letters: makeLetters(3),
      collageBlob: new Blob(["collage"]),
      isPublic: true,
    })

    expect(result.status).toBe("completed")
    // 3글자 + 실패분(slot 1) 재시도 1회 = 4회
    expect(deps.uploadLetter).toHaveBeenCalledTimes(4)
    expect(deps.uploadCollage).toHaveBeenCalledTimes(1)
  })

  it("재시도까지 실패하면 에러가 전파되고 이후 단계가 실행되지 않는다", async () => {
    const { deps } = makeDeps({
      uploadLetter: vi.fn(async (_id, input: { slotIndex: number }) => {
        if (input.slotIndex === 1) throw new Error("업로드 실패")
        return {}
      }),
    })

    await expect(
      submitCollage(deps, {
        challengeId: DRAFT.challenge_id,
        letters: makeLetters(3),
        collageBlob: new Blob(["collage"]),
        isPublic: true,
      }),
    ).rejects.toThrow("업로드 실패")

    // 1차 3회(그중 slot 1 실패) + 재시도 1회 실패 = 4회
    expect(deps.uploadLetter).toHaveBeenCalledTimes(4)
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
