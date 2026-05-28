# Phase 1 Day 4 — 이미지 Crop(잘라내기) 학습 노트

> crop 초안 구현(react-easy-crop) → 실기기 피드백 → UX 전면 교체(react-image-crop)

---

## 1. 오늘 구현한 기능 요약

### 1차: crop 초안 (react-easy-crop)

슬롯에 사진을 선택하면 **전체화면 crop 모달**이 열리고, 정사각형 crop 영역 안에서 이미지를 이동/확대해서 잘라낸 뒤 슬롯에 저장하는 기능을 만들었다.

- 화면 중앙에 **고정된 정사각형** crop 영역
- 이미지를 드래그해서 위치 이동
- 핀치 줌 / 슬라이더로 확대·축소
- "이 글자로 저장" → Canvas로 잘라서 Blob 생성 → 슬롯에 표시

### 2차: 실기기 피드백 → UX 전면 교체 (react-image-crop)

맥 Chrome + Android 실기기로 테스트한 결과, **고정 영역 방식이 핵심 UX에 부적합**하다는 피드백이 나왔다. (`docs/reviews/day4-crop-ux-feedback.md`)

> 간판/포스터 사진에서 **특정 글자만 정밀하게** 잘라내려면, 사용자가 **crop 영역 자체를 직접 그리고 꼭짓점/변을 드래그**해 크기·위치를 조절해야 한다. (Android 갤러리 앱 스타일)

그래서 `react-easy-crop` → `react-image-crop`(ReactCrop)으로 교체했다.

**교체의 핵심 통찰**: crop 라이브러리만 바꾸고, **Canvas crop 유틸(`crop-image.ts`)과 CaptureClient는 변경하지 않았다.** 두 라이브러리 모두 `{ x, y, width, height }` 형태의 `PixelCrop`을 결과로 주기 때문이다. 잘 설계된 인터페이스 경계 덕분에 UI 라이브러리 교체가 국소적으로 끝났다.

---

## 2. 핵심 개념 설명

### 2-1. Canvas API 기본 — HTMLCanvasElement와 getContext("2d")

Canvas는 **픽셀 단위로 그림을 그리는 브라우저 도화지**다. crop의 실제 잘라내기는 전부 Canvas에서 일어난다.

```typescript
// crop-image.ts:23-28
const canvas = document.createElement("canvas")   // 메모리상의 빈 도화지 (화면에 안 붙음)
canvas.width = pixelCrop.width                      // 도화지 크기 = 잘라낼 크기
canvas.height = pixelCrop.height

const ctx = canvas.getContext("2d")                 // 2D 그리기 도구(붓)
if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다")
```

**두 단계로 이해**:
1. `canvas` = 도화지 (얼마나 큰가)
2. `ctx` (context) = 붓 (어떻게 그리는가) — `drawImage`, `fillRect` 등 그리기 명령은 전부 `ctx`에 있다

**중요**: 여기서 만든 canvas는 `document.createElement`로 만들었을 뿐 **화면에 추가(`appendChild`)하지 않는다**. 화면에 보이지 않는 임시 도화지에서 잘라내기만 하고, 결과물(Blob)만 추출한다.

**왜 `getContext`가 null을 반환할 수 있나?** 브라우저 메모리 부족, WebGL 컨텍스트와 충돌 등 드문 상황에서 null이 나올 수 있어 방어 코드가 필요하다.

**쓰이는 곳**: `crop-image.ts:23-28`

---

### 2-2. ctx.drawImage()의 9개 인자 — crop의 핵심 원리

`drawImage`는 인자 개수에 따라 동작이 다르다. crop에서는 **9개 인자 버전**을 쓴다.

```typescript
// crop-image.ts:30-40
ctx.drawImage(
  image,              // (1) 원본 이미지
  pixelCrop.x,        // (2) sx — 원본에서 잘라낼 시작 x
  pixelCrop.y,        // (3) sy — 원본에서 잘라낼 시작 y
  pixelCrop.width,    // (4) sWidth  — 원본에서 잘라낼 너비
  pixelCrop.height,   // (5) sHeight — 원본에서 잘라낼 높이
  0,                  // (6) dx — 캔버스에 그릴 시작 x
  0,                  // (7) dy — 캔버스에 그릴 시작 y
  pixelCrop.width,    // (8) dWidth  — 캔버스에 그릴 너비
  pixelCrop.height    // (9) dHeight — 캔버스에 그릴 높이
)
```

**핵심 모델: source rect(원본 영역) → destination rect(캔버스 영역)**

