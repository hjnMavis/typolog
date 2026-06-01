/**
 * Canvas 기반 콜라주 렌더링 유틸
 *
 * 책임 분리:
 *   - PURE 함수 (getLineCellRects, backgroundToFillStyle): DOM 의존 없음 → Vitest 단위 테스트 가능
 *   - renderCollageToBlob: 브라우저 Canvas API 사용 → 단위 테스트 제외, E2E로 커버
 *
 * 주의: jsdom 환경에서는 canvas.getContext("2d")가 null을 반환하므로
 *       renderCollageToBlob 자체는 단위 테스트 대상에서 제외한다.
 */

import { getPieceLayout } from "@/features/compose/collage-layout"
import { getCollageLines } from "@/lib/collage/sentence-lines"
import type { BackgroundColor } from "@/lib/constants"

/** 내보낼 PNG의 정사각형 크기 (px). 1080×1080 = SNS 표준 해상도 */
export const EXPORT_SIZE = 1080

// ─────────────────────────────────────────────────────────
// PURE 수학 함수 — 단위 테스트 가능
// ─────────────────────────────────────────────────────────

export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 작성자 지정 줄 배치(슬롯 index의 2차원 배열)로부터 각 슬롯의 셀 사각형을 계산한다.
 * 결정론적이며 Math.random() / Date를 사용하지 않는다.
 *
 * 반환 배열의 인덱스 = 슬롯 index(문장 순서)와 일치한다.
 * (getCollageLines의 불변식 flat()===[0..N-1] 덕분에 index로 직접 채워 넣을 수 있다.)
 *
 * 배치 규칙:
 *   - 같은 줄의 셀은 동일한 y (한 줄로 정렬)
 *   - 아래 줄일수록 y 증가 (행간 일정)
 *   - 각 줄은 가로 중앙 정렬 (줄마다 길이가 달라도 각자 중앙)
 *   - 모든 셀은 정사각형·동일 크기 (가장 넓은 줄·줄 수 양쪽 제약을 동시 충족하는 최댓값)
 *   - 전체 줄 블록은 패딩 안에서 세로 중앙 배치
 *
 * @param lines      - getCollageLines()가 반환한 슬롯 index 2차원 배열
 * @param canvasSize - 캔버스 크기 (정사각형; px)
 * @param paddingPx  - 캔버스 가장자리 패딩 (px)
 */
export function getLineCellRects(
  lines: number[][],
  canvasSize: number,
  paddingPx: number
): CellRect[] {
  const numRows = lines.length
  if (numRows === 0) return []

  const maxCols = Math.max(...lines.map((row) => row.length))
  const totalCells = lines.reduce((sum, row) => sum + row.length, 0)

  // 패딩을 제외한 가용 영역
  const innerSize = canvasSize - paddingPx * 2
  // 셀 사이 gap은 셀 크기의 약 5% (미리보기 gap-1 ≈ 4px / w-16 64px ≈ 6%)
  const gapRatio = 0.05

  // 가로(가장 넓은 줄)·세로(줄 수) 양쪽 제약을 동시에 만족하는 최대 정사각 셀 크기
  const cellW = innerSize / (maxCols + (maxCols - 1) * gapRatio)
  const cellH = innerSize / (numRows + (numRows - 1) * gapRatio)
  const cellSize = Math.min(cellW, cellH)
  const gap = cellSize * gapRatio

  // 전체 줄 블록을 캔버스 세로 중앙에 배치
  const gridHeight = numRows * cellSize + (numRows - 1) * gap
  const offsetY = (canvasSize - gridHeight) / 2

  const rects: CellRect[] = new Array(totalCells)

  for (let r = 0; r < numRows; r++) {
    const row = lines[r]
    const rowWidth = row.length * cellSize + (row.length - 1) * gap
    const offsetX = (canvasSize - rowWidth) / 2 // 각 줄 가로 중앙
    const y = offsetY + r * (cellSize + gap)

    for (let c = 0; c < row.length; c++) {
      const slotIndex = row[c]
      const x = offsetX + c * (cellSize + gap)
      rects[slotIndex] = { x, y, w: cellSize, h: cellSize }
    }
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
  /**
   * 작성자 지정 줄 배치(challenge.lines). 콜라주 줄나눔의 단일 소스.
   * 내부에서 getCollageLines(lines)로 슬롯 index 레이아웃을 만들어 셀 좌표를 계산한다.
   * items는 슬롯 index 순서(문장 순서)로 정렬돼 있어야 한다.
   */
  lines: string[]
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
  const { items, bgColor, lines, size = EXPORT_SIZE } = opts

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
  // 작성자 지정 줄 배치 → 슬롯 index 레이아웃 → 줄 기반 셀 좌표
  const layout = getCollageLines(lines)
  const rects = getLineCellRects(layout, size, paddingPx)

  // 미리보기에서 w-16 = 64px 기준이므로, 내보낼 때 cellSize로 스케일
  // getLineCellRects에서 반환된 cellSize는 rects[0].w와 같다
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
