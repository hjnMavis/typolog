# Phase 1 Day 2 — QA Review

> 리뷰 일시: 2026-05-26
> 리뷰어: qa-agent
> 대상: 글자 슬롯 UI, challenge-store, sentence-parser

## High (수정 완료)

### H-1. getTodayChallenge 타임존 버그
- **문제**: `toISOString()`이 UTC 기준 → 한국 자정~오전 9시에 어제 챌린지 표시
- **수정**: `toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })`로 KST 기준 변경

### H-2. parseSentence / MOCK_CHALLENGES.letters 불일치 위험
- **문제**: letters가 수동 하드코딩 → sentence 수정 시 불일치 가능
- **수정**: letters를 `parseSentence(sentence)`로 파생 + 일치 검증 테스트 10개 추가

## Medium (수정 완료)

### M-1. useEffect 의존성
- **문제**: `[challenge, initSlots]` → 객체 참조 변경 시 불필요한 재초기화
- **수정**: `[challenge.id, initSlots]`로 변경

## Low (미룸)

### L-1. localStorage base64 imageDataUrl 용량
- Day 3 이미지/crop 구현 시 Blob URL 또는 IndexedDB로 전환 예정

### L-2. 9글자 grid 불균형
- UI polish 단계에서 처리 예정
