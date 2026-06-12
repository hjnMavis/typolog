import { HomeClient } from "@/features/home/HomeClient"

// 오늘의 챌린지 fetch는 클라이언트(TanStack Query)로 통일한다 — 보호 라우트라 SEO 무관,
// SSR prefetch(HydrationBoundary)는 공개 화면이 생기는 Phase 3에서 도입 (게이트 A-(d)).
export default function HomePage() {
  return <HomeClient />
}
