# Phase 1 Day 3 — 카메라/갤러리 이미지 선택 학습 노트

> 커밋: `99c5eb9` feat: add camera/gallery image picker with bottom sheet

---

## 1. 오늘 구현한 기능 요약

슬롯을 터치하면 **바텀 시트**가 올라오고, "카메라로 찍기" 또는 "갤러리에서 선택"을 고를 수 있다.
사진을 선택하면 해당 슬롯에 **미리보기 이미지**가 들어간다.

아직 크롭(자르기)은 없다 — 사진 원본 그대로 슬롯에 표시된다.
이미지 크롭은 Day 4에서 구현한다.

**Day 2와 달라진 점**:
- `ImagePickerSheet` 컴포넌트 추가 (바텀 시트 + 숨겨진 file input 2개)
- `CaptureClient`에 Blob URL 생명주기 관리 추가
- Zustand persist에 `partialize` 추가 — `challengeId`만 저장하고 이미지는 저장하지 않음
- Store 테스트 17개 추가

---

## 2. 핵심 개념 설명

### 2-1. `<input type="file">` — 파일 선택의 출발점

브라우저에서 사용자의 파일에 접근하는 **유일한 공식 방법**이다.

```html
<input type="file" accept="image/*" />
```

이 input을 화면에 직접 보여줄 수도 있지만, 대부분의 모바일 앱처럼 **숨기고 버튼 클릭으로 대신 열어준다**:

```tsx
const inputRef = useRef<HTMLInputElement>(null)

<Button onClick={() => inputRef.current?.click()}>
  갤러리에서 선택
</Button>
<input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
```

**왜 숨기나?** `<input type="file">`의 기본 UI가 못생겼기 때문이다. 브라우저마다 다르게 생겼고, CSS로 자유롭게 꾸밀 수 없다. 그래서 숨기고(`hidden`), 예쁜 `<Button>`을 대신 보여주고, 클릭 시 `ref.current?.click()`으로 숨겨진 input을 프로그래밍적으로 열어준다.

**쓰이는 파일**: `ImagePickerSheet.tsx:76-90` — 숨겨진 input 2개

---

### 2-2. `accept="image/*"` — 파일 타입 필터

```html
<input type="file" accept="image/*" />
```

`accept`는 **파일 선택 다이얼로그에서 보여줄 파일 유형을 제한**한다.

| accept 값 | 효과 |
|-----------|------|
| `image/*` | 모든 이미지 (JPEG, PNG, WebP, HEIC 등) |
| `image/jpeg` | JPEG만 |
| `.pdf` | PDF만 |
| `video/*` | 비디오만 |
| 생략 | 모든 파일 (위험!) |

**주의: accept는 "권장"이지 "강제"가 아니다.** 사용자가 파일 탐색기에서 필터를 바꾸면 다른 타입도 선택할 수 있다. 그래서 코드에서도 한 번 더 검사한다:

```typescript
function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  if (!file.type.startsWith("image/")) return  // ← 이중 안전장치
  onImageSelected(file)
}
```

**쓰이는 파일**: `ImagePickerSheet.tsx:78,86`

---

### 2-3. `capture="environment"` — 모바일 카메라 직접 열기

```html
<!-- 카메라 input -->
<input type="file" accept="image/*" capture="environment" />

<!-- 갤러리 input -->
<input type="file" accept="image/*" />
```

`capture` 속성은 **모바일 기기에서 파일 선택 대신 카메라를 바로 여는 힌트**이다.

| capture 값 | 의미 | 모바일에서의 동작 |
|------------|------|-----------------|
| `"environment"` | 후면(바깥) 카메라 | 카메라 앱이 바로 열림 |
| `"user"` | 전면(셀카) 카메라 | 셀카 카메라가 열림 |
| 생략 | 카메라 힌트 없음 | 갤러리/파일 선택기가 열림 |

