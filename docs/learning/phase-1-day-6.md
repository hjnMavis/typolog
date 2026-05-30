# Phase 1 Day 6 — 콜라주 미리보기 화면 학습 노트

> 커밋: `9b89638` feat: add collage preview screen (Phase 1 Day 6)

---

## 1. 오늘 구현한 기능 요약

지금까지(Day 2~5) 한 글자씩 사진을 찍어 crop하고 IndexedDB에 저장했다. Day 6은 그 **모은 글자들을 한 화면에 콜라주로 펼쳐 보여주는 미리보기**를 만든다.

`/challenge/[id]/preview` 페이지가 placeholder에서 실제 화면으로 바뀌었다:

- IndexedDB에 저장된 글자 Blob들을 **다시 읽어** 콜라주로 배치
- 각 글자 조각에 **결정론적(deterministic) 흔들림**(회전·크기·여백)을 줘서 "ransom note"(신문 오려붙인 협박편지) 느낌 연출
- **배경색 3종**(흰색/검정/크림) 선택
- 모든 슬롯이 안 채워졌으면 "다시 채우기" 안내, 채워졌으면 콜라주 표시
- 복원 중 **스켈레톤 로딩** 표시
- "저장하기" 버튼은 **disabled** (PNG 저장은 Day 7 예정)

핵심 설계 원칙은 **"순수 함수와 부수효과 분리"** + **"표시 시점에 항상 새 Object URL 생성"**이다.

---

## 2. 핵심 개념 설명

### 2-1. 순수 함수 분리 — `collage-layout.ts`

콜라주 레이아웃 계산을 **브라우저/DOM에 의존하지 않는 순수 함수**로 분리했다.

```typescript
// collage-layout.ts — DOM 없음, store 없음, 입력→출력만
export function getPieceLayout(index: number): PieceLayout { ... }
export function canPreview(slots: Array<{ status: "empty" | "filled" }>): boolean { ... }
```

**왜 분리하나?**

1. **단위 테스트 가능**: 이 함수들은 `index`나 `slots` 배열만 받아 값을 돌려준다. 브라우저 없이 Vitest로 바로 테스트된다. 실제로 `collage-layout.test.ts`가 14개 테스트로 검증한다.
2. **IndexedDB는 jsdom에서 못 돈다**: 컴포넌트 전체(`CollagePreviewClient`)는 IDB 복원을 포함해 jsdom 단위 테스트가 어렵다(테스트 파일 주석에 명시). 그래서 **테스트 가능한 로직만 순수 함수로 빼고**, IDB가 얽힌 부분은 E2E로 위임했다.

**비유**: 요리에서 "계량(순수 계산)"과 "불 쓰기(부수효과)"를 나누는 것. 계량은 어디서든 검증 가능하고, 불 쓰기는 실제 주방(브라우저)에서만 확인한다.

이는 Day 2에서 본 `sentence-parser`, Day 4의 `crop-image` 좌표 계산과 같은 패턴 — **테스트하기 쉬운 순수 코어를 컴포넌트 밖으로 추출**한다.

**쓰이는 곳**: `collage-layout.ts` 전체, `collage-layout.test.ts`

---

### 2-2. 결정론적 의사난수(deterministic pseudo-random) — 왜 `Math.random()`을 안 쓰나

각 글자 조각을 살짝 회전시키고 크기를 다르게 해서 자연스러운 콜라주 느낌을 낸다. 이때 **무작위처럼 보이지만 항상 같은 값**을 만든다.

```typescript
// collage-layout.ts:28-45
export function getPieceLayout(index: number): PieceLayout {
  const t1 = Math.sin(index * 2.3998)      // 회전 seed
  const t2 = Math.cos(index * 3.7213)      // 크기 seed
  const t3 = Math.sin(index * 5.1729 + 1.0) // 여백 seed

  const rotateDeg = t1 * 6                  // ±6deg
  const scale = 0.99 + t2 * 0.07            // 0.92 ~ 1.06
  const marginTopPx = ((t3 + 1) / 2) * 8    // 0 ~ 8px

  return { rotateDeg, scale, marginTopPx }
}
```

