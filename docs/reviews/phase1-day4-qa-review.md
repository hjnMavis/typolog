# Phase 1 Day 4 QA 리뷰

리뷰 범위: ImageCropperModal, crop-image 유틸, CaptureClient crop 연동, Object URL lifecycle
리뷰 일자: 2026-05-26

## 변경 요약

| 파일 | 변경 | 핵심 |
|------|------|------|
| `ImageCropperModal.tsx` | +119 (신규) | react-easy-crop 기반 전체화면 crop UI |
| `crop-image.ts` | +51 (신규) | Canvas API로 crop 영역 잘라서 Blob 생성 |
| `CaptureClient.tsx` | +65/-8 | Sheet→Cropper 전환, Object URL 이중 관리 |
| `index.ts` | +1 | ImageCropperModal export |
| `crop-image.test.ts` | +118 (신규) | loadImage, createCroppedImageBlob 유닛 테스트 |

---

## 1. Critical Issues

없음.

---

## 2. High Issues

### [H-01] crop 결과 포맷이 `image/png` 고정 — WebP 미사용

```typescript
// crop-image.ts:48
canvas.toBlob((blob) => { ... }, "image/png")
```

계획 문서에서는 "글자 조각은 WebP (용량 절약)"이었으나 PNG로만 구현됨. 모바일 카메라 원본(4000x3000)에서 crop한 결과가 PNG면 투명도 채널 포함으로 WebP 대비 2-5배 클 수 있음.

**판정: Day 5로 미뤄도 됨.**

근거:
- 현재 Phase 1은 mock 기반으로 서버 업로드 없음. 로컬 Object URL만 사용
- WebP 전환은 `canvas.toBlob(cb, "image/webp", 0.85)` 한 줄 변경이지만, Safari 호환성 체크(`canvas.toBlob(cb, "image/webp")` → Safari는 PNG fallback)가 필요
- Phase 2 Supabase Storage 연동 시 이미지 최적화 파이프라인과 함께 처리하는 것이 적절

### [H-02] `handleCropCancel`에서 `deselectSlot()` 호출 — 기존 filled 슬롯 교체 시 의도치 않은 deselect

```typescript
const handleCropCancel = useCallback(() => {
  // ...
  setCropperOpen(false)
  deselectSlot()  // ← 교체 플로우에서도 deselect
}, [deselectSlot])
```

사용자가 채워진 슬롯을 탭 → 이미지 선택 → crop 취소하면 `deselectSlot()`이 호출되어 슬롯이 deselect됨. 이 자체는 문제 없지만, 기존 이미지는 유지됨(clearSlot 미호출). **기존 슬롯 데이터가 의도치 않게 지워지는 버그는 없음.**

**판정: 이슈 아님. 동작 올바름.**

---

## 3. Medium Issues

### [M-01] aspect={1} 고정 — 정사각형 crop만 가능

```typescript
<Cropper aspect={1} cropShape="rect" ... />
```

한글 글자 모양에 따라 세로/가로 비율이 다를 수 있음 (예: "ㅣ" vs "ㅡ"). MVP에서 1:1 고정은 제품 결정으로 수용 가능하지만, 콜라주 레이아웃이 정사각형 그리드를 전제하므로 일관성은 유지됨.

**판정: MVP에서 1:1 고정이 적절. 향후 자유 비율 crop은 콜라주 레이아웃 엔진 변경과 함께 고려.**

### [M-02] zoom 범위 min={1} max={3} — 극단적 케이스

매우 큰 이미지(4000x3000)에서 글자가 작으면 3배 줌으로 불충분할 수 있음. 다만 react-easy-crop은 핀치 줌으로 슬라이더 범위를 넘어 확대할 수 없으므로 슬라이더가 유일한 줌 컨트롤.

**판정: MVP에서 3배 충분. 사용자 피드백 후 조정 가능.**

### [M-03] 모달이 조건부 렌더링 (`if (!open) return null`) — mount/unmount 반복

```typescript
{cropSourceUrl && activeCharacter && (
  <ImageCropperModal open={cropperOpen} ... />
)}
```

