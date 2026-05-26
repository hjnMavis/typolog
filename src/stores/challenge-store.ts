import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Challenge, LetterSlot } from "@/types"

interface ChallengeStore {
  challengeId: string | null
  slots: LetterSlot[]
  activeSlotIndex: number | null
  isComplete: boolean

  initSlots: (challenge: Challenge) => void
  selectSlot: (index: number) => void
  deselectSlot: () => void
  fillSlot: (index: number, imageDataUrl: string) => void
  clearSlot: (index: number) => void
  reset: () => void
}

export const useChallengeStore = create<ChallengeStore>()(
  persist(
    (set, get) => ({
      challengeId: null,
      slots: [],
      activeSlotIndex: null,
      isComplete: false,

      initSlots: (challenge) => {
        if (get().challengeId === challenge.id && get().slots.length > 0) return
        set({
          challengeId: challenge.id,
          slots: challenge.letters.map((char, i) => ({
            index: i,
            character: char,
            status: "empty",
            imageDataUrl: null,
          })),
          activeSlotIndex: null,
          isComplete: false,
        })
      },

      selectSlot: (index) =>
        set((state) => ({
          activeSlotIndex: state.activeSlotIndex === index ? null : index,
        })),

      deselectSlot: () => set({ activeSlotIndex: null }),

      fillSlot: (index, imageDataUrl) =>
        set((state) => {
          const slots = state.slots.map((slot) =>
            slot.index === index
              ? { ...slot, status: "filled" as const, imageDataUrl }
              : slot
          )
          const isComplete = slots.every((s) => s.status === "filled")
          return { slots, isComplete, activeSlotIndex: null }
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

      reset: () =>
        set({
          challengeId: null,
          slots: [],
          activeSlotIndex: null,
          isComplete: false,
        }),
    }),
    { name: "typolog-challenge" }
  )
)
