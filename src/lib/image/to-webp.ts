/**
 * 글자 조각 업로드(A5) 규격 변환: 임의 이미지 Blob → WebP(기본) 또는 JPEG(폴백).
 *
 * Phase 1 crop 파이프라인은 PNG를 저장하므로(crop-image.ts) 업로드 직전에 변환한다.
 * A5가 요구하는 width/height(실제 픽셀 크기)도 함께 돌려준다.
 *
 * Safari(iOS 포함)는 canvas WebP "인코딩"을 지원하지 않아 toBlob('image/webp')이
 * PNG로 조용히 폴백한다 — 결과 타입을 검사해 미지원이면 JPEG로 재시도한다
 * (게이트 A Day4.5 옵션 A: 서버 A5·버킷이 image/jpeg도 허용, 마이그레이션 0004).
 */

import { loadImage } from "./crop-image"
import { LETTER_IMAGE_MAX_BYTES } from "@/lib/validations/letter-piece"

export interface LetterUploadImage {
  /** image/webp 또는 image/jpeg Blob (≤500KB 보장) */
  blob: Blob
  /** 변환 원본의 실제 픽셀 폭 */
  width: number
  /** 변환 원본의 실제 픽셀 높이 */
  height: number
}

/** 500KB 초과 시 품질을 단계적으로 낮춰 재시도한다. 순서 = 선호 포맷 순. */
const ENCODING_CANDIDATES = [
  { type: "image/webp", qualities: [0.9, 0.8, 0.65, 0.5] },
  // Safari 폴백 — JPEG 인코딩은 모든 브라우저가 지원한다 (사진 압축 효율도 충분)
  { type: "image/jpeg", qualities: [0.85, 0.75, 0.6, 0.45] },
] as const

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("이미지를 변환할 수 없습니다.")),
      type,
      quality
    )
  })
}

export async function toLetterUploadImage(source: Blob): Promise<LetterUploadImage> {
  const url = URL.createObjectURL(source)
  try {
    const img = await loadImage(url)
    const width = img.naturalWidth
    const height = img.naturalHeight

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다.")
    ctx.drawImage(img, 0, 0)

    let anyEncoderSupported = false
    for (const candidate of ENCODING_CANDIDATES) {
      for (const quality of candidate.qualities) {
        const blob = await canvasToBlob(canvas, candidate.type, quality)
        if (blob.type !== candidate.type) {
          // 이 포맷의 인코더 미지원(toBlob이 PNG로 폴백) → 다음 포맷으로
          break
        }
        anyEncoderSupported = true
        if (blob.size <= LETTER_IMAGE_MAX_BYTES) {
          return { blob, width, height }
        }
      }
    }

    throw new Error(
      anyEncoderSupported
        ? "이미지가 너무 커서 업로드 규격(500KB)에 맞출 수 없습니다."
        : "이 브라우저에서는 이미지를 변환할 수 없습니다."
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
