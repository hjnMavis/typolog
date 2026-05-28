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
      {/* Image mask container: clips the photo to the button's border-radius without cutting the badge */}
      {status === "filled" && imageDataUrl ? (
        <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
          {/* eslint-disable-next-line @next/next/no-img-element -- Object URL does not need next/image */}
          <img
            src={imageDataUrl}
            alt={character}
            className="h-full w-full object-cover"
          />
        </span>
      ) : null}

      <span
        className={cn(
          "relative z-10 text-lg font-semibold select-none",
          status === "filled" && imageDataUrl && "sr-only",
          status === "filled" && !imageDataUrl && "text-primary",
          status === "empty" && !isActive && "text-muted-foreground/60",
          isActive && "text-primary",
        )}
      >
        {character}
      </span>

      {/* Badge is a sibling of the mask container, outside of it, so it won't be clipped */}
      {status === "filled" && (
        <span className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
          ✓
        </span>
      )}
    </button>
  )
}
