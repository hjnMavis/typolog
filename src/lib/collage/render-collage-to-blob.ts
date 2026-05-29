/**
 * Canvas 기반 콜라주 렌더링 유틸
 *
 * 책임 분리:
 *   - PURE 함수 (getGridColumns, getCellRects, backgroundToFillStyle): DOM 의존 없음 → Vitest 단위 테스트 가능
 *   - renderCollageToBlob: 브라우저 Canvas API 사용 → 단위 테스트 제외, E2E로 커버
 *
 * 주의: jsdom 환경에서는 canvas.getContext("2d")가 null을 반환하므로
 *       renderCollageToBlob 자체는 단위 테스트 대상에서 제외한다.
 */

import { getPieceLayout } from "@/features/compose/collage-layout"
import type { BackgroundColor } from "@/lib/constants"

/** 내보낼 PNG의 정사각형 크기 (px). 1080×1080 = SNS 표준 해상도 */
export const EXPORT_SIZE = 1080

// ─────────────────────────────────────────────────────────
// PURE 수학 함수 — 단위 테스트 가능
// ─────────────────────────────────────────────────────────

/**
 * 조각 수로부터 flex-wrap 레이아웃과 유사한 그리드 열 수를 계산한다.
 * 결정론적이며 Math.random() / Date를 사용하지 않는다.
 *
 * 알고리즘: ceil(sqrt(count))로 정사각에 가까운 배열을 만들되, 최소 1 / 최대 6으로 클램프한다.
 * 최대 6은 미리보기의 max-w-xs(320px) / size-16(64px) + gap-1(4px) 기준 가로로 4~5개 들어가는
 * 실제 레이아웃과 근사치를 맞추기 위한 값이다.
 *
 * @param count - 전체 조각 수
 */
export function getGridColumns(count: number): number {
  if (count <= 0) return 1
  const cols = Math.ceil(Math.sqrt(count))
  return Math.max(1, Math.min(cols, 6))
}

/**
 * count개의 조각에 대해 행-우선(row-major) 순서로 셀 사각형 배열을 반환한다.
 * 반환 배열의 인덱스 = 문장 순서(slot.index)와 일치한다.
 *
 * @param count      - 전체 조각 수
 * @param canvasSize - 캔버스 크기 (정사각형; px)
 * @param paddingPx  - 캔버스 가장자리 패딩 (px)
 */
export function getCellRects(
  count: number,
  canvasSize: number,
  paddingPx: number
): Array<{ x: number; y: number; w: number; h: number }> {
  if (count <= 0) return []

  const cols = getGridColumns(count)
  const rows = Math.ceil(count / cols)

  // 패딩을 제외한 가용 영역
  const innerSize = canvasSize - paddingPx * 2
  // 셀 사이 gap은 셀 크기의 약 4% (미리보기 gap-1 ≈ 4px / size-16 64px ≈ 6%)
  const gapRatio = 0.05
  const cellW = innerSize / (cols + (cols - 1) * gapRatio)
  const cellH = innerSize / (rows + (rows - 1) * gapRatio)
  const cellSize = Math.min(cellW, cellH) // 정사각 셀
  const gap = cellSize * gapRatio

  // 전체 격자 크기를 계산해 캔버스 중앙에 배치
  const gridWidth = cols * cellSize + (cols - 1) * gap
  const gridHeight = rows * cellSize + (rows - 1) * gap
  const offsetX = (canvasSize - gridWidth) / 2
  const offsetY = (canvasSize - gridHeight) / 2

  const rects: Array<{ x: number; y: number; w: number; h: number }> = []

  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = offsetX + col * (cellSize + gap)
    const y = offsetY + row * (cellSize + gap)
    rects.push({ x, y, w: cellSize, h: cellSize })
  }

  return rects
}

/**
 * BackgroundColor 값을 Canvas fillStyle 문자열로 변환한다.
 * 현재는 항등 변환(identity)이지만, 향후 테마 확장 시 매핑 로직을 여기에 집중한다.
 *
 * @param color - BackgroundColor hex string
 */
export function backgroundToFillStyle(color: BackgroundColor): string {
  // BackgroundColor는 유효한 CSS hex color이므로 직접 fillStyle로 사용 가능
  return color
}

// ─────────────────────────────────────────────────────────
// 캔버스 드로잉 — 브라우저 전용 (단위 테스트 제외)
// ─────────────────────────────────────────────────────────

export interface RenderCollageItem {
  /** 이미지가 복원된 경우 HTMLImageElement, 복원 실패(IDB miss) 시 null */
  imageEl: HTMLImageElement | null
  /** 해당 슬롯의 글자 (이미지 없을 때 텍스트 폴백으로 사용) */
  character: string
}

export interface RenderCollageOptions {
  items: RenderCollageItem[]
  bgColor: BackgroundColor
  /** 내보낼 PNG 크기 (정사각형). 기본값: EXPORT_SIZE (1080) */
  size?: number
}

