import { CollagePreviewClient } from "@/features/compose"

// 챌린지 데이터는 클라이언트가 ['challenge','today'] 쿼리로 가져온다 —
// URL id 검증(오늘 챌린지와 일치)은 TodayChallengeGate가 수행한다 (게이트 A-(d)).
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CollagePreviewClient challengeId={id} />
}
