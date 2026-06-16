// 피드 화면 — CSR 클라이언트 컴포넌트 마운트 전용 (SSR prefetch 없음 — Day 4.5 패턴과 동일).
// 인증 보호 라우트이며, 데이터 패칭은 FeedClient 내부 훅이 처리한다.
import { FeedClient } from '@/features/feed/FeedClient';

export default function FeedTodayPage() {
  return <FeedClient />;
}