**타이포로그에서 두 개의 input을 쓰는 이유**:

하나의 `<input>`으로는 "카메라"와 "갤러리"를 선택지로 동시에 제공할 수 없다. `capture`가 있으면 카메라가 바로 열리고, 없으면 갤러리가 열리니까, **각각 다른 input에 연결한다**:

```
"카메라로 찍기" 버튼 → cameraInputRef → <input capture="environment">  → 카메라 실행
"갤러리에서 선택" 버튼 → galleryInputRef → <input>                      → 갤러리 실행
```

두 input 모두 같은 `handleFileChange`를 사용한다 — 어떤 경로로 사진이 오든 처리 로직은 동일하다.

**쓰이는 파일**: `ImagePickerSheet.tsx:54,62` (버튼 onClick), `ImagePickerSheet.tsx:76-90` (input 2개)

---

### 2-4. iOS Safari vs Android Chrome 동작 차이

같은 HTML이지만 **OS마다 동작이 다르다**. 이건 외워야 하는 게 아니라 실기기에서 테스트해서 확인해야 한다.

| 동작 | iOS Safari | Android Chrome |
|------|-----------|----------------|
| `capture="environment"` | 카메라 바로 열림 | 카메라 바로 열림 |
| `capture` 생략 | "사진 찍기 / 사진 보관함 / 파일 선택" 3가지 선택지 | 갤러리/파일 탐색기 열림 (카메라 선택지 포함될 수도) |
| `accept="image/*"` | 이미지만 필터 | 이미지만 필터 |
| 사진 촬영 후 결과 | JPEG (HEIC는 브라우저가 자동 변환) | JPEG |
| 갤러리 선택 결과 | HEIC/JPEG/PNG 등 원본 포맷 | JPEG/PNG/WebP |
| 파일 크기 | 원본 그대로 (수 MB~수십 MB) | 원본 그대로 |
| EXIF 포함 여부 | GPS, 방향 등 포함 | GPS, 방향 등 포함 |

**핵심 차이**: iOS Safari에서 `capture` 없이 `<input type="file" accept="image/*">`만 쓰면, OS가 자체적으로 **카메라/갤러리/파일 중 선택하는 팝업**을 보여준다. 즉 iOS에서는 굳이 두 개의 input을 만들지 않아도 선택지가 나온다. 하지만 Android에서는 이 동작이 일관되지 않으므로, **두 개의 input으로 명시적으로 분리하는 것이 가장 안전하다**.

**실기기 테스트가 필수인 이유**: `capture` 속성의 동작은 기기, OS 버전, 브라우저마다 미묘하게 다르다. 시뮬레이터만으로는 카메라 동작을 테스트할 수 없다.

---

### 2-5. File 객체 — 브라우저가 주는 파일 정보

사용자가 사진을 선택하면 `onChange` 이벤트에서 `File` 객체를 받는다:

```typescript
function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]  // File 객체
}
```

`File` 객체에는 이런 정보가 들어 있다:

| 속성 | 예시 | 용도 |
|------|------|------|
| `file.name` | `"IMG_1234.jpg"` | 파일 이름 (참고용) |
| `file.type` | `"image/jpeg"` | MIME 타입 (유효성 검사) |
| `file.size` | `3145728` | 바이트 단위 크기 (업로드 제한) |
| `file.lastModified` | `1716700800000` | 마지막 수정 시간 |

**File은 Blob을 상속한다**:
```
Blob (바이너리 데이터 덩어리)
  └── File (Blob + name + lastModified)
```

그래서 `File`을 `Blob`이 필요한 곳에 그대로 쓸 수 있다. `URL.createObjectURL(file)`이 가능한 이유가 바로 이것이다.

**쓰이는 파일**: `ImagePickerSheet.tsx:31` (`e.target.files?.[0]`), `CaptureClient.tsx:65` (`handleImageSelected(file: File)`)

---

### 2-6. Blob — 바이너리 데이터 덩어리

