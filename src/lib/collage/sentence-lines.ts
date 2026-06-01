/**
 * 작성자 지정 줄 배치(`Challenge.lines`)를 슬롯 인덱스 레이아웃으로 변환하는 순수 함수.
 *
 * DOM 의존 없음 → Vitest 단위 테스트 가능. 콜라주 줄나눔의 단일 소스이며,
 * 수집(CaptureClient)·미리보기(CollagePreviewClient)·PNG(renderCollageToBlob)가
 * 모두 이 함수의 결과를 그대로 따른다.
 */

import { parseSentence } from "@/lib/utils/sentence-parser"

/**
 * 작성자가 지정한 줄 배치를 "슬롯 index의 2차원 배열"로 변환한다.
 *
 * 동작:
 *   - 각 줄을 parseSentence로 한글 글자만 추출한다.
 *   - 누적 cursor로 전역 슬롯 index를 매긴다(문장 순서 = letters 순서).
 *   - 글자가 하나도 없는 줄(공백/특수문자/숫자만)은 건너뛴다 → 빈 행을 만들지 않는다.
 *
 * 불변식:
 *   getCollageLines(lines).flat() === [0, 1, …, letters.length - 1]
 *   (letters = lines.flatMap(parseSentence) 와 순서·개수가 정확히 일치)
 *   이 불변식 덕분에 반환 행의 index로 slot/letter를 1:1 조회할 수 있다.
 *
 * @param lines - Challenge.lines (작성자 지정 줄 배치)
 * @returns 각 행이 해당 줄의 슬롯 index 배열인 2차원 배열
 */
export function getCollageLines(lines: string[]): number[][] {
  const rows: number[][] = []
  let cursor = 0

  for (const line of lines) {
    const chars = parseSentence(line)
    if (chars.length === 0) continue // 비한글/빈 줄 스킵
    rows.push(chars.map((_, i) => cursor + i))
    cursor += chars.length
  }

  return rows
}