외부 조건(`cropSourceUrl && activeCharacter`)과 내부 조건(`if (!open) return null`) 이중 가드. `cropSourceUrl`이 null이 되면 컴포넌트 자체가 unmount되므로 react-easy-crop의 내부 상태(crop 위치, zoom)가 자연스럽게 초기화됨. **정상 동작.**

단, crop 중에 `activeCharacter`가 null이 되면(예: store가 외부에서 reset되면) 모달이 사라짐. 현재 구조에서는 crop 중 store reset이 일어날 경로가 없으므로 안전.

### [M-04] 모바일 pinch zoom과 viewport zoom 충돌 가능성

react-easy-crop은 `touch-action: none`을 내부적으로 설정하여 브라우저 기본 핀치 줌을 방지함. 단, 크롬퍼 영역 밖(버튼, 슬라이더)에서는 브라우저 줌이 트리거될 수 있음.

`<meta name="viewport" content="width=device-width, initial-scale=1">` — `maximum-scale=1, user-scalable=no`가 없음. iOS Safari에서 crop 중 실수로 브라우저 줌이 되면 crop UI가 깨질 수 있음.

**판정: Day 5로 미뤄도 됨. viewport meta 수정은 전체 앱에 영향을 주므로 신중히 처리.**

---

## 4. QA 17대 체크포인트 결과

| # | 체크포인트 | 결과 | 근거 |
|---|-----------|------|------|
| 1 | react-easy-crop 사용 | ✅ | `Cropper` 컴포넌트 import 확인 |
| 2 | 직접 Canvas gesture UI 미사용 | ✅ | Canvas는 `crop-image.ts`의 Blob 생성에만 사용 |
| 3 | Canvas API = crop Blob 생성만 | ✅ | `drawImage` + `toBlob` only |
| 4 | 원본 Object URL cleanup (저장/취소/unmount) | ✅ | `handleCropConfirm`, `handleCropCancel`, useEffect cleanup 모두 revoke |
| 5 | cropped Object URL cleanup (교체/reset) | ✅ | `handleCropConfirm`에서 oldUrl revoke, useEffect cleanup에서 전체 revoke |
| 6 | revokeObjectURL 너무 빠른 호출 | ✅ | cropSourceUrl은 crop 완료/취소 후에만 revoke. croppedUrl은 다음 교체 시에만 revoke. 표시 중인 URL을 revoke하지 않음 |
| 7 | localStorage persist 안전성 | ✅ | Day 3에서 `partialize: challengeId만` 적용 유지. Blob/URL 누출 없음 |
| 8 | crop 완료 전 preview 버튼 | ✅ | `fillSlot`은 `handleCropConfirm`에서만 호출. crop 중 isComplete 변경 없음 |
| 9 | crop 취소 시 기존 슬롯 보존 | ✅ | `handleCropCancel`은 `deselectSlot()`만 호출, `clearSlot` 미호출 |
| 10 | 기존 슬롯 교체 안전성 | ✅ | oldUrl revoke → 새 croppedUrl 생성 → fillSlot 순서 올바름 |
| 11 | 에러 처리 | ✅ | `loadImage` onerror, `getContext` null, `toBlob` null 모두 처리. UI에 에러 메시지 표시 |
| 12 | touch gesture 충돌 | ⚠️ | react-easy-crop 내부 touch-action:none 처리. 크롬퍼 밖에서 viewport zoom 가능성 (M-04) |
| 13 | iOS Safari viewport/safe-area | ⚠️ | `fixed inset-0`으로 전체화면. safe-area padding 없음 — 노치 기기에서 헤더가 상태바에 가려질 수 있음 |
| 14 | Android 대형 이미지 성능 | ⚠️ | Canvas drawImage는 동기 작업. 12MP+ 이미지에서 순간 프리즈 가능하나 체감 1초 이내로 예상 |
| 15 | 기존 테스트 깨짐 | ✅ | 41/41 통과 (sentence-parser 18 + challenge-store 17 + crop-image 6) |
| 16 | 새 테스트 의미 | ✅ | drawImage 좌표 검증, toBlob null 에러, getContext null 에러, loadImage 성공/실패 — 핵심 경로 커버 |
| 17 | Day 5 분리 | ✅ | EXIF strip, WebP 전환, persist 복원 전략 모두 미구현으로 Day 5로 명확히 분리됨 |

