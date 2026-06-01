# Phase 1 Day 6 QA 리뷰

리뷰 범위: 콜라주 미리보기 화면, IDB Blob 복원, 결정론적 레이아웃, 배경색 선택, 새로고침 복원
리뷰 일자: 2026-05-29
검증 방식: 정적 리뷰 + **실제 브라우저 실행 검증 (browse, iPhone 14 viewport)**

## 변경 요약

| 파일 | 변경 | 핵심 |
|------|------|------|
| `CollagePreviewClient.tsx` | +243 (신규) | IDB Blob 복원, 콜라주 렌더, 배경색, 폴백 |
| `collage-layout.ts` | +55 (신규) | 결정론적 jitter (rotate/scale/margin), canPreview |
| `preview/page.tsx` | +31/-9 | placeholder → CollagePreviewClient 연결 |
| `compose/index.ts` | +4/-? | export 추가 |
| `collage-layout.test.ts` | +119 (신규) | 결정론/범위/canPreview 테스트 14개 |

---

## 1. Critical Issues

없음.

---

## 2. High Issues

없음. (Day 5의 새로고침 복원 버그가 이번 화면에서 재발하지 않음을 실제 검증 — 아래 9번 참조)

---

## 3. Medium Issues

### [M-01] 배경색 선택이 영속되지 않음 — 새로고침 시 흰색으로 초기화

`bgColor`는 컴포넌트 로컬 `useState`. 검정/크림을 골라도 새로고침하면 흰색 기본값으로 돌아간다.

**판정: Day 6 범위에서는 수용 가능.** 배경색은 Day 7 PNG 저장 시점에 함께 확정/영속하면 된다. 단, 사용자가 배경 고르고 새로고침하면 선택이 날아가는 건 인지해둘 것.

### [M-02] flex-wrap 레이아웃은 글자 수에 따라 줄바꿈이 달라짐

콜라주가 `flex flex-wrap`이라 6글자는 4+2로 자연스럽지만, 7글자(challenge 9·10)는 4+3, 5글자는 4+1 등으로 마지막 줄 정렬이 들쭉날쭉할 수 있다. 정사각형 그리드가 아니라 "ransom note" 느낌을 의도한 것으로 보이나, 글자 수별 시각 균형은 미검증.

**판정: 디자인 의도에 따라 다름. 7글자 챌린지로 수동 확인 권장.** 현재 6글자는 양호.

> **해소 (2026-05-31, authored lines 방향 결정)**: `flex-wrap` 자동 줄바꿈을 폐기하고, 줄 배치를 작성자 지정 `Challenge.lines`로 전환. 글자 수에 따라 들쭉날쭉하던 마지막 줄 문제가 작성자가 줄을 직접 지정하므로 해소됨. 수집/preview/PNG 세 화면이 동일 줄 구조. 상세: `docs/data-model.md`, `docs/mvp-sprint.md` "줄 배치". (작업: roadmap 1-11)

### [M-03] 콜라주 조각이 정사각형(size-16) 고정 — crop 비율 무시

Day 4에서 자유 비율 crop으로 바꿨는데, 미리보기 조각은 `size-16` + `object-cover`로 정사각형 고정. 세로로 긴 글자를 crop해도 정사각형으로 잘려 보인다.

**판정: Day 7/콜라주 레이아웃 고도화 시 검토.** MVP 미리보기로는 허용 가능하나, crop 자유 비율의 의미가 미리보기에서 일부 상쇄됨.

---