```
원본 이미지 (4000 x 3000)              잘라낸 캔버스 (100 x 100)
┌────────────────────────┐
│                        │
│    ┌──────┐            │            ┌──────┐
│    │ s    │  ───────→  │   복사     │ d    │
│    │ rect │            │            │ rect │
│    └──────┘            │            └──────┘
│  (sx,sy,sw,sh)         │          (0,0,dw,dh)
└────────────────────────┘
```

- 인자 2~5 (`sx,sy,sw,sh`): "원본의 **어디**를 잘라낼 것인가"
- 인자 6~9 (`dx,dy,dw,dh`): "잘라낸 걸 캔버스 **어디에** 어떤 크기로 놓을 것인가"

이 코드에서는 source의 크기(sw,sh)와 destination 크기(dw,dh)가 같으므로 **크기 변화 없이 영역만 잘라낸다**. (만약 dw/dh를 작게 주면 잘라내면서 축소까지 된다 — 썸네일 만들 때 활용 가능)

> **테스트로 검증됨**: `crop-image.test.ts:77-93`에서 9개 인자 각각의 값을 검증한다 (sx=10, sy=20, ... dh=100).

**쓰이는 곳**: `crop-image.ts:30-40`

---

### 2-3. canvas.toBlob() vs toDataURL() — Blob을 만드는 이유

잘라낸 Canvas를 이미지 파일로 추출하는 두 가지 방법이 있다.

```typescript
// crop-image.ts:42-50 — 이 프로젝트가 선택한 방식
canvas.toBlob(
  (blob) => {
    if (blob) resolve(blob)
    else reject(new Error("이미지를 생성할 수 없습니다"))
  },
  "image/png"
)
```

| | `toBlob()` | `toDataURL()` |
|---|-----------|--------------|
| 반환 형태 | **Blob** (바이너리 객체) | **base64 문자열** (`"data:image/png;base64,iVBOR..."`) |
| 반환 방식 | 콜백 (비동기) | 즉시 (동기) |
| 메모리 효율 | 원본 크기 그대로 | base64로 **약 1.33배 증가** |
| Object URL과 궁합 | `URL.createObjectURL(blob)` 바로 가능 | 변환 필요 |
| 큰 이미지 | 효율적 | 거대한 문자열 → 메모리 부담 |

**왜 Blob인가?**

1. **메모리 효율**: base64는 원본보다 33% 크다. 4000×3000 사진을 crop해도 결과가 클 수 있는데, base64 문자열로 들고 다니면 메모리를 더 먹는다.
2. **Object URL과의 자연스러운 연결**: 이 프로젝트는 Day 3부터 `URL.createObjectURL()`로 이미지를 표시한다. Blob은 여기에 바로 들어간다.
3. **Day 3 학습과 일관**: `phase-1-day-3.md`에서 "base64를 localStorage에 저장하면 위험"하다고 배웠다. 같은 이유로 crop 결과도 base64가 아닌 Blob으로 다룬다.

**`toBlob`이 콜백/null인 이유**: 이미지 인코딩은 시간이 걸리는 작업이라 비동기 콜백으로 처리된다. 인코딩 실패 시 `null`이 올 수 있어 방어 코드가 필수다. 이 프로젝트는 콜백을 `Promise`로 감싸서 `await`로 쓸 수 있게 만들었다.

**쓰이는 곳**: `crop-image.ts:42-50`

---

### 2-4. 화면 표시 좌표 → 원본 이미지 좌표 변환 (scaleX/scaleY)

**이것이 Day 4에서 가장 중요한 개념이다.**

사용자는 화면에서 **축소되어 보이는 이미지** 위에 crop 영역을 그린다. 하지만 실제로 잘라내야 하는 건 **원본 고해상도 이미지**다. 두 좌표계가 다르다.

```typescript
// ImageCropperModal.tsx:38-47
const img = imgRef.current
const scaleX = img.naturalWidth / img.width    // 원본 너비 / 화면 표시 너비
const scaleY = img.naturalHeight / img.height  // 원본 높이 / 화면 표시 높이

const pixelCrop = {
  x: Math.round(completedCrop.x * scaleX),       // 화면 좌표 → 원본 좌표
  y: Math.round(completedCrop.y * scaleY),
  width: Math.round(completedCrop.width * scaleX),
  height: Math.round(completedCrop.height * scaleY),
}
```

**두 개의 너비/높이를 구분**:

| 속성 | 의미 | 예시 |
|------|------|------|
| `img.naturalWidth` / `naturalHeight` | **원본** 이미지의 실제 픽셀 크기 | 4000 × 3000 |
| `img.width` / `img.height` | 화면에 **표시된** 크기 (CSS `max-h-[60vh]`로 축소됨) | 400 × 300 |

이 경우 `scaleX = 4000 / 400 = 10`. 즉 화면에서 1px은 원본에서 10px이다.

