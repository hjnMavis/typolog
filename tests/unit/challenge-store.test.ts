import { describe, it, expect, beforeEach } from "vitest"
import { useChallengeStore } from "@/stores/challenge-store"
import type { Challenge } from "@/types"

const mockChallenge: Challenge = {
  id: "test-1",
  sentence: "오늘도 화이팅",
  letters: ["오", "늘", "도", "화", "이", "팅"],
  activeDate: "2026-05-26",
}

describe("useChallengeStore", () => {
  beforeEach(() => {
    localStorage.removeItem("typolog-challenge")
    useChallengeStore.setState({
      challengeId: null,
      slots: [],
      activeSlotIndex: null,
      isComplete: false,
    })
  })

  describe("initSlots", () => {
    it("챌린지로부터 빈 슬롯을 생성한다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      const state = useChallengeStore.getState()

      expect(state.challengeId).toBe("test-1")
      expect(state.slots).toHaveLength(6)
      expect(state.slots[0]).toEqual({
        index: 0,
        character: "오",
        status: "empty",
        imageDataUrl: null,
      })
      expect(state.isComplete).toBe(false)
      expect(state.activeSlotIndex).toBeNull()
    })

    it("같은 챌린지로 재호출하면 기존 슬롯을 유지한다", () => {
      const store = useChallengeStore.getState()
      store.initSlots(mockChallenge)
      store.fillSlot(0, "blob:test-url")

      store.initSlots(mockChallenge)
      const state = useChallengeStore.getState()

      expect(state.slots[0].status).toBe("filled")
      expect(state.slots[0].imageDataUrl).toBe("blob:test-url")
    })

    it("다른 챌린지로 호출하면 슬롯을 새로 생성한다", () => {
      const store = useChallengeStore.getState()
      store.initSlots(mockChallenge)
      store.fillSlot(0, "blob:test-url")

      const otherChallenge: Challenge = {
        id: "test-2",
        sentence: "참 좋은 날",
        letters: ["참", "좋", "은", "날"],
        activeDate: "2026-05-27",
      }
      store.initSlots(otherChallenge)
      const state = useChallengeStore.getState()

      expect(state.challengeId).toBe("test-2")
      expect(state.slots).toHaveLength(4)
      expect(state.slots.every((s) => s.status === "empty")).toBe(true)
    })
  })

  describe("selectSlot / deselectSlot", () => {
    it("슬롯을 선택한다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().selectSlot(2)

      expect(useChallengeStore.getState().activeSlotIndex).toBe(2)
    })

    it("같은 슬롯을 다시 선택하면 해제한다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().selectSlot(2)
      useChallengeStore.getState().selectSlot(2)

      expect(useChallengeStore.getState().activeSlotIndex).toBeNull()
    })

    it("다른 슬롯을 선택하면 이전 선택이 변경된다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().selectSlot(2)
      useChallengeStore.getState().selectSlot(4)

      expect(useChallengeStore.getState().activeSlotIndex).toBe(4)
    })

    it("deselectSlot으로 선택을 해제한다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().selectSlot(2)
      useChallengeStore.getState().deselectSlot()

      expect(useChallengeStore.getState().activeSlotIndex).toBeNull()
    })
  })

  describe("fillSlot", () => {
    it("슬롯에 이미지를 추가하면 filled 상태가 된다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().fillSlot(0, "blob:test-url")

      const slot = useChallengeStore.getState().slots[0]
      expect(slot.status).toBe("filled")
      expect(slot.imageDataUrl).toBe("blob:test-url")
    })

    it("fillSlot 후 activeSlotIndex가 null로 리셋된다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().selectSlot(0)
      useChallengeStore.getState().fillSlot(0, "blob:test-url")

      expect(useChallengeStore.getState().activeSlotIndex).toBeNull()
    })

    it("기존 이미지를 교체할 수 있다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().fillSlot(0, "blob:old-url")
      useChallengeStore.getState().fillSlot(0, "blob:new-url")

      expect(useChallengeStore.getState().slots[0].imageDataUrl).toBe("blob:new-url")
    })

    it("모든 슬롯을 채우면 isComplete가 true가 된다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      for (let i = 0; i < 6; i++) {
        useChallengeStore.getState().fillSlot(i, `blob:url-${i}`)
      }

      expect(useChallengeStore.getState().isComplete).toBe(true)
    })

    it("일부만 채우면 isComplete는 false다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().fillSlot(0, "blob:url-0")
      useChallengeStore.getState().fillSlot(1, "blob:url-1")

      expect(useChallengeStore.getState().isComplete).toBe(false)
    })
  })

  describe("clearSlot", () => {
    it("채운 슬롯을 비운다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().fillSlot(0, "blob:test-url")
      useChallengeStore.getState().clearSlot(0)

      const slot = useChallengeStore.getState().slots[0]
      expect(slot.status).toBe("empty")
      expect(slot.imageDataUrl).toBeNull()
    })

    it("전체 완성 후 하나를 비우면 isComplete가 false가 된다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      for (let i = 0; i < 6; i++) {
        useChallengeStore.getState().fillSlot(i, `blob:url-${i}`)
      }
      useChallengeStore.getState().clearSlot(3)

      expect(useChallengeStore.getState().isComplete).toBe(false)
    })
  })

  describe("reset", () => {
    it("모든 상태를 초기화한다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().selectSlot(2)
      useChallengeStore.getState().fillSlot(0, "blob:test-url")
      useChallengeStore.getState().reset()

      const state = useChallengeStore.getState()
      expect(state.challengeId).toBeNull()
      expect(state.slots).toEqual([])
      expect(state.activeSlotIndex).toBeNull()
      expect(state.isComplete).toBe(false)
    })
  })

  describe("persist partialize", () => {
    it("localStorage에 challengeId만 저장된다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      useChallengeStore.getState().fillSlot(0, "blob:test-url")

      const raw = localStorage.getItem("typolog-challenge")
      expect(raw).not.toBeNull()

      const persisted = JSON.parse(raw!)
      expect(persisted.state).toEqual({ challengeId: "test-1" })
      expect(persisted.state.slots).toBeUndefined()
      expect(persisted.state.activeSlotIndex).toBeUndefined()
      expect(persisted.state.isComplete).toBeUndefined()
    })

    it("imageDataUrl이 localStorage에 저장되지 않는다", () => {
      useChallengeStore.getState().initSlots(mockChallenge)
      for (let i = 0; i < 6; i++) {
        useChallengeStore.getState().fillSlot(i, `blob:url-${i}`)
      }

      const raw = localStorage.getItem("typolog-challenge")
      expect(raw).not.toContain("blob:")
      expect(raw).not.toContain("imageDataUrl")
    })
  })
})
