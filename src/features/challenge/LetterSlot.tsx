"use client"

import { cn } from "@/lib/utils"

interface LetterSlotProps {
  character: string
  status: "empty" | "filled"
  isActive: boolean
  imageDataUrl: string | null
  onTap: () => void
}

export function LetterSlot({
  character,
  status,
  isActive,
  imageDataUrl,
  onTap,
}: LetterSlotProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "relative flex aspect-square w-full items-center justify-center rounded-xl border-2 transition-all",
        "active:scale-95",
        status === "filled" && !isActive &&
          "border-primary bg-primary/5",
        status === "empty" && !isActive &&
          "border-dashed border-muted-foreground/30 bg-muted/50",
        isActive &&
          "border-primary ring-2 ring-primary/30 ring-offset-2 bg-primary/10",
      )}
    >
      {status === "filled" && imageDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- base64 dataUrl에는 next/image 불필요
        <img
          src={imageDataUrl}
          alt={character}
          className="absolute inset-1 rounded-lg object-cover"
        />
      ) : null}

      <span
        className={cn(
          "text-lg font-semibold select-none",
          status === "filled" && imageDataUrl && "sr-only",
          status === "filled" && !imageDataUrl && "text-primary",
          status === "empty" && !isActive && "text-muted-foreground/60",
          isActive && "text-primary",
        )}
      >
        {character}
      </span>

      {status === "filled" && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
          ✓
        </span>
      )}
    </button>
  )
}
