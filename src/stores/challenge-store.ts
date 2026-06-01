import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Challenge, LetterSlot } from "@/types"

/** Metadata fields persisted to localStorage (no runtime-only URLs). */
type SlotMeta = {
  imageKey: string
  fileName: string
  fileType: string
}

interface ChallengeStore {
  challengeId: string | null
  slots: LetterSlot[]
  activeSlotIndex: number | null
  isComplete: boolean

  initSlots: (challenge: Challenge) => void
  selectSlot: (index: number) => void
  deselectSlot: () => void
  /**
   * Mark a slot as filled.
   * @param index - slot index
   * @param meta - persisted metadata (imageKey, fileName, fileType)
   * @param imageDataUrl - runtime-only Object URL; stored in memory but NOT persisted
   */
  fillSlot: (index: number, meta: SlotMeta, imageDataUrl: string) => void
  /**
   * Attach a re-created Object URL to a restored slot without touching metadata.
   * Used during IDB restore on mount.
   */
  setSlotImageUrl: (index: number, imageDataUrl: string) => void
  /**
   * Null out every slot's runtime-only imageDataUrl.
   * Call right after revoking the corresponding Object URLs (e.g. on unmount):
   * a revoked URL must not stay referenced in state, or a later re-mount would
   * render a dead `blob:` URL. Persisted metadata (imageKey/status) is kept, so
   * the next restore re-creates fresh URLs from IndexedDB.
   */
  clearImageUrls: () => void
  clearSlot: (index: number) => void
  /**
   * Re-create empty slots for the current challenge, clearing all metadata.
   * Pure store-only: the caller must handle IDB deletion and Object URL revocation
   * BEFORE calling this (read keys from state first).
   */
  resetDraft: () => void
  /** Full wipe — challengeId, slots, everything. */
  reset: () => void
}

function emptySlot(index: number, character: string): LetterSlot {
  return {
    index,
    character,
    status: "empty",
    imageKey: null,
    fileName: null,
    fileType: null,
    updatedAt: null,
    imageDataUrl: null,
  }
}

export const useChallengeStore = create<ChallengeStore>()(
  persist(
    (set, get) => ({
      challengeId: null,
      slots: [],
      activeSlotIndex: null,
      isComplete: false,

      initSlots: (challenge) => {
        // Guard: same challenge already loaded — keep rehydrated metadata.
        // Normalize imageDataUrl: partialize omits the key, so rehydrated slots
        // carry `undefined`; coerce to `null` so the restore guard (=== null) and
        // type (string | null) stay correct. Recompute isComplete (not persisted).
        if (get().challengeId === challenge.id && get().slots.length > 0) {
          const slots = get().slots.map((s) => ({
            ...s,
            imageDataUrl: s.imageDataUrl ?? null,
          }))
          const isComplete = slots.every((s) => s.status === "filled")
          set({ slots, isComplete })
          return
        }
        set({
          challengeId: challenge.id,
          slots: challenge.letters.map((char, i) => emptySlot(i, char)),
          activeSlotIndex: null,
          isComplete: false,
        })
      },

      selectSlot: (index) =>
        set((state) => ({
          activeSlotIndex: state.activeSlotIndex === index ? null : index,
        })),

      deselectSlot: () => set({ activeSlotIndex: null }),

      fillSlot: (index, meta, imageDataUrl) =>
        set((state) => {
          const slots = state.slots.map((slot) =>
            slot.index === index
              ? {
                  ...slot,
                  status: "filled" as const,
                  imageKey: meta.imageKey,
                  fileName: meta.fileName,
                  fileType: meta.fileType,
                  updatedAt: Date.now(),
                  imageDataUrl,
                }
              : slot
          )
          const isComplete = slots.every((s) => s.status === "filled")
          return { slots, isComplete, activeSlotIndex: null }
        }),

      setSlotImageUrl: (index, imageDataUrl) =>
        set((state) => ({
          slots: state.slots.map((slot) =>
            slot.index === index ? { ...slot, imageDataUrl } : slot
          ),
        })),

      clearImageUrls: () =>
        set((state) => ({
          slots: state.slots.map((slot) =>
            slot.imageDataUrl === null ? slot : { ...slot, imageDataUrl: null }
          ),
        })),

      clearSlot: (index) =>
        set((state) => ({
          slots: state.slots.map((slot) =>
            slot.index === index
              ? emptySlot(index, slot.character)
              : slot
          ),
          isComplete: false,
        })),

      resetDraft: () =>
        set((state) => ({
          // Keep challengeId; re-create empty slots preserving characters
          slots: state.slots.map((slot) => emptySlot(slot.index, slot.character)),
          activeSlotIndex: null,
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
    {
      name: "typolog-challenge",
      /**
       * Partialize: persist challengeId + slim slot metadata.
       * imageDataUrl is intentionally omitted — it is a runtime-only Object URL
       * and must NEVER be serialized to localStorage.
       */
      partialize: (state) => ({
        challengeId: state.challengeId,
        slots: state.slots.map(({ index, character, status, imageKey, fileName, fileType, updatedAt }) => ({
          index,
          character,
          status,
          imageKey,
          fileName,
          fileType,
          updatedAt,
        })),
      }),
    }
  )
)
