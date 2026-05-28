# Phase 1 Day 4.5 — Slot Thumbnail Fit 학습 노트

> 커밋: `4c6b8d1` fix: clip letter slot thumbnail to rounded-square mask

---

## 1. 오늘 수정한 문제 요약

Day 4에서 crop 기능을 **자유 비율**(react-image-crop)로 바꾸면서 새로운 표시 문제가 생겼다.

**문제**: 사용자가 가로로 길거나 세로로 긴 영역을 crop하면, 그 결과 이미지의 비율이 **정사각형 슬롯**과 맞지 않았다. 잘라낸 이미지가:
- 슬롯의 둥근 모서리(`rounded-xl`)를 **삐져나오거나**
- 슬롯 경계(border) **밖으로 넘쳐** 보이거나
- 비율이 안 맞아 **찌그러져** 보였다

**원인**: 기존 코드는 `<img>`에 `absolute inset-1 rounded-lg object-cover`만 줬다. 이미지 자체에 둥근 모서리를 줬지만, 이미지의 실제 비율과 슬롯 비율이 다를 때 깔끔하게 잘리지 않았다.

**해결**: 이미지를 **마스크 컨테이너(`<span>`)**로 감쌌다.

```tsx
// 변경 전
<img src={imageDataUrl} className="absolute inset-1 rounded-lg object-cover" />

// 변경 후
<span className="absolute inset-0 overflow-hidden rounded-[inherit]">
  <img src={imageDataUrl} className="h-full w-full object-cover" />
</span>
```

핵심 아이디어: **"이미지를 직접 둥글게 만들지 말고, 둥근 창문(컨테이너)으로 이미지를 들여다보게 한다."**

추가로, 체크 배지(✓)는 마스크 **밖**에 두어 잘리지 않게 했다. (배지는 슬롯 모서리 바깥으로 `-right-1 -top-1`만큼 튀어나오는데, `overflow-hidden` 안에 있으면 잘려버리기 때문)

---

## 2. 핵심 CSS 개념 설명

### 2-1. `aspect-ratio` / `aspect-square`

요소의 **가로:세로 비율을 고정**하는 CSS 속성이다. Tailwind의 `aspect-square`는 `aspect-ratio: 1 / 1`(정사각형)을 뜻한다.

```tsx
// LetterSlot.tsx:25
"relative flex aspect-square w-full ..."
```

**왜 중요한가**: 슬롯은 `w-full`로 그리드 칸 너비에 맞춰 늘어난다. 너비가 어떻든 `aspect-square`가 높이를 너비와 같게 강제하므로, 슬롯은 **항상 정사각형**을 유지한다. 화면 크기가 달라도 슬롯 모양이 일정하다.

**비유**: 액자 틀을 "가로 세로 같은 정사각형"으로 못 박아두는 것. 안에 무엇을 넣든 액자 모양은 변하지 않는다.

**높이를 직접 px로 안 주는 이유**: 반응형. 작은 폰과 큰 폰에서 슬롯 너비가 다른데, `aspect-square`면 높이가 자동으로 따라온다. `height: 80px`처럼 고정하면 너비와 안 맞아 직사각형이 될 수 있다.

---

### 2-2. `overflow-hidden`

요소 경계를 **벗어나는 자식 콘텐츠를 잘라내는(숨기는)** 속성이다. 이번 수정의 핵심 도구다.

```tsx
// LetterSlot.tsx:37
<span className="absolute inset-0 overflow-hidden rounded-[inherit]">
  <img className="h-full w-full object-cover" />
</span>
```

`<img>`가 `object-cover`로 컨테이너를 꽉 채우다 보면 일부가 컨테이너 밖으로 넘친다. `overflow-hidden`이 그 넘친 부분을 **싹둑 잘라낸다**.

**비유**: 창문(컨테이너)으로 풍경(이미지)을 보는 것. 창문 밖의 풍경은 벽에 가려 안 보인다. `overflow-hidden`이 그 "벽" 역할을 한다.

**`overflow-hidden`이 없으면**: 이미지가 컨테이너 밖으로 그대로 삐져나와 옆 슬롯을 침범하거나 레이아웃을 깬다.

---

### 2-3. `border-radius` clipping (`rounded-[inherit]`)

