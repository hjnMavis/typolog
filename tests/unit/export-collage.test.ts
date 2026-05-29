/**
 * export-collage + render-collage-to-blob 순수 함수 단위 테스트
 *
 * 주의: jsdom 환경에서는 canvas.getContext("2d")가 null을 반환하므로
 *       renderCollageToBlob의 실제 Canvas 드로잉은 테스트하지 않는다.
 *       해당 영역은 E2E 테스트(Playwright 등)로 커버해야 한다.
 *
 * 테스트 대상 (순수 함수):
 *   - buildCollageFilename
 *   - backgroundToFillStyle
 *   - shouldUseIosFallback
 *   - canExport
 *   - getCellRects
 *   - getGridColumns
 */

import { describe, it, expect } from "vitest"
import {
  buildCollageFilename,
  shouldUseIosFallback,
  shouldUseIosFallbackWithTouch,
  canExport,
} from "@/features/compose/export-collage"
import {
  backgroundToFillStyle,
  getCellRects,
  getGridColumns,
} from "@/lib/collage/render-collage-to-blob"
import { SLOT_BACKGROUND_COLORS } from "@/lib/constants"

// ─────────────────────────────────────────────────────────
// buildCollageFilename
// ─────────────────────────────────────────────────────────
describe("buildCollageFilename", () => {
  it("challengeId와 kstDate로 올바른 파일명을 생성한다", () => {
    expect(buildCollageFilename("4", "2026-05-29")).toBe("typolog-4-20260529.png")
  })

  it("날짜 하이픈이 모두 제거된다", () => {
    const filename = buildCollageFilename("1", "2026-01-01")
    // 날짜 부분에 하이픈이 없어야 한다 (20260101 형태)
    expect(filename).toContain("20260101")
    // 날짜 자리에 원래 형식(2026-01-01)이 그대로 남아있지 않아야 한다
    expect(filename).not.toContain("2026-01-01")
  })

  it("확장자가 .png이다", () => {
    expect(buildCollageFilename("10", "2026-12-31")).toMatch(/\.png$/)
  })

  it("파일명이 typolog- 접두사로 시작한다", () => {
    expect(buildCollageFilename("3", "2026-05-28")).toMatch(/^typolog-/)
  })

  it("challengeId가 파일명에 포함된다", () => {
    expect(buildCollageFilename("42", "2026-06-01")).toContain("42")
  })
})

// ─────────────────────────────────────────────────────────
// backgroundToFillStyle
// ─────────────────────────────────────────────────────────
describe("backgroundToFillStyle", () => {
  it("흰색 배경(#ffffff)을 올바르게 반환한다", () => {
    expect(backgroundToFillStyle("#ffffff")).toBe("#ffffff")
  })

  it("어두운 배경(#1a1a1a)을 올바르게 반환한다", () => {
    expect(backgroundToFillStyle("#1a1a1a")).toBe("#1a1a1a")
  })

  it("크림색 배경(#f5f0e8)을 올바르게 반환한다", () => {
    expect(backgroundToFillStyle("#f5f0e8")).toBe("#f5f0e8")
  })

  it("SLOT_BACKGROUND_COLORS 3가지 모두 동일한 값을 반환한다", () => {
    for (const color of SLOT_BACKGROUND_COLORS) {
      expect(backgroundToFillStyle(color)).toBe(color)
    }
  })
})

