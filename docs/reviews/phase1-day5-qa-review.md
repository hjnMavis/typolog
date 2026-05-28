# Phase 1 Day 5 QA 리뷰

리뷰 범위: crop 저장, IndexedDB Blob 저장, localStorage metadata, 새로고침 복원, Object URL lifecycle, EXIF 제거, resetDraft
리뷰 일자: 2026-05-28

## 변경 요약

| 파일 | 변경 | 핵심 |
|------|------|------|
| `indexed-image-store.ts` | +174 (신규) | IndexedDB Blob 저장/조회/삭제, SSR-safe |
| `challenge-store.ts` | +98/-? | SlotMeta persist, fillSlot/setSlotImageUrl/resetDraft, isComplete 재계산 |
| `CaptureClient.tsx` | +129 | IDB 저장 + 복원 useEffect, resetDraft, saveError 처리 |
| `crop-image.ts` | +9 | EXIF 제거 동작 문서화 (Canvas re-encode) |
| `types/index.ts` | +13 | LetterSlot에 imageKey/fileName/fileType/updatedAt 추가 |
| `challenge-store.test.ts` | +226 | 메타데이터/persist/resetDraft 테스트 확장 |

**주목**: Day 4 피드백(react-easy-crop → react-image-crop)이 반영됨. 자유 영역 crop으로 전환 완료.

---

## 1. Critical Issues

없음.

---

## 2. High Issues

### [H-01] SSR/CSR hydration mismatch 가능성 (기존 패턴 + persist 확장)

`CaptureClient`는 `"use client"`지만 Next.js가 SSR한다. 서버에서는 store가 비어 `if (slots.length === 0) return null`로 빈 렌더. 클라이언트에서는 zustand persist가 localStorage를 **동기 rehydrate**하므로 첫 렌더에 slots가 채워진 상태 → 서버(null) vs 클라이언트(채워짐) 불일치.

Day 5에서 slots 메타데이터까지 persist하면서, 새로고침 시 클라이언트가 즉시 filled 슬롯을 렌더하려다 hydration 경고가 날 수 있음.

**판정: 실제 동작 확인 필요.** 아키텍처상 `/challenge/[id]`는 CSR 중심이고, Next.js는 mismatch를 client 값으로 복구한다. 하지만 콘솔 경고가 뜨면 사용자 신뢰에 영향. 실기기/브라우저에서 콘솔 경고 여부 확인 권장. 경고가 있으면 `skipHydration` + 명시적 `rehydrate()` 또는 mounted 가드로 해결.

### [H-02] preview 페이지가 아직 placeholder — Day 6 데이터 구조 검증 미완

`/challenge/[id]/preview`는 여전히 placeholder. Day 5에서 만든 데이터 구조(IDB Blob + slot metadata)가 Day 6 콜라주 렌더링에 충분한지는 실제 구현 전까지 확정 불가.

**판정: Day 6 작업이므로 정상.** 다만 데이터 구조 분석상 충분함 (아래 "Day 6 준비 상태" 참고).

---

## 3. Medium Issues

### [M-01] restore 비동기 중 crop 교체 시 Object URL 누수 가능성

복원 useEffect의 `getImageBlob(slot.imageKey)`는 async. blob이 resolve되기 전에 사용자가 같은 슬롯을 crop으로 채우면:
1. `handleCropConfirm`이 `objectUrlsRef`에 새 URL 저장 + `fillSlot`으로 imageDataUrl 설정
2. 뒤늦게 restore의 blob이 resolve → `objectUrlsRef.set(slot.index, url)`로 **덮어쓰기** → crop이 만든 URL이 map에서 사라져 revoke 불가 → 누수

restore에 `slot.imageDataUrl === null` 가드가 있으나, 이는 **루프 시작 시점** 검사라 async 이후 상태 변화를 못 잡음.

**판정: 매우 드문 엣지 케이스** (초기 로드 중 IDB 읽기의 수 ms 내 crop 완료 필요). 누수도 1개 URL. Day 6 이후 정리 권장.

### [M-02] "다시 시작" 확인 다이얼로그 없음 — 실수로 전체 삭제

`handleResetDraft`는 클릭 즉시 모든 Blob 삭제 + Object URL revoke + 슬롯 초기화. 확인 다이얼로그 없음. 6글자를 다 모은 상태에서 실수로 누르면 전부 날아감.

**판정: UX 안전성 이슈. Day 6 또는 별도로 confirm 추가 권장.**

### [M-03] EXIF orientation 처리는 브라우저 기본 동작에 의존

`crop-image.ts`는 Canvas re-encode로 EXIF를 제거(올바름). 단, 회전 EXIF가 있는 사진은 modern 브라우저의 자동 orientation(`image-orientation: from-image` 기본값)에 의존. react-image-crop의 표시 좌표와 `createCroppedImageBlob`의 새 Image 모두 같은 브라우저 auto-orient를 받으므로 좌표 일관성은 유지됨.