둥근 모서리로 콘텐츠를 잘라내려면 **두 가지가 함께** 필요하다:
1. `border-radius` (둥글기)
2. `overflow-hidden` (그 둥근 선을 따라 잘라내기)

```tsx
// 부모 버튼: rounded-xl (큰 둥글기)
<button className="... rounded-xl border-2 ...">
  // 마스크: rounded-[inherit] → 부모의 rounded-xl을 그대로 상속
  <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
    <img className="h-full w-full object-cover" />
  </span>
```

**`rounded-[inherit]`의 의미**: "부모(버튼)의 `border-radius` 값을 그대로 물려받아라." 버튼이 `rounded-xl`이든 나중에 `rounded-2xl`로 바뀌든, 마스크가 자동으로 같은 둥글기를 따른다. **값을 두 군데 하드코딩하지 않아 한쪽만 바꿔도 어긋나지 않는다.**

**왜 `overflow-hidden` 없이 `rounded`만 주면 안 되나**: `border-radius`는 "요소 자신의 배경/테두리"만 둥글게 한다. 자식(이미지)을 둥근 선대로 자르려면 `overflow-hidden`이 있어야 한다. 둘은 항상 짝이다.

**기존 코드의 한계**: 변경 전에는 `<img>`에 직접 `rounded-lg`를 줬다. 이미지의 사각형 모서리는 둥글어졌지만, `object-cover`로 넘친 부분과 부모 둥글기(`rounded-xl`)의 미세한 차이 때문에 깔끔하게 안 맞았다. 마스크 컨테이너 방식이 더 견고하다.

---

### 2-4. `object-fit: cover`

`<img>`나 `<video>`가 **자기 박스를 어떻게 채울지** 정하는 속성이다. `object-cover`(Tailwind) = `object-fit: cover`.

```tsx
// LetterSlot.tsx:42
<img className="h-full w-full object-cover" />
```

**`object-cover`의 동작**: 비율을 유지한 채, 박스를 **빈틈없이 꽉 채운다.** 비율이 안 맞으면 넘치는 부분을 **잘라낸다(crop)**.

```
원본 이미지 (가로로 긴 사진)        정사각형 슬롯 + object-cover
┌──────────────────────┐          ┌──────────┐
│                      │          │ (양옆이  │
│   가로로 긴 사진      │  ──────→ │  잘리고  │
│                      │          │  중앙만) │
└──────────────────────┘          └──────────┘
```

세로:가로 비율이 슬롯과 달라도 **찌그러지지 않고**, 대신 넘치는 영역이 잘린다. 이미지 본래 모양은 보존된다.

**왜 `h-full w-full`과 함께 쓰나**: `object-cover`는 "박스를 채운다"는 규칙인데, 박스 크기를 정해줘야 한다. `h-full w-full`로 박스를 마스크 컨테이너 전체 크기로 만들고, 그 안을 `cover`로 채운다.

---

### 2-5. `object-fit: contain` vs `cover`의 차이

같은 `object-fit` 가족이지만 정반대 전략이다.

| | `cover` | `contain` |
|---|---------|-----------|
| 목표 | 박스를 **꽉 채움** | 이미지를 **전부 보여줌** |
| 비율 안 맞으면 | 넘치는 부분 **잘라냄** | 빈 공간(여백) **생김** |
| 잘림 | 있음 | 없음 |
| 여백(레터박스) | 없음 | 있음 |
| 적합한 곳 | 썸네일, 배경, 꽉 찬 카드 | 로고, 전체를 봐야 하는 도표 |

```
object-cover (슬롯에 채택)        object-contain (대안)
┌──────────┐                      ┌──────────┐
│██████████│ ← 꽉 참              │  ▓▓▓▓▓▓  │ ← 위아래 여백
│██████████│   (양옆 잘림)        │  ▓▓▓▓▓▓  │   (전체 보이나
│██████████│                      │  ▓▓▓▓▓▓  │    빈 공간)
└──────────┘                      └──────────┘
```

**이 프로젝트가 `cover`를 택한 이유**: 슬롯은 콜라주의 한 칸이다. 빈 여백이 있으면 콜라주가 듬성듬성 비어 보인다. 글자 일부가 살짝 잘려도 **꽉 찬 모습**이 콜라주 미학에 맞다. 게다가 사용자가 이미 crop 단계에서 원하는 영역을 골랐으므로, 슬롯에서 약간 더 잘려도 핵심 글자는 보존된다.

