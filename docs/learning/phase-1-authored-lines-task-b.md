# Phase 1 — Task B: 작성자 지정 줄 배치로 콜라주 레이아웃 전환 학습 노트

> 작업 브랜치: `phase1-authored-collage-lines`
> 변경 파일: `src/lib/collage/sentence-lines.ts`(신규), `src/lib/collage/render-collage-to-blob.ts`, `src/features/compose/CollagePreviewClient.tsx`, `src/features/challenge/CaptureClient.tsx`, `tests/unit/sentence-lines.test.ts`(신규), `tests/unit/export-collage.test.ts`

---

## 이 작업이 한 일 (한 문장)

Task A에서 만든 `Challenge.lines`(작성자가 정한 줄 배치)를 **수집·미리보기·PNG 세 화면이 모두 똑같이 따르도록** 레이아웃 코드를 갈아끼웠다.

**전(before)**:
- 수집 화면: `grid grid-cols-3` 또는 `grid-cols-4` — 글자 수에 따라 분기, 줄 배치는 CSS가 자동으로 결정
- 미리보기: `flex flex-wrap` — 글자 수에 따라 줄바꿈이 들쭉날쭉(Day 6 QA M-02)
- PNG: (Day 7) flat 글자 배열을 받아 자기만의 격자 좌표로 그림

세 화면이 **각자** 줄을 추측 → 작성자 의도("동네"가 한 줄에 붙어야 함)가 안 지켜질 수 있음.

**후(after)**:
- 한 곳에서 줄 배치 → 슬롯 index 2차원 배열을 만든다(`getCollageLines`)
- 세 화면이 **같은 결과**를 보고 행 단위로 렌더한다
- 줄 배치 = 화면 = PNG 가 자동 일치

---

## 1. 순수 함수 분리 — `getCollageLines`

### 개념

DOM·브라우저 API·React state에 의존하지 않는 **순수 함수**(같은 입력 → 같은 출력)를 별도 파일로 뽑아낸다. 이런 함수는 jsdom·Vitest로 **즉시 단위 테스트**가 된다.

### 왜 이렇게 했나

"작성자 줄 배치를 슬롯 index의 2차원 배열로 변환"하는 로직은 콜라주 레이아웃의 **단일 진실**이다(Task A의 단일 소스 원칙이 여기서 함수로 구체화된다). 만약 이 변환을 컴포넌트 안에 인라인으로 적어두면:

- 수집 컴포넌트, 미리보기 컴포넌트, Canvas 렌더 함수 — **세 곳에 똑같은 로직이 복제**된다.
- 어느 한 곳만 바꾸면 화면 셋이 어긋난다 (Day 6의 flex-wrap 줄바꿈이 PNG와 달라지는 것 같은 버그).
- 단위 테스트할 수 없다 — 컴포넌트 안의 로직은 jsdom·React Testing Library 위에서만 검증 가능해 느리고 비싸다.

순수 함수로 분리하면:

- **단일 진실**: 세 화면이 같은 함수를 호출 → 결과가 같다는 게 자동 보증된다.
- **테스트 가능**: 입력(`string[]`)만 주면 출력(`number[][]`)을 검증할 수 있다. DOM·React·Canvas 없이.
- **불변식을 코드로 명시**: 함수 주석에 "flat() === [0..N-1]" 등 자기 약속을 적어둘 수 있고, 테스트로 그 약속을 고정한다(6번 절 참고).

이는 Day 6의 `collage-layout.ts`(결정론적 jitter)와 같은 패턴의 확장이다. 그때는 "한 슬롯의 transform 값"만 순수화했고, 이번엔 "줄 배치 자체"를 순수화한다.

### 코드 어디서 쓰였나

- `src/lib/collage/sentence-lines.ts:27-39` — 함수 본체. 모듈 헤더 주석(`:1-7`)이 명시한다:
  > "콜라주 줄나눔의 단일 소스이며, 수집(CaptureClient)·미리보기(CollagePreviewClient)·PNG(renderCollageToBlob)가 모두 이 함수의 결과를 그대로 따른다."