// ─────────────────────────────────────────────────────────
// shouldUseIosFallback
// ─────────────────────────────────────────────────────────
describe("shouldUseIosFallback", () => {
  // iOS Safari UA strings
  const iphoneUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  const ipadUA =
    "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  // Mac Safari UA — iPadOS 13+ 와 UA가 동일해 UA만으로는 구분 불가.
  // 안전하게 다운로드 경로(false)로 처리하고, iPad 판별은 클라이언트의 maxTouchPoints가 담당한다.
  const macSafariUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

  // Non-iOS UA strings
  const androidChromeUA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36"
  const desktopChromeUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
  const desktopFirefoxUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/109.0"

  it("iPhone UA에서 true를 반환한다", () => {
    expect(shouldUseIosFallback(iphoneUA)).toBe(true)
  })

  it("iPad UA에서 true를 반환한다", () => {
    expect(shouldUseIosFallback(ipadUA)).toBe(true)
  })

  it("Mac Safari UA에서 false를 반환한다 (UA만으로 iPad과 구분 불가 → 다운로드 경로)", () => {
    // 실제 Mac과 iPadOS 13+ 는 UA가 동일하다. iPad 보정은 클라이언트의 maxTouchPoints 체크가 담당한다.
    expect(shouldUseIosFallback(macSafariUA)).toBe(false)
  })

  it("Android Chrome UA에서 false를 반환한다", () => {
    expect(shouldUseIosFallback(androidChromeUA)).toBe(false)
  })

  it("Desktop Chrome UA에서 false를 반환한다", () => {
    expect(shouldUseIosFallback(desktopChromeUA)).toBe(false)
  })

  it("Desktop Firefox UA에서 false를 반환한다", () => {
    expect(shouldUseIosFallback(desktopFirefoxUA)).toBe(false)
  })

  it("빈 문자열에서 false를 반환한다 (크래시 없음)", () => {
    expect(shouldUseIosFallback("")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────
// shouldUseIosFallbackWithTouch — UA + maxTouchPoints 결합 판단
// ─────────────────────────────────────────────────────────
describe("shouldUseIosFallbackWithTouch", () => {
  const iphoneUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  // 데스크톱 Mac Chrome UA — "Macintosh" + "Chrome" + "Safari" 토큰을 모두 포함한다.
  const macChromeUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  // 실제 Mac Safari = iPadOS 13+ 와 동일 UA
  const macSafariUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

  it("iPhone UA는 maxTouchPoints와 무관하게 true", () => {
    expect(shouldUseIosFallbackWithTouch(iphoneUA, 5)).toBe(true)
    expect(shouldUseIosFallbackWithTouch(iphoneUA, 0)).toBe(true)
  })

  it("Mac Chrome은 maxTouchPoints가 커도 false (← 버그 회귀 방지)", () => {
    // 터치 트랙패드/태블릿으로 maxTouchPoints > 1 이 보고돼도 데스크톱 Chrome은 직접 다운로드한다.
    expect(shouldUseIosFallbackWithTouch(macChromeUA, 5)).toBe(false)
    expect(shouldUseIosFallbackWithTouch(macChromeUA, 0)).toBe(false)
  })

  it("실제 Mac Safari(maxTouchPoints=0)는 false (직접 다운로드)", () => {
    expect(shouldUseIosFallbackWithTouch(macSafariUA, 0)).toBe(false)
  })

  it("iPadOS 13+ (Mac UA + Safari + 멀티터치)는 true", () => {
    expect(shouldUseIosFallbackWithTouch(macSafariUA, 5)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────
// canExport
// ─────────────────────────────────────────────────────────
describe("canExport", () => {
  it("모든 슬롯이 filled이면 true를 반환한다", () => {
    const slots = [
      { status: "filled" as const },
      { status: "filled" as const },
      { status: "filled" as const },
    ]
    expect(canExport(slots)).toBe(true)
  })

  it("하나라도 empty이면 false를 반환한다", () => {
    const slots = [
      { status: "filled" as const },
      { status: "empty" as const },
      { status: "filled" as const },
    ]
    expect(canExport(slots)).toBe(false)
  })

  it("빈 배열이면 false를 반환한다", () => {
    expect(canExport([])).toBe(false)
  })

  it("슬롯이 1개이고 filled이면 true를 반환한다", () => {
    expect(canExport([{ status: "filled" }])).toBe(true)
  })

  it("슬롯이 1개이고 empty이면 false를 반환한다", () => {
    expect(canExport([{ status: "empty" }])).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────
// getGridColumns
// ─────────────────────────────────────────────────────────
describe("getGridColumns", () => {
  it("count=1 이면 1열을 반환한다", () => {
    expect(getGridColumns(1)).toBe(1)
  })

  it("count=4 이면 2열을 반환한다 (ceil(sqrt(4))=2)", () => {
    expect(getGridColumns(4)).toBe(2)
  })

  it("count=9 이면 3열을 반환한다 (ceil(sqrt(9))=3)", () => {
    expect(getGridColumns(9)).toBe(3)
  })

  it("count=0 이면 1을 반환한다 (최솟값 클램프)", () => {
    expect(getGridColumns(0)).toBe(1)
  })

  it("count=음수이면 1을 반환한다 (최솟값 클램프)", () => {
    expect(getGridColumns(-5)).toBe(1)
  })

  it("최대 6열을 초과하지 않는다 (count=100)", () => {
    expect(getGridColumns(100)).toBeLessThanOrEqual(6)
  })

  it("count=6 이면 결정론적이다 (동일 입력 → 동일 출력)", () => {
    expect(getGridColumns(6)).toBe(getGridColumns(6))
  })
})

// ─────────────────────────────────────────────────────────
// getCellRects
// ─────────────────────────────────────────────────────────
describe("getCellRects", () => {
  it("count개의 사각형을 반환한다", () => {
    expect(getCellRects(6, 1080, 54)).toHaveLength(6)
    expect(getCellRects(1, 1080, 54)).toHaveLength(1)
    expect(getCellRects(10, 1080, 54)).toHaveLength(10)
  })

  it("count=0 이면 빈 배열을 반환한다", () => {
    expect(getCellRects(0, 1080, 54)).toHaveLength(0)
  })

  it("반환된 사각형은 행-우선(row-major) 순서이다 (인덱스 = 슬롯 순서)", () => {
    const rects = getCellRects(4, 1080, 54)
    // 4개 = 2×2 그리드: 행0 col0, col1 → 행1 col0, col1
    // 첫 번째 행의 두 rect는 y 좌표가 같아야 한다
    expect(rects[0].y).toBeCloseTo(rects[1].y, 0)
    // 두 번째 행의 두 rect는 y 좌표가 같아야 한다
    expect(rects[2].y).toBeCloseTo(rects[3].y, 0)
    // 두 번째 행은 첫 번째 행보다 y가 크다
    expect(rects[2].y).toBeGreaterThan(rects[0].y)
  })

  it("모든 사각형의 w와 h가 양수이다", () => {
    const rects = getCellRects(6, 1080, 54)
    for (const rect of rects) {
      expect(rect.w).toBeGreaterThan(0)
      expect(rect.h).toBeGreaterThan(0)
    }
  })

  it("사각형이 패딩 영역 안에 위치한다", () => {
    const size = 1080
    const padding = 54
    const rects = getCellRects(6, size, padding)
    for (const rect of rects) {
      // 셀 중심 ± cellSize/2가 패딩 범위 내에 있어야 한다
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(size)
      expect(rect.y + rect.h).toBeLessThanOrEqual(size)
    }
  })

  it("count=1 이면 사각형이 캔버스 중앙에 위치한다", () => {
    const size = 1080
    const padding = 0
    const [rect] = getCellRects(1, size, padding)
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    expect(cx).toBeCloseTo(size / 2, 0)
    expect(cy).toBeCloseTo(size / 2, 0)
  })
})