---

## 5. 지금 반드시 수정해야 할 문제

없음. 커밋 가능.

---

## 6. Day 5로 미뤄도 되는 문제

| ID | 이슈 | 이유 |
|----|------|------|
| D-01 | PNG → WebP 전환 (H-01) | 서버 업로드 없는 Phase 1에서 용량 무의미. Phase 2 Storage 연동 시 처리 |
| D-02 | EXIF strip | Canvas re-draw로 자동 제거되지만 명시적 strip 유틸 필요. Day 5 계획 |
| D-03 | viewport meta `user-scalable=no` (M-04) | 전체 앱 영향. crop 중 iOS 브라우저 줌 가능성은 낮음 |
| D-04 | iOS safe-area padding for crop modal | `pt-safe-top` 추가 필요하나 기능 동작에 영향 없음 |
| D-05 | 이어하기 복원 전략 | partialize에 slots 메타 포함 + IndexedDB 이미지 저장 |
| D-06 | 대형 이미지 리사이즈 | crop 전 원본을 Canvas로 리사이즈하여 성능 개선 |

---

## 7. 테스트 케이스 제안

### 현재 테스트 (41개, 전부 통과)

```
tests/unit/sentence-parser.test.ts  — 18개
tests/unit/challenge-store.test.ts  — 17개
tests/unit/crop-image.test.ts       — 6개 (loadImage 2 + createCroppedImageBlob 4)
```

### 추가 필요 테스트

```
[NT-01] ImageCropperModal > open=false → null 렌더링
[NT-02] ImageCropperModal > 취소 버튼 → onCancel 호출
[NT-03] ImageCropperModal > "이 글자로 저장" → onCropComplete(Blob) 호출
[NT-04] ImageCropperModal > saving 중 버튼 disabled + "저장 중..." 텍스트
[NT-05] ImageCropperModal > createCroppedImageBlob 실패 → 에러 메시지 표시
[NT-06] ImageCropperModal > zoom 슬라이더 변경 → zoom 값 업데이트
[NT-07] CaptureClient > 이미지 선택 → Sheet 닫힘 → Cropper 열림 (전환 순서)
[NT-08] CaptureClient > crop 확인 → 슬롯에 croppedUrl 표시 + Cropper 닫힘
[NT-09] CaptureClient > crop 취소 → 기존 슬롯 이미지 유지
[NT-10] CaptureClient > crop 중 다른 슬롯 탭 → 무시 (cropperOpen guard)
[NT-11] crop-image > canvas 크기가 pixelCrop width/height와 일치
[NT-12] crop-image > toBlob에 "image/png" 포맷 전달 확인
```

---

## 8. 모바일 수동 테스트 체크리스트

### Crop UI 기본 동작
- [ ] 슬롯 터치 → Sheet → "갤러리에서 선택" → 이미지 선택 → Crop 화면 전환
- [ ] Crop 화면: 전체화면 검정 배경, 글자 이름 헤더, 사각형 crop 영역
- [ ] 드래그로 crop 영역 이동
- [ ] 핀치 줌으로 이미지 확대/축소
- [ ] 줌 슬라이더로 확대/축소 (1x ~ 3x)
- [ ] "이 글자로 저장" → 슬롯에 cropped 이미지 표시 + crop 화면 닫힘
- [ ] "취소" → 슬롯 변화 없음, crop 화면 닫힘

### 교체 플로우
- [ ] 이미 채운 슬롯 터치 → Sheet → 새 이미지 선택 → Crop → 저장 → 이전 이미지 교체됨
- [ ] 교체 후 이전 이미지가 메모리에서 정리되는지 (DevTools Memory 탭 확인 가능)

### 에러 케이스
- [ ] crop 확인 시 에러 → "이미지 자르기에 실패했습니다" 메시지 표시
- [ ] 에러 후 다시 "이 글자로 저장" 클릭 가능

### 전체 플로우
- [ ] 6개 슬롯 모두 이미지 선택 + crop + 저장
- [ ] 진행률 바 + 헤더 카운트 정상 증가
- [ ] "콜라주 만들기" 버튼 활성화