**구체적 예시**:
```
사용자가 화면에서 그린 crop:  x=50, y=30, width=80, height=80
                                    │
                          × scaleX(10), scaleY(10)
                                    ▼
원본에 적용할 crop:          x=500, y=300, width=800, height=800
```

---

### 2-5. 왜 좌표 변환이 필요한가

만약 변환을 빼먹으면?

```
화면 crop:  x=50, y=30, w=80, h=80  (화면 400px 기준)
            ↓ 변환 없이 그대로 원본(4000px)에 적용
원본 crop:  x=50, y=30, w=80, h=80  ← 원본 4000px 중 좌상단 귀퉁이 80px만 잘림!
```

사용자가 사진 중앙의 글자를 선택했는데, 실제로는 **좌상단 귀퉁이의 엉뚱한 작은 조각**이 잘린다.

**근본 원인**: 모바일 카메라 원본은 4000×3000처럼 크지만, 모바일 화면은 좁아서 CSS로 축소해 보여준다(`max-h-[60vh] max-w-full object-contain`). 사용자가 보고 만지는 좌표는 "축소된 화면 좌표"인데, Canvas로 잘라낼 때는 "원본 픽셀 좌표"가 필요하다. **두 좌표계 사이의 비율(scale)을 곱해서 변환**해야 한다.

이것이 `react-image-crop`이 주는 `PixelCrop`을 그대로 `createCroppedImageBlob`에 넘기지 않고, 중간에 scaleX/scaleY 변환을 거치는 이유다.

**쓰이는 곳**: `ImageCropperModal.tsx:38-47`

---

### 2-6. react-easy-crop vs react-image-crop — 모델의 차이

| 항목 | react-easy-crop (초안) | react-image-crop (교체 후) |
|------|----------------------|--------------------------|
| **crop 모델** | 고정된 영역, **이미지를 움직임** | **영역(사각형)을 직접 그림** |
| 영역 크기 조절 | ❌ 불가 (영역 고정) | ✅ 꼭짓점/변 드래그 |
| 영역 위치 이동 | ❌ 이미지만 이동 | ✅ 영역을 드래그 |
| 비율 | aspect 고정 (1:1) | 자유 비율 |
| 확대/축소 | 핀치 줌 + 슬라이더 | 이미지 원본 크기 표시 (줌 컨트롤 없음) |
| 결과 | `PixelCrop { x,y,w,h }` | `PixelCrop { x,y,w,h }` (동일!) |

**두 모델의 사고방식 차이**:

```
react-easy-crop:  "구멍은 고정. 사진을 움직여서 원하는 부분을 구멍에 맞춰라"
                  → 인스타그램 프로필 사진 자르기 스타일

react-image-crop: "사진은 고정. 원하는 부분에 직접 네모를 그려라"
                  → Android 갤러리 / 윈도우 캡처 도구 스타일
```

`react-image-crop`의 코드 형태:
```tsx
// ImageCropperModal.tsx:81-95
<ReactCrop
  crop={crop}                            // 현재 그려진 영역
  onChange={(c) => setCrop(c)}           // 드래그 중 실시간 업데이트
  onComplete={(c) => setCompletedCrop(c)} // 드래그 끝났을 때 최종 영역
  minWidth={30}                          // 너무 작은 crop 방지
  minHeight={30}
>
  <img ref={imgRef} src={imageSrc} ... />  {/* crop 대상 이미지를 자식으로 감쌈 */}
</ReactCrop>
```

`crop`(실시간)과 `completedCrop`(드래그 종료) 두 상태를 나눠 갖는 이유: 화면 표시는 매 순간 부드럽게(`crop`), 실제 잘라내기 계산은 드래그가 끝난 최종 값(`completedCrop`)으로 한다.

**쓰이는 곳**: `ImageCropperModal.tsx:25-26`(상태), `81-95`(컴포넌트)

---

### 2-7. 왜 crop UX를 교체했는가

핵심은 **제품의 본질**이다.

타이포로그는 "간판/포스터 같은 실제 환경에서 **특정 글자 하나**를 찾아 잘라내는" 앱이다. 사진 속 글자는:
- 크기가 제각각 (작은 간판 글자 ~ 큰 포스터 글자)
- 위치가 제각각 (구석, 중앙, 기울어짐)
- 주변에 다른 글자/배경이 섞여 있음

**고정 정사각형(react-easy-crop)의 한계**:
- 작은 글자를 잡으려면 이미지를 한참 확대하고 위치를 맞춰야 함
- 정사각형 비율이 글자 모양과 안 맞음 ("ㅣ"는 세로로 길고 "ㅡ"는 가로로 김)
- 정밀 조절이 번거로움 → **핵심 플로우의 마찰**

