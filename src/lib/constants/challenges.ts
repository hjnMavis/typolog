import type { Challenge } from "@/types"

export const MOCK_CHALLENGES: Challenge[] = [
  { id: "1", sentence: "오늘도 화이팅", letters: ["오", "늘", "도", "화", "이", "팅"], activeDate: "2026-05-26" },
  { id: "2", sentence: "참 좋은 날", letters: ["참", "좋", "은", "날"], activeDate: "2026-05-27" },
  { id: "3", sentence: "어서 오세요", letters: ["어", "서", "오", "세", "요"], activeDate: "2026-05-28" },
  { id: "4", sentence: "오늘 뭐 먹지", letters: ["오", "늘", "뭐", "먹", "지"], activeDate: "2026-05-29" },
  { id: "5", sentence: "좋아하는 것", letters: ["좋", "아", "하", "는", "것"], activeDate: "2026-05-30" },
  { id: "6", sentence: "잘 지내고 있어", letters: ["잘", "지", "내", "고", "있", "어"], activeDate: "2026-05-31" },
  { id: "7", sentence: "오늘의 기분", letters: ["오", "늘", "의", "기", "분"], activeDate: "2026-06-01" },
  { id: "8", sentence: "우리 동네 맛집", letters: ["우", "리", "동", "네", "맛", "집"], activeDate: "2026-06-02" },
  { id: "9", sentence: "오늘 참 수고했어", letters: ["오", "늘", "참", "수", "고", "했", "어"], activeDate: "2026-06-03" },
  { id: "10", sentence: "이 순간을 기억해", letters: ["이", "순", "간", "을", "기", "억", "해"], activeDate: "2026-06-04" },
]

export function getTodayChallenge(): Challenge {
  const today = new Date().toISOString().split("T")[0]
  return MOCK_CHALLENGES.find((c) => c.activeDate === today) ?? MOCK_CHALLENGES[0]
}