### iOS Safari 특이사항
- [ ] crop 화면에서 노치/상태바 영역과 헤더 겹침 없는지
- [ ] 핀치 줌 시 브라우저 전체 줌이 되지 않는지 (react-easy-crop 내부만 줌)
- [ ] "이 글자로 저장" 후 crop 화면이 깔끔하게 닫히는지

### Android Chrome
- [ ] 카메라 촬영 후 대형 이미지(12MP+)로 crop 시 프리즈 없는지
- [ ] 핀치 줌 반응 속도
- [ ] 뒤로가기 버튼 → crop 화면 닫히거나 앱 이탈 (현재 처리 없음 — 알려진 제한)

---

## 9. 커밋 가능 여부

**커밋 가능.**

| 검증 | 결과 |
|------|------|
| `pnpm type-check` | ✅ 통과 |
| `pnpm lint` | ✅ 통과 |
| `pnpm test:run` | ✅ 41/41 통과 (1.26s) |
| Critical issues | 0 |
| High issues | 1 (PNG 고정 — Day 5로 이관) |
| Medium issues | 4 (모두 Day 5 이관 가능) |
| Object URL lifecycle | ✅ 원본 + cropped 이중 관리 올바름 |
| 에러 처리 | ✅ loadImage/getContext/toBlob 모두 처리 |
| 기존 테스트 회귀 | ✅ 없음 |
| 새 테스트 | ✅ 6개 추가, 핵심 경로 커버 |

---

## 10. 추가 확인 포인트 결과

| # | 포인트 | 결과 |
|---|--------|------|
| 1 | PNG 고정 vs WebP | PNG 고정 확인. 의도적 단순화로 판단. H-01로 기록, Day 5 이관 |
| 2 | aspect={1} 고정 | 정사각형 고정 확인. MVP 콜라주 레이아웃이 정사각형 그리드 전제이므로 적절 |
| 3 | open=false → return null | 정상. 외부 조건부 렌더링과 이중 가드. unmount 시 react-easy-crop 상태 자연 초기화 |
| 4 | 모바일 pinch zoom 충돌 | react-easy-crop 내부 touch-action:none 처리됨. 크롬퍼 밖 영역은 M-04로 기록 |
| 5 | zoom max=3 충분 여부 | 대부분의 글자 촬영 시나리오에서 충분. 극단적 케이스는 사용자 피드백 후 조정 |

---

## 11. Day 4 → Day 5 인수인계

Day 5 콜라주 Preview + 마무리 시 함께 처리:
1. **EXIF strip**: Canvas re-draw 방식 구현 또는 확인 (crop-image.ts에서 이미 drawImage로 자동 strip되지만 명시적 검증 필요)
2. **WebP 전환**: `canvas.toBlob(cb, "image/webp", 0.85)` + Safari fallback
3. **이미지 크기 제한**: crop 결과 500KB 이하 검증/리사이즈
4. **이어하기 전략**: partialize에 slots 메타 포함, IndexedDB 이미지 저장
5. **viewport meta**: `user-scalable=no` 추가 검토
6. **iOS safe-area**: crop 모달 헤더에 `pt-safe-top` 추가
7. **Android 뒤로가기**: crop 화면에서 hardware back 버튼 처리


---

## 12. 실기기 테스트 결과 — Crop UX Critical 피드백

> 테스트 환경: 맥 Chrome + Android 폰 Chrome (cloudflared 터널, production 빌드)

### 발견된 Critical UX 문제

**react-easy-crop의 고정 영역 crop 방식이 MVP 핵심 UX에 부적합.**

간판/포스터 사진에서 특정 글자만 정밀하게 잘라내려면 사용자가 crop 영역의 크기와 위치를 직접 조절할 수 있어야 한다. 현재 구현은 고정된 정사각형 안에 이미지를 끌어 맞추는 방식으로, 정밀한 글자 crop이 어렵다.

**상세 피드백**: [day4-crop-ux-feedback.md](day4-crop-ux-feedback.md)

**결론**:  →  교체 필요. crop-image.ts 유틸과 CaptureClient는 변경 불필요.
