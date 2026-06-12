/**
 * validateLetterImage 단위 테스트 — A5 업로드 검증 (MIME + 크기, §7.5)
 *
 * Day 4.5 옵션 A: WebP(기본) + JPEG(Safari 폴백) 허용, 그 외 MIME 거부.
 * 버킷 allowed_mime_types(마이그레이션 0004)와 동일 목록이어야 한다.
 */

import { describe, it, expect } from "vitest"
import {
  LETTER_IMAGE_MAX_BYTES,
  LETTER_IMAGE_MIMES,
  validateLetterImage,
} from "@/lib/validations/letter-piece"

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], "letter", { type })
}

describe("validateLetterImage", () => {
  it("WebP를 허용한다", () => {
    expect(validateLetterImage(makeFile("image/webp", 1024))).toBeNull()
  })

  it("JPEG를 허용한다 (Safari canvas WebP 인코딩 미지원 폴백)", () => {
    expect(validateLetterImage(makeFile("image/jpeg", 1024))).toBeNull()
  })

  it("PNG는 400으로 거부한다", () => {
    const error = validateLetterImage(makeFile("image/png", 1024))
    expect(error).toEqual({
      status: 400,
      code: "INVALID_IMAGE_TYPE",
      message: expect.stringContaining("WebP 또는 JPEG"),
    })
  })

  it("허용 MIME이라도 500KB 초과면 413으로 거부한다", () => {
    const error = validateLetterImage(makeFile("image/webp", LETTER_IMAGE_MAX_BYTES + 1))
    expect(error?.status).toBe(413)
    expect(error?.code).toBe("IMAGE_TOO_LARGE")
  })

  it("경계값 500KB 정확히는 허용한다", () => {
    expect(validateLetterImage(makeFile("image/jpeg", LETTER_IMAGE_MAX_BYTES))).toBeNull()
  })

  it("허용 목록은 WebP·JPEG 두 가지다 (버킷 0004와 정합)", () => {
    expect(LETTER_IMAGE_MIMES).toEqual(["image/webp", "image/jpeg"])
  })
})
