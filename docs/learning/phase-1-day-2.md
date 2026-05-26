# Phase 1 Day 2 — 글자 슬롯 UI 학습 노트

> 커밋: `975102a` feat: add challenge letter slot UI

---

## 1. 오늘 구현한 기능을 쉬운 말로

"오늘의 문장"이 주어지면, 문장의 각 글자에 대응하는 **빈 칸(슬롯)**이 화면에 나타난다.
슬롯을 터치하면 **파란 테두리**로 "선택됨" 상태가 되고, 모든 슬롯에 이미지가 채워지면 "콜라주 만들기" 버튼이 활성화된다.

아직 카메라/크롭은 없다 — **빈 그리드 + 선택 인터랙션 + 진행률 표시**가 오늘의 범위.

---

## 2. 핵심 개념별 설명

### 2-1. Dynamic Route: `/challenge/[id]`

**뭔가**: 대괄호 `[id]`가 들어간 폴더 이름은 "여기에 아무 값이나 올 수 있다"는 뜻이다.

```
/challenge/1   → id = "1"   → "오늘도 화이팅" 챌린지
/challenge/7   → id = "7"   → "오늘의 기분" 챌린지
/challenge/999 → id = "999" → 해당 없음 → 404 화면
```

URL의 일부가 **변수**가 되는 것이다. 하드코딩된 10개 페이지를 만드는 대신, **하나의 페이지 파일**로 모든 챌린지를 처리한다.

**Next.js 15에서 달라진 점**: `params`가 Promise이다.

```typescript
// Next.js 14 이전
export default function Page({ params }: { params: { id: string } }) {
  const id = params.id  // 바로 접근
}

// Next.js 15
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params  // await 필요
}
```

왜 이렇게 바뀌었나? Next.js가 내부적으로 params를 비동기로 처리해서 성능을 최적화하기 위해서다. 아직은 "그냥 await 붙이면 된다" 정도로 이해하면 충분하다.

**쓰이는 파일**: `src/app/challenge/[id]/page.tsx:6-9`

---

### 2-2. Client Component가 필요한 이유

챌린지 페이지는 **두 레이어**로 나뉜다:

| 레이어 | 파일 | 타입 | 하는 일 |
|--------|------|------|---------|
| 바깥 | `challenge/[id]/page.tsx` | **Server Component** | URL에서 id 추출, 챌린지 데이터 찾기 |
| 안쪽 | `CaptureClient.tsx` | **Client Component** | 슬롯 터치, 상태 변경, 애니메이션 |

**왜 Client Component가 필요한가?**

Server Component에서는 이런 것들을 **쓸 수 없다**:
- `useState`, `useEffect` — React 상태/생명주기
- `onClick`, `onTap` — 사용자 이벤트
- Zustand store — 브라우저 메모리 + localStorage
- 브라우저 API — 나중에 Camera, Canvas

이 페이지에서 슬롯을 터치하면 **즉시 UI가 바뀌어야** 한다(선택 표시, 진행률 업데이트). 이건 브라우저에서 일어나는 일이니까 `'use client'`가 필요하다.

**패턴 이름**: **Server → Client 경계(boundary)**

```
Server Component (page.tsx)
  └── 데이터를 props로 내려줌
        └── Client Component (CaptureClient.tsx)
              └── 인터랙션 처리
```

이 패턴의 장점: 서버에서 할 수 있는 일(데이터 조회)은 서버에서 하고, 브라우저에서만 가능한 일(클릭 반응)은 클라이언트에서 한다. **필요한 만큼만** `'use client'`를 쓰는 것이 핵심이다.

**쓰이는 파일**: `CaptureClient.tsx:1` (`"use client"` 선언), `LetterSlot.tsx:1`

---

### 2-3. Zustand Store의 역할

**문제 상황**: 글자 슬롯 데이터를 여러 컴포넌트가 공유해야 한다.

```
CaptureClient       → 전체 진행률 (filledCount / totalCount) 표시
  ├── LetterSlot[0]  → 0번 슬롯의 상태 (empty/filled/active) 표시
  ├── LetterSlot[1]  → 1번 슬롯의 상태 표시
  └── ...
  └── CTA 버튼       → isComplete에 따라 활성/비활성
```

만약 `useState`만 쓰면? `CaptureClient`에 모든 상태를 넣고, LetterSlot에 props로 내려야 한다. 지금은 괜찮지만, 나중에 **ImageCropper**, **CollagePreview** 같은 다른 페이지/컴포넌트에서도 같은 슬롯 데이터가 필요하다.

**Zustand가 해결하는 것**: 어떤 컴포넌트에서든 `useChallengeStore()`를 호출하면 **같은 데이터**에 접근할 수 있다. Props 전달 없이.

```typescript
// 어디서든 이렇게 쓸 수 있다
const slots = useChallengeStore((state) => state.slots)
```

