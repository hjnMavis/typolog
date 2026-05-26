import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Challenge, LetterSlot } from "@/types"

interface ChallengeStore {
  challengeId: string | null
  slots: LetterSlot[]
  isComplete: boolean

  initSlots: (challenge: Challenge) => void
  fillSlot: (index: number, imageDataUrl: string) => void
  clearSlot: (index: number) => void
  reset: () => void
}

export const useChallengeStore = create<ChallengeStore>()(
  persist(
    (set) => ({
      challengeId: null,
      slots: [],
      isComplete: false,

      initSlots: (challenge) =>
        set({
          challengeId: challenge.id,
          slots: challenge.letters.map((char, i) => ({
            index: i,
            character: char,
            status: "empty",
            imageDataUrl: null,
          })),
          isComplete: false,
        }),

      fillSlot: (index, imageDataUrl) =>
        set((state) => {
          const slots = state.slots.map((slot) =>
            slot.index === index
              ? { ...slot, status: "filled" as const, imageDataUrl }
              : slot
          )
          const isComplete = slots.every((s) => s.status === "filled")
          return { slots, isComplete }
        }),

      clearSlot: (index) =>
        set((state) => ({
          slots: state.slots.map((slot) =>
            slot.index === index
              ? { ...slot, status: "empty" as const, imageDataUrl: null }
              : slot
          ),
          isComplete: false,
        })),

      reset: () => set({ challengeId: null, slots: [], isComplete: false }),
    }),
    { name: "typolog-challenge" }
  )
)
