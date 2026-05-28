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
