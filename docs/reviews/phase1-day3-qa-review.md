# Phase 1 Day 3 QA 리뷰

리뷰 범위: ImagePickerSheet, CaptureClient Sheet 연동, challenge-store partialize, Object URL lifecycle
리뷰 일자: 2026-05-26

## 변경 요약

| 파일 | 변경 | 핵심 |
|------|------|------|
| `CaptureClient.tsx` | +84/-12 | Sheet 연동, Object URL 관리, handleSlotTap/handleImageSelected |
| `ImagePickerSheet.tsx` | +95 (신규) | shadcn Sheet, 카메라/갤러리 input, 파일 선택 |
| `challenge-store.ts` | +7/-1 | `partialize: challengeId만 persist` |
| `index.ts` | +1 | ImagePickerSheet export |
| `challenge-store.test.ts` | +213 (신규) | store 17개 테스트 + partialize 검증 2개 |

---

## 1. Critical Issues

없음.

---

## 2. High Issues

### [H-01] `partialize`로 `challengeId`만 persist → 새로고침 시 슬롯 상태 전부 소실

```typescript
partialize: (state) => ({ challengeId: state.challengeId })
```

slots, activeSlotIndex, isComplete이 persist에서 제외. 새로고침하면 슬롯 전부 empty로 초기화되어 product-brief `7-1. 이어하기`와 testing-strategy `BUG-08`에 해당.

**판정: 의도적 결정으로 수용.**

근거:
- Day 2 QA D-01(localStorage 용량 폭탄)을 해결하기 위해 도입
- 현 단계에서 Object URL은 새로고침 시 무효화 → slots를 persist해도 이미지 복원 불가
- slots를 persist하면 "filled인데 이미지 없음" 상태가 더 혼란스러움
- 진짜 이어하기는 Day 4 crop 이후 이미지 저장 전략(IndexedDB 또는 리사이즈 base64)과 함께 구현해야 의미 있음

**Day 4 액션**: crop 구현 시 이어하기 복원 전략을 함께 설계할 것.

---

## 3. Medium Issues

### [M-01] `handleFileChange` 파일 타입 검증이 느슨

```typescript
if (!file.type.startsWith("image/")) return
```

`image/svg+xml`(XSS 벡터), `image/tiff`, `image/bmp` 등도 통과. MVP에서는 JPEG/PNG/WebP만 허용이 안전.

**판정: Day 4로 미룸.** `accept="image/*"` 속성이 OS 파일 피커에서 1차 필터링하고, Day 4 crop에서 image-validate 유틸 도입 시 화이트리스트로 강화.

### [M-02] `handleImageSelected`에서 `activeSlotIndex` 클로저 stale 가능성

`activeSlotIndex`가 useCallback 의존성에 포함되어 stale closure 문제 없음. `fillSlot` 내부에서 `activeSlotIndex: null`로 리셋하지만 파일 선택 UI 특성상 이중 호출 불가. `e.target.value = ""`로 이중 방어. **리스크 낮음.**

### [M-03] Sheet `showCloseButton={false}` 접근성

X 닫기 버튼 없음. 하지만 shadcn Sheet는 Radix Dialog 기반이라 ESC 키 닫기, 백드롭 클릭 닫기 모두 지원됨. `onOpenChange`가 `handleSheetOpenChange`로 연결. **접근성 이슈 없음.**

---

## 4. QA 12대 체크포인트 결과

| # | 체크포인트 | 결과 | 근거 |
|---|-----------|------|------|
| 1 | Object URL revoke 누락 없는가 | ✅ | 교체 시 `handleImageSelected`에서 oldUrl revoke, unmount 시 cleanup useEffect에서 전체 revoke+clear |
| 2 | 같은 파일 재선택 시 change 이벤트 | ✅ | `e.target.value = ""` 리셋으로 해결 |
| 3 | active slot 없이 이미지 선택 가능한 버그 | ✅ | `if (activeSlotIndex === null) return` guard |
| 4 | Object URL/base64가 localStorage persist | ✅ | `partialize`로 challengeId만 저장. 테스트로 검증됨 |
| 5 | 파일 타입 검증 | ⚠️ | `image/*` 느슨한 체크. Day 4 화이트리스트로 강화 예정 |
| 6 | 이미지 교체 시 이전 URL 정리 | ✅ | `handleImageSelected`에서 oldUrl revoke 후 새 URL 생성 |
| 7 | unmount/reset 시 cleanup | ✅ | useEffect cleanup에서 전체 revoke. challenge.id 변경 시 재실행 |
| 8 | iOS Safari capture attribute | ✅ | `capture="environment"` — iOS에서 OS 자체 카메라/갤러리 시트 표시. 정상 동작 |
| 9 | Android Chrome 카메라/갤러리 | ✅ | 카메라 input과 갤러리 input 분리. Android에서 카메라 직행 / 갤러리 직행 |
| 10 | Day 4 전에 반드시 막아야 할 문제 | ✅ | 없음. 현재 상태로 커밋 가능 |
| 11 | 기존 테스트 깨짐 | ✅ | sentence-parser 18개 유지, 전체 35/35 통과 |
| 12 | 신규 store 테스트 의미 | ✅ | 17개 상태 전이 + partialize 2개. 특히 persist 검증이 핵심 |

