/**
 * collage-layout 단위 테스트
 *
 * 참고: IndexedDB는 jsdom 환경에서 지원되지 않으므로 이 테스트 파일에서는
 * indexed-image-store를 import하지 않는다. CollagePreviewClient 전체의
 * 마운트 테스트(IDB 복원 포함)는 fake-indexeddb 패키지 없이는 불가하므로
 * 해당 영역은 E2E 테스트로 위임한다.
 */

import { describe, it, expect } from "vitest"
import { getPieceLayout, canPreview } from "@/features/compose/collage-layout"

describe("getPieceLayout", () => {
  // ─────────────────────────────────────────────
  // 결정론(Determinism)
  // ─────────────────────────────────────────────
  describe("결정론적 출력", () => {
    it("같은 index를 두 번 호출하면 동일한 결과를 반환한다", () => {
      expect(getPieceLayout(3)).toEqual(getPieceLayout(3))
    })

    it("index 0 ~ 9 모두 두 번 호출 결과가 동일하다", () => {
      for (let i = 0; i < 10; i++) {
        expect(getPieceLayout(i)).toEqual(getPieceLayout(i))
      }
    })

    it("다른 index는 일반적으로 다른 rotateDeg를 반환한다", () => {
      const results = Array.from({ length: 10 }, (_, i) => getPieceLayout(i))
      const rotateDegValues = results.map((r) => r.rotateDeg)
      // 모두 동일하지 않아야 한다 (unique 값이 최소 2개 이상)
      const unique = new Set(rotateDegValues)
      expect(unique.size).toBeGreaterThan(1)
    })

    it("다른 index는 일반적으로 다른 scale을 반환한다", () => {
      const results = Array.from({ length: 10 }, (_, i) => getPieceLayout(i))
      const scaleValues = results.map((r) => r.scale)
      const unique = new Set(scaleValues)
      expect(unique.size).toBeGreaterThan(1)
    })
  })

  // ─────────────────────────────────────────────
  // 범위(Bounds)
  // ─────────────────────────────────────────────
  describe("출력 범위", () => {
    const INDICES = Array.from({ length: 20 }, (_, i) => i)

    it("rotateDeg가 ±6deg 범위 안에 있다", () => {
      for (const i of INDICES) {
        const { rotateDeg } = getPieceLayout(i)
        expect(rotateDeg).toBeGreaterThanOrEqual(-6)
        expect(rotateDeg).toBeLessThanOrEqual(6)
      }
    })

    it("scale이 0.92 ~ 1.06 범위 안에 있다", () => {
      for (const i of INDICES) {
        const { scale } = getPieceLayout(i)
        expect(scale).toBeGreaterThanOrEqual(0.92)
        expect(scale).toBeLessThanOrEqual(1.06)
      }
    })

    it("marginTopPx이 0 ~ 8px 범위 안에 있다", () => {
      for (const i of INDICES) {
        const { marginTopPx } = getPieceLayout(i)
        expect(marginTopPx).toBeGreaterThanOrEqual(0)
        expect(marginTopPx).toBeLessThanOrEqual(8)
      }
    })
  })

  // ─────────────────────────────────────────────
  // 구체적인 고정값 (snapshot-style)
  // ─────────────────────────────────────────────
  describe("고정 출력 검증", () => {
    it("index 0의 출력이 항상 동일하다", () => {
      const layout = getPieceLayout(0)
      // sin(0) = 0, cos(0) = 1, sin(1.0) ≈ 0.8415
      expect(layout.rotateDeg).toBeCloseTo(0, 5) // sin(0 * 2.3998) = 0
      expect(layout.scale).toBeCloseTo(1.06, 4)  // cos(0 * 3.7213) = 1 → 0.99 + 0.07
      expect(layout.marginTopPx).toBeCloseTo(((Math.sin(1.0) + 1) / 2) * 8, 4)
    })
  })
})

describe("canPreview", () => {
  it("모든 슬롯이 filled이면 true를 반환한다", () => {
    const slots = [
      { status: "filled" as const },
      { status: "filled" as const },
      { status: "filled" as const },
    ]
    expect(canPreview(slots)).toBe(true)
  })

  it("하나라도 empty이면 false를 반환한다", () => {
    const slots = [
      { status: "filled" as const },
      { status: "empty" as const },
      { status: "filled" as const },
    ]
    expect(canPreview(slots)).toBe(false)
  })

  it("빈 배열이면 false를 반환한다", () => {
    expect(canPreview([])).toBe(false)
  })

  it("슬롯이 1개이고 filled이면 true를 반환한다", () => {
    expect(canPreview([{ status: "filled" }])).toBe(true)
  })

  it("슬롯이 1개이고 empty이면 false를 반환한다", () => {
    expect(canPreview([{ status: "empty" }])).toBe(false)
  })
})