**persist 미들웨어**: `{ name: "typolog-challenge" }` 한 줄이면 상태가 **localStorage에 자동 저장**된다. 페이지를 새로고침해도, 앱을 닫았다 열어도, 모아둔 글자가 사라지지 않는다.

> 브라우저 DevTools → Application → Local Storage → `typolog-challenge` 키를 확인해보면 실제 저장된 JSON을 볼 수 있다.

**쓰이는 파일**: `src/stores/challenge-store.ts` (전체)

---

### 2-4. activeSlotIndex — 왜 이 상태가 필요한가

**`activeSlotIndex: number | null`** — "지금 사용자가 선택한 슬롯 번호. 아무것도 안 선택했으면 null."

이것이 없으면 어떻게 되나?

1. 사용자가 "ㅎ" 슬롯을 터치한다
2. 카메라가 열린다 (Day 3에서 구현)
3. 사진을 찍고 크롭한다
4. ...크롭한 이미지를 **어느 슬롯에** 넣어야 하지?

`activeSlotIndex`는 **"지금 작업 중인 슬롯이 어디인지"를 기억하는 포인터**이다.

**토글(toggle) 패턴**:

```typescript
selectSlot: (index) =>
  set((state) => ({
    activeSlotIndex: state.activeSlotIndex === index ? null : index,
  })),
```

같은 슬롯을 다시 터치하면 → 선택 해제 (`null`)
다른 슬롯을 터치하면 → 그 슬롯으로 변경

이 로직 덕분에 **한 번에 하나의 슬롯만** 선택 상태가 된다. 모바일에서는 한 번에 하나씩 작업하는 게 자연스럽다.

**쓰이는 파일**: `challenge-store.ts:8,42-44`, `CaptureClient.tsx:80` (`isActive={activeSlotIndex === slot.index}`)

---

### 2-5. sentence-parser가 하는 일

```typescript
export function parseSentence(sentence: string): string[] {
  return sentence.replace(/[^가-힣]/g, "").split("")
}
```

단 두 줄이지만 핵심적인 함수다.

**하는 일**: 문장에서 **완성된 한글 글자만** 추출한다.

```
"오늘도 화이팅" → ["오", "늘", "도", "화", "이", "팅"]
"참 좋은 날"   → ["참", "좋", "은", "날"]
"안녕!하세요?" → ["안", "녕", "하", "세", "요"]
```

**정규식 해석**: `/[^가-힣]/g`
- `[^...]` — "이 안에 있는 것 **빼고** 전부"
- `가-힣` — 유니코드에서 완성된 한글 음절 범위 (가 ~ 힣, 총 11,172자)
- `g` — 전체에서 반복 적용
- 결과: 공백, 특수문자, 숫자, 영문, **자음/모음만 있는 글자(ㄱㄴㄷ)**도 제거

**왜 중요한가**: 이 함수의 결과가 **슬롯 개수**를 결정한다. "오늘도 화이팅"이면 6개 슬롯, "참 좋은 날"이면 4개 슬롯.

**데이터 일관성 보장 패턴**: mock 데이터에서 `letters`를 직접 하드코딩하지 않고, `parseSentence()`로 **계산해서 만든다**:

```typescript
function challenge(id: string, sentence: string, activeDate: string): Challenge {
  return { id, sentence, letters: parseSentence(sentence), activeDate }
}
```

이렇게 하면 `sentence`와 `letters`가 **절대 어긋나지 않는다**. QA 리뷰에서 지적된 H-2 이슈가 바로 이 문제였다.

**쓰이는 파일**: `src/lib/utils/sentence-parser.ts`, `src/lib/constants/challenges.ts:5`

---

### 2-6. Derived State로 진행률 계산

**Derived state(파생 상태)**란 — 저장된 데이터에서 **계산으로 얻는** 값.

```typescript
// CaptureClient.tsx:29-30
const filledCount = slots.filter((s) => s.status === "filled").length
const totalCount = slots.length
```

`filledCount`와 `totalCount`는 store에 **저장하지 않는다**. `slots` 배열에서 매번 계산한다.

**왜 저장하지 않는가?**

만약 `filledCount`를 store에 별도로 저장하면:
1. `fillSlot()` 할 때 `filledCount++` 해야 하고
2. `clearSlot()` 할 때 `filledCount--` 해야 하고
3. `reset()` 할 때 `filledCount = 0` 해야 한다

실수로 하나를 빠뜨리면 `filledCount`와 실제 filled된 슬롯 수가 **달라진다(불일치)**. 매번 계산하면 이런 버그가 원천적으로 불가능하다.

같은 원리로, `isComplete`는 store 안에서 `fillSlot` 시점에 계산한다:

```typescript
// challenge-store.ts:56
const isComplete = slots.every((s) => s.status === "filled")
```

