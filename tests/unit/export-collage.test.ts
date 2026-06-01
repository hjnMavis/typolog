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
 *   - getLineCellRects
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
  getLineCellRects,
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
// getLineCellRects — 작성자 지정 줄 배치 기반 셀 좌표
// ─────────────────────────────────────────────────────────
describe("getLineCellRects", () => {
  // 다중 줄 레이아웃: 2줄 × 3셀 (예: "오늘도" / "화이팅")
  const twoRows = [
    [0, 1, 2],
    [3, 4, 5],
  ]
  // 길이가 다른 줄: 4셀 / 2셀 (예: "우리 동네" / "맛집")
  const unevenRows = [
    [0, 1, 2, 3],
    [4, 5],
  ]

  it("전체 셀 수만큼 사각형을 반환하고, 인덱스가 슬롯 index와 일치한다", () => {
    const rects = getLineCellRects(twoRows, 1080, 54)
    expect(rects).toHaveLength(6)
    // index 5는 두 번째 줄(아래)에 있어야 한다
    expect(rects[5].y).toBeGreaterThan(rects[0].y)
  })

  it("빈 줄 배치는 빈 배열을 반환한다", () => {
    expect(getLineCellRects([], 1080, 54)).toHaveLength(0)
  })

  it("같은 줄의 셀은 동일한 y를 가진다", () => {
    const rects = getLineCellRects(twoRows, 1080, 54)
    expect(rects[0].y).toBeCloseTo(rects[1].y, 5)
    expect(rects[1].y).toBeCloseTo(rects[2].y, 5)
    expect(rects[3].y).toBeCloseTo(rects[4].y, 5)
  })

  it("아래 줄일수록 y가 증가한다 (행간 일정)", () => {
    const rects = getLineCellRects(twoRows, 1080, 54)
    expect(rects[3].y).toBeGreaterThan(rects[0].y)
  })

  it("모든 셀은 정사각형이며 동일한 크기다", () => {
    const rects = getLineCellRects(unevenRows, 1080, 54)
    const w0 = rects[0].w
    for (const rect of rects) {
      expect(rect.w).toBeCloseTo(rect.h, 5) // 정사각
      expect(rect.w).toBeCloseTo(w0, 5) // 동일 크기
      expect(rect.w).toBeGreaterThan(0)
    }
  })

  it("각 줄은 줄 길이가 달라도 가로 중앙 정렬된다", () => {
    const size = 1080
    const rects = getLineCellRects(unevenRows, size, 54)
    // 1줄(4셀): 좌측 끝 ~ 우측 끝의 중심 = 캔버스 중앙
    const row1Center = (rects[0].x + rects[3].x + rects[3].w) / 2
    expect(row1Center).toBeCloseTo(size / 2, 0)
    // 2줄(2셀): 더 짧지만 마찬가지로 캔버스 중앙
    const row2Center = (rects[4].x + rects[5].x + rects[5].w) / 2
    expect(row2Center).toBeCloseTo(size / 2, 0)
  })

  it("모든 셀이 패딩 영역 안에 위치한다", () => {
    const size = 1080
    const padding = 54
    const rects = getLineCellRects(twoRows, size, padding)
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(padding - 0.5)
      expect(rect.y).toBeGreaterThanOrEqual(padding - 0.5)
      expect(rect.x + rect.w).toBeLessThanOrEqual(size - padding + 0.5)
      expect(rect.y + rect.h).toBeLessThanOrEqual(size - padding + 0.5)
    }
  })

  it("단일 셀(1줄 1글자)은 캔버스 중앙에 위치한다", () => {
    const size = 1080
    const [rect] = getLineCellRects([[0]], size, 0)
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    expect(cx).toBeCloseTo(size / 2, 0)
    expect(cy).toBeCloseTo(size / 2, 0)
  })
})