**왜 `Math.random()`을 쓰면 안 되나?**

React 컴포넌트는 **여러 번 리렌더링**된다. 만약 `Math.random()`으로 각 조각의 회전값을 정하면, 리렌더링될 때마다 값이 바뀌어 **조각들이 매번 다른 각도로 튀는(jitter) 현상**이 생긴다. 배경색을 바꾸거나 스크롤만 해도 콜라주가 들썩인다.

**해결: `index`를 seed로 한 함수**. `index`가 같으면 `sin(index * 상수)`는 **항상 같은 값**이다. 그래서:
- 0번 글자는 언제나 같은 각도·크기
- 리렌더링해도 안 변함
- 새로고침해도 똑같이 복원됨 (QA 체크포인트 4에서 검증)

**왜 `sin`/`cos`에 서로 다른 소수(prime)를 곱하나?**

```
t1 = sin(index * 2.3998)  ← 회전
t2 = cos(index * 3.7213)  ← 크기
t3 = sin(index * 5.1729 + 1.0)  ← 여백
```

`sin`/`cos`의 출력은 [-1, 1] 범위를 매끄럽게 오간다. 인접한 index(0,1,2…)에 **서로 다른 배수**를 곱하면 세 채널(회전/크기/여백)이 **독립적으로 흩어진다**. 같은 배수를 쓰면 회전·크기·여백이 똑같이 움직여서 부자연스럽다. 소수 배수는 패턴이 쉽게 반복되지 않게 한다.

**선형 보간(lerp)으로 범위 맞추기**:
```
scale = 0.99 + t2 * 0.07   // t2 ∈ [-1,1] → scale ∈ [0.92, 1.06]
                            //  중심값 0.99, 반범위 0.07
marginTopPx = ((t3 + 1) / 2) * 8  // [-1,1] → [0,1] → [0,8]
```
`(t3 + 1) / 2`는 [-1,1]을 [0,1]로 옮기는 정석 변환이다. 거기에 8을 곱해 [0,8px]로 만든다.

> **프로젝트 규칙과 연결**: 이 프로젝트의 워크플로(워크플로 스크립트)에서도 `Math.random()`/`Date.now()`를 금지한다. "재현 가능성(reproducibility)"이 핵심 가치다. 같은 입력 → 같은 출력이면 테스트도, 디버깅도, 새로고침 복원도 예측 가능해진다.

**쓰이는 곳**: `collage-layout.ts:28-45`, 테스트 `collage-layout.test.ts:78-86`(고정값 검증)

---

### 2-3. 미리보기는 store의 Object URL을 재사용하지 않고 IDB에서 새로 만든다

Day 5에서 글자 이미지를 IndexedDB에 저장하고, capture 화면(`CaptureClient`)에서 Object URL로 표시했다. 미리보기 화면은 **그 URL을 재사용하지 않는다**. 대신 **IDB에서 Blob을 다시 읽어 새 Object URL을 만든다**.

```typescript
// CollagePreviewClient.tsx:43-79
useEffect(() => {
  let isMounted = true
  const restore = async () => {
    const currentSlots = useChallengeStore.getState().slots
    const newUrls: Record<number, string> = {}
    for (const slot of currentSlots) {
      if (slot.status === "filled" && slot.imageKey) {
        const blob = await getImageBlob(slot.imageKey)  // IDB에서 다시 읽기
        if (!isMounted) return
        if (blob) {
          const url = URL.createObjectURL(blob)          // 새 URL 생성
          objectUrlsRef.current.set(slot.index, url)
          newUrls[slot.index] = url
        }
      }
    }
    if (!isMounted) return
    setRestoredUrls(newUrls)
    setIsRestoring(false)
  }
  restore()
  return () => { isMounted = false }
}, [challenge.id])
```

**왜 store의 `imageDataUrl`을 재사용하면 안 되나?**

