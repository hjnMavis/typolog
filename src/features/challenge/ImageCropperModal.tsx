"use client"

import { useState, useRef, useCallback } from "react"
import ReactCrop from "react-image-crop"
import type { Crop, PixelCrop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { createCroppedImageBlob } from "@/lib/image/crop-image"
import { Button } from "@/components/ui/button"

interface ImageCropperModalProps {
  open: boolean
  imageSrc: string
  character: string
  onCropComplete: (croppedBlob: Blob) => void
  onCancel: () => void
}

export function ImageCropperModal({
  open,
  imageSrc,
  character,
  onCropComplete,
  onCancel,
}: ImageCropperModalProps) {
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const handleSave = useCallback(async () => {
    if (!completedCrop || !imgRef.current || saving) return
    if (completedCrop.width === 0 || completedCrop.height === 0) return

    setSaving(true)
    setError(null)

    const img = imgRef.current
    const scaleX = img.naturalWidth / img.width
    const scaleY = img.naturalHeight / img.height

    const pixelCrop = {
      x: Math.round(completedCrop.x * scaleX),
      y: Math.round(completedCrop.y * scaleY),
      width: Math.round(completedCrop.width * scaleX),
      height: Math.round(completedCrop.height * scaleY),
    }

    try {
      const blob = await createCroppedImageBlob(imageSrc, pixelCrop)
      onCropComplete(blob)
    } catch {
      setError("이미지 자르기에 실패했습니다. 다시 시도해주세요.")
    } finally {
      setSaving(false)
    }
  }, [completedCrop, imageSrc, onCropComplete, saving])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-4 h-14 shrink-0">
        <Button
          variant="ghost"
          className="text-white hover:text-white/80 hover:bg-white/10"
          onClick={onCancel}
          disabled={saving}
        >
          취소
        </Button>
        <span className="text-sm font-medium text-white">
          &ldquo;{character}&rdquo; 글자 자르기
        </span>
        <div className="w-14" />
      </header>

      {/* Crop 영역 */}
      <div className="flex flex-1 items-center justify-center overflow-auto px-4">
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
          minWidth={30}
          minHeight={30}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Object URL에는 next/image 불필요 */}
          <img
            ref={imgRef}
            src={imageSrc}
            alt="crop 대상 이미지"
            className="max-h-[60vh] max-w-full object-contain"
          />
        </ReactCrop>
      </div>

      {/* 하단 컨트롤 */}
      <div className="shrink-0 space-y-3 px-6 pt-4 pb-6">
        {error && (
          <p className="text-center text-sm text-red-400">{error}</p>
        )}

        <Button
          className="w-full h-12 text-base"
          onClick={handleSave}
          disabled={saving || !completedCrop?.width}
        >
          {saving ? "저장 중..." : "이 글자로 저장"}
        </Button>
      </div>
    </div>
  )
}
