/**
 * useSubmitCollage 훅 단위 테스트 — 제출 완성 성공 시 캐시 무효화 (#74)
 *
 * 제출 완성은 세 서버 상태를 바꾼다:
 *   - ['submission', id]  : A3 상세(완성 상태 + 콜라주 signed URL) 재조회
 *   - ['my','submissions']: /my 목록 멤버십 (완성작 등장, #60 확정 화면 복원)
 *   - ['feed']            : 피드 멤버십 (내 카드가 피드에 새로 등장 — Day 9 §1 기준)
 *
 * Day 10 V-1: ['feed']가 목록에서 빠져 있었다 — staleTime(60s) 이내 재방문 시
 * 방금 제출한 내 카드가 피드에 안 보이는 갭. 이 테스트가 세 키 전부를 고정한다.
 */

import { describe, it, expect, vi } from "vitest"
import { createElement, type ReactNode } from "react"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSubmitCollage } from "@/hooks/use-submission"
import { submitCollage } from "@/features/compose/submit-collage"
import type { ApiSubmission } from "@/types/api"

// 훅의 배선 대상(네트워크·Canvas)은 전부 mock — 검증 대상은 onSuccess의 invalidate 목록뿐.
vi.mock("@/lib/api-client", () => ({
  createOrGetSubmission: vi.fn(),
  fetchSubmissionDetail: vi.fn(),
  updateSubmission: vi.fn(),
  uploadCollage: vi.fn(),
  uploadLetter: vi.fn(),
}))
vi.mock("@/lib/image/to-webp", () => ({ toLetterUploadImage: vi.fn() }))
vi.mock("@/features/compose/submit-collage", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/compose/submit-collage")>()
  return { ...original, submitCollage: vi.fn() }
})

const COMPLETED: ApiSubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  challenge_id: "33333333-3333-4333-8333-333333333333",
  status: "completed",
  is_public: true,
  created_at: "2026-07-13T00:00:00.000Z",
  completed_at: "2026-07-13T01:00:00.000Z",
}

function renderSubmitHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  const rendered = renderHook(() => useSubmitCollage(), { wrapper })
  return { ...rendered, invalidateSpy }
}

describe("useSubmitCollage — onSuccess 캐시 무효화 (#74)", () => {
  it("완성 성공 시 ['submission', id]·['my','submissions']·['feed']를 모두 invalidate한다", async () => {
    vi.mocked(submitCollage).mockResolvedValue(COMPLETED)
    const { result, invalidateSpy } = renderSubmitHook()

    await act(async () => {
      await result.current.mutateAsync({
        challengeId: COMPLETED.challenge_id,
        letters: [],
        collageBlob: new Blob(["collage"], { type: "image/png" }),
        isPublic: true,
      })
    })

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey)
    expect(invalidatedKeys).toContainEqual(["submission", COMPLETED.id])
    expect(invalidatedKeys).toContainEqual(["my", "submissions"])
    // V-1(#74): 제출 완성은 피드 멤버십을 바꾼다 — ['feed'] prefix가 ['feed', cid]를 포괄
    expect(invalidatedKeys).toContainEqual(["feed"])
  })

  it("제출 실패 시에는 아무 캐시도 invalidate하지 않는다", async () => {
    vi.mocked(submitCollage).mockRejectedValue(new Error("업로드 실패"))
    const { result, invalidateSpy } = renderSubmitHook()

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          challengeId: COMPLETED.challenge_id,
          letters: [],
          collageBlob: new Blob(["collage"], { type: "image/png" }),
          isPublic: true,
        }),
      ).rejects.toThrow("업로드 실패")
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
