/**
 * getCollageLines 순수 함수 단위 테스트
 *
 * 핵심 검증:
 *   - 작성자 지정 줄 배치가 슬롯 index 2차원 배열로 정확히 매핑되는가
 *   - 단어 보존(동네) / 다중 줄 / 단일 줄 / 비한글 스킵 / 빈 입력
 *   - 불변식: getCollageLines(lines).flat() === [0 … letters.length-1]
 *     (letters = lines.flatMap(parseSentence) 와 순서·개수 일치)
 */

import { describe, it, expect } from "vitest"
import { getCollageLines } from "@/lib/collage/sentence-lines"
import { parseSentence } from "@/lib/utils/sentence-parser"
import { MOCK_CHALLENGES } from "@/lib/constants/challenges"

describe("getCollageLines", () => {
  it("다중 줄: 각 줄의 글자를 누적 index로 매긴다", () => {
    // "오늘도"(3) / "화이팅"(3) → [[0,1,2],[3,4,5]]
    expect(getCollageLines(["오늘도", "화이팅"])).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ])
  })

  it("단일 줄: 한 줄이면 하나의 행만 반환한다", () => {
    // "오늘 뭐 먹지" → parseSentence → 오늘뭐먹지(5) → [[0,1,2,3,4]]
    expect(getCollageLines(["오늘 뭐 먹지"])).toEqual([[0, 1, 2, 3, 4]])
  })

  it("단어 보존: '우리 동네' / '맛집' 줄에서 '동네'가 한 줄에 유지된다", () => {
    // 챌린지 8: 줄 중간에 '동네'가 끊기지 않아야 함
    const layout = getCollageLines(["우리 동네", "맛집"])
    expect(layout).toEqual([
      [0, 1, 2, 3], // 우 리 동 네
      [4, 5], //       맛 집
    ])
    // '동'(index 2)과 '네'(index 3)가 같은 행(첫 줄)에 있어야 한다
    expect(layout[0]).toContain(2)
    expect(layout[0]).toContain(3)
  })

  it("비한글/공백만 있는 줄은 건너뛴다 (빈 행을 만들지 않음)", () => {
    // "abc"·"123!"는 한글 0개 → 스킵, "안녕"만 남아 index 0부터 시작
    expect(getCollageLines(["abc", "안녕", "123!"])).toEqual([[0, 1]])
  })

  it("줄 안의 비한글은 제거되고 한글만 index로 매겨진다", () => {
    // "안녕!" → 안녕(2) / "세상~" → 세상(2)
    expect(getCollageLines(["안녕!", "세상~"])).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it("빈 입력은 빈 배열을 반환한다", () => {
    expect(getCollageLines([])).toEqual([])
    expect(getCollageLines([""])).toEqual([])
    expect(getCollageLines(["", "   ", "!@#"])).toEqual([])
  })

  it("불변식: flat()이 [0 … letters.length-1]와 일치한다 (단일 케이스)", () => {
    const lines = ["오늘 참", "수고했어"]
    const letters = lines.flatMap(parseSentence)
    const flat = getCollageLines(lines).flat()
    expect(flat).toEqual(letters.map((_, i) => i))
  })

  it("MOCK_CHALLENGES 전체에서 flat 불변식이 성립한다", () => {
    for (const challenge of MOCK_CHALLENGES) {
      const flat = getCollageLines(challenge.lines).flat()
      // flat 순서가 0..N-1 연속이어야 한다
      expect(flat).toEqual(challenge.letters.map((_, i) => i))
      // letters는 lines에서 파생됐으므로 개수도 일치
      expect(flat).toHaveLength(challenge.letters.length)
    }
  })
})