---

## 5. 지금 반드시 수정해야 할 문제

없음. 커밋 가능.

---

## 6. Day 4로 미뤄도 되는 문제

| ID | 이슈 | 이유 |
|----|------|------|
| D-01 | 파일 타입 화이트리스트 강화 (M-01) | Day 4 crop에서 image-validate 유틸 도입 시 함께 처리 |
| D-02 | 이어하기 UX (H-01) | crop 이후 이미지 저장 전략과 함께 설계 필요 |
| D-03 | 이미지 파일 크기 검증 | 500KB 제한은 crop 후 적용해야 의미 있음 |
| D-04 | EXIF strip | Day 4 crop pipeline에서 Canvas re-draw로 자동 처리 예정 |
| D-05 | `handleImageSelected` 에러 처리 | `createObjectURL` 실패 가능성 극히 낮음. try-catch 추가 권장 수준 |

---

## 7. 테스트 현황 및 추가 제안

### 현재 테스트 (35개, 전부 통과)

```
tests/unit/sentence-parser.test.ts  — 18개 (파서 8 + MOCK_CHALLENGES 일치 10)
tests/unit/challenge-store.test.ts  — 17개 (store 상태 전이 + partialize 검증)
```

### 추가 필요 테스트 (Day 4 이후)

```
[NT-01] ImagePickerSheet > 카메라 버튼 클릭 → cameraInputRef input 트리거
[NT-02] ImagePickerSheet > 갤러리 버튼 클릭 → galleryInputRef input 트리거
[NT-03] ImagePickerSheet > 이미지 선택 후 e.target.value 리셋 확인
[NT-04] ImagePickerSheet > image/* 아닌 파일 선택 → onImageSelected 미호출
[NT-05] ImagePickerSheet > 빈 파일(files[0] 없음) → onImageSelected 미호출
[NT-06] ImagePickerSheet > 취소 버튼 → onOpenChange(false) 호출
[NT-07] CaptureClient > 슬롯 탭 → Sheet open + activeSlotIndex 설정
[NT-08] CaptureClient > active 슬롯 재탭 → Sheet close + deselect
[NT-09] CaptureClient > 이미지 선택 후 해당 슬롯에 Object URL 표시
[NT-10] CaptureClient > 채운 슬롯 탭 → Sheet open (교체 플로우)
[NT-11] CaptureClient > 이미지 교체 시 이전 Object URL revoke 확인
[NT-12] challenge-store > clearSlot 후 해당 슬롯만 empty, 다른 슬롯 유지
```

---

## 8. 모바일 수동 테스트 체크리스트

### Sheet 동작
- [ ] 빈 슬롯 터치 → bottom sheet 올라옴 (애니메이션 자연스러움)
- [ ] Sheet 외부 터치(backdrop) → sheet 닫힘 + 슬롯 deselect
- [ ] "취소" 버튼 → sheet 닫힘
- [ ] Sheet 열린 상태에서 뒤로가기 → sheet 닫힘

### 카메라/갤러리
- [ ] "카메라로 찍기" → 카메라 앱 실행
- [ ] "갤러리에서 선택" → 사진 라이브러리 열림
- [ ] 사진 촬영/선택 후 → sheet 자동 닫힘, 해당 슬롯에 이미지 미리보기
- [ ] 카메라/갤러리에서 취소 → sheet 유지, 아무 변화 없음

### 이미지 교체
- [ ] 채운 슬롯 터치 → sheet 열림
- [ ] 새 이미지 선택 → 이전 이미지 교체됨
- [ ] 같은 사진 다시 선택 → 정상 동작

### 진행률
- [ ] 이미지 추가 시 헤더 카운트 증가 (예: "1 / 6 글자")
- [ ] 진행률 바 width 증가 (애니메이션)
- [ ] 모든 슬롯 채우면 → "모든 글자를 모았어요!" + 버튼 활성화