/**
 * 콜라주를 Canvas에 렌더링하고 PNG Blob을 반환한다.
 *
 * 시각적 일치:
 *   - getPieceLayout(i)의 rotateDeg / scale / marginTopPx를 적용해 미리보기와 동일한 변환을 재현한다.
 *   - marginTopPx는 미리보기 기준(64px 셀)과 내보내기 기준(캔버스 cellSize) 간 비율로 스케일한다.
 *   - 이미지는 cover-fit(중앙 기준)으로 셀에 꽉 채운다.
 *   - 이미지 없는 슬롯은 글자를 셀 중앙에 그린다.
 *
 * EXIF: Blob → loadImage → ctx.drawImage 파이프라인이 EXIF를 자동으로 제거한다.
 *       (원본 EXIF는 이미 crop 단계에서 strip됨)
 *
 * @throws {Error} Canvas 2D 컨텍스트 생성 실패 시
 * @throws {Error} toBlob이 null 반환 시
 */
export async function renderCollageToBlob(opts: RenderCollageOptions): Promise<Blob> {
  const { items, bgColor, size = EXPORT_SIZE } = opts

  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다")

  // 배경 채우기
  ctx.fillStyle = backgroundToFillStyle(bgColor)
  ctx.fillRect(0, 0, size, size)

  if (items.length === 0) {
    return blobFromCanvas(canvas)
  }

  // 패딩: EXPORT_SIZE 기준 비율 (미리보기 p-4 = 16px / 320px ≈ 5%)
  const paddingPx = Math.round(size * 0.05)
  const rects = getCellRects(items.length, size, paddingPx)

  // 미리보기에서 size-16 = 64px 기준이므로, 내보낼 때 cellSize로 스케일
  // getCellRects에서 반환된 cellSize는 rects[0].w와 같다
  const previewCellSize = 64
  const exportCellSize = rects[0]?.w ?? previewCellSize
  const marginScale = exportCellSize / previewCellSize

  for (let i = 0; i < items.length; i++) {
    const { imageEl, character } = items[i]
    const rect = rects[i]
    if (!rect) continue

    const layout = getPieceLayout(i)

    // 셀 중심으로 이동 후 변환 적용
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2 + layout.marginTopPx * marginScale

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((layout.rotateDeg * Math.PI) / 180)
    ctx.scale(layout.scale, layout.scale)

    if (imageEl) {
      drawImageCoverFit(ctx, imageEl, rect.w, rect.h)
    } else {
      drawCharacterFallback(ctx, character, rect.w, bgColor)
    }

    ctx.restore()
  }

  return blobFromCanvas(canvas)
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

/** canvas.toBlob을 Promise로 래핑 */
function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("PNG 생성 실패"))
      },
      "image/png"
    )
  })
}

/**
 * 이미지를 주어진 셀 크기(w×h)에 cover-fit으로 중앙에 그린다.
 * ctx는 이미 셀 중심(0, 0)에 translate된 상태여야 한다.
 */
function drawImageCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
): void {
  const imgW = img.naturalWidth || img.width
  const imgH = img.naturalHeight || img.height

  if (imgW === 0 || imgH === 0) return

  // cover-fit: 이미지 비율을 유지하면서 셀을 가득 채우는 최소 스케일
  const scale = Math.max(w / imgW, h / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale

  // 중앙 기준으로 배치 (ctx는 이미 셀 중심 기준)
  const dx = -drawW / 2
  const dy = -drawH / 2

  // 셀 영역에만 클리핑 (rounded rect 근사)
  ctx.beginPath()
  const r = w * 0.18 // rounded-xl ≈ 18% (미리보기 rounded-xl)
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r)
  ctx.clip()

  ctx.drawImage(img, dx, dy, drawW, drawH)
}

/**
 * 이미지 없는 슬롯에 글자를 셀 중앙에 그린다.
 * bgColor에 따라 텍스트 색상을 결정한다 (어두운 배경 → 흰색, 밝은 배경 → 어두운색).
 */
function drawCharacterFallback(
  ctx: CanvasRenderingContext2D,
  character: string,
  cellSize: number,
  bgColor: BackgroundColor
): void {
  // 어두운 배경이면 흰색, 밝은 배경이면 near-black
  const isDark = bgColor === "#1a1a1a"
  ctx.fillStyle = isDark ? "rgba(255,255,255,0.85)" : "rgba(26,26,26,0.85)"

  // 배경 박스 (미리보기의 bg-white/10 또는 bg-black/5)
  const r = cellSize * 0.18
  ctx.beginPath()
  roundRectPath(ctx, -cellSize / 2, -cellSize / 2, cellSize, cellSize, r)
  const boxFill = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)"
  ctx.fillStyle = boxFill
  ctx.fill()

  // 텍스트
  const fontSize = Math.round(cellSize * 0.45)
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = isDark ? "rgba(255,255,255,0.85)" : "rgba(26,26,26,0.85)"
  ctx.fillText(character, 0, 0)
}

/**
 * CanvasRenderingContext2D에 라운드 사각형 경로를 그린다.
 * 네이티브 roundRect가 없는 환경(iOS Safari 15 이하)에서도 동작하는 폴리필.
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  // 네이티브 roundRect 지원 여부 확인
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  // 폴리필: arc로 각 모서리를 그린다
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
