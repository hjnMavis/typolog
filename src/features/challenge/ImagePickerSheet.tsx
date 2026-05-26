"use client"

import { useRef, type ChangeEvent } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { CameraIcon, ImageIcon } from "lucide-react"

interface ImagePickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  character: string | null
  onImageSelected: (file: File) => void
}

export function ImagePickerSheet({
  open,
  onOpenChange,
  character,
  onImageSelected,
}: ImagePickerSheetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) return
    onImageSelected(file)
    e.target.value = ""
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>
            &ldquo;{character}&rdquo; 글자 이미지 선택
          </SheetTitle>
          <SheetDescription>
            카메라로 촬영하거나 갤러리에서 선택하세요
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4 pb-6">
          <Button
            variant="outline"
            className="h-12 justify-start gap-3 text-base"
            onClick={() => cameraInputRef.current?.click()}
          >
            <CameraIcon className="h-5 w-5" />
            카메라로 찍기
          </Button>
          <Button
            variant="outline"
            className="h-12 justify-start gap-3 text-base"
            onClick={() => galleryInputRef.current?.click()}
          >
            <ImageIcon className="h-5 w-5" />
            갤러리에서 선택
          </Button>
          <Button
            variant="ghost"
            className="h-12 text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </SheetContent>
    </Sheet>
  )
}