- `src/features/challenge/CaptureClient.tsx:16, 229` — 수집 화면이 호출.
- `src/features/compose/CollagePreviewClient.tsx:12, 112` — 미리보기 화면이 호출.
- `src/lib/collage/render-collage-to-blob.ts:13, 163` — PNG 생성이 호출 (`renderCollageToBlob` 내부에서 직접).
- `tests/unit/sentence-lines.test.ts` — 7개 단위 테스트로 동작 고정.

---

## 2. 누적 cursor와 비한글/빈 줄 스킵 — `getCollageLines`의 내부 동작

### 개념

작성자는 자연스러운 한국어로 줄을 쓴다 — `["오늘도", "화이팅"]`. 하지만 우리가 필요한 건 **슬롯 index의 2차원 배열** `[[0,1,2],[3,4,5]]`이다. 이 변환에서 두 가지를 동시에 처리한다:

1. **줄 안의 한글 글자만 추출** (Day 2의 `parseSentence` 재사용 — `/[^가-힣]/g` 제거)
2. **줄 사이를 가로지르는 누적 index** — 0번 줄의 글자 수만큼 cursor를 올리고, 다음 줄은 그 cursor부터 시작

### 왜 이렇게 했나

**왜 줄별로 index를 다시 0부터 매기지 않나?** 슬롯 데이터(`store.slots[i]`)는 **문장 전체에 걸친 평탄(flat) index**로 키잉돼 있다. 0번 슬롯 = 첫 글자, 5번 슬롯 = 여섯 번째 글자. 그래서 행 안의 슬롯을 그릴 때 `store.slots[행_안의_index]`로 직접 조회하려면 **행에서 빼낸 index가 곧 store의 slot index여야 한다**. 누적 cursor가 이를 보장한다.

**왜 빈 줄(한글 0개)을 그냥 두지 않고 스킵하나?**
- 작성자가 빈 문자열(`""`)이나 비한글만 있는 줄(`"!@#"`, `"abc"`)을 적어도, 빈 행을 만들면 화면에 빈 공간이 생긴다.
- `parseSentence`가 빈 배열을 주는 줄은 **그 자리에 슬롯이 0개**라는 뜻이다. 빈 행은 렌더 의미가 없다.
- 그래서 `if (chars.length === 0) continue`로 건너뛴다(`sentence-lines.ts:33`).

### 코드 어디서 쓰였나

- `src/lib/collage/sentence-lines.ts:28-36`:
  ```typescript
  const rows: number[][] = []
  let cursor = 0
  for (const line of lines) {
    const chars = parseSentence(line)
    if (chars.length === 0) continue       // 빈 줄 스킵
    rows.push(chars.map((_, i) => cursor + i))  // 행의 index = cursor 시작
    cursor += chars.length                  // 다음 줄을 위해 cursor 전진
  }
  ```
- `tests/unit/sentence-lines.test.ts:30-40` — "동네"가 한 줄에 유지되는 단어 보존 테스트.
- `tests/unit/sentence-lines.test.ts:42-44` — "abc"·"123!" 같은 비한글 줄을 건너뛰는 테스트.

---

## 3. Canvas 셀 좌표 수학 — `getLineCellRects`

### 개념

작성자가 정한 줄 배치(예: 1줄에 4글자, 2줄에 2글자)를 정해진 크기의 캔버스(예: 1080×1080) 위에 어떻게 배치할지 **좌표를 계산**한다. 핵심 의사결정 3가지:

1. **셀 크기**: 모든 셀이 같은 정사각형이어야 한다. 너비도 높이도 캔버스를 넘으면 안 된다. → **가로 제약과 세로 제약의 최솟값**
2. **각 줄 가로 중앙 정렬**: 줄마다 글자 수가 달라도 각자 캔버스 중앙으로
3. **전체 블록 세로 중앙 정렬**: 줄 수가 적으면 위아래 여백 균등

### 왜 이렇게 했나

가장 중요한 통찰은 **셀 크기를 가로·세로 양쪽에서 동시에 계산해 최솟값을 쓴다**는 점이다.