---

### 2-6. `absolute inset-0` 이미지 배치

`position: absolute` + `inset: 0`은 요소를 **가장 가까운 `relative` 부모의 네 모서리에 딱 붙여 꽉 채우는** 관용구다.

```tsx
// 부모 버튼: relative (LetterSlot.tsx:25)
<button className="relative ...">
  // 마스크: absolute inset-0 → 버튼을 완전히 덮음 (LetterSlot.tsx:37)
  <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
```

`inset-0`은 `top:0; right:0; bottom:0; left:0`의 줄임이다. 네 방향을 모두 0으로 붙이면 부모를 빈틈없이 덮는다.

**`inset-0`(변경 후) vs `inset-1`(변경 전)의 차이**:
- 기존 `inset-1`: 사방 4px 안쪽으로 들여서 배치 → 테두리와 이미지 사이 미세한 틈. 둥글기와 어긋날 여지.
- 현재 `inset-0`: 버튼 경계에 완전히 밀착 → 마스크가 버튼 전체를 덮고, `rounded-[inherit] + overflow-hidden`이 둥근 모서리를 정확히 따라 자른다.

**왜 부모에 `relative`가 필요한가**: `absolute`는 "가장 가까운 위치 지정된(`relative`/`absolute`) 조상" 기준으로 배치된다. 버튼이 `relative`라서 마스크가 버튼 기준으로 꽉 찬다. 만약 `relative` 부모가 없으면 페이지 전체 기준으로 배치되어 엉뚱한 곳에 간다.

---

### 2-7. 이미지 비율 ≠ thumbnail 비율일 때의 표시 정책

이번 수정의 본질은 **"비율이 다른 두 사각형을 어떻게 화해시킬 것인가"**라는 정책 결정이다.

- **이미지**: 자유 비율 (가로로 길 수도, 세로로 길 수도, 정사각형일 수도)
- **슬롯 thumbnail**: 항상 정사각형 (`aspect-square`)

비율이 다를 때 선택지는 세 가지다:

| 정책 | CSS | 결과 | 채택? |
|------|-----|------|-------|
| 늘려서 맞춤 | `object-fill` | **찌그러짐** (글자 왜곡) | ✗ |
| 전부 보여줌 | `object-contain` | 여백 생김 (콜라주 빈틈) | ✗ |
| 꽉 채우고 자름 | `object-cover` + 마스크 | 약간 잘리나 꽉 참, 왜곡 없음 | ✓ |

이 프로젝트는 **3번(cover + 마스크)**을 택했다. 글자 왜곡이 가장 나쁘고(가독성 파괴), 여백은 콜라주 미학을 해치므로, "약간 잘리되 꽉 차고 왜곡 없는" 절충이 최선이다.

**마스크 컨테이너가 정책을 완성하는 이유**: `object-cover`만으로는 넘친 이미지가 둥근 모서리를 삐져나온다. `overflow-hidden + rounded-[inherit]` 마스크가 "넘친 부분을 둥근 선대로 정확히 잘라내" 정책을 시각적으로 완성한다.

---

### 2-8. crop 데이터는 자유 비율로 유지하고, thumbnail만 정사각형 마스크로 보여주는 이유

이것이 가장 중요한 설계 판단이다. **"데이터(원본 진실)와 표시(UI 마스크)를 분리한다."**

```
[데이터 레이어]  crop 결과 Blob — 사용자가 고른 자유 비율 그대로 보존
       │           (가로 3:2, 세로 2:3, 정사각형 1:1 등 무엇이든)
       │
       ▼  (UI는 데이터를 건드리지 않고, 보여주는 방식만 결정)
[표시 레이어]    슬롯 thumbnail — object-cover + 정사각형 마스크로 표시
                 콜라주 preview — (Day 5에서) 또 다른 비율/레이아웃으로 표시 가능
```

**왜 crop을 정사각형으로 강제하지 않는가**:

1. **진실을 보존**: 사용자가 가로로 긴 간판 글자("환영합니다"의 한 글자)를 정밀하게 잘랐다면 그 비율 자체가 의미 있는 데이터다. 정사각형으로 강제 crop하면 정보가 영구 손실된다.