Object URL은 **생성한 화면의 수명에 묶인다**. `CaptureClient`가 언마운트되면 그 화면의 cleanup이 `URL.revokeObjectURL`로 자기 URL들을 **무효화**한다(Day 3·4·5에서 본 정리 로직). 미리보기로 넘어오면 capture 화면은 언마운트되고, 그때 store에 남아 있던 `imageDataUrl`은 **이미 revoke된 죽은 URL**일 수 있다. 죽은 URL을 `<img src>`에 쓰면 깨진 이미지가 나온다.

**그래서**: 미리보기는 **영속 데이터(IDB Blob)를 단일 진실로** 삼아, 자기 화면에서 쓸 URL을 **새로** 만든다. 이는 Day 4.5·5에서 다진 **"데이터(IDB Blob)와 표시(Object URL) 분리"** 원칙의 연장이다.

```
영속 (IndexedDB)  →  화면마다 자기 Object URL을 새로 생성
  imageKey="1:0"      capture 화면: blob:...A  (언마운트 시 revoke)
  → Blob              preview 화면: blob:...B  (언마운트 시 revoke)
```

코드 주석도 이를 명시한다: "store의 slot.imageDataUrl은 capture 화면 언마운트 시 revoke될 수 있으므로 재사용하지 않는다" (`CollagePreviewClient.tsx:41-42`).

**쓰이는 곳**: `CollagePreviewClient.tsx:43-79`, QA 체크포인트 13

---

### 2-4. Object URL lifecycle (미리보기 화면 버전)

이 화면도 자기가 만든 Object URL을 **언마운트/챌린지 변경 시 전부 정리**한다. Day 3~5에서 반복된 패턴이다.

```typescript
// CollagePreviewClient.tsx:82-88
useEffect(() => {
  const urlMap = objectUrlsRef.current
  return () => {
    urlMap.forEach((url) => URL.revokeObjectURL(url))
    urlMap.clear()
  }
}, [challenge.id])
```

- `objectUrlsRef`(useRef Map): 이 화면이 만든 URL들을 추적. 화면 표시용 데이터가 아니라 **정리(cleanup)용 참조**라 `useState`가 아닌 `useRef`.
- cleanup에서 `const urlMap = objectUrlsRef.current`로 **현재 시점 참조를 캡처**(Day 3에서 배운 실수 방지).
- `isMounted` 플래그: 비동기 복원 도중 언마운트되면 `setState`를 막는다(Day 5 패턴).

**쓰이는 곳**: `CollagePreviewClient.tsx:33`(ref), `44·69`(isMounted), `82-88`(cleanup)

---

### 2-5. 복원 상태(isRestoring)와 3가지 화면 분기

비동기로 IDB를 읽는 동안 화면이 **세 가지 상태**를 가진다.

```typescript
const [isRestoring, setIsRestoring] = useState(true)  // 처음엔 복원 중
const allFilled = canPreview(slots)
```

| 상태 | 조건 | 화면 |
|------|------|------|
| **복원 중** | `isRestoring === true` | 스켈레톤(`animate-pulse` 회색 사각형) |
| **미완성** | `!isRestoring && !allFilled` | "아직 모든 글자가 준비되지 않았어요" + 다시 채우기 |
| **완성** | `!isRestoring && allFilled` | 콜라주 카드 표시 |

**순서가 중요**: 미완성 분기(`if (!isRestoring && !allFilled) return ...`)를 **복원이 끝난 뒤에만** 평가한다. 만약 `isRestoring` 체크 없이 `!allFilled`만 보면, 복원이 끝나기 전 잠깐 슬롯이 비어 보이는 순간에 "미완성" 화면이 깜빡인다. `isRestoring` 가드가 이 깜빡임을 막는다.

**스켈레톤 UI**: 로딩 중 빈 화면 대신 콜라주와 비슷한 크기의 회색 박스를 보여줘 **레이아웃 점프(layout shift)를 줄이고** 체감 속도를 높인다.