```typescript
// render-collage-to-blob.ts:65-67
const cellW = innerSize / (maxCols + (maxCols - 1) * gapRatio)
const cellH = innerSize / (numRows + (numRows - 1) * gapRatio)
const cellSize = Math.min(cellW, cellH)
```

왜?
- `cellW`만 보면 "가로로 maxCols개 넣을 때 셀 너비가 얼마면 가용 폭을 채우는가"의 답이다.
- `cellH`만 보면 "세로로 numRows개 쌓을 때 셀 높이가 얼마면 가용 높이를 채우는가"의 답이다.
- **둘 중 작은 값**을 쓰면 가로도 안 넘치고 세로도 안 넘친다. 더 큰 값을 쓰면 한 방향이 캔버스 밖으로 삐져나간다.

이게 "정사각형 셀 + 캔버스 안에 다 들어감"의 유일한 해다. 가로가 좁으면 가로 제약이 이김(가로 빵빵·세로 여백), 세로가 좁으면 세로 제약이 이김(세로 빵빵·가로 여백).

**각 줄의 가로 중앙**:
```typescript
// render-collage-to-blob.ts:78-79
const rowWidth = row.length * cellSize + (row.length - 1) * gap
const offsetX = (canvasSize - rowWidth) / 2  // 각 줄 가로 중앙
```
줄마다 `row.length`가 다르므로 `rowWidth`도 다르고, 따라서 `offsetX`도 다르다. 결과적으로 4셀 줄과 2셀 줄이 **각자 자기 폭의 중앙**으로 정렬된다.

**전체 블록의 세로 중앙**:
```typescript
// render-collage-to-blob.ts:71-72
const gridHeight = numRows * cellSize + (numRows - 1) * gap
const offsetY = (canvasSize - gridHeight) / 2
```
줄이 2개든 5개든, 위아래 여백이 균등해진다.

### 코드 어디서 쓰였나

- `src/lib/collage/render-collage-to-blob.ts:48-90` — 함수 전체.
- `src/lib/collage/render-collage-to-blob.ts:23-28` — `CellRect` 타입 정의.
- `src/lib/collage/render-collage-to-blob.ts:163-164` — `renderCollageToBlob` 안에서 호출.
- `tests/unit/export-collage.test.ts:204-279` — 9개 테스트로 정사각·동일 크기·가로 중앙·세로 중앙·패딩 안쪽 모두 검증.

> 이 함수도 DOM에 의존하지 않는 **순수 함수**다. Canvas를 받지 않고 좌표만 계산해서 돌려준다. 그래서 jsdom에서 `canvas.getContext("2d")`가 null이어도 테스트가 된다(같은 파일의 `renderCollageToBlob`은 단위 테스트에서 제외, E2E 위임).

---

## 4. 슬롯 index로 직접 채워 넣는 배열 — 불변식이 만든 단순함

### 개념

`getLineCellRects`는 슬롯 index의 2차원 배열을 받아 **`CellRect[]` 1차원 배열**을 돌려준다. 그런데 그 배열의 인덱스가 곧 슬롯 index다(`rects[5] = 5번 슬롯의 사각형`).

### 왜 이렇게 했나

가능한 다른 설계:
- `CellRect[][]`(2차원 배열)로 줄 구조 유지 → 호출자가 매번 `rects[행][열]`로 찾아야 함
- `Map<slotIndex, CellRect>` → 매번 `rects.get(i)`. 좀 무거움.

여기서 쓰는 방식은:
```typescript
// render-collage-to-blob.ts:74, 83-86
const rects: CellRect[] = new Array(totalCells)
// ...
for (let c = 0; c < row.length; c++) {
  const slotIndex = row[c]
  // ...
  rects[slotIndex] = { x, y, w: cellSize, h: cellSize }
}
```

**이게 안전한 이유**: `getCollageLines`의 불변식이 `flat() === [0..N-1]`임을 보장한다. 즉 모든 슬롯 index가 빠짐없이 정확히 한 번씩 나타난다. 그래서 `rects[slotIndex] =`로 채워 넣어도 **충돌도, 빈 자리도 생기지 않는다**.