2. **표시는 맥락마다 다르다**: 같은 글자 이미지를 슬롯에선 정사각형 썸네일로, 콜라주에선 다른 레이아웃으로, 공유 카드에선 또 다르게 보여줄 수 있다. 데이터가 자유 비율이어야 각 맥락이 자유롭게 표시한다.

3. **관심사 분리**: crop 로직(데이터)은 "어디를 잘랐나"만 책임지고, 슬롯 컴포넌트(표시)는 "어떻게 보여줄까"만 책임진다. 한쪽을 바꿔도 다른 쪽이 안 깨진다. 실제로 이번 수정은 **`LetterSlot.tsx` 한 파일, CSS만** 바꿨다. crop 데이터·store·Object URL 로직은 전혀 건드리지 않았다.

**비유**: 사진(데이터)은 원본 그대로 보관하고, 액자(UI)마다 다른 매트(마스크)를 끼워 보여주는 것. 사진을 가위로 자르지(데이터 손상) 않는다.

이 원칙은 Day 2에서 배운 **derived state**("하나의 진실에서 표시를 계산")의 시각적 버전이다.

---

### 2-9. `z-index` 쌓임과 배지를 마스크 밖에 두는 이유

마스크는 `absolute inset-0`로 버튼을 덮으므로, 그 위에 글자/배지를 올리려면 **쌓임 순서(z-index)** 관리가 필요하다.

```tsx
<span className="absolute inset-0 overflow-hidden rounded-[inherit]"> ... </span>  // 마스크 (바닥)
<span className="relative z-10 ...">{character}</span>                              // 글자 (위)
<span className="absolute -right-1 -top-1 z-10 ...">✓</span>                         // 배지 (위)
```

글자와 배지에 `z-10`을 줘서 마스크 이미지 위에 표시되게 했다.

**배지를 마스크 밖(형제)으로 둔 핵심 이유**: 배지는 `-right-1 -top-1`로 슬롯 모서리 **바깥으로 튀어나온다**. 만약 배지가 `overflow-hidden` 마스크 **안**에 있으면, 튀어나온 부분이 잘려 반쪽 배지가 된다. 그래서 배지를 마스크의 **형제 요소**로 빼서, `overflow-hidden`의 영향을 받지 않게 했다.

```
배지가 마스크 안 (잘못)         배지가 마스크 밖 (수정)
┌──────────┐                    ┌──────────┐✓ ← 온전한 배지
│        ◖ │ ← 반쪽 배지        │          │
│ (overflow│   (잘림)           │          │
│  -hidden)│                    │          │
└──────────┘                    └──────────┘
```

---

### 2-10. 왜 이 수정이 Day 5 persist/EXIF 작업 전에 필요한가

Day 5에서는 **persist(이어하기 복원)**와 **EXIF strip**을 다룬다. 이번 thumbnail 수정이 그 전에 와야 하는 이유:

1. **표시 레이어를 먼저 안정화해야 한다.** persist는 "저장했다가 다시 불러와 **표시**"하는 기능이다. 표시(슬롯 썸네일)가 깨진 상태에서 persist를 만들면, 복원해도 깨진 화면이 나온다. 표시가 올바른지 먼저 확정해야 복원 결과를 신뢰할 수 있다.

2. **데이터/표시 분리가 persist 설계의 전제다.** 2-8에서 본 "crop 데이터는 자유 비율, 표시는 마스크" 원칙이 자리잡아야, Day 5에서 "무엇을 저장(데이터)하고 무엇을 다시 계산(표시)할지"를 깔끔히 가른다. 자유 비율 Blob만 저장하면 되고, 정사각형 마스크는 복원 후 CSS가 알아서 한다 — 저장 대상이 단순해진다.

3. **EXIF 회전과 표시의 상호작용.** EXIF orientation 때문에 이미지가 회전되어 보일 수 있다. 표시 정책(`object-cover` + 마스크)이 명확해야, Day 5에서 EXIF 회전 보정이 썸네일에 어떻게 반영되는지 정확히 검증할 수 있다. 표시가 흔들리면 EXIF 버그인지 CSS 버그인지 구분이 안 된다.

