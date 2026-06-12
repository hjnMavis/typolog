import { CaptureClient } from "@/features/challenge/CaptureClient"

// 챌린지 데이터는 클라이언트가 ['challenge','today'] 쿼리로 가져온다 —
// 별도 GET /api/challenges/[id]가 없으므로(§6.1) URL id 검증(오늘 챌린지와 일치)도
// CaptureClient가 수행하고, 불일치 시 홈으로 보낸다 (게이트 A-(d)).
export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CaptureClient challengeId={id} />
}