이 단순함은 **Task A의 단일 소스 + Task B의 불변식**이 만들어낸 합작이다. 호출자(`renderCollageToBlob`)는 `for (let i = 0; i < items.length; i++) { const rect = rects[i]; ... }`로 평탄한 루프만 돌리면 된다 — 2차원 구조를 다시 풀 필요가 없다.

### 코드 어디서 쓰였나

- `src/lib/collage/render-collage-to-blob.ts:74, 83-86` — `rects[slotIndex]`로 직접 인덱싱.
- `src/lib/collage/render-collage-to-blob.ts:172-174` — 호출자가 그냥 `rects[i]`로 꺼냄.
- `src/lib/collage/sentence-lines.ts:19-22` — 함수 주석에 불변식이 박혀 있음:
  > "getCollageLines(lines).flat() === [0, 1, …, letters.length - 1] … 이 불변식 덕분에 반환 행의 index로 slot/letter를 1:1 조회할 수 있다."

---

## 5. `getPieceLayout` 재사용 — 화면과 PNG가 같은 변환을 공유

### 개념

Day 6에서 만든 `getPieceLayout(index)`는 슬롯마다 **결정론적**으로 회전 각도·스케일·marginTop을 돌려주는 순수 함수다. 미리보기 화면이 CSS `transform`으로 이걸 적용해 "ransom note" 느낌을 만든다.

PNG 생성도 **똑같은 함수**를 호출한다. CSS의 `rotate/scale`을 Canvas의 `ctx.rotate/ctx.scale`로 옮기기만 한다.

### 왜 이렇게 했나

PNG는 화면에서 본 그대로 저장돼야 한다. 만약 각도 산출 로직을 화면용·PNG용 따로 두면:
- 한 쪽 상수만 바꿔도 두 결과가 어긋난다(화면은 6도, PNG는 5도).
- 디버깅 비용 폭증.

`getPieceLayout`을 함수로 둔 덕분에 **양쪽이 같은 값을 보장**한다. CSS에서는:
```tsx
// CollagePreviewClient.tsx:236-240
const layout = getPieceLayout(slotIndex)
<div style={{ transform: `rotate(${layout.rotateDeg}deg) scale(${layout.scale})`, marginTop: `${layout.marginTopPx}px` }}>
```
Canvas에서는:
```typescript
// render-collage-to-blob.ts:177-186
const layout = getPieceLayout(i)
ctx.translate(cx, cy)
ctx.rotate((layout.rotateDeg * Math.PI) / 180)  // deg→rad
ctx.scale(layout.scale, layout.scale)
```

**한 가지 미세 보정**: `marginTopPx`는 미리보기 셀(64px) 기준으로 만들어졌는데, PNG 셀은 크기가 다르다(1080px 캔버스 안에서 셀이 커짐). 그래서 비율로 스케일:
```typescript
// render-collage-to-blob.ts:168-170
const previewCellSize = 64
const exportCellSize = rects[0]?.w ?? previewCellSize
const marginScale = exportCellSize / previewCellSize
// ...
const cy = rect.y + rect.h / 2 + layout.marginTopPx * marginScale
```
회전·스케일은 단위가 비율(deg, ratio)이라 그대로 써도 되지만, marginTopPx는 px 단위라 캔버스 크기에 맞춰 환산이 필요하다.

### 코드 어디서 쓰였나

- `src/features/compose/collage-layout.ts` — 함수 정의 (Day 6에서 만듦).
- `src/features/compose/CollagePreviewClient.tsx:231, 238-240` — 화면용.
- `src/lib/collage/render-collage-to-blob.ts:12, 177, 184-186` — PNG용.

---

## 6. 단위 테스트 불변식 — `flat()`로 데이터 일관성 고정

### 개념

`getCollageLines(lines).flat()`이 `[0, 1, …, letters.length - 1]`과 항상 같다는 약속을 **테스트로 박는다**. 문서 한 줄로 적는 것과는 다르다 — CI에서 자동 검증된다.

### 왜 이렇게 했나

