export interface Challenge {
  id: string
  sentence: string
  letters: string[]
  activeDate: string
}

export interface LetterSlot {
  index: number
  character: string
  status: "empty" | "filled"
  imageDataUrl: string | null
}

export interface ChallengeState {
  challengeId: string | null
  slots: LetterSlot[]
  activeSlotIndex: number | null
  isComplete: boolean
}