**자유 영역(react-image-crop)의 적합성**:
- 글자에 딱 맞게 네모를 그리면 끝
- 꼭짓점을 당겨 미세 조절
- 글자 비율에 맞는 자유 크기

QA 리뷰(`phase1-day4-qa-review.md`)는 이를 **"MVP 핵심 플로우에 직접 영향"**으로 분류했다. 부가 기능이 아니라 제품의 심장이라 즉시 교체가 정당화됐다.

**교훈**: 기술 선택은 "더 좋은 라이브러리"가 아니라 "제품이 사용자에게 시키려는 동작"에 맞춰야 한다. 실기기 테스트 전까지는 두 방식의 차이가 드러나지 않았다.

---

### 2-8. 비동기 이미지 로딩 — new Image() + onload를 Promise로 감싸기

Canvas로 그리려면 먼저 이미지가 **완전히 로드**되어야 한다. 이미지 로딩은 비동기인데, 브라우저의 `Image` API는 콜백 기반이라 `await`로 쓸 수 없다. 그래서 **Promise로 감싼다**.

```typescript
// crop-image.ts:8-15
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)                              // 로드 성공 → resolve
    img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다"))  // 실패 → reject
    img.src = src   // ← src를 마지막에 설정 (핸들러 먼저 등록 후)
  })
}
```

**이 패턴의 3가지 포인트**:

1. **콜백 → Promise 변환**: `onload`/`onerror`라는 콜백을 `resolve`/`reject`로 연결하면 `await loadImage(src)`로 깔끔하게 쓸 수 있다.

2. **src를 마지막에 설정하는 이유**: 캐시된 이미지는 `img.src = src` 즉시 `onload`가 발생할 수 있다. 핸들러를 먼저 등록하지 않으면 놓친다. **"핸들러 등록 → src 설정" 순서가 중요.**

3. **에러 처리**: 깨진 URL, revoke된 Object URL 등에서 `onerror`가 발생한다. 이걸 `reject`로 연결해야 `createCroppedImageBlob`의 `try/catch`가 잡을 수 있다.

사용처:
```typescript
// crop-image.ts:21
const image = await loadImage(imageSrc)   // 로드 완료를 기다린 후
ctx.drawImage(image, ...)                  // 그린다
```

> **테스트로 검증됨**: `crop-image.test.ts:20-56`에서 `Image`를 mock해서 onload→resolve, onerror→reject를 검증한다.

**쓰이는 곳**: `crop-image.ts:8-15`(정의), `crop-image.ts:21`(사용)

---

### 2-9. image/png vs image/webp — crop 결과 포맷

현재 crop 결과는 **PNG**로 생성된다.

```typescript
// crop-image.ts:48
canvas.toBlob((blob) => { ... }, "image/png")
```

| 포맷 | 용량 | 투명도 | 호환성 |
|------|------|--------|--------|
| **PNG** | 큼 (무손실 + 알파 채널) | 지원 | 모든 브라우저 |
| **WebP** | 작음 (PNG 대비 2~5배 절약) | 지원 | Chrome/Android 완벽, Safari는 일부 버전 fallback 필요 |

**계획서는 WebP였는데 왜 지금 PNG인가?** QA 리뷰(H-01)가 명확히 답한다:

1. **Phase 1은 서버 업로드가 없다.** 로컬 Object URL로만 쓰므로 용량 절감의 실익이 없다. (네트워크로 안 나감)
2. **WebP 전환은 한 줄**(`canvas.toBlob(cb, "image/webp", 0.85)`)이지만, **Safari 호환성 체크**가 필요하다. Safari 일부 버전은 `toBlob`에서 WebP를 지원하지 않아 PNG로 조용히 fallback된다.
3. **Phase 2 Supabase Storage 연동 시** 이미지 최적화 파이프라인과 함께 처리하는 것이 적절하다.

즉 "지금 PNG"는 게으름이 아니라 **의도적 미루기(deferral)**다. 용량이 의미를 갖는 시점(서버 업로드)에 호환성까지 챙겨서 전환한다.

**WebP의 두 번째 인자 `0.85`**: 품질(0~1). PNG는 무손실이라 품질 인자가 없지만, WebP는 손실 압축이라 품질을 지정한다. 0.85는 "용량과 화질의 균형점"으로 흔히 쓰인다.

**쓰이는 곳**: `crop-image.ts:48`

---

### 2-10. crop 단계에서의 Object URL lifecycle — 이중 관리

Day 3에서는 Object URL이 **하나**였다 (선택한 이미지 → 슬롯). Day 4에서는 **두 종류**가 된다:

```
1. cropSourceUrl  — crop 모달에 보여줄 "원본 사진" URL (잠깐 쓰고 버림)
2. croppedUrl     — crop 완료 후 "잘라낸 이미지" URL (슬롯에 오래 표시)
```

**두 URL의 생명주기가 다르다**:

```
[원본 URL: cropSourceUrl]
  생성: 파일 선택 시 (handleFileSelected)
  용도: crop 모달에서 잘라낼 대상으로 표시
  해제: crop 확인 직후 OR crop 취소 시 (역할 끝나면 바로 버림)

[잘라낸 URL: croppedUrl]
  생성: crop 확인 시 (handleCropConfirm)
  용도: 슬롯에 미리보기로 오래 표시
  해제: 같은 슬롯 교체 시(oldUrl) OR 챌린지 변경/언마운트 시
```

**코드로 보는 생성/해제**:

```typescript
// handleFileSelected — 원본 URL 생성 (CaptureClient.tsx:83-85)
const url = URL.createObjectURL(file)
cropSourceUrlRef.current = url   // ref로 추적
setCropSourceUrl(url)            // state로 렌더링

// handleCropConfirm — 잘라낸 URL 생성 + 원본 URL 해제 (CaptureClient.tsx:96-107)
const oldUrl = objectUrlsRef.current.get(activeSlotIndex)
if (oldUrl) URL.revokeObjectURL(oldUrl)              // 이전 슬롯 이미지 해제
const croppedUrl = URL.createObjectURL(croppedBlob)  // 새 잘라낸 URL 생성
objectUrlsRef.current.set(activeSlotIndex, croppedUrl)
fillSlot(activeSlotIndex, croppedUrl)
if (cropSourceUrlRef.current) {
  URL.revokeObjectURL(cropSourceUrlRef.current)      // 원본 URL은 역할 끝 → 해제
  cropSourceUrlRef.current = null
}
```

**왜 ref와 state를 둘 다 쓰나?** (`cropSourceUrl` state + `cropSourceUrlRef`)
- `state`(`cropSourceUrl`): 렌더링에 필요 (모달의 `imageSrc`로 전달)
- `ref`(`cropSourceUrlRef.current`): cleanup 시점에 **최신 값을 정확히 참조**하기 위해. state는 클로저에 캡처된 옛 값일 수 있지만 ref는 항상 현재 값을 가리킨다. (Day 3 "cleanup에서 ref 캡처" 실수와 동일한 원리)

**세 가지 해제 시점이 빠짐없이 처리됨** (QA 체크포인트 4,5,6):
- crop 확인 → 원본 해제, 이전 슬롯 이미지 해제
- crop 취소 → 원본 해제
- 챌린지 변경/언마운트 → 슬롯 전체 + 원본 해제 (useEffect cleanup, `CaptureClient.tsx:41-52`)

**쓰이는 곳**: `CaptureClient.tsx:30,33`(상태/ref), `79-121`(핸들러들), `41-52`(cleanup)

---

### 2-11. crop 취소/교체 시 슬롯 상태 처리 주의점

채워진 슬롯을 다시 눌러 교체하려다 취소하는 흐름에서, **기존 이미지를 실수로 지우면 안 된다.**

```typescript
// handleCropCancel (CaptureClient.tsx:113-121)
const handleCropCancel = useCallback(() => {
  if (cropSourceUrlRef.current) {
    URL.revokeObjectURL(cropSourceUrlRef.current)  // 원본 URL만 해제
    cropSourceUrlRef.current = null
  }
  setCropSourceUrl(null)
  setCropperOpen(false)
  deselectSlot()              // ← 선택만 해제, clearSlot은 호출 안 함!
}, [deselectSlot])
```

**핵심**: `deselectSlot()`(선택 해제)은 호출하지만 `clearSlot()`(이미지 삭제)은 호출하지 **않는다**. 그래서 채워진 슬롯을 교체하려다 취소해도 **기존 이미지가 그대로 유지**된다. (QA 리뷰 H-02, 체크포인트 9에서 "동작 올바름"으로 확정)

**또 하나의 주의점: 전환 중 의도치 않은 deselect 방지**

Sheet에서 Cropper로 넘어갈 때, Sheet가 닫히면서 `onOpenChange(false)`가 호출되고, 그 안에서 `deselectSlot()`이 불릴 수 있다. 그러면 crop을 시작하기도 전에 `activeSlotIndex`가 null이 되어 어느 슬롯에 저장할지 잃어버린다.

이를 막기 위해 **전환 플래그**를 둔다:

```typescript
// handleFileSelected (CaptureClient.tsx:82)
transitionToCropperRef.current = true   // "지금은 Cropper로 넘어가는 중"
setSheetOpen(false)
setCropperOpen(true)

// handleSheetOpenChange (CaptureClient.tsx:68-77)
const handleSheetOpenChange = useCallback((open: boolean) => {
  setSheetOpen(open)
  if (!open && !transitionToCropperRef.current) {  // 전환 중이 아닐 때만 deselect
    deselectSlot()
  }
  transitionToCropperRef.current = false           // 플래그 리셋
}, [deselectSlot])
```

전환 중이면 deselect를 건너뛴다. 덕분에 Sheet→Cropper 전환에서 `activeSlotIndex`가 보존된다.

**추가 가드**: crop 중에는 다른 슬롯 탭을 무시한다.
```typescript
// handleSlotTap (CaptureClient.tsx:56)
if (cropperOpen) return   // crop 모달 떠있으면 슬롯 탭 무시
```

**쓰이는 곳**: `CaptureClient.tsx:34`(플래그), `68-77`(Sheet 핸들러), `113-121`(취소), `56`(가드)

---

### 2-12. Day 3 → Day 4 데이터 흐름

Day 3의 흐름에 **crop 단계가 중간에 삽입**된다.

```
Day 3 (crop 없음):
  File → URL.createObjectURL → fillSlot → <img src={objectUrl}>

Day 4 (crop 삽입):
  File
   │ URL.createObjectURL(file)
   ▼
  cropSourceUrl  ──────────────→  ImageCropperModal (ReactCrop)
                                    │ 사용자가 영역을 그림
                                    ▼
                                  completedCrop { x,y,w,h }  (화면 좌표)
                                    │ × scaleX, scaleY
                                    ▼
                                  pixelCrop { x,y,w,h }  (원본 좌표)
                                    │ createCroppedImageBlob()
                                    │   loadImage → Canvas → drawImage(9인자) → toBlob("png")
                                    ▼
                                  croppedBlob
                                    │ URL.createObjectURL(blob)
                                    ▼
                                  croppedUrl  →  fillSlot  →  <img src={croppedUrl}>
                                    
  (cropSourceUrl은 여기서 revoke되어 사라짐)
```

**전체 단계 풀어쓰기**:

1. **파일 선택**: Sheet에서 카메라/갤러리로 File 획득
2. **원본 URL 생성**: `URL.createObjectURL(file)` → `cropSourceUrl`
3. **Cropper 열기**: Sheet 닫고 모달 열기 (전환 플래그로 deselect 방지)
4. **영역 그리기**: 사용자가 ReactCrop으로 사각형을 그림 → `completedCrop` (화면 좌표)
5. **좌표 변환**: `scaleX/scaleY` 곱해서 원본 좌표 `pixelCrop`으로 변환
6. **Canvas crop**: `createCroppedImageBlob` — 이미지 로드 → Canvas drawImage → toBlob
7. **잘라낸 URL 생성**: `URL.createObjectURL(croppedBlob)` → `croppedUrl`
8. **슬롯 저장**: `fillSlot(index, croppedUrl)` → 슬롯에 미리보기 표시
9. **원본 URL 해제**: `cropSourceUrl`은 역할 끝 → `revokeObjectURL`

**핵심**: Store(`fillSlot`)는 Day 3과 똑같이 "string URL을 받아 저장"만 한다. 바뀐 건 그 URL이 "원본 사진"에서 "잘라낸 이미지"로 바뀐 것뿐. **인터페이스 경계가 안정적이라 Store와 슬롯 컴포넌트는 무변경.**

---

## 3. 이 프로젝트에서 개념이 쓰인 파일

| 개념 | 파일:줄 |
|------|---------|
| Canvas 생성 + getContext | `crop-image.ts:23-28` |
| drawImage 9개 인자 | `crop-image.ts:30-40` |
| toBlob("image/png") | `crop-image.ts:42-50` |
| loadImage Promise 패턴 | `crop-image.ts:8-15` (정의), `:21` (사용) |
| scaleX/scaleY 좌표 변환 | `ImageCropperModal.tsx:38-47` |
| ReactCrop 컴포넌트 + 상태 | `ImageCropperModal.tsx:25-26`, `81-95` |
| crop 결과 → Blob → 슬롯 | `ImageCropperModal.tsx:31-57` (handleSave) |
| 원본/잘라낸 Object URL 이중 관리 | `CaptureClient.tsx:30,33`, `79-121` |
| useEffect cleanup (전체 해제) | `CaptureClient.tsx:41-52` |
| 전환 플래그 (deselect 방지) | `CaptureClient.tsx:34`, `68-77`, `82` |
| crop 취소 시 슬롯 보존 | `CaptureClient.tsx:113-121` |
| crop 중 슬롯 탭 가드 | `CaptureClient.tsx:56` |
| 좌표/에러 경로 테스트 | `crop-image.test.ts:77-117` |
| UX 교체 배경 | `docs/reviews/day4-crop-ux-feedback.md` |
| PNG/WebP, deselect 판정 | `docs/reviews/phase1-day4-qa-review.md` (H-01, H-02) |