4. **시각적 회귀의 기준선(baseline).** 지금 썸네일이 올바르게 보이는 상태를 확정해두면, Day 5 작업 후 "썸네일이 여전히 똑같이 보이는가"로 회귀를 판단할 수 있다. 기준선 없이 큰 변경을 쌓으면 무엇이 깨뜨렸는지 추적이 어렵다.

**한 줄 요약**: persist/EXIF는 "데이터를 다루는" 작업이고, 그 결과는 결국 슬롯에 **표시**된다. 표시 레이어가 견고해야 데이터 작업의 성공/실패를 눈으로 확인할 수 있다.

---

## 3. 이 프로젝트에서 개념이 쓰인 파일

| 개념 | 파일:줄 |
|------|---------|
| `aspect-square` (정사각형 슬롯) | `LetterSlot.tsx:25` |
| `relative` (마스크 배치 기준) | `LetterSlot.tsx:25` |
| 마스크 컨테이너 (`absolute inset-0 overflow-hidden rounded-[inherit]`) | `LetterSlot.tsx:37` |
| `object-cover` + `h-full w-full` | `LetterSlot.tsx:42` |
| 글자 텍스트 `z-10` (마스크 위로) | `LetterSlot.tsx:49` |
| 배지를 마스크 밖 형제로 + `z-10` | `LetterSlot.tsx:60-63` |
| crop 자유 비율 데이터 생성 (표시와 분리된 데이터) | `crop-image.ts` / `ImageCropperModal.tsx` (Day 4) |
| 슬롯에 Object URL 전달 | `CaptureClient.tsx` → `LetterSlot` props (Day 3·4) |

---

## 4. 자주 하는 실수

### 실수 1: `overflow-hidden` 없이 `rounded`만 준다

```tsx
// 나쁜 예 — 자식 이미지가 둥근 모서리를 삐져나옴
<span className="absolute inset-0 rounded-xl">
  <img className="h-full w-full object-cover" />
</span>

// 좋은 예 — overflow-hidden이 둥근 선대로 잘라냄
<span className="absolute inset-0 overflow-hidden rounded-xl">
  <img className="h-full w-full object-cover" />
</span>
```

`border-radius`는 요소 자신만 둥글게 한다. 자식을 둥글게 자르려면 `overflow-hidden`이 짝으로 필요하다.

### 실수 2: `object-cover`를 빼먹어 이미지가 찌그러진다

```tsx
// 나쁜 예 — 비율 무시하고 박스에 강제로 늘림 → 글자 왜곡
<img className="h-full w-full" />

// 좋은 예 — 비율 유지하며 채우고 넘침만 잘라냄
<img className="h-full w-full object-cover" />
```

`object-fit`을 지정 안 하면 기본값 `fill`이라 이미지가 박스 모양대로 늘어나 찌그러진다.

### 실수 3: 음수 오프셋 요소(배지)를 `overflow-hidden` 안에 둔다

```tsx
// 나쁜 예 — 배지가 -right-1 -top-1로 튀어나오는데 마스크 안 → 잘림
<span className="overflow-hidden">
  <img ... />
  <span className="absolute -right-1 -top-1">✓</span>  // 반쪽 잘림
</span>

// 좋은 예 — 배지를 마스크 밖 형제로
<span className="overflow-hidden"><img ... /></span>
<span className="absolute -right-1 -top-1 z-10">✓</span>
```

### 실수 4: `relative` 부모 없이 `absolute`를 쓴다

```tsx
// 나쁜 예 — 기준 부모가 없어 페이지 전체 기준으로 배치됨
<button className="aspect-square">
  <span className="absolute inset-0">...</span>  // 엉뚱한 위치
</button>

// 좋은 예 — 부모에 relative
<button className="relative aspect-square">
  <span className="absolute inset-0">...</span>  // 버튼 기준 꽉 참
</button>
```

### 실수 5: 둥글기 값을 두 군데 하드코딩한다

```tsx
// 나쁜 예 — 부모는 rounded-xl, 마스크는 rounded-lg → 모서리 어긋남
<button className="rounded-xl">
  <span className="absolute inset-0 overflow-hidden rounded-lg">

// 좋은 예 — rounded-[inherit]로 부모 값 상속 → 항상 일치
<button className="rounded-xl">
  <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
```

### 실수 6: crop 단계에서 정사각형을 강제해 데이터를 손상한다