진행률 바의 width도 derived state이다:

```typescript
// CaptureClient.tsx:61
style={{ width: `${totalCount > 0 ? (filledCount / totalCount) * 100 : 0}%` }}
```

**규칙**: "같은 정보를 두 곳에 저장하지 않는다. 하나의 원천(source of truth)에서 나머지를 계산한다."

---

### 2-7. Disabled CTA UX

```tsx
<Link
  href={isComplete ? `/challenge/${challenge.id}/preview` : "#"}
  aria-disabled={!isComplete}
  className={cn(
    buttonVariants({ size: "lg" }),
    "w-full",
    !isComplete && "pointer-events-none opacity-40",
  )}
>
  콜라주 만들기
</Link>
```

**세 가지 장치**:

| 장치 | 역할 | 대상 |
|------|------|------|
| `href="#"` | 클릭해도 이동하지 않음 | 모든 사용자 |
| `pointer-events-none opacity-40` | 클릭 불가능 + 반투명 시각 표시 | 눈으로 보는 사용자 |
| `aria-disabled={!isComplete}` | 스크린 리더에게 "이 버튼은 비활성" 알림 | 접근성 보조기기 사용자 |

**왜 `<button disabled>`를 안 쓰나?** 여기서는 `<Link>` 컴포넌트(= `<a>` 태그)를 쓰고 있다. HTML `<a>` 태그에는 `disabled` 속성이 없다. 그래서 CSS(`pointer-events-none`)와 ARIA로 비활성 상태를 구현한다.

**안내 텍스트도 상태에 따라 바뀐다**:
- 슬롯이 선택된 상태 → "다음 단계: 선택한 슬롯에 이미지 추가"
- 아무것도 선택 안 한 상태 → "슬롯을 터치해서 글자를 모아보세요"
- 모두 채워진 상태 → 안내 없음 (버튼이 활성화되니까)

**쓰이는 파일**: `CaptureClient.tsx:88-113`

---

### 2-8. Mock-First 개발 방식

지금 이 프로젝트에 **서버가 없다**. DB도 없고, API도 없고, 로그인도 없다.

그런데도 동작하는 앱이 있다. 왜?

```typescript
export const MOCK_CHALLENGES: Challenge[] = [
  challenge("1", "오늘도 화이팅", "2026-05-26"),
  challenge("2", "참 좋은 날", "2026-05-27"),
  // ...
]
```

**가짜 데이터(mock)**를 하드코딩해서 서버 없이도 UI를 완성하는 것이 **mock-first 개발**이다.

**왜 이렇게 하나?**

| 접근법 | 위험 |
|--------|------|
| 서버 먼저 만들고 UI 나중에 | UI를 붙여보니 데이터 구조가 안 맞아서 서버를 수정 → 반복 |
| **UI 먼저 만들고 서버 나중에** | 사용자 입장에서 "이게 자연스러운가"를 빠르게 확인 가능 |

나중에 Phase 2에서 Supabase를 연결할 때:
1. `MOCK_CHALLENGES` → DB 쿼리로 교체
2. `findChallengeById()` → API 호출로 교체
3. `persist` localStorage → 서버 동기화 추가

**UI와 UX는 이미 검증된 상태**이므로, 서버 연동은 "데이터 소스만 바꾸는" 작업이 된다.

**타이포로그의 mock-first 계층**:

```
지금 (Phase 1)           나중에 (Phase 2)
────────────             ────────────
MOCK_CHALLENGES 배열  →  Supabase DB
localStorage persist  →  Supabase + localStorage 동기화
findChallengeById()   →  Route Handler GET /api/challenges/[id]
```

---

## 3. 직접 확인해야 할 코드 파일

우선순위 순으로 읽기를 권장한다:

| 순서 | 파일 | 핵심 포인트 |
|------|------|------------|
| 1 | `src/types/index.ts` | 전체 데이터 구조의 "설계도" — 여기서 시작 |
| 2 | `src/lib/utils/sentence-parser.ts` | 6줄 유틸. 정규식 하나로 슬롯 개수가 결정됨 |
| 3 | `src/stores/challenge-store.ts` | 상태 관리의 중심. `initSlots`, `selectSlot`, `fillSlot` 흐름 따라가기 |
| 4 | `src/app/challenge/[id]/page.tsx` | Server → Client 경계. `await params` 패턴 |
| 5 | `src/features/challenge/CaptureClient.tsx` | 실제 UI. derived state, 조건부 렌더링, disabled CTA |
| 6 | `src/features/challenge/LetterSlot.tsx` | 컴포넌트 설계. props interface, 3가지 상태별 스타일링 |
| 7 | `src/lib/constants/challenges.ts` | Mock 데이터 + KST 타임존 처리 |
| 8 | `tests/unit/sentence-parser.test.ts` | 테스트 작성법. `describe` / `it` / `expect` / `it.each` 패턴 |