---

## 4. 자주 하는 실수

### 실수 1: 좌표 변환을 빼먹는다 (가장 흔함)

```typescript
// 나쁜 예 — 화면 좌표를 그대로 원본에 적용
const blob = await createCroppedImageBlob(imageSrc, completedCrop)
// → 4000px 원본 중 좌상단 작은 조각만 잘림. 사용자가 고른 영역과 전혀 다름

// 좋은 예 — scaleX/scaleY로 변환
const scaleX = img.naturalWidth / img.width
const scaleY = img.naturalHeight / img.height
const pixelCrop = {
  x: Math.round(completedCrop.x * scaleX),
  y: Math.round(completedCrop.y * scaleY),
  width: Math.round(completedCrop.width * scaleX),
  height: Math.round(completedCrop.height * scaleY),
}
```

증상: "내가 고른 글자가 아니라 사진 귀퉁이가 잘려요." → 100% 좌표 변환 누락이다.

### 실수 2: Object URL 누수 (특히 crop은 URL이 2개)

```typescript
// 나쁜 예 — 원본 URL을 만들고 crop 후 안 버림
const url = URL.createObjectURL(file)   // cropSourceUrl
// ... crop 완료 후 croppedUrl만 관리하고 원본 url은 방치
// → 사진 6장 × 원본 URL이 메모리에 쌓임

// 좋은 예 — 원본 URL은 역할 끝나면 즉시 revoke
if (cropSourceUrlRef.current) {
  URL.revokeObjectURL(cropSourceUrlRef.current)
  cropSourceUrlRef.current = null
}
```

crop은 URL이 2종류(원본 + 잘라낸 것)라 Day 3보다 누수 위험이 높다. **원본은 짧게, 잘라낸 것은 길게** 산다는 걸 기억.

### 실수 3: Canvas CORS 오염 (tainted canvas)

다른 도메인의 이미지를 Canvas에 그린 뒤 `toBlob`을 호출하면 **보안 에러(tainted canvas)**가 난다. 이 프로젝트는 같은 출처의 Object URL(`blob:`)만 쓰므로 안전하지만, 만약 외부 URL 이미지를 crop하게 되면:

```typescript
const img = new Image()
img.crossOrigin = "anonymous"   // CORS 허용 헤더가 있는 이미지에 필요
img.src = externalUrl
```

증상: `toBlob`에서 `SecurityError: tainted canvas`. 현재는 발생 경로 없음이지만 Phase 2에서 Supabase Storage URL을 crop하게 되면 주의.

### 실수 4: toBlob의 null을 처리하지 않는다

```typescript
// 나쁜 예 — null 가능성 무시
canvas.toBlob((blob) => resolve(blob))   // blob이 null이면 undefined resolve

// 좋은 예 — null 방어
canvas.toBlob((blob) => {
  if (blob) resolve(blob)
  else reject(new Error("이미지를 생성할 수 없습니다"))
}, "image/png")
```

메모리 부족, 너무 큰 캔버스 등에서 `null`이 올 수 있다. `crop-image.test.ts:103-109`가 이 경로를 검증한다.

### 실수 5: 이미지 로드 완료 전에 drawImage 호출

```typescript
// 나쁜 예 — 로드 안 기다리고 바로 그림
const img = new Image()
img.src = src
ctx.drawImage(img, ...)   // 아직 로드 안 됨 → 빈 이미지 그려짐

// 좋은 예 — await loadImage로 완료 보장
const image = await loadImage(src)
ctx.drawImage(image, ...)
```

### 실수 6: getContext의 null을 무시

```typescript
const ctx = canvas.getContext("2d")
ctx.drawImage(...)   // ctx가 null이면 런타임 크래시

// 좋은 예
const ctx = canvas.getContext("2d")
if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다")
```

---

## 5. 모바일 실기기 테스트 체크리스트

### Crop 영역 그리기/조절 (교체된 UX의 핵심)
- [ ] 이미지 위에 손가락으로 사각형을 **새로 그릴** 수 있는가
- [ ] 사각형의 **꼭짓점**을 드래그해 크기 조절되는가
- [ ] 사각형의 **변(모서리)**을 드래그해 크기 조절되는가
- [ ] 사각형 **안쪽**을 드래그해 위치 이동되는가
- [ ] 자유 비율로 가로/세로 다르게 그릴 수 있는가 (1:1 강제 아님)
- [ ] `minWidth/minHeight`(30px) 이하로는 안 줄어드는가