불변식이 깨지면 다음이 다 깨진다:
- `rects[slotIndex] = ...`가 충돌하거나 빈 자리 생김
- 미리보기 행의 `row.map(slotIndex => ...)`이 잘못된 슬롯을 조회
- PNG 셀 배치가 어긋남

이 모든 게 **한 줄짜리 약속**(flat == [0..N-1])에 걸려 있다. 코드를 손볼 때 누가 실수로 cursor를 빼먹거나 chars.length를 잘못 셀 수 있다. 테스트가 있으면 그 순간 빨간불이 켜진다.

특히 **MOCK_CHALLENGES 전체에 대해** 불변식을 돌린다:
```typescript
// tests/unit/sentence-lines.test.ts:68-76
it("MOCK_CHALLENGES 전체에서 flat 불변식이 성립한다", () => {
  for (const challenge of MOCK_CHALLENGES) {
    const flat = getCollageLines(challenge.lines).flat()
    expect(flat).toEqual(challenge.letters.map((_, i) => i))
    expect(flat).toHaveLength(challenge.letters.length)
  }
})
```
실제 mock 데이터 10개 전부에서 `Challenge.lines` ↔ `Challenge.letters` 일관성이 확인된다. Task A의 데이터 모델 불변식(`lines.flatMap(parseSentence) === letters`)이 Task B의 레이아웃 함수까지 **연쇄적으로 검증**된다.

### 코드 어디서 쓰였나

- `tests/unit/sentence-lines.test.ts:61-66` — 단일 케이스 불변식.
- `tests/unit/sentence-lines.test.ts:68-76` — MOCK_CHALLENGES 전체 검증.
- `src/lib/collage/sentence-lines.ts:19-22` — 함수 주석에 박힌 불변식(문서 + 테스트가 짝).

---

## 7. CSS `min-w-0` + `shrink` — flex item을 콘텐츠보다 작아지게 만드는 마법

### 개념

CSS의 flexbox에서, flex item의 **기본 동작**은 "콘텐츠의 자연 너비(min-content) 아래로는 줄어들지 않는다"이다. 이게 종종 모바일에서 콘텐츠가 화면 밖으로 삐져나오게 만든다.

이걸 풀어주는 마법 같은 한 쌍이 `min-w-0`(`min-width: 0`)과 `shrink`(`flex-shrink: 1`)다.

### 왜 이렇게 했나

작은 모바일(예: iPhone SE, 폭 375px)에서 7글자가 한 줄에 들어가야 할 때:

```
375px 화면 폭
- 좌우 패딩 24px씩 → 327px 가용
- 셀 7개 + 간격 6개
- 셀이 64px 고정이면 7×64 + 6×12 = 520px → 넘침!
```

`w-16`(64px)을 고정 폭으로 주면 슬롯 7개가 화면 밖으로 나간다. 하지만 `w-16 min-w-0 shrink`로 주면:
- `w-16`: **희망 폭은 64px**
- `shrink`: **공간 부족하면 줄어들어도 좋다**
- `min-w-0`: **min-content(글자/이미지의 자연 너비) 아래로도 줄어들 수 있다**

이 셋이 합쳐져 슬롯들이 **부드럽게 줄어들면서 화면에 맞춰진다**. 정사각형 비율(`aspect-square`)은 별도라 폭이 줄어도 정사각형은 유지된다.

특히 **`min-w-0`가 핵심**이다. `shrink`만 있으면, item 안의 콘텐츠(예: 이미지)가 "이 정도는 보장해줘" 하는 자연 너비 아래로는 안 줄어든다. 한글 글자나 이미지가 들어 있으면 그 자연 너비가 의외로 크다. `min-w-0`이 그 보장을 깬다.

> **비유**: 엘리베이터 정원. 기본은 "한 사람당 최소 50cm 폭은 줘야 함"인데, 만원 출근시간에는 "어깨 부딪쳐도 좋으니 다 타라"가 `min-w-0 shrink`다.

### 코드 어디서 쓰였나

- `src/features/challenge/CaptureClient.tsx:278` — 수집 화면의 슬롯 래퍼.
- `src/features/compose/CollagePreviewClient.tsx:242` — 미리보기 화면의 슬롯 래퍼.

