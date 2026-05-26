import Link from "next/link"
import { findChallengeById } from "@/lib/constants/challenges"
import { CaptureClient } from "@/features/challenge/CaptureClient"

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const challenge = findChallengeById(id)

  if (!challenge) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <h1 className="text-xl font-bold">챌린지를 찾을 수 없어요</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          존재하지 않는 챌린지입니다.
        </p>
        <Link
          href="/"
          className="mt-6 text-sm text-primary underline underline-offset-4"
        >
          홈으로 돌아가기
        </Link>
      </div>
    )
  }

  return <CaptureClient challenge={challenge} />
}
