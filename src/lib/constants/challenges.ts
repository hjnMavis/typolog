import type { Challenge } from "@/types"
import { parseSentence } from "@/lib/utils/sentence-parser"

function challenge(id: string, sentence: string, activeDate: string): Challenge {
  return { id, sentence, letters: parseSentence(sentence), activeDate }
}

export const MOCK_CHALLENGES: Challenge[] = [
  challenge("1", "오늘도 화이팅", "2026-05-26"),
  challenge("2", "참 좋은 날", "2026-05-27"),
  challenge("3", "어서 오세요", "2026-05-28"),
  challenge("4", "오늘 뭐 먹지", "2026-05-29"),
  challenge("5", "좋아하는 것", "2026-05-30"),
  challenge("6", "잘 지내고 있어", "2026-05-31"),
  challenge("7", "오늘의 기분", "2026-06-01"),
  challenge("8", "우리 동네 맛집", "2026-06-02"),
  challenge("9", "오늘 참 수고했어", "2026-06-03"),
  challenge("10", "이 순간을 기억해", "2026-06-04"),
]

export function getKSTDateString(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
}

export function getTodayChallenge(): Challenge {
  const today = getKSTDateString()
  return MOCK_CHALLENGES.find((c) => c.activeDate === today) ?? MOCK_CHALLENGES[0]
}

export function findChallengeById(id: string): Challenge | undefined {
  return MOCK_CHALLENGES.find((c) => c.id === id)
}