---

## 4. 자주 하는 실수

### 실수 1: useEffect 의존성 배열에 객체를 넣는다

```typescript
// 나쁜 예
useEffect(() => {
  initSlots(challenge)
}, [challenge, initSlots])  // challenge는 객체 → 매번 새 참조 → 무한 루프 가능

// 좋은 예
useEffect(() => {
  initSlots(challenge)
}, [challenge.id, initSlots])  // id는 string → 값이 바뀔 때만 실행
```

React는 의존성을 `===`(참조 비교)로 확인한다. 객체는 내용이 같아도 `{} !== {}`이므로, `challenge.id`처럼 **원시값(string, number)**을 넣는다.

### 실수 2: Zustand에서 불필요한 리렌더링

```typescript
// 나쁜 예 — store 전체를 구독. 아무 값이나 바뀌면 리렌더링
const store = useChallengeStore()

// 좋은 예 — 필요한 값만 구독
const slots = useChallengeStore((state) => state.slots)
const isComplete = useChallengeStore((state) => state.isComplete)
```

CaptureClient에서는 구조 분해로 여러 값을 한 번에 꺼내고 있는데, 컴포넌트가 작은 동안은 괜찮다. 나중에 성능 이슈가 생기면 selector로 분리한다.

### 실수 3: 타임존을 무시한다

```typescript
// 나쁜 예 — UTC 기준이라 한국 자정~오전 9시에 어제 날짜가 나옴
new Date().toISOString().slice(0, 10)

// 좋은 예 — 한국 시간대(KST, UTC+9)로 변환
new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
```

한국 사용자를 위한 앱이면 **항상 KST**로 날짜를 비교해야 한다. 이 버그는 QA에서 H-1으로 잡혔다.

### 실수 4: Derived state를 store에 중복 저장한다

```typescript
// 나쁜 예 — filledCount를 별도로 관리
interface ChallengeStore {
  slots: LetterSlot[]
  filledCount: number  // slots에서 계산 가능한데 따로 저장
}

// 좋은 예 — 컴포넌트에서 계산
const filledCount = slots.filter((s) => s.status === "filled").length
```

---

## 5. 다음 단계 전에 이해하면 좋은 개념

Phase 1 Day 3에서 **카메라 → 이미지 크롭**을 구현하게 된다. 미리 알면 좋은 것들:

| 개념 | 왜 필요한가 | 간단 설명 |
|------|------------|-----------|
| **File API** (`<input type="file">`) | 카메라/갤러리에서 사진을 가져와야 함 | `e.target.files[0]`으로 File 객체를 받는다 |
| **Blob** | 크롭된 이미지를 메모리에 저장해야 함 | 바이너리 데이터 덩어리. File은 Blob의 자식 |
| **Object URL** | Blob을 `<img src>`에 넣어야 함 | `URL.createObjectURL(blob)`으로 임시 URL 생성 |
| **Canvas API** | 이미지에서 영역을 잘라내야 함 | `drawImage()` 9인자 버전으로 크롭 |
| **EXIF orientation** | 모바일 사진이 회전되어 보일 수 있음 | Canvas에 그리기 전에 방향 보정 필요 |
| **touch 이벤트** | 모바일에서 핀치 줌, 드래그 | `touchstart`, `touchmove`, `touchend` |

> 이 개념들은 `docs/learning/learning-first-roadmap.md`의 Phase 1 섹션(#8~#13)에 상세 설명이 있다.

---

## 6. 오늘의 데이터 흐름 한눈에 보기

```
사용자가 /challenge/1에 접속
        │
        ▼
[Server] page.tsx
  └─ findChallengeById("1")
  └─ MOCK_CHALLENGES에서 "오늘도 화이팅" 찾음
  └─ <CaptureClient challenge={...} /> 렌더링
        │
        ▼
[Client] CaptureClient.tsx
  └─ useEffect → initSlots(challenge)
        │
        ▼
[Store] challenge-store.ts
  └─ slots = ["오","늘","도","화","이","팅"].map(...)
  └─ localStorage에 자동 저장 (persist)
        │
        ▼
[Client] CaptureClient.tsx (리렌더링)
  └─ filledCount = 0, totalCount = 6  (derived)
  └─ 진행률 바: 0%
  └─ LetterSlot × 6 렌더링
  └─ "콜라주 만들기" 버튼: 비활성 (isComplete = false)
        │
        ▼
사용자가 "오" 슬롯을 터치
        │
        ▼
[Store] selectSlot(0)
  └─ activeSlotIndex = 0
        │
        ▼
[Client] LetterSlot[0]
  └─ isActive = true → 파란 테두리 + ring 표시
  └─ 안내: "다음 단계: 선택한 슬롯에 이미지 추가"
```