```tsx
// CollagePreviewClient.tsx:137-138
{isRestoring ? (
  <div className="aspect-square w-full max-w-xs animate-pulse rounded-2xl bg-black/10" />
) : ( ... )}
```

**쓰이는 곳**: `CollagePreviewClient.tsx:28·90·97·137`

---

### 2-6. `canPreview` — 미리보기 가능 여부 가드 (순수 함수)

```typescript
// collage-layout.ts:53-55
export function canPreview(slots: Array<{ status: "empty" | "filled" }>): boolean {
  return slots.length > 0 && slots.every((s) => s.status === "filled")
}
```

"슬롯이 1개 이상 있고, 전부 filled"일 때만 true. **빈 배열은 false**(`slots.length > 0` 가드) — 슬롯이 아직 초기화 안 된 순간에 `[].every()`가 true를 반환하는 함정을 막는다.

> `[].every(...)`는 **항상 true**다(공허한 참, vacuous truth). 빈 배열 가드가 없으면 슬롯 0개일 때 "완성"으로 오판한다. 이건 자주 하는 실수라 테스트로 명시 검증한다(`collage-layout.test.ts:108-110`).

타입을 `Array<{ status: ... }>`로 느슨하게 잡은 것도 포인트 — `LetterSlot` 전체가 아니라 **필요한 필드(status)만** 받게 해서 순수 함수의 재사용성과 테스트 용이성을 높였다.

**쓰이는 곳**: `collage-layout.ts:53-55`, `CollagePreviewClient.tsx:90`

---

### 2-7. 배경색 선택 — 로컬 state와 대비(contrast) 처리

```typescript
// constants/index.ts
export const SLOT_BACKGROUND_COLORS = ["#ffffff", "#1a1a1a", "#f5f0e8"] as const
export type BackgroundColor = (typeof SLOT_BACKGROUND_COLORS)[number]
```

흰색/검정/크림 3종. `as const`로 배열을 고정하고, `(typeof ...)[number]`로 **배열에서 유니온 타입을 자동 생성**한다 — 색을 추가하면 타입도 자동 확장된다(중복 정의 불필요).

```typescript
// CollagePreviewClient.tsx:30
const [bgColor, setBgColor] = useState<BackgroundColor>("#ffffff")
```

**배경색은 카드에만 적용, 페이지 전체엔 안 함**:
```tsx
// 카드에만 inline style로 배경색
<div style={{ backgroundColor: bgColor }} ...>
```
주석이 강조한다: "배경색은 이 카드에만 적용". 페이지 전체를 물들이면 미리보기가 아니라 앱 테마처럼 보인다.

**어두운 배경일 때 글자 폴백 대비**:
```typescript
// CollagePreviewClient.tsx:17-20
function isDarkBackground(color: BackgroundColor): boolean {
  return color === "#1a1a1a"
}
```
이미지가 없어 글자로 폴백될 때(2-8 참조), 검정 배경에선 흰 글자, 밝은 배경에선 어두운 글자로 **대비를 유지**한다. `cardIsDark ? "text-white..." : "text-foreground..."`.

**알려진 한계(QA M-01)**: `bgColor`는 로컬 `useState`라 **새로고침하면 흰색으로 초기화**된다. Day 7에서 PNG 저장과 함께 영속화 예정.

**쓰이는 곳**: `CollagePreviewClient.tsx:17-20·30·140-145·196-220`, `constants/index.ts:4-5`

---

### 2-8. 글자 폴백 — Blob이 없을 때도 안 깨진다

IDB에서 Blob을 못 찾으면(삭제됨/오류) 그 슬롯은 **이미지 대신 글자 텍스트**를 보여준다.

```tsx
// CollagePreviewClient.tsx:165-187
{imageUrl ? (
  <img src={imageUrl} alt={slot.character} className="size-full object-cover" />
) : (
  // IDB Blob 없음 → 글자 텍스트 폴백
  <div className={cn("flex size-16 items-center justify-center ...",
    cardIsDark ? "bg-white/10 text-white ..." : "bg-black/5 text-foreground ...")}>
    {slot.character}
  </div>
)}
```