## 4. QA 체크포인트 결과 (실행 검증 포함)

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|----------|
| 1 | 미준비 상태(슬롯 미완성) 폴백 | ✅ | **실행**: 빈 상태로 /preview 접근 → "아직 모든 글자가..." + 다시 채우기 링크 (d6-01) |
| 2 | 6슬롯 완성 시 콜라주 렌더 | ✅ | **실행**: 시드 후 6색 조각 순서대로 렌더 (d6-02) |
| 3 | 글자 순서(slot.index) 유지 | ✅ | **실행**: 오·늘·도·화·이·팅 순서 = 색 순서 일치 |
| 4 | 결정론적 jitter (re-render 안정) | ✅ | 유닛테스트 14개 + 새로고침 후 동일 배치 (d6-02 vs d6-04) |
| 5 | 흰 배경 | ✅ | **실행** (d6-02) |
| 6 | 검정 배경 + 선택 표시 | ✅ | **실행**: 카드 검정, 색 버튼 scale/border (d6-03) |
| 7 | 크림 배경 | ✅ | **실행** (d6-06) |
| 8 | IDB Blob → Object URL 복원 | ✅ | **실행**: imgs=6, 모두 blob: URL |
| 9 | **미리보기 새로고침 후 이미지 복원** | ✅ | **실행**: 새로고침 후 imgs=6 allBlobUrls=true, 콘솔 에러 0 (d6-04) — Day 5 버그 미재발 |
| 10 | Blob 누락 시 글자 폴백 | ✅ | **실행**: IDB에서 1:2·1:4 삭제 → "도"·"이" 글자 표시, 나머지 4개 이미지 (d6-05) |
| 11 | 폴백 글자 대비 (검정 배경) | ✅ | 코드: cardIsDark 분기로 text-white/text-foreground |
| 12 | Object URL cleanup (unmount/challenge 변경) | ✅ | 코드: objectUrlsRef revoke useEffect |
| 13 | 미리보기가 capture의 revoke된 URL 재사용 안 함 | ✅ | 코드: store.imageDataUrl 무시, 항상 getImageBlob으로 새 URL 생성 |
| 14 | SSR 안전성 (window/IDB) | ✅ | 복원은 useEffect, getImageBlob에 isSupported 가드 |
| 15 | 저장 버튼 disabled (Day 7 예정) | ✅ | **실행**: disabled + 라벨 (전 스크린샷) |
| 16 | 콘솔 에러 | ✅ | **실행**: 초기/새로고침/폴백 모두 에러 0 |
| 17 | type-check / lint / test | ✅ | 63/63 통과 |

---

## 5. 지금 반드시 수정해야 할 문제

없음. 커밋 가능.

---

## 6. Day 7로 미뤄도 되는 문제

| ID | 이슈 | 이유 |
|----|------|------|
| M-01 | 배경색 영속 안 됨 | Day 7 PNG 저장 시 배경색 확정/영속과 함께 처리 |
| M-02 | 7글자 레이아웃 균형 | 디자인 의도 확인 후. 6글자는 양호 |
| M-03 | 조각 정사각형 고정 vs 자유 비율 crop | 콜라주 레이아웃 고도화 시 |
| D-01 | PNG 저장 (toBlob/다운로드) | Day 7 본 작업 |
| D-02 | 배경색이 PNG에 반영되는지 | Day 7 |

---

## 7. 테스트 케이스 제안

### 현재 테스트 (63개, 전부 통과)

```
sentence-parser  18 / challenge-store 25 / crop-image 6 / collage-layout 14
```

collage-layout 테스트는 결정론·범위·고정값·canPreview를 잘 커버. (의미 있음 ✅)

### 추가 권장 (E2E 또는 fake-indexeddb)

```
[NT-01] preview > 슬롯 미완성 시 "다시 채우기" 폴백 렌더
[NT-02] preview > IDB 6 blob 시드 → 6 img 렌더 + 순서 일치
[NT-03] preview > 새로고침(재마운트) 후 img 6개 복원 (회귀 방지 — Day 5 버그)
[NT-04] preview > blob 일부 누락 → 해당 슬롯 글자 폴백
[NT-05] preview > 배경색 변경 → 카드 backgroundColor 반영
```

NT-03은 Day 5 회귀 방지용으로 특히 가치 있음. 현재 IDB 복원은 E2E로만 검증되므로(jsdom IDB 미지원), `fake-indexeddb` 도입 시 자동화 권장.

---

## 8. 모바일 수동 테스트 체크리스트

- [ ] 6글자 채운 뒤 "콜라주 만들기" → 미리보기 진입, 콜라주 표시
- [ ] **미리보기에서 새로고침 → 이미지 유지** (글자 폴백 아님)
- [ ] 배경색 흰/검/크림 전환 즉시 반영
- [ ] 배경색 고른 뒤 새로고침 → 흰색으로 초기화됨 (현재 동작, M-01)
- [ ] "다시 수정" → 글자 수집 화면 복귀
- [ ] 7글자 챌린지(/challenge/9)로 콜라주 → 마지막 줄 정렬 확인
- [ ] iOS Safari: 미리보기 새로고침 복원, safe-area
- [ ] Android: 대형 이미지 6개 복원 속도

---

## 9. 커밋 가능 여부

**커밋 가능.**

| 검증 | 결과 |
|------|------|
| `pnpm type-check` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm test:run` | ✅ 63/63 |
| Critical / High | 0 / 0 |
| Medium | 3 (모두 Day 7 이관 가능) |
| **실제 새로고침 복원 (browse)** | ✅ imgs=6, blob URL, 에러 0 |
| Blob 폴백 (browse) | ✅ |
| 배경색 3종 (browse) | ✅ |

**Day 5 대비 개선점**: 이번엔 정적 리뷰로 끝내지 않고 browse로 실제 새로고침 복원·폴백·배경색을 모두 실행 검증함. 스크린샷 6장 증거 보관(`~/typolog-qa-screenshots/day6/`).
