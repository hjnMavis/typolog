import { describe, it, expect, vi, beforeEach } from "vitest"
import { createCroppedImageBlob, loadImage, type PixelCrop } from "@/lib/image/crop-image"

const mockDrawImage = vi.fn()
const mockGetContext = vi.fn(() => ({ drawImage: mockDrawImage })) as ReturnType<typeof vi.fn> & {
  mockReturnValueOnce: (val: { drawImage: typeof mockDrawImage } | null) => void
}
const mockToBlob = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  mockDrawImage.mockClear()
  mockGetContext.mockClear()
  mockToBlob.mockClear()

  HTMLCanvasElement.prototype.getContext = mockGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = mockToBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob
})

describe("loadImage", () => {
  it("이미지 로드 성공 시 HTMLImageElement를 반환한다", async () => {
    const originalImage = globalThis.Image

    globalThis.Image = class MockImage {
      src = ""
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        setTimeout(() => this.onload?.(), 0)
      }
    } as unknown as typeof globalThis.Image

    const img = await loadImage("blob:test")
    expect(img).toBeDefined()
    expect(img.src).toBe("blob:test")

    globalThis.Image = originalImage
  })

  it("이미지 로드 실패 시 에러를 throw한다", async () => {
    const originalImage = globalThis.Image

    globalThis.Image = class MockImage {
      src = ""
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        setTimeout(() => this.onerror?.(), 0)
      }
    } as unknown as typeof globalThis.Image

    await expect(loadImage("invalid")).rejects.toThrow("이미지를 불러올 수 없습니다")

    globalThis.Image = originalImage
  })
})

describe("createCroppedImageBlob", () => {
  const pixelCrop: PixelCrop = { x: 10, y: 20, width: 100, height: 100 }

  beforeEach(() => {
    const originalImage = globalThis.Image
    globalThis.Image = class MockImage {
      src = ""
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        setTimeout(() => this.onload?.(), 0)
      }
    } as unknown as typeof globalThis.Image

    return () => {
      globalThis.Image = originalImage
    }
  })

  it("drawImage를 올바른 좌표로 호출한다", async () => {
    const fakeBlob = new Blob(["test"], { type: "image/png" })
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(fakeBlob))

    await createCroppedImageBlob("blob:test", pixelCrop)

    expect(mockDrawImage).toHaveBeenCalledOnce()
    const args = mockDrawImage.mock.calls[0]
    expect(args[1]).toBe(10)
    expect(args[2]).toBe(20)
    expect(args[3]).toBe(100)
    expect(args[4]).toBe(100)
    expect(args[5]).toBe(0)
    expect(args[6]).toBe(0)
    expect(args[7]).toBe(100)
    expect(args[8]).toBe(100)
  })

  it("Blob을 반환한다", async () => {
    const fakeBlob = new Blob(["test"], { type: "image/png" })
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(fakeBlob))

    const result = await createCroppedImageBlob("blob:test", pixelCrop)
    expect(result).toBe(fakeBlob)
  })

  it("toBlob이 null을 반환하면 에러를 throw한다", async () => {
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(null))

    await expect(createCroppedImageBlob("blob:test", pixelCrop)).rejects.toThrow(
      "이미지를 생성할 수 없습니다"
    )
  })

  it("getContext가 null을 반환하면 에러를 throw한다", async () => {
    mockGetContext.mockReturnValueOnce(null)

    await expect(createCroppedImageBlob("blob:test", pixelCrop)).rejects.toThrow(
      "Canvas 2D 컨텍스트를 생성할 수 없습니다"
    )
  })
})