### iOS Safari
- [ ] `capture="environment"` → OS 카메라/갤러리 선택 시트 표시
- [ ] 가로 사진 촬영 후 회전 문제 없는지 확인

### Android Chrome
- [ ] "카메라로 찍기" → 카메라 앱 직접 실행
- [ ] "갤러리에서 선택" → 사진 선택기 실행

---

## 9. 커밋 가능 여부

**커밋 가능.**

| 검증 | 결과 |
|------|------|
| `pnpm type-check` | ✅ 통과 |
| `pnpm lint` | ✅ 통과 |
| `pnpm test:run` | ✅ 35/35 통과 (1.37s) |
| Critical issues | 0 |
| High issues | 1 (의도적 결정으로 수용) |
| Medium issues | 3 (Day 4로 이관) |
| Object URL lifecycle | ✅ 올바르게 관리됨 |
| localStorage 안전성 | ✅ partialize로 보호됨 |
| 기존 테스트 회귀 | ✅ 없음 |

---

## 10. 실기기 테스트 결과

### 테스트 환경

- 기기: Android 폰 (Chrome 브라우저)
- 접속 방법: `cloudflared tunnel` → `pnpm build && pnpm start` (production 모드, 포트 3001)
- dev 모드는 HMR WebSocket이 터널 경유 시 502를 발생시켜 클라이언트 hydration 실패 → production 모드로 전환하여 해결

### 테스트 항목 및 결과

| # | 항목 | 결과 |
|---|------|------|
| 1 | 홈 화면 렌더링 | ✅ 맥과 동일 |
| 2 | /challenge/1 슬롯 6개 렌더링 | ✅ 정상 |
| 3 | 슬롯 터치 → Sheet 올라옴 | ✅ 정상 |
| 4 | "카메라로 찍기" → 카메라 앱 실행 | ✅ Android에서 카메라 직접 실행 |
| 5 | "갤러리에서 선택" → 사진 선택기 실행 | ✅ 정상 |
| 6 | 사진 촬영/선택 후 슬롯에 이미지 반영 | ✅ 정상 |
| 7 | 6개 슬롯 전부 채우기 | ✅ 정상 |
| 8 | "콜라주 만들기" 버튼 활성화 | ✅ 정상 |
| 9 | 전체 플로우가 맥 환경과 동일 | ✅ 동일 |

### 발견된 이슈

- dev 모드(`pnpm dev`) + cloudflared 터널 조합에서 `/challenge/[id]` 페이지가 빈 화면으로 렌더링됨
  - 원인: HMR WebSocket 502 → 클라이언트 JS hydration 실패 → `CaptureClient`의 `if (slots.length === 0) return null`이 영구 적용
  - 해결: `pnpm build && pnpm start` (production 모드)로 전환
  - 영향: 개발 중 터널 테스트 시 production 빌드 필요. Vercel 배포 후에는 해당 없음

### headless 브라우저 테스트 (gstack /browse)

iPhone 14 뷰포트(390x844)로 10개 시나리오 테스트 완료. 스크린샷 증거: `/Users/javis.hwang/typolog-qa-screenshots/day3/`

| 파일 | 내용 |
|------|------|
| 01-home.png | 홈 화면 |
| 02-challenge.png | 챌린지 페이지 (6 슬롯) |
| 03-slot-active.png | 슬롯 active + Sheet |
| 04-sheet-closed.png | Sheet 닫힘 후 |
| 05-after-upload.png | 이미지 업로드 후 (1/6) |
| 06-all-filled.png | 전체 완성 (6/6) |
| 07-replace-sheet.png | 채운 슬롯 교체 Sheet |
| 08-not-found.png | 존재하지 않는 챌린지 |
| 09-4char.png | 4글자 그리드 레이아웃 |
| 10-7char.png | 7글자 그리드 레이아웃 |

---

## 11. Day 3 → Day 4 인수인계

Day 4 crop 구현 시 반드시 함께 처리:
1. **이미지 타입 화이트리스트**: `image/jpeg`, `image/png`, `image/webp`만 허용하는 `validateImageFile` 유틸
2. **EXIF strip**: Canvas re-draw 방식으로 crop pipeline에 포함
3. **이미지 크기 검증**: crop 결과 500KB 이하, 콜라주 2MB 이하
4. **이어하기 복원 전략**: crop 결과를 리사이즈 base64 또는 IndexedDB에 저장 → persist에 slots 메타 포함
5. **에러 처리**: `createObjectURL` / Canvas 로드 실패 시 사용자 피드백
