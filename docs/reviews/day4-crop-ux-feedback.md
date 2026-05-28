# Day 4 Crop UX 피드백 — 실기기 테스트 결과

> 작성: QA Agent + 사용자 직접 테스트
> 일자: 2026-05-26
> 테스트 환경: 맥 Chrome + Android 폰 Chrome (cloudflared 터널)

## 문제

현재 crop UI(react-easy-crop)는 **고정된 정사각형 안에 이미지를 끌어 맞추는 방식**이다.
사용자가 원하는 건 **Android 갤러리 앱처럼 crop 영역 자체를 자유롭게 그리고, 크기와 위치를 조절하는 방식**이다.

### 현재 동작 (react-easy-crop)
- 화면 중앙에 고정된 정사각형 crop 영역
- 이미지를 드래그해서 위치 이동 → 동작함
- 핀치 줌으로 확대/축소 → 동작함
- **crop 영역의 크기/위치를 사용자가 조절할 수 없음**

### 기대 동작 (Android 갤러리 스타일)
- 사용자가 이미지 위에 직접 사각형을 그림
- 사각형의 꼭짓점/변을 드래그해서 크기 조절
- 사각형을 드래그해서 위치 이동
- 핀치 줌으로 이미지 확대/축소도 가능
- 자유 비율 (1:1 강제 아님)

### 영향
- 간판/포스터에서 특정 글자만 정밀하게 잘라내는 것이 핵심 UX
- 고정 영역 방식으로는 글자 크기/위치에 맞게 정밀한 crop이 어려움
- **MVP 핵심 플로우에 직접 영향** — 이 문제가 해결되지 않으면 사용자가 원하는 글자를 정확히 잘라낼 수 없음

## 제안

### 방법: react-image-crop으로 교체

`react-easy-crop` → `react-image-crop` 교체

| 항목 | react-easy-crop (현재) | react-image-crop (제안) |
|------|----------------------|----------------------|
| crop 방식 | 고정 영역, 이미지 이동 | **사용자가 영역을 그림** |
| 영역 크기 조절 | ❌ 불가 | ✅ 꼭짓점/변 드래그 |
| 영역 위치 이동 | ❌ 이미지만 이동 | ✅ 영역을 드래그 |
| 자유 비율 | ❌ aspect 고정 | ✅ 자유 비율 가능 |
| 모바일 터치 | ✅ | ✅ |
| 번들 크기 | ~12KB | ~10KB |
| npm | react-easy-crop | react-image-crop |

### 변경 범위

```
수정 파일:
1. src/features/challenge/ImageCropperModal.tsx  — Cropper 컴포넌트 교체
2. package.json                                  — react-easy-crop 제거, react-image-crop 추가

유지 파일 (변경 불필요):
- src/lib/image/crop-image.ts                    — Canvas crop 유틸 그대로 사용
- src/features/challenge/CaptureClient.tsx        — 변경 불필요 (onCropComplete(Blob) 인터페이스 동일)
- tests/unit/crop-image.test.ts                  — 변경 불필요
```

### crop-image.ts와의 호환성

`react-image-crop`은 `PixelCrop` 객체를 반환하며, 형태가 기존과 동일하다:
```typescript
{ x: number, y: number, width: number, height: number }
```
기존 `createCroppedImageBlob(imageSrc, pixelCrop)` 함수를 그대로 사용할 수 있다.

### 주의사항

1. `react-image-crop`은 CSS import가 필요: `import 'react-image-crop/dist/ReactCrop.css'`
2. 최소 crop 크기 설정 권장: `minWidth={30} minHeight={30}` (너무 작은 crop 방지)
3. aspect prop 제거 — 자유 비율이 기본
4. 모바일에서 이미지가 화면보다 클 때 스크롤 처리 필요할 수 있음
5. zoom 슬라이더는 제거 가능 (react-image-crop은 이미지 원본 크기로 표시)