복원 루프에서 `blob`이 null이면 그 슬롯의 URL을 안 만든다 → `restoredUrls[slot.index]`가 `undefined` → `?? null` → 글자 폴백. **부분 실패에도 콜라주 전체가 안 깨지고**, 채운 글자는 이미지로, 못 읽은 글자는 텍스트로 나온다(QA 체크포인트 10에서 실제 검증: 1:2·1:4 삭제 후 "도"·"이"만 글자).

이는 Day 5의 "복원 실패 = 글자 fallback, 앱 안 깨짐" 원칙과 동일하다.

**쓰이는 곳**: `CollagePreviewClient.tsx:153·165-187`

---

### 2-9. 콜라주 배치 — flex-wrap + slot.index 정렬

```tsx
// CollagePreviewClient.tsx:148-151
<div className="flex flex-wrap items-center justify-center gap-1 p-4">
  {[...slots]
    .sort((a, b) => a.index - b.index)   // 문장 순서 보장
    .map((slot) => { ... })}
```

- **`[...slots]`로 복사 후 정렬**: `sort`는 원본 배열을 **제자리에서 변형(mutate)**한다. store의 slots를 직접 sort하면 store 상태를 건드릴 수 있어, **복사본**을 만들어 정렬한다(불변성 유지).
- **`slot.index` 기준 정렬**: 글자가 문장 순서대로(오·늘·도·화·이·팅) 나오도록 보장. 복원 순서나 객체 순서에 의존하지 않는다.
- **`flex-wrap`**: 글자 수에 따라 자동 줄바꿈. "ransom note" 느낌을 의도.

**알려진 한계(QA M-02, M-03)**:
- 7글자 챌린지는 마지막 줄 정렬이 들쭉날쭉할 수 있음(6글자는 양호).
- 조각이 `size-16`(정사각형) + `object-cover` 고정이라, Day 4에서 만든 **자유 비율 crop의 의미가 미리보기에선 일부 상쇄**된다. 콜라주 레이아웃 고도화 시 검토 예정.

> **업데이트 (authored lines 방향 결정 후)**: `flex-wrap` 자동 줄바꿈은 한글 단어를 중간에 끊는 문제가 있어 폐기한다. 줄나눔은 **작성자가 지정한 `Challenge.lines` 배열을 단일 소스**로 따르도록 변경(수집/preview/PNG 동일). 위 "마지막 줄 들쭉날쭉" 한계는 작성자가 줄을 직접 지정하므로 해소된다. 상세: `docs/data-model.md`, `docs/mvp-sprint.md` "줄 배치".

**쓰이는 곳**: `CollagePreviewClient.tsx:148-191`

---

### 2-10. Server → Client 경계 (Day 2 패턴 재확인)

미리보기도 Day 2의 챌린지 페이지와 같은 구조다.

```typescript
// preview/page.tsx — Server Component
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params              // Next.js 15: params는 Promise
  const challenge = findChallengeById(id)
  if (!challenge) return <에러 화면 />
  return <CollagePreviewClient challenge={challenge} />  // Client에 위임
}
```

- **Server Component**(`page.tsx`): URL에서 id 추출 → 챌린지 조회 → 없으면 404 화면.
- **Client Component**(`CollagePreviewClient`): IDB 접근, Object URL, useState/useEffect, 클릭 이벤트 — 브라우저 전용 작업.

데이터 조회(서버)와 인터랙션/브라우저 API(클라이언트)를 나누는 동일한 경계. IndexedDB·Object URL은 브라우저에만 있으므로 반드시 Client + `useEffect` 안에서 다룬다(SSR 안전, QA 체크포인트 14).

**쓰이는 곳**: `preview/page.tsx`, `CollagePreviewClient.tsx:1`(`"use client"`)

---

## 3. 이 프로젝트에서 개념이 쓰인 파일

