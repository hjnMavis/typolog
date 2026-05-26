/**
 * 문장에서 공백, 특수문자, 숫자를 제거하고 한글 글자 배열을 반환한다.
 */
export function parseSentence(sentence: string): string[] {
  return sentence.replace(/[^가-힣]/g, "").split("")
}