**판정: modern 브라우저(Chrome 81+, Safari)에서 정상. 회전된 실사진으로 수동 테스트 권장.**

---

## 4. QA 16대 체크포인트 결과

| # | 체크포인트 | 결과 | 근거 |
|---|-----------|------|------|
| 1 | localStorage에 Blob/File/base64/URL 유입 | ✅ | partialize가 metadata만 직렬화. 테스트로 blob:/base64/imageDataUrl 부재 검증 |
| 2 | Object URL persist 안 함 | ✅ | imageDataUrl은 partialize에서 제외 |
| 3 | IDB Blob ↔ metadata 키 일관성 | ✅ | 양쪽 모두 `${challengeId}:${slotIndex}` 결정적 키 |
| 4 | 새로고침 후 Blob 복원 구조 | ✅ | restore useEffect가 imageKey로 getImageBlob → createObjectURL → setSlotImageUrl |
| 5 | 복원 실패 시 앱 안 깨짐 | ✅ | getImageBlob null/throw 시 try-catch, 글자 fallback 표시 |
| 6 | 교체 시 이전 Blob 삭제 | ✅ | 결정적 키 overwrite — 같은 키 put으로 자동 교체, orphan 없음 |
| 7 | resetDraft 시 Blob+metadata 함께 정리 | ✅ | 키 수집 → URL revoke → deleteImageBlobs → resetDraft 순서 올바름 |
| 8 | revokeObjectURL 너무 빠른 호출 | ✅ | crop 저장 후, 교체 시 oldUrl만 revoke. 표시 중 URL 안 건드림 |
| 9 | revokeObjectURL 누락 (누수) | ⚠️ | 정상 경로는 모두 revoke. restore 비동기 race에서 1개 누수 가능 (M-01) |
| 10 | Canvas drawImage→toBlob EXIF 제거 | ✅ | 새 canvas re-encode로 EXIF strip. orientation은 브라우저 의존 (M-03) |
| 11 | SSR window/indexedDB 접근 에러 | ✅ | isSupported() 가드 + restore는 useEffect(클라이언트 전용) |
| 12 | 모바일 새로고침 복원 자연스러움 | ⚠️ | 구조상 가능. hydration 경고 여부 실기기 확인 필요 (H-01) |
| 13 | Day 6에서 쓸 데이터 구조 | ✅ | imageKey로 IDB Blob 접근 가능, slot metadata 충분 |
| 14 | 기존 crop/picker/thumbnail 흐름 | ✅ | react-image-crop 교체됨, 인터페이스 onCropComplete(Blob) 동일 |
| 15 | 기존 테스트 깨짐 | ✅ | 49/49 통과 (sentence-parser 18 + challenge-store 25 + crop-image 6) |
| 16 | 새 테스트 의미 | ✅ | metadata persist, imageDataUrl 부재, resetDraft, 키 결정성 모두 검증 |

---

## 5. 지금 반드시 수정해야 할 문제

없음. 커밋 가능.

H-01(hydration)은 실기기 콘솔 확인이 선행되어야 수정 여부 판단 가능. 경고가 없으면 그대로 진행.

---

## 6. Day 6로 미뤄도 되는 문제

| ID | 이슈 | 이유 |
|----|------|------|
| M-01 | restore 비동기 race Object URL 누수 | 극히 드문 엣지, 1 URL. Day 6 정리 |
| M-02 | "다시 시작" 확인 다이얼로그 | UX 안전성. Day 6 또는 별도 |
| M-03 | EXIF orientation 실사진 검증 | modern 브라우저 정상. 회전 사진 수동 테스트 |
| D-01 | WebP 전환 (Day 4 H-01 이월) | Phase 2 Storage 연동 시 |
| D-02 | 이미지 크기 제한 (500KB) | crop 결과 검증/리사이즈 |
| D-03 | IDB 용량 초과(QuotaExceeded) 처리 | saveImageBlob 실패는 에러 표시되나, 용량 관리 전략은 추후 |

---

## 7. 테스트 케이스 제안

### 현재 테스트 (49개, 전부 통과)

```
tests/unit/sentence-parser.test.ts  — 18개
tests/unit/challenge-store.test.ts  — 25개 (metadata/persist/resetDraft 확장)
tests/unit/crop-image.test.ts       — 6개
```

### 추가 필요 테스트