**Blob(Binary Large Object)**은 텍스트가 아닌 데이터(이미지, 비디오, 오디오 등)를 자바스크립트에서 다루기 위한 객체이다.

지금 단계에서는 "File이 곧 Blob"이라고 이해하면 충분하다. Day 4에서 Canvas 크롭을 하면 `canvas.toBlob()`이 나오는데, 그때 File이 아닌 **순수 Blob**을 다루게 된다.

**Day 3에서의 Blob 흐름**:
```
카메라/갤러리 선택 → File(=Blob) → URL.createObjectURL(file) → "blob:..." URL → <img src>
```

**Day 4에서 추가될 흐름**:
```
File → Canvas에 그리기 → 영역 선택 → canvas.toBlob() → 순수 Blob → URL.createObjectURL(blob)
```

---

### 2-7. `URL.createObjectURL()` — Blob에 임시 주소 붙이기

이미지를 `<img>` 태그에 표시하려면 **URL**이 필요하다. 하지만 사용자가 방금 찍은 사진은 서버에 없고, 브라우저 메모리에만 있다.

`URL.createObjectURL()`은 **메모리의 Blob에 대한 임시 URL을 만들어준다**:

```typescript
const file = e.target.files[0]                    // File (= Blob)
const objectUrl = URL.createObjectURL(file)        // "blob:http://localhost:3000/abc-123"
```

이 URL은 브라우저 메모리에만 존재한다. 서버에 보낼 수 없고, 다른 브라우저 탭에서 열 수도 없다. 페이지를 닫으면 사라진다.

**비유**: 놀이공원 물품 보관함. 짐(Blob)을 맡기면 보관함 번호(URL)를 준다. 그 번호로 찾아갈 수 있지만, 놀이공원(브라우저) 밖에서는 의미가 없다.

**쓰이는 파일**: `CaptureClient.tsx:71` (`URL.createObjectURL(file)`)

---

### 2-8. `URL.revokeObjectURL()` — 임시 주소 해제 (메모리 반환)

**Object URL은 명시적으로 해제하지 않으면 메모리에 계속 남는다.**

모바일 사진 한 장이 3~10MB이다. 6개 슬롯에 사진을 넣고, 다시 찍어서 교체하고, 다시 교체하면... Object URL을 해제하지 않으면 사진이 **쌓인다**.

```typescript
// 슬롯의 이미지를 교체할 때: 이전 URL 해제 → 새 URL 생성
const oldUrl = objectUrlsRef.current.get(activeSlotIndex)
if (oldUrl) URL.revokeObjectURL(oldUrl)      // ← 이전 이미지 메모리 반환
const objectUrl = URL.createObjectURL(file)   // ← 새 이미지에 URL 부여
```

**비유**: 물품 보관함 번호를 반납하는 것. 반납하지 않으면 보관함(메모리)이 꽉 찬다.

**쓰이는 파일**: `CaptureClient.tsx:69` (교체 시 해제), `CaptureClient.tsx:37-39` (컴포넌트 정리 시 전체 해제)

---

### 2-9. Object URL Cleanup — 세 가지 해제 시점

이 프로젝트에서 Object URL을 해제하는 시점은 **세 곳**이다:

#### 시점 1: 이미지 교체 시

같은 슬롯에 새 사진을 넣으면, **이전 사진의 Object URL을 먼저 해제**한다.

```typescript
// CaptureClient.tsx:68-72
const oldUrl = objectUrlsRef.current.get(activeSlotIndex)
if (oldUrl) URL.revokeObjectURL(oldUrl)
const objectUrl = URL.createObjectURL(file)
objectUrlsRef.current.set(activeSlotIndex, objectUrl)
```

#### 시점 2: 챌린지 변경 시 (useEffect cleanup)

다른 날의 챌린지로 이동하면, 이전 챌린지의 **모든 Object URL을 한꺼번에 해제**한다.

