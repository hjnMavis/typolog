import Link from "next/link"
import { getTodayChallenge } from "@/lib/constants/challenges"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function HomePage() {
  const challenge = getTodayChallenge()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">오늘의 문장</p>
          <h1 className="text-3xl font-bold tracking-tight">
            {challenge.sentence}
          </h1>
          <p className="text-sm text-muted-foreground">
            {challenge.letters.length}글자
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {challenge.letters.map((letter, i) => (
            <div
              key={i}
              className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-lg font-medium text-muted-foreground"
            >
              {letter}
            </div>
          ))}
        </div>

        <Link
          href={`/challenge/${challenge.id}`}
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          시작하기
        </Link>
      </div>
    </div>
  )
}