두 곳 모두:
```tsx
<div className="w-16 min-w-0 shrink">
  <LetterSlot ... />  {/* 안에는 aspect-square w-full */}
</div>
```

---

## 8. A2 버그 — `aspect-square w-full`이 flex 행에서 폭 0으로 붕괴

### 개념

`LetterSlot` 컴포넌트는 자기 내부에서 `aspect-square w-full`을 쓴다 — "부모 폭만큼 차지하고, 그 폭과 같은 높이로 정사각형이 돼라". 부모가 폭을 가지고 있을 때는 잘 동작한다.

문제는 **flex 행 안에 그냥 던져두면** 부모(flex item)의 폭이 콘텐츠 기준으로 결정된다. 자기는 `w-full`이고, 부모(flex item)는 "콘텐츠가 필요한 만큼"이고, 콘텐츠는 다시 `w-full`이고… **순환 참조**가 생긴다. 결과적으로 폭 0으로 붕괴해서 슬롯이 점처럼 보인다.

### 왜 이렇게 했나 (= 어떻게 고쳤나)

**부모(flex item)에 명시적인 폭 기준**을 주면 순환이 끊긴다.

```tsx
<div className="w-16 min-w-0 shrink">    {/* 부모: 폭 기준을 가진 flex item */}
  <LetterSlot ... />                       {/* 내부: w-full → 64px가 됨 */}
</div>
```

- `w-16`이 "기본 64px"라는 폭 기준을 박는다.
- 슬롯 내부의 `aspect-square w-full`은 이제 "부모 64px의 100% = 64px, 그래서 높이도 64px"로 자연스럽게 풀린다.
- 좁은 화면에서는 `shrink + min-w-0`이 부드럽게 줄어든다(7번 절).

이 패턴은 **"래퍼로 책임 분리"**의 좋은 예다:
- **래퍼**: 부모(flex)와의 관계(폭 기준, shrink 정책)를 책임진다.
- **슬롯 내부**: 자기 모양(정사각형, border, 상태별 스타일)을 책임진다.

만약 슬롯 컴포넌트 자체에 `w-16 shrink`를 박으면 — 그건 컴포넌트의 책임 범위를 침해한다. 슬롯이 다른 맥락(예: 그리드, 절대 위치)에서 쓰일 때마다 그 스타일과 싸워야 한다. 래퍼로 분리하면 **슬롯은 컨텍스트-중립**이고, 컨텍스트 적응은 호출자가 한다.

### 코드 어디서 쓰였나

- `src/features/challenge/CaptureClient.tsx:276-287` — 주석으로 명시:
  > "A2: 슬롯을 w-16 min-w-0 shrink 래퍼로 감싸 flex 행에서 폭0 붕괴를 막는다. (LetterSlot 내부 aspect-square w-full이 래퍼 폭을 채워 정사각 유지)"
- `src/features/compose/CollagePreviewClient.tsx:242` — 미리보기에도 같은 래퍼.

> Day 4.5의 **"데이터/표시 분리"**(자유 비율 crop은 데이터, 정사각 마스크는 CSS)와 같은 원리의 다른 형태: **부모 폭은 래퍼가 결정, 정사각형은 내부가 결정**.

---

## 핵심 요약 (한눈에)

| 개념 | 한 줄 요약 | 코드 위치 |
|------|-----------|-----------|
| 순수 함수 분리 | `getCollageLines` — DOM 없이 줄나눔만 책임 | `sentence-lines.ts:27-39` |
| 누적 cursor + 빈 줄 스킵 | 행 안의 index = store의 slot index 보장 | `sentence-lines.ts:28-36` |
| Canvas 셀 좌표 수학 | `min(cellW, cellH)`로 정사각·캔버스 내 보장 | `render-collage-to-blob.ts:48-90` |
| 슬롯 index로 직접 인덱싱 | `rects[slotIndex]=` — 불변식이 만든 단순함 | `render-collage-to-blob.ts:74, 83-86` |
| `getPieceLayout` 재사용 | CSS와 Canvas가 같은 변환 공유 | `CollagePreviewClient.tsx:231`, `render-collage-to-blob.ts:177` |
| flat 불변식 테스트 | CI에서 자동 검증, MOCK 전체 적용 | `sentence-lines.test.ts:61-76` |
| `min-w-0 + shrink` | flex item이 콘텐츠보다 작아지게 | `CaptureClient.tsx:278`, `CollagePreviewClient.tsx:242` |
| A2 래퍼로 폭 기준 부여 | `w-16` 래퍼 → 내부 `aspect-square w-full` 안전 | `CaptureClient.tsx:276-287` |