```
[NT-01] indexed-image-store > saveImageBlob 후 getImageBlob으로 동일 Blob 반환 (fake-indexeddb)
[NT-02] indexed-image-store > 같은 키 재저장 시 덮어쓰기 (orphan 없음)
[NT-03] indexed-image-store > deleteImageBlob 후 getImageBlob null 반환
[NT-04] indexed-image-store > deleteImageBlobs 일괄 삭제
[NT-05] indexed-image-store > 존재하지 않는 키 getImageBlob → null
[NT-06] indexed-image-store > isSupported false 환경에서 getImageBlob null, saveImageBlob throw
[NT-07] CaptureClient > 새로고침 시뮬레이션: 메타데이터 rehydrate → restore가 setSlotImageUrl 호출
[NT-08] CaptureClient > IDB 저장 실패 → saveError 표시 + 슬롯 filled 안 됨
[NT-09] CaptureClient > handleResetDraft → deleteImageBlobs 호출 + resetDraft
[NT-10] CaptureClient > restore에서 blob null → 슬롯 글자 fallback 유지
[NT-11] crop-image > EXIF 포함 이미지 → 출력 Blob에 EXIF 없음 (실제 fixture)
```

**우선순위**: indexed-image-store는 핵심 신규 모듈인데 유닛 테스트가 0개. `fake-indexeddb` 패키지로 NT-01~06 추가를 강력 권장. (현재 challenge-store 테스트는 IDB를 전혀 안 건드림)

---

## 8. 모바일 수동 테스트 체크리스트

### crop 저장 + 복원
- [ ] 슬롯 터치 → 갤러리 → 이미지 선택 → crop → "이 글자로 저장" → 슬롯에 이미지 표시
- [ ] 6개 모두 채우기 → "콜라주 만들기" 활성화
- [ ] **새로고침** → 채운 슬롯이 이미지와 함께 복원됨 (글자 fallback 아님)
- [ ] 새로고침 후 진행률 바 / 카운트가 복원된 상태 반영

### 교체
- [ ] 채운 슬롯 재터치 → 새 이미지 crop → 저장 → 이전 이미지 교체
- [ ] 교체 후 새로고침 → 새 이미지로 복원 (이전 것 아님)

### 다시 시작
- [ ] "다시 시작" 클릭 → 모든 슬롯 비워짐
- [ ] 다시 시작 후 새로고침 → 빈 상태 유지 (IDB/localStorage 정리됨)

### EXIF / 회전
- [ ] 세로로 찍은 실제 사진(회전 EXIF 포함) crop → 결과가 올바른 방향으로 저장
- [ ] crop 좌표가 표시와 일치하는지 (회전 사진에서 어긋나지 않는지)

### 에러 / 엣지
- [ ] 시크릿 모드 / IDB 차단 환경에서 저장 시 에러 메시지 표시, 앱 안 깨짐
- [ ] 새로고침 직후 빠르게 슬롯 탭 → crop (restore와 충돌 없는지)

### iOS Safari
- [ ] 새로고침 후 복원 시 hydration 깜빡임/경고 없는지 (Safari 콘솔)
- [ ] crop 모달 전체화면 + safe-area

### Android Chrome
- [ ] 대형 카메라 이미지 crop 저장 → IDB 저장 속도
- [ ] 새로고침 복원 속도

---

## 9. 커밋 가능 여부

**커밋 가능.**

| 검증 | 결과 |
|------|------|
| `pnpm type-check` | ✅ 통과 |
| `pnpm lint` | ✅ 통과 |
| `pnpm test:run` | ✅ 49/49 통과 (1.29s) |
| Critical | 0 |
| High | 2 (H-01 hydration 실기기 확인, H-02 preview는 Day 6) |
| Medium | 3 (모두 Day 6 이관 가능) |
| localStorage 안전성 | ✅ metadata만, Blob/URL 없음 |
| IDB ↔ metadata 키 일관성 | ✅ 결정적 키 |
| Object URL lifecycle | ✅ 정상 경로 완비, 드문 race만 (M-01) |
| EXIF 제거 | ✅ Canvas re-encode |
| SSR 안전성 | ✅ isSupported 가드 + useEffect |

**커밋 전 권장**: 실기기/브라우저에서 새로고침 시 콘솔 hydration 경고 여부 1회 확인 (H-01). indexed-image-store 유닛 테스트는 Day 6 초입에 추가 권장.

---

## 10. Day 6 준비 상태

콜라주 미리보기(`/challenge/[id]/preview`)가 사용할 데이터:

| 필요 데이터 | 제공 여부 | 접근 방법 |
|------------|----------|----------|
| 채운 글자 이미지 | ✅ | `getImageBlob(slot.imageKey)` → Blob → Object URL 또는 ImageBitmap |
| 글자 순서 | ✅ | `slot.index` / `slot.character` |
| 완성 여부 | ✅ | `slots.every(s => s.status === "filled")` |
| 이미지 크기 | ⚠️ | 현재 metadata에 width/height 없음 — Day 6에서 Blob 디코드로 획득하거나 metadata 확장 |

**결론**: 콜라주 렌더링에 필요한 핵심 데이터는 충분. 단, 콜라주 레이아웃 계산 시 각 이미지의 실제 픽셀 크기가 필요하면 metadata에 width/height 추가를 고려 (현재는 정사각형 crop이 아니므로 비율이 제각각일 수 있음).
