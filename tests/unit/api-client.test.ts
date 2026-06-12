/**
 * api-client typed fetcher 단위 테스트
 *
 * 전역 fetch를 모킹해 다음을 검증한다:
 *   - 와이어 → 클라이언트 타입 매핑 (active_date → activeDate)
 *   - 표준 에러 바디 → ApiError 변환 (code/status 보존, 비-JSON 바디 폴백)
 *   - A2 create-or-get: 201 통과 / 409 SUBMISSION_EXISTS면 기존 submission 반환
 *   - A5 FormData 필드 구성 (숫자 → 문자열, 서버 zod coerce 전제)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  ApiError,
  createOrGetSubmission,
  fetchSubmissionDetail,
  fetchTodayChallenge,
  updateSubmission,
  uploadLetter,
} from "@/lib/api-client"
import type { ApiSubmission } from "@/types/api"

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const SUBMISSION: ApiSubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  challenge_id: "33333333-3333-4333-8333-333333333333",
  status: "draft",
  is_public: false,
  created_at: "2026-06-11T00:00:00.000Z",
  completed_at: null,
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────
// fetchTodayChallenge (A1)
// ─────────────────────────────────────────────────────────
describe("fetchTodayChallenge", () => {
  it("와이어 active_date를 클라이언트 Challenge.activeDate로 매핑한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: "c-1",
        sentence: "오늘도 화이팅",
        lines: ["오늘도", "화이팅"],
        letters: ["오", "늘", "도", "화", "이", "팅"],
        active_date: "2026-06-11",
      }),
    )

    const challenge = await fetchTodayChallenge()

    expect(challenge.activeDate).toBe("2026-06-11")
    expect(challenge.letters).toHaveLength(6)
    expect(fetchMock).toHaveBeenCalledWith("/api/challenges/today")
  })

  it("404면 코드가 보존된 ApiError를 던진다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: "오늘의 챌린지가 없습니다.", code: "CHALLENGE_NOT_FOUND" }),
    )

    const error = await fetchTodayChallenge().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(404)
    expect((error as ApiError).code).toBe("CHALLENGE_NOT_FOUND")
  })

  it("비-JSON 에러 바디(HTML 등)도 UNKNOWN 코드의 ApiError로 변환한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", { status: 502 }),
    )

    const error = await fetchTodayChallenge().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).code).toBe("UNKNOWN")
  })
})

// ─────────────────────────────────────────────────────────
// createOrGetSubmission (A2 — create-or-get 멱등 처리)
// ─────────────────────────────────────────────────────────
describe("createOrGetSubmission", () => {
  it("201이면 생성된 submission을 반환한다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, SUBMISSION))

    const result = await createOrGetSubmission(SUBMISSION.challenge_id)

    expect(result.id).toBe(SUBMISSION.id)
    expect(result.status).toBe("draft")
  })

  it("409 SUBMISSION_EXISTS면 동봉된 기존 submission을 반환한다 (에러 아님)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "이미 제출이 존재합니다.",
        code: "SUBMISSION_EXISTS",
        submission: SUBMISSION,
      }),
    )

    const result = await createOrGetSubmission(SUBMISSION.challenge_id)

    expect(result.id).toBe(SUBMISSION.id)
  })

  it("409인데 submission이 없으면 ApiError를 던진다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "이미 제출이 존재합니다.",
        code: "SUBMISSION_EXISTS",
        submission: null,
      }),
    )

    const error = await createOrGetSubmission(SUBMISSION.challenge_id).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
  })

  it("challenge_id를 JSON 바디로 전송한다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, SUBMISSION))

    await createOrGetSubmission("ch-1")

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ challenge_id: "ch-1" })
  })
})

// ─────────────────────────────────────────────────────────
// fetchSubmissionDetail (A3)
// ─────────────────────────────────────────────────────────
describe("fetchSubmissionDetail", () => {
  it("letter_pieces의 image_url이 null이어도 그대로 전달한다 (QA M2)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        submission: SUBMISSION,
        collage_url: null,
        letter_pieces: [
          {
            id: "p-1",
            slot_index: 0,
            character: "오",
            width: 600,
            height: 600,
            image_url: null,
          },
        ],
      }),
    )

    const detail = await fetchSubmissionDetail(SUBMISSION.id)

    expect(detail.letter_pieces[0].image_url).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────
// uploadLetter (A5 — FormData 구성)
// ─────────────────────────────────────────────────────────
describe("uploadLetter", () => {
  it("숫자 필드를 문자열로, 이미지를 파일로 담아 전송한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: "p-1",
        submission_id: SUBMISSION.id,
        character: "오",
        slot_index: 3,
        image_url: "user/sub/3.webp",
        width: 600,
        height: 600,
        created_at: "2026-06-11T00:00:00.000Z",
      }),
    )

    await uploadLetter(SUBMISSION.id, {
      slotIndex: 3,
      character: "오",
      width: 600,
      height: 600,
      image: new Blob(["x"], { type: "image/webp" }),
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/submissions/${SUBMISSION.id}/letters`)
    const form = init.body as FormData
    expect(form.get("slot_index")).toBe("3")
    expect(form.get("width")).toBe("600")
    expect(form.get("height")).toBe("600")
    expect(form.get("character")).toBe("오")
    expect(form.get("image")).toBeInstanceOf(File)
  })
})

// ─────────────────────────────────────────────────────────
// updateSubmission (A4)
// ─────────────────────────────────────────────────────────
describe("updateSubmission", () => {
  it("PATCH 성공 시 갱신된 submission을 반환한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...SUBMISSION, status: "completed", completed_at: "2026-06-11T01:00:00.000Z" }),
    )

    const result = await updateSubmission(SUBMISSION.id, { status: "completed", is_public: true })

    expect(result.status).toBe("completed")
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("PATCH")
  })

  it("409 SUBMISSION_INCOMPLETE는 코드가 보존된 ApiError로 던진다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "모든 글자와 콜라주를 채워야 완성할 수 있습니다.",
        code: "SUBMISSION_INCOMPLETE",
      }),
    )

    const error = await updateSubmission(SUBMISSION.id, { status: "completed" }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe("SUBMISSION_INCOMPLETE")
  })
})
