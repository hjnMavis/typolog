export interface Challenge {
  id: string
  /**
   * 작성자가 정의한 줄 배치. 콜라주 단일 소스(single source of truth).
   * 수집·preview·PNG 세 화면이 모두 이 배열을 그대로 따른다.
   */
  lines: string[]
  /** 파생값: `lines.join(" ")`. 표시·SEO용 한 문장. */
  sentence: string
  /** 파생값: `lines.flatMap(parseSentence)`. 슬롯 글자 배열. */
  letters: string[]
  activeDate: string
}

export interface LetterSlot {
  index: number
  character: string
  status: "empty" | "filled"
  /** Deterministic IDB key: `${challengeId}:${index}`. Persisted to localStorage. */
  imageKey: string | null
  /** Original file name (or derived name). Persisted. */
  fileName: string | null
  /** MIME type of the cropped blob (e.g. "image/png"). Persisted. */
  fileType: string | null
  /** Unix timestamp (ms) when this slot was last filled. Persisted. */
  updatedAt: number | null
  /**
   * Runtime-only Object URL created from the IDB Blob.
   * NEVER persisted to localStorage or IndexedDB.
   * Must be revoked on replace / unmount / reset.
   */
  imageDataUrl: string | null
}

export interface ChallengeState {
  challengeId: string | null
  slots: LetterSlot[]
  activeSlotIndex: number | null
  isComplete: boolean
}