표시 문제를 데이터에서 해결하려는 유혹. crop을 1:1로 강제하면 표시는 편해지지만 **사용자가 고른 비율 정보가 영구 손실**된다. 표시 문제는 표시 레이어(CSS 마스크)에서 푼다.

---

## 5. 모바일 수동 테스트 체크리스트

### 다양한 crop 비율
- [ ] **가로로 긴** 영역을 crop → 슬롯에 꽉 차고 양옆이 자연스럽게 잘리는가 (찌그러짐 없음)
- [ ] **세로로 긴** 영역을 crop → 슬롯에 꽉 차고 위아래가 잘리는가
- [ ] **정사각형**에 가깝게 crop → 거의 안 잘리고 꽉 차는가
- [ ] **아주 가는** 영역(예: "ㅣ" 같은 세로획) → 찌그러지지 않는가

### 마스크 경계
- [ ] 이미지가 슬롯 **둥근 모서리**를 삐져나오지 않는가
- [ ] 이미지가 슬롯 **테두리(border)** 밖으로 넘치지 않는가
- [ ] 이미지가 옆 슬롯을 침범하지 않는가
- [ ] 슬롯 모서리 둥글기가 빈 슬롯과 채운 슬롯이 동일한가

### 배지·글자
- [ ] 체크 배지(✓)가 **온전히** 보이는가 (반쪽 잘림 없음)
- [ ] 배지가 슬롯 우상단 모서리에 올바르게 떠 있는가
- [ ] 채운 슬롯에서 글자 텍스트는 안 보이고(sr-only) 이미지만 보이는가

### 반응형
- [ ] 작은 폰(예: iPhone SE)에서 슬롯이 정사각형을 유지하는가
- [ ] 큰 폰/태블릿에서도 슬롯이 정사각형이고 이미지가 꽉 차는가
- [ ] 글자 수에 따른 그리드 변화(4칸/3칸/4칸)에서 모든 슬롯이 일관되게 보이는가

### 상태 전환
- [ ] active(선택) 슬롯의 ring/테두리가 이미지 위에 올바르게 보이는가
- [ ] 이미지 교체 후에도 새 이미지가 동일하게 마스크에 맞는가
- [ ] 6개 슬롯을 서로 다른 비율로 채워도 그리드가 가지런한가

---

## 6. Day 5 전에 이해하면 좋은 개념

Day 5(persist 복원 · EXIF strip · WebP 전환)를 앞두고:

| 개념 | 왜 필요한가 | 핵심 |
|------|------------|------|
| **EXIF orientation** | 모바일 사진이 회전돼 보이는 문제 | Canvas re-draw로 보정 — 보정 결과가 `object-cover` 마스크에 어떻게 표시되는지 검증 |
| **IndexedDB** | Object URL은 새로고침 시 사라짐(Day 3) | Blob을 IndexedDB에 저장 → 복원 시 다시 Object URL 생성 → 슬롯 표시 |
| **데이터/표시 분리 (재확인)** | persist 설계의 전제 | 자유 비율 Blob만 저장, 정사각형 마스크는 CSS가 복원 후 처리 |
| **Blob 직렬화 가능성** | localStorage는 문자열만, Blob은 못 담음 | IndexedDB는 Blob을 직접 저장 가능 — 그래서 IndexedDB |
| **시각적 회귀 테스트** | 큰 변경 후 표시가 안 깨졌는지 확인 | 이번에 확정한 썸네일 모습이 기준선 |
| **WebP `object-cover` 호환** | WebP 전환 시 표시 동일성 | 포맷이 바뀌어도 마스크/cover 정책은 그대로 작동해야 함 |

**Day 5 persist로 가는 연결고리**: 이번 수정으로 "**표시는 CSS 마스크가 책임진다**"가 확정됐다. 따라서 Day 5에서 저장해야 할 것은 **자유 비율 crop Blob 하나**뿐이다. 복원 시 그 Blob으로 Object URL을 다시 만들어 슬롯에 넣으면, `aspect-square` + `object-cover` + 마스크가 알아서 정사각형으로 보여준다. **데이터는 단순하게, 표시는 CSS에 위임** — 이 분리가 persist를 단순하게 만든다.

> 관련 개념의 상세 설명은 `docs/learning/learning-first-roadmap.md`의 Phase 1(#13 EXIF) 및 Phase 5(성능·next/image)를 참고.