```typescript
// CaptureClient.tsx:35-41
useEffect(() => {
  const urls = objectUrlsRef.current
  return () => {
    urls.forEach((url) => URL.revokeObjectURL(url))
    urls.clear()
  }
}, [challenge.id])
```

`return () => { ... }`은 **cleanup 함수**이다. React는 이 함수를:
- `challenge.id`가 바뀔 때 (이전 값에 대해)
- 컴포넌트가 화면에서 사라질 때 (unmount)

자동으로 호출한다.

#### 시점 3: 왜 `useRef`인가

```typescript
const objectUrlsRef = useRef<Map<number, string>>(new Map())
```

`useState` 대신 `useRef`를 쓰는 이유: Object URL Map은 **UI에 표시할 데이터가 아니다**. 변경되어도 리렌더링이 필요 없다. `useState`로 관리하면 URL을 추가/삭제할 때마다 불필요한 리렌더링이 발생한다.

**규칙**:
- 화면에 보여줄 데이터 → `useState`
- 화면과 무관한 참조 데이터 (DOM ref, 타이머 ID, Object URL) → `useRef`

---

### 2-10. base64 imageDataUrl을 localStorage에 저장하면 위험한 이유

Day 2에서는 Zustand `persist`가 **모든 상태**를 localStorage에 저장했다:

```typescript
// Day 2
persist(storeLogic, { name: "typolog-challenge" })
// → localStorage에 slots 배열 전체 저장 (imageDataUrl 포함)
```

만약 `imageDataUrl`에 base64 인코딩된 이미지를 넣으면 어떻게 되나?

**base64 인코딩 = 원본 크기의 약 1.33배**

| 사진 원본 | base64 크기 | 6개 슬롯 합계 |
|-----------|------------|--------------|
| 3MB | ~4MB | **~24MB** |
| 5MB | ~6.7MB | **~40MB** |

**localStorage 용량 제한**: 브라우저마다 다르지만 보통 **5~10MB**이다.

```
24MB base64 이미지 > 5MB localStorage 제한 → 저장 실패 → 앱 크래시 가능
```

**Day 3의 해결책**: `partialize`로 저장 범위를 제한한다.

```typescript
// Day 3
persist(storeLogic, {
  name: "typolog-challenge",
  partialize: (state) => ({
    challengeId: state.challengeId,  // string 하나만 저장 (수 바이트)
  }),
})
```

이렇게 하면 `slots`, `activeSlotIndex`, `isComplete`, 그리고 **`imageDataUrl`**은 localStorage에 저장되지 않는다.

**트레이드오프**: 새로고침하면 진행 중이던 사진이 사라진다. 하지만 이건 의도된 결정이다 — Phase 2에서 서버에 이미지를 업로드하면 새로고침해도 유지된다.

**테스트로 검증됨**: `challenge-store.test.ts:186-211`에서 localStorage에 `blob:`이나 `imageDataUrl`이 포함되지 않는 것을 확인한다.

**쓰이는 파일**: `challenge-store.ts:78-83`

---

### 2-11. Zustand store에 임시 이미지 상태를 둘 때 주의할 점

현재 `LetterSlot.imageDataUrl`에는 `"blob:http://localhost:3000/abc-123"` 같은 **Object URL**이 들어간다.

**주의 1: Object URL은 세션 한정이다**

Object URL은 페이지가 살아 있는 동안만 유효하다. 새로고침하면 URL이 깨진다. 그래서 `partialize`로 persist 대상에서 제외한 것이다.

**주의 2: Object URL 해제 책임은 Store 밖에 있다**

Store의 `fillSlot()`은 Object URL을 **받아서 저장만** 한다. 해제(`revokeObjectURL`)는 **CaptureClient의 `objectUrlsRef`**가 담당한다. 이렇게 나눈 이유:

```
Store (challenge-store.ts)     → 데이터만 관리 (순수 상태)
CaptureClient (컴포넌트)       → 브라우저 리소스(Object URL) 생명주기 관리
```

Store가 직접 `URL.revokeObjectURL()`를 호출하면, Store가 브라우저 API에 의존하게 된다. 그러면 테스트할 때 브라우저 API를 mock해야 하고, Node.js 환경에서 테스트가 어려워진다.

**주의 3: Day 4 크롭 후 데이터 흐름이 바뀐다**

지금은 `File` → Object URL → Store이지만, 크롭을 도입하면:

```
지금 (Day 3):  File → Object URL → Store → <img src={objectUrl}>
나중 (Day 4):  File → Canvas → 크롭 → canvas.toBlob() → Object URL → Store → <img src={objectUrl}>
```

Store 입장에서는 둘 다 "string URL을 받는 것"이므로 Store는 변경할 필요가 없다. 바뀌는 건 CaptureClient의 `handleImageSelected` 로직뿐이다.

---

### 2-12. `e.target.value = ""` — 같은 파일을 다시 선택할 수 있게

```typescript
function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  if (!file.type.startsWith("image/")) return
  onImageSelected(file)
  e.target.value = ""  // ← 이것
}
```

**왜 필요한가?**

브라우저는 `<input type="file">`에 **이전에 선택한 파일**을 기억한다. 사용자가 같은 사진을 다시 선택하면, 값이 변하지 않으므로 `onChange` 이벤트가 **발생하지 않는다**.

`e.target.value = ""`로 input을 비우면, 다음에 같은 파일을 선택해도 "값이 비어있다 → 파일이 선택됨"으로 변경이 감지되어 `onChange`가 정상 실행된다.

**시나리오**: 사용자가 "오" 슬롯에 사진A를 넣었다가, 마음에 안 들어서 같은 사진A를 다시 선택하려 한다. `value = ""`가 없으면 아무 반응이 없다.

**쓰이는 파일**: `ImagePickerSheet.tsx:35`

---

## 3. 직접 확인해야 할 코드 파일

| 순서 | 파일 | 핵심 포인트 |
|------|------|------------|
| 1 | `src/features/challenge/ImagePickerSheet.tsx` | input 2개 구조, `capture`, `accept`, ref 패턴, value 리셋 |
| 2 | `src/features/challenge/CaptureClient.tsx:28,35-41,64-77` | `objectUrlsRef`, cleanup effect, `handleImageSelected` |
| 3 | `src/stores/challenge-store.ts:78-83` | `partialize` — 왜 `challengeId`만 persist하는지 |
| 4 | `tests/unit/challenge-store.test.ts:186-211` | persist 테스트 — localStorage에 blob URL이 없는지 검증 |

---

## 4. 자주 하는 실수

### 실수 1: Object URL을 해제하지 않는다

```typescript
// 나쁜 예 — 교체할 때 이전 URL을 해제하지 않음
const handleImageSelected = (file: File) => {
  const objectUrl = URL.createObjectURL(file)   // 새 URL 생성
  fillSlot(activeSlotIndex, objectUrl)           // 이전 URL은 메모리에 방치됨
}

// 좋은 예 — 이전 URL을 먼저 해제
const handleImageSelected = (file: File) => {
  const oldUrl = objectUrlsRef.current.get(activeSlotIndex)
  if (oldUrl) URL.revokeObjectURL(oldUrl)        // ← 메모리 반환
  const objectUrl = URL.createObjectURL(file)
  objectUrlsRef.current.set(activeSlotIndex, objectUrl)
  fillSlot(activeSlotIndex, objectUrl)
}
```

모바일 브라우저는 메모리가 제한적이다. 사진 6장을 3번씩 교체하면 18개의 Object URL이 메모리에 남는다 (각각 3~10MB). **브라우저가 탭을 강제 종료할 수 있다.**

### 실수 2: base64를 localStorage에 저장한다