---

## 자주 하는 실수 (이번 변경을 응용할 때)

1. **줄 변환 로직을 컴포넌트 안에 인라인으로 적는다** — 같은 코드가 세 화면에 복제 → 한쪽 수정 시 일관성 깨짐. **순수 함수로 빼라.**

2. **셀 크기를 한 방향만 계산한다** — `cellSize = innerWidth / maxCols`만 쓰면 줄이 많을 때 세로로 넘친다. **`min(cellW, cellH)`가 정답.**

3. **2차원 구조를 끝까지 들고 다닌다** — 좌표 계산 함수까지 `CellRect[][]`로 받으면 호출자가 복잡해진다. **불변식으로 1차원 인덱싱이 되면 쓰자.**

4. **CSS의 transform을 PNG 생성에서 따로 또 적는다** — `getPieceLayout` 같은 함수를 재사용. 단, **단위 환산**(deg/rad, marginPx 비율)은 명시적으로.

5. **flex item에 `min-w-0`을 빼먹는다** — 콘텐츠가 자연 너비 이하로 안 줄어들어 좁은 화면에서 화면 밖으로 튀어나간다. **모바일 우선 프로젝트에서 거의 항상 필요.**

6. **컴포넌트에 컨텍스트 의존 스타일을 박는다** — 슬롯 자체에 `w-16 shrink`를 박으면 다른 맥락(그리드, 절대 위치)에서 쓸 때 충돌. **래퍼로 분리하라.**

7. **불변식을 주석에만 적는다** — Task A에서 본 패턴 그대로: 주석 + 테스트 둘 다 있어야 강제된다.

---

## Task A·B를 합치면 보이는 큰 그림

```
[데이터 계층 — Task A]
challenge.lines (단일 소스)
   ↓ 팩토리에서 파생
sentence = lines.join(" ")
letters  = lines.flatMap(parseSentence)

[레이아웃 계층 — Task B]
challenge.lines
   ↓ getCollageLines (순수 함수)
2차원 슬롯 index 배열  ←─── 세 화면이 같이 본다
   ↓                ↓                ↓
수집 CSS          미리보기 CSS       PNG Canvas
(flex 행 스택)     (flex 행 스택)     (getLineCellRects)
   ↓                ↓                ↓
+ getPieceLayout (회전/스케일/marginTop) — 화면과 PNG가 공유
```

**한 개의 진실(`lines`)에서 출발해, 한 개의 변환 함수(`getCollageLines`)를 거쳐, 세 화면이 같은 결과를 본다.** 이게 Task A+B의 합작이다. Day 4.5·5·6에서 반복된 **"데이터 ≠ 표시, 한 함수에서 계산해 여러 곳이 소비"** 원칙의 완성형이다.

다음 단계의 함의:
- **Task C**: PNG export에 줄 구조를 충실히 반영해 실기기 검증 (이미 변경에 포함됐지만 디바이스 테스트 필요).
- **Phase 2 백엔드**: `challenge.lines`가 DB 컬럼으로 옮겨가도 같은 함수가 그대로 작동.
- **콜라주 레이아웃 옵션 확장**: 정렬(좌/우/중앙), 줄 간격 조정 등을 추가할 때, **단일 함수만 확장**하면 세 화면이 같이 따라온다.

> 관련 개념의 상세 설명은 `docs/learning/learning-first-roadmap.md`의 Phase 1을 참고. 직전 노트는 `docs/learning/phase-1-authored-lines-task-a.md`, Day 6은 `docs/learning/phase-1-day-6.md`.
