import { describe, it, expect } from "vitest"
import { parseSentence } from "@/lib/utils/sentence-parser"
import { MOCK_CHALLENGES } from "@/lib/constants/challenges"

describe("parseSentence", () => {
  it("한글 문장에서 공백을 제거하고 글자 배열을 반환한다", () => {
    expect(parseSentence("오늘도 화이팅")).toEqual(["오", "늘", "도", "화", "이", "팅"])
  })

  it("공백이 여러 개여도 모두 제거한다", () => {
    expect(parseSentence("참 좋은 날")).toEqual(["참", "좋", "은", "날"])
  })

  it("특수문자를 제거한다", () => {
    expect(parseSentence("안녕!하세요?")).toEqual(["안", "녕", "하", "세", "요"])
  })

  it("숫자를 제거한다", () => {
    expect(parseSentence("오늘1번째")).toEqual(["오", "늘", "번", "째"])
  })

  it("영문을 제거한다", () => {
    expect(parseSentence("hello안녕")).toEqual(["안", "녕"])
  })

  it("빈 문자열이면 빈 배열을 반환한다", () => {
    expect(parseSentence("")).toEqual([])
  })

  it("한글이 없으면 빈 배열을 반환한다", () => {
    expect(parseSentence("hello 123!")).toEqual([])
  })

  it("자음/모음만 있으면 제거한다", () => {
    expect(parseSentence("ㄱㄴㄷ가나다")).toEqual(["가", "나", "다"])
  })
})

describe("MOCK_CHALLENGES letters 일치 검증", () => {
  it.each(MOCK_CHALLENGES)(
    "챌린지 '$sentence'의 letters가 parseSentence 결과와 일치한다",
    (challenge) => {
      expect(challenge.letters).toEqual(parseSentence(challenge.sentence))
    }
  )
})