```typescript
// 나쁜 예
persist(storeLogic, { name: "my-store" })
// slots[].imageDataUrl에 "data:image/jpeg;base64,/9j/4AAQ..." 같은
// 수 MB짜리 문자열이 들어가면 localStorage가 터진다

// 좋은 예
persist(storeLogic, {
  name: "my-store",
  partialize: (state) => ({ challengeId: state.challengeId }),
})
```

### 실수 3: cleanup effect에서 현재 ref를 캡처하지 않는다

```typescript
// 나쁜 예 — cleanup 시점에 ref.current가 이미 바뀌어 있을 수 있음
useEffect(() => {
  return () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }
}, [challenge.id])

// 좋은 예 — effect 실행 시점에 ref 값을 캡처
useEffect(() => {
  const urls = objectUrlsRef.current  // ← 지금 시점의 Map을 캡처
  return () => {
    urls.forEach((url) => URL.revokeObjectURL(url))
    urls.clear()
  }
}, [challenge.id])
```

React의 cleanup 함수는 **나중에** 실행된다. 그때 `objectUrlsRef.current`가 이미 새 Map을 가리키고 있을 수 있다. 그래서 `const urls = objectUrlsRef.current`로 **지금 시점의 참조를 변수에 잡아두는 것**이 안전하다.

### 실수 4: `e.target.value = ""`를 빠뜨린다

같은 사진을 다시 선택했는데 아무 반응이 없다면, 이 한 줄이 빠진 것이다.

### 실수 5: capture 속성으로 카메라/갤러리를 "선택"할 수 있다고 착각한다

`capture="environment"`는 "카메라를 바로 여는 힌트"이지 "반드시 카메라만 열린다"는 보장이 아니다. 브라우저마다 동작이 다르다. 항상 실기기에서 테스트해야 한다.

---

## 5. 모바일 실기기 테스트 체크리스트

### 기본 동작
- [ ] 슬롯 터치 → 바텀 시트가 올라오는가
- [ ] "카메라로 찍기" → 카메라 앱이 열리는가
- [ ] "갤러리에서 선택" → 갤러리/파일 선택기가 열리는가
- [ ] 사진 선택 후 → 슬롯에 미리보기 이미지가 표시되는가
- [ ] "취소" 버튼 → 시트가 닫히고 슬롯 선택이 해제되는가

### 교체 동작
- [ ] 이미 채워진 슬롯을 다시 터치 → 시트가 열리는가
- [ ] 새 사진 선택 → 이전 사진이 교체되는가
- [ ] 같은 사진을 다시 선택 → 정상 동작하는가 (`value=""` 검증)

### 플랫폼별
- [ ] **iOS Safari**: "카메라로 찍기"가 카메라를 바로 여는가
- [ ] **iOS Safari**: "갤러리에서 선택"이 사진 보관함을 여는가
- [ ] **Android Chrome**: "카메라로 찍기"가 카메라를 바로 여는가
- [ ] **Android Chrome**: "갤러리에서 선택"이 갤러리를 여는가
- [ ] HEIC 사진(iPhone)이 정상 표시되는가

### 엣지 케이스
- [ ] 카메라를 열었다가 "뒤로 가기" → 앱이 정상 상태인가 (시트 닫힘, 슬롯 선택 해제)
- [ ] 갤러리를 열었다가 아무것도 선택 안 하고 닫기 → 정상 상태인가
- [ ] 6개 슬롯 전부 채우기 → "콜라주 만들기" 버튼 활성화되는가
- [ ] 6개 채운 후 한 장 교체 → 여전히 "콜라주 만들기" 활성화인가
- [ ] 사진 여러 번 교체 후 페이지 새로고침 → 슬롯이 비어 있는가 (Object URL은 persist 안 됨)

### 성능
- [ ] 사진 6장 선택 후 스크롤이 버벅이지 않는가
- [ ] DevTools → Memory 탭에서 사진 교체 시 이전 Blob이 해제되는가

