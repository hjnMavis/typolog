// 날짜 유틸 — 순수 함수라 클라이언트/서버 양쪽에서 안전하게 import한다.

// KST(Asia/Seoul) 기준 YYYY-MM-DD 문자열.
// 'sv-SE' 로캘은 ISO 형식(YYYY-MM-DD)을 보장하므로 수동 zero-pad가 불필요하다.
// Phase 1 mock·서버 라우트(challenges/today, submissions)가 모두 이 한 소스를 공유한다
// (Day 3 QA M1 중복 제거).
export function getKSTDateString(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}
