export interface PixelCrop {
  x: number
  y: number
  width: number
  height: number
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다"))
    img.src = src
  })
}

/**
 * Crop `imageSrc` to `pixelCrop` and return the result as a PNG Blob.
 *
 * **EXIF stripping**: The source image is drawn onto a brand-new `<canvas>` element
 * and re-encoded via `canvas.toBlob("image/png")`. This pipeline produces a fresh
 * bitmap that does NOT carry over any of the original file's EXIF metadata
 * (orientation, GPS coordinates, camera model, etc.). The returned Blob is therefore
 * an EXIF-stripped cropped image — no additional EXIF parser is needed.
 */
export async function createCroppedImageBlob(
  imageSrc: string,
  pixelCrop: PixelCrop
): Promise<Blob> {
  const image = await loadImage(imageSrc)

  const canvas = document.createElement("canvas")
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다")

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("이미지를 생성할 수 없습니다"))
      },
      "image/png"
    )
  })
}