| 개념 | 파일:줄 |
|------|---------|
| 순수 함수 분리 (레이아웃 계산) | `collage-layout.ts` 전체 |
| 결정론적 의사난수 (sin/cos seed) | `collage-layout.ts:28-45` |
| `canPreview` 가드 (빈 배열 처리) | `collage-layout.ts:53-55` |
| IDB Blob → 새 Object URL 복원 | `CollagePreviewClient.tsx:43-79` |
| store URL 재사용 금지 (주석) | `CollagePreviewClient.tsx:41-42` |
| Object URL cleanup | `CollagePreviewClient.tsx:82-88` |
| isRestoring 3분기 + 스켈레톤 | `CollagePreviewClient.tsx:90·97·137-138` |
| 배경색 state + 대비 | `CollagePreviewClient.tsx:17-20·30·196-220` |
| 글자 폴백 | `CollagePreviewClient.tsx:165-187` |
| flex-wrap + index 정렬 | `CollagePreviewClient.tsx:148-151` |
| `as const` → 유니온 타입 | `constants/index.ts:4-5` |
| Server→Client 경계 | `preview/page.tsx`, `CollagePreviewClient.tsx:1` |
| 결정론/범위/canPreview 테스트 | `collage-layout.test.ts` (14개) |

---

## 4. 자주 하는 실수

### 실수 1: 렌더링마다 바뀌는 난수로 레이아웃을 정한다

```typescript
// 나쁜 예 — 리렌더링마다 조각이 튐
const rotate = Math.random() * 12 - 6

// 좋은 예 — index seed로 항상 같은 값
const rotate = Math.sin(index * 2.3998) * 6
```

배경색만 바꿔도 콜라주가 들썩인다. seed 기반 결정론 함수로 안정화.

### 실수 2: 다른 화면의 Object URL을 재사용한다

```typescript
// 나쁜 예 — capture 화면이 revoke한 죽은 URL일 수 있음
<img src={slot.imageDataUrl} />

// 좋은 예 — 이 화면에서 IDB Blob으로 새 URL 생성
const blob = await getImageBlob(slot.imageKey)
const url = URL.createObjectURL(blob)
```

### 실수 3: `[].every()`가 true인 걸 잊는다

```typescript
// 나쁜 예 — 슬롯 0개일 때 "완성"으로 오판
const done = slots.every((s) => s.status === "filled")  // [] → true!

// 좋은 예 — 빈 배열 가드
const done = slots.length > 0 && slots.every((s) => s.status === "filled")
```

### 실수 4: 복원 완료 전에 미완성 화면을 보여준다

```typescript
// 나쁜 예 — 복원 중에도 !allFilled가 true라 깜빡임
if (!allFilled) return <미완성 />

// 좋은 예 — 복원 끝난 뒤에만 판단
if (!isRestoring && !allFilled) return <미완성 />
```

### 실수 5: store 배열을 직접 sort 한다

```typescript
// 나쁜 예 — 원본 배열을 mutate (store 상태 오염)
slots.sort((a, b) => a.index - b.index)

// 좋은 예 — 복사 후 정렬
[...slots].sort((a, b) => a.index - b.index)
```

### 실수 6: 어두운 배경에서 폴백 글자 대비를 놓친다

검정 배경에 어두운 글자를 쓰면 안 보인다. `cardIsDark` 분기로 글자색을 전환.

### 실수 7: IndexedDB를 컴포넌트 본문(렌더 중)에서 호출한다

SSR 크래시. 반드시 `useEffect` 안에서 + `getImageBlob`의 `isSupported` 가드(Day 5).

---

## 5. 모바일 수동 테스트 체크리스트

### 콜라주 표시
- [ ] 6글자 채운 뒤 "콜라주 만들기" → 미리보기 진입, 콜라주 표시
- [ ] 글자가 문장 순서(오·늘·도·화·이·팅)대로 배치되는가
- [ ] 조각들이 살짝 회전·크기 차이로 자연스러운가 (ransom note 느낌)
- [ ] 복원 중 스켈레톤(회색 박스)이 잠깐 보였다가 콜라주로 바뀌는가

