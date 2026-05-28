/**
 * 콜라주 레이아웃 유틸 — 순수 함수 (브라우저/DOM 의존 없음, Vitest 단위 테스트 가능)
 *
 * 결정론적 원칙:
 *   - Math.random() 또는 Date 사용 금지
 *   - index를 seed로 삼아 sin/cos 기반의 pseudo-random 변환값 생성
 *   - 동일 index → 동일 출력 (re-render jitter 없음)
 */

export interface PieceLayout {
  /** 회전 각도 (deg). 범위: ±6deg */
  rotateDeg: number
  /** 스케일 배율. 범위: 0.92 ~ 1.06 */
  scale: number
  /** 상단 여백 (px). 범위: 0 ~ 8px */
  marginTopPx: number
}

/**
 * 슬롯 index를 seed로 사용해 stable한 레이아웃 변환 값을 반환한다.
 *
 * 알고리즘:
 *   - sin/cos에 서로 다른 소수(prime) 배수를 곱해 두 채널이 독립적으로 흩어지게 한다.
 *   - 결과를 [min, max] 범위로 선형 보간(lerp)한다.
 *
 * @param index - 슬롯 인덱스 (0-based)
 */
export function getPieceLayout(index: number): PieceLayout {
  // 각 채널마다 다른 소수 배수 → 인접 인덱스 간 충분한 분산
  const t1 = Math.sin(index * 2.3998) // rotate seed
  const t2 = Math.cos(index * 3.7213) // scale seed
  const t3 = Math.sin(index * 5.1729 + 1.0) // margin seed

  // [-1, 1] → 원하는 범위로 선형 보간
  // rotate: ±6deg
  const rotateDeg = t1 * 6

  // scale: 0.92 ~ 1.06 (midpoint=0.99, half-range=0.07)
  const scale = 0.99 + t2 * 0.07

  // marginTop: 0 ~ 8px (t3는 [-1,1] → [0,8])
  const marginTopPx = ((t3 + 1) / 2) * 8

  return { rotateDeg, scale, marginTopPx }
}

/**
 * 모든 슬롯이 채워진 상태인지 확인한다.
 * 순수 함수 — 스토어에 의존하지 않으므로 단위 테스트 가능.
 *
 * @param slots - status 필드를 포함하는 슬롯 배열
 */
export function canPreview(slots: Array<{ status: "empty" | "filled" }>): boolean {
  return slots.length > 0 && slots.every((s) => s.status === "filled")
}