---

## 6. Day 4 크롭 구현 전에 이해하면 좋은 개념

Day 4에서는 사진을 선택한 후 **원하는 영역만 잘라내는(crop) UI**를 추가한다.

| 개념 | 왜 필요한가 | 핵심 |
|------|------------|------|
| **Canvas API** | 이미지에서 영역을 잘라내는 유일한 브라우저 API | `drawImage()` 9인자 버전으로 크롭 |
| **`drawImage()` 9인자** | "원본의 이 영역을 → 캔버스의 이 위치에 그려라" | `ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)` |
| **`canvas.toBlob()`** | 크롭한 결과를 Blob으로 추출 | 이 Blob에 Object URL을 붙여서 슬롯에 표시 |
| **EXIF orientation** | 모바일 사진은 실제 픽셀과 보이는 방향이 다를 수 있음 | Canvas에 그리기 전에 방향 보정 필요 |
| **터치 이벤트** | 모바일에서 드래그, 핀치 줌 | `touchstart`, `touchmove`, `touchend` |
| **Retina 대응** | Canvas의 논리 크기와 물리 픽셀이 다름 | `devicePixelRatio`로 Canvas 해상도 조정 |

**Day 4에서 바뀌는 데이터 흐름**:

```
지금 (Day 3):
  File → Object URL → fillSlot() → <img src={objectUrl}>

Day 4 이후:
  File → [크롭 UI: Canvas에 그리고, 터치로 영역 선택]
       → canvas.toBlob() → Object URL → fillSlot() → <img src={objectUrl}>
```

Store(`fillSlot`)는 바뀌지 않는다 — 입력이 "원본 사진의 Object URL"에서 "크롭된 이미지의 Object URL"로 바뀔 뿐이다. CaptureClient의 `handleImageSelected`에 크롭 단계가 중간에 끼어들게 된다.

---

## 7. 오늘의 데이터 흐름 한눈에 보기

```
사용자가 "화" 슬롯을 터치
        │
        ▼
handleSlotTap(3)
  ├── selectSlot(3) → Store: activeSlotIndex = 3
  └── setSheetOpen(true) → 바텀 시트 올라옴
        │
        ▼
ImagePickerSheet 렌더링
  ├── 제목: "화" 글자 이미지 선택
  ├── "카메라로 찍기" 버튼
  └── "갤러리에서 선택" 버튼
        │
        ▼
사용자가 "카메라로 찍기" 클릭
  └── cameraInputRef.current.click()
      └── <input capture="environment"> 트리거 → 카메라 앱 열림
        │
        ▼
카메라로 사진 촬영 후 확인
  └── onChange 이벤트 발생
      └── handleFileChange(e)
          ├── file = e.target.files[0]  (File 객체)
          ├── file.type 검사 ("image/jpeg" → OK)
          ├── onImageSelected(file) 호출
          └── e.target.value = "" (리셋)
        │
        ▼
handleImageSelected(file)
  ├── oldUrl = objectUrlsRef.get(3)  (이전 URL 확인)
  ├── URL.revokeObjectURL(oldUrl)    (이전 메모리 해제)
  ├── objectUrl = URL.createObjectURL(file)  ("blob:http://...")
  ├── objectUrlsRef.set(3, objectUrl)        (새 URL 추적)
  ├── fillSlot(3, objectUrl) → Store 업데이트
  │     ├── slots[3].status = "filled"
  │     ├── slots[3].imageDataUrl = "blob:..."
  │     ├── isComplete = false (3개 남음)
  │     └── activeSlotIndex = null (자동 해제)
  └── setSheetOpen(false) → 바텀 시트 닫힘
        │
        ▼
LetterSlot[3] 리렌더링
  └── <img src="blob:http://..." /> 표시
  └── ✓ 체크마크 배지 표시
```