### 결정론 (회귀 방지)
- [ ] **새로고침 후 조각 배치가 이전과 똑같은가** (각도/크기 안 바뀜)
- [ ] 배경색을 바꿔도 조각이 튀지 않는가

### 새로고침 복원 (Day 5 회귀 방지 — 핵심)
- [ ] **미리보기에서 새로고침 → 이미지 6개 유지** (글자 폴백 아님)
- [ ] 새로고침 후 콘솔 에러 0건

### 배경색
- [ ] 흰/검/크림 전환이 카드에 즉시 반영되는가 (페이지 전체는 안 바뀜)
- [ ] 선택한 색 버튼에 표시(scale/border)가 뜨는가
- [ ] 배경색 고른 뒤 새로고침 → 흰색으로 초기화됨 (현재 동작, M-01)

### 폴백 / 엣지
- [ ] (개발자도구로 IDB 일부 삭제 후) 해당 슬롯만 글자로 폴백, 나머지는 이미지
- [ ] 검정 배경에서 폴백 글자가 잘 보이는가 (흰 글자)
- [ ] 슬롯 미완성 상태로 /preview 직접 접근 → "다시 채우기" 안내

### 레이아웃
- [ ] 7글자 챌린지(`/challenge/9`)로 콜라주 → 마지막 줄 정렬 확인 (M-02)
- [ ] 세로로 길게 crop한 글자가 정사각형으로 잘려 보이는가 (현재 동작, M-03)

### 플랫폼
- [ ] iOS Safari: 미리보기 새로고침 복원, safe-area
- [ ] Android Chrome: 대형 이미지 6개 복원 속도

---

## 6. Day 7(PNG 저장) 전에 이해하면 좋은 개념

Day 7은 이 콜라주를 **하나의 PNG 이미지로 합성해 다운로드**하는 단계다.

| 개념 | 왜 필요한가 | 핵심 |
|------|------------|------|
| **여러 이미지 Canvas 합성** | 콜라주 = 글자 조각들을 한 캔버스에 그림 | `drawImage`를 N번 호출, 각 조각의 위치·회전·크기 계산 |
| **Canvas 회전/스케일 변환** | 미리보기의 CSS `transform`을 Canvas로 재현 | `ctx.save/translate/rotate/scale/restore` |
| **CSS transform ↔ Canvas 변환 매핑** | DOM에서 본 모습 그대로 PNG로 | `getPieceLayout` 값을 Canvas 변환으로 변환 |
| **배경색을 Canvas에 칠하기** | 선택한 배경색이 PNG에 포함되어야 | `ctx.fillRect`로 카드 배경 먼저 칠하기 |
| **`canvas.toBlob` 다운로드** | 완성 콜라주를 파일로 저장 | `toBlob` → Object URL → `<a download>` 클릭 |
| **배경색 영속화** | 새로고침에도 선택 유지 (M-01) | localStorage 또는 store에 bgColor 저장 |
| **DPR(고해상도) 대응** | 레티나에서 선명한 PNG | `canvas.width = css * devicePixelRatio` |

**Day 7으로 가는 연결고리**: Day 6은 **CSS로** 콜라주를 그렸다(`transform: rotate/scale`, `flex-wrap`). Day 7은 **이 똑같은 배치를 Canvas로** 다시 그려 PNG로 만든다. `getPieceLayout`이 순수 함수라 **미리보기(CSS)와 PNG 생성(Canvas)이 같은 레이아웃 값을 공유**할 수 있다 — 화면에서 본 그대로 저장된다. Day 4의 crop(`drawImage` 9인자)에서 배운 Canvas 그리기가, 이번엔 "1 이미지 → 1 영역"이 아니라 "N 조각 → 회전·크기 변환하며 1 캔버스에 배치"로 확장된다.

> 관련 개념은 `docs/learning/learning-first-roadmap.md`의 Phase 1(#11 Canvas)을 참고. 직전 노트는 `docs/learning/phase-1-day-5.md`.