### 좌표 정확도 (변환 검증)
- [ ] 화면에서 고른 글자가 **정확히 그 글자**로 잘리는가 (귀퉁이 아님)
- [ ] 큰 원본(4000×3000)에서도 고른 영역과 결과가 일치하는가
- [ ] 사진 중앙/구석 등 다양한 위치의 글자가 정확히 잘리는가

### 큰 원본 처리 (성능)
- [ ] Android 카메라 12MP+ 원본 crop 시 프리즈 없는가 (drawImage는 동기 작업)
- [ ] "이 글자로 저장" 누른 후 멈춤/지연이 1초 이내인가
- [ ] 큰 이미지에서 crop 영역 드래그가 버벅이지 않는가

### 핀치 줌 / 터치 충돌
- [ ] crop 영역 드래그 중 브라우저 전체 줌이 안 되는가
- [ ] crop 영역 밖(버튼 영역)에서 실수로 viewport 줌되지 않는가 (iOS Safari, M-04)
- [ ] 터치 제스처가 crop 조작과 충돌하지 않는가

### 교체/취소 플로우
- [ ] 채운 슬롯 재탭 → 새 이미지 crop → 저장 → 이전 이미지 교체되는가
- [ ] 채운 슬롯 재탭 → 이미지 선택 → **crop 취소** → 기존 이미지 **유지**되는가 (H-02)
- [ ] crop 취소 시 슬롯 선택이 해제되는가 (clearSlot은 안 됨)
- [ ] crop 중 다른 슬롯 탭이 무시되는가 (cropperOpen 가드)

### 메모리
- [ ] 사진 6장 crop 저장 후 DevTools Memory에서 원본 URL이 해제됐는가
- [ ] 같은 슬롯 여러 번 교체 후 이전 잘라낸 URL이 해제됐는가
- [ ] 새로고침 후 슬롯이 비어 있는가 (Object URL은 persist 안 됨, Day 3)

### iOS Safari 특이사항
- [ ] crop 모달 헤더가 노치/상태바에 가려지지 않는가 (현재 safe-area 없음, D-04)
- [ ] "이 글자로 저장" 후 모달이 깔끔히 닫히는가

### 에러
- [ ] crop 실패 시 "이미지 자르기에 실패했습니다" 메시지가 뜨는가
- [ ] 에러 후 다시 저장 버튼을 누를 수 있는가

---

## 6. 다음 작업 전에 이해하면 좋은 개념

Day 5(WebP 전환·EXIF·슬롯 복원)와 콜라주 Preview를 앞두고:

| 개념 | 왜 필요한가 | 핵심 |
|------|------------|------|
| **WebP 호환성 fallback** | Safari 일부 버전이 `toBlob` WebP 미지원 | 변환 후 `blob.type` 확인하거나 기능 감지 |
| **`canvas.toBlob` 품질 인자** | WebP 손실 압축의 화질/용량 균형 | `toBlob(cb, "image/webp", 0.85)` |
| **EXIF strip 검증** | 프라이버시(GPS 제거) | Canvas re-draw로 자동 제거됨 — 명시적 검증 필요 (D-02) |
| **이미지 리사이즈** | 큰 원본 성능/용량 | crop 전 Canvas로 다운스케일 (D-06) |
| **IndexedDB** | 새로고침 후 이미지 복원 | localStorage는 작아서 Blob 저장 불가 (D-05) |
| **여러 이미지 Canvas 합성** | 콜라주 = 글자 6개를 한 캔버스에 배치 | `drawImage`를 6번 호출, 격자 좌표 계산 |
| **viewport meta** | iOS crop 중 브라우저 줌 방지 | `user-scalable=no` (전체 앱 영향, 신중히, D-03) |
| **safe-area-inset** | 노치 기기에서 헤더 가림 방지 | `pt-safe-top` (D-04) |

**콜라주 Preview로 가는 연결고리**: Day 4에서 배운 Canvas `drawImage`가 콜라주의 토대다. crop은 "1개 이미지에서 1개 영역을 잘라 1개 캔버스"였다면, 콜라주는 "6개 이미지를 1개 캔버스의 격자에 배치"다. `drawImage`를 6번 호출하고 각 글자의 destination 좌표(dx, dy)를 격자에 맞게 계산하면 된다. 그리고 최종 콜라주도 `toBlob`으로 PNG/WebP 추출 → 다운로드한다.

> 관련 개념의 상세 설명은 `docs/learning/learning-first-roadmap.md`의 Phase 1(#11 Canvas, #13 EXIF)과 Phase 5(성능)를 참고.
