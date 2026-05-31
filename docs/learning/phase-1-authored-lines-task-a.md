# Phase 1 — Task A: 작성자 지정 `Challenge.lines` 데이터 모델 학습 노트

> 작업 브랜치: `phase1-authored-collage-lines`
> 변경 파일: `src/types/index.ts`, `src/lib/constants/challenges.ts`, `tests/unit/challenge-store.test.ts`

---

## 이 작업이 한 일 (한 문장)

콜라주의 **줄 배치를 작성자가 직접 지정**할 수 있도록, `Challenge`의 단일 소스를 `sentence`(한 문장)에서 `lines`(줄 배열)로 바꾸고, `sentence`와 `letters`는 **파생값**으로 만들었다.

**전(before)**:
```typescript
// 작성자는 한 문장만 줄 수 있었다. 줄바꿈을 의도할 방법이 없음.
challenge("1", "오늘도 화이팅", "2026-05-26")
//             └─ sentence (소스)
//   letters = parseSentence(sentence)  ← 자동 계산
```

**후(after)**:
```typescript
// 작성자가 줄 배치를 직접 정한다. 콜라주 3개 화면이 모두 이 배열을 따른다.
challenge("1", ["오늘도", "화이팅"], "2026-05-26")
//             └─ lines (소스, 줄 배열)
//   sentence = "오늘도 화이팅"           ← lines.join(" ")
//   letters  = ["오","늘","도","화","이","팅"]  ← lines.flatMap(parseSentence)
```

작성자가 "오늘도 / 화이팅" 두 줄로 콜라주를 만들고 싶을 때, 이제 그 의도가 데이터에 그대로 들어간다. 수집·preview·PNG 세 화면이 같은 `lines` 배열을 보고 줄을 나눈다.

---

## 1. 단일 소스(single source of truth) 데이터 모델링

### 개념

같은 정보를 여러 곳에 따로 적어두면, 그중 어디 하나가 바뀌었을 때 **나머지와 어긋난다**. "어디가 진짜냐" 헷갈리게 된다. 이를 방지하기 위해 **한 곳만 진짜(source of truth)로 정하고, 나머지는 거기서 계산해서 만든다**.

### 왜 이렇게 했나

전에는 `sentence: "오늘도 화이팅"` 한 줄이 소스였다. 그러면 **콜라주의 줄 나눔을 작성자가 지정할 수 없다.** "오늘도"와 "화이팅"을 두 줄로 보여주고 싶어도, 문장에서 그 의도를 복원할 방법이 없다 — 공백으로 자르면 "오늘도 / 화이팅"이 될 수도, 그냥 한 줄이 될 수도 있다. 화면(수집/preview/PNG)마다 다르게 추측하면 **세 화면의 줄바꿈이 어긋난다**.

`lines: ["오늘도", "화이팅"]`를 소스로 두면 작성자의 의도가 데이터에 박힌다. **세 화면 모두 같은 배열을 그대로 따라가면 자동으로 일관된다.** 화면별 추측이 없어진다.

### 코드 어디서 쓰였나

- `src/types/index.ts:3-7` — 타입 정의의 JSDoc이 명시한다:
  > "작성자가 정의한 줄 배치. 콜라주 **단일 소스(single source of truth)**. 수집·preview·PNG 세 화면이 모두 이 배열을 그대로 따른다."
- `src/lib/constants/challenges.ts:9-17` — 팩토리 시그니처가 `lines: string[]`을 받는다(다른 둘은 안 받음 → 외부에서 따로 적어 넣을 수 없음).

---

## 2. 파생값(derived value) — `sentence`와 `letters`는 계산값이다

### 개념

데이터 필드 중 일부를 **저장하지 않고 매번 계산해서 얻는다**. 이 값들은 소스가 정해지는 순간 **자동으로 결정**되므로, 따로 저장하면 오히려 어긋날 위험만 생긴다.

### 왜 이렇게 했나

`sentence`와 `letters`는 `lines`만 있으면 **결정적으로** 계산할 수 있다:

```typescript
sentence = lines.join(" ")              // 줄들을 공백으로 합치면 끝
letters  = lines.flatMap(parseSentence) // 각 줄을 한글 글자로 쪼개고 평탄화
```

만약 이 둘을 작성자에게 따로 입력받으면 어떻게 될까? 작성자가 실수로 `lines: ["오늘도", "화이팅"]`인데 `sentence: "안녕하세요"`로 적으면 데이터가 거짓말을 한다. 화면마다 다른 값을 믿어서 버그가 난다.

**파생값으로 두면 그 버그가 원천 차단된다.** `sentence`는 항상 `lines.join(" ")`이고, `letters`는 항상 `lines.flatMap(parseSentence)`다. 어긋날 수가 없다.

이는 Day 2 노트의 **derived state**(컴포넌트에서 `filledCount`를 저장하지 않고 매번 계산)와 **같은 원리의 데이터 모델 버전**이다. UI 상태도, 데이터 모델도, "하나의 진실에서 나머지를 계산한다"는 원칙은 똑같다.

### 코드 어디서 쓰였나

- `src/types/index.ts:8-11` — 두 필드 모두 **JSDoc에 "파생값"임을 명시**한다:
  > `sentence` — "파생값: `lines.join(" ")`. 표시·SEO용 한 문장."
  > `letters` — "파생값: `lines.flatMap(parseSentence)`. 슬롯 글자 배열."

  타입에 남아있는 이유: 화면 코드(`<h1>{challenge.sentence}</h1>`, `slots = challenge.letters.map(...)`)가 변경 없이 그대로 작동하게 하려고. **인터페이스의 안정성**과 **소스의 단일성**을 둘 다 챙긴다.

- `src/lib/constants/challenges.ts:13-14` — 실제 계산 위치:
  ```typescript
  sentence: lines.join(" "),
  letters: lines.flatMap(parseSentence),
  ```

> **왜 굳이 타입에 보관해 두나?** 파생값을 매번 컴포넌트에서 계산하게 만들 수도 있지만(`challenge.lines.join(" ")`), 그러면 모든 사용처에 똑같은 계산식이 흩어진다. **팩토리에서 한 번만 계산해 객체에 박아 두면**, 사용처는 그냥 `challenge.sentence`만 읽으면 된다 — 단순함은 유지하면서, 계산식은 **한 곳**에만 존재한다.

---

## 3. 팩토리 함수 — 파생·불변식을 한 곳에서 강제

### 개념

객체를 만드는 **모든 경로를 함수 하나에 모은다**. 그러면 그 함수 안에서 "어떻게 생성해야 옳은가"의 규칙을 100% 강제할 수 있다. 외부에서는 누구도 그 규칙을 어길 수 없다.

### 왜 이렇게 했나

만약 `MOCK_CHALLENGES`를 객체 리터럴로 직접 적으면:
```typescript
// 위험한 예 — 누군가 실수로 lines와 sentence를 다르게 쓸 수 있음
{ id: "1", lines: ["오늘도", "화이팅"], sentence: "오늘도 안녕", letters: ["오","늘","도","안","녕"], activeDate: "..." }
```
타입 검사는 통과한다(모든 필드 있음). 하지만 데이터는 거짓말이다. 화면이 깨진다.

팩토리 `challenge(id, lines, activeDate)`는 **`lines`만 받고** `sentence`와 `letters`를 **내부에서 계산해 박는다**. 외부에서는 `sentence`나 `letters`를 따로 줄 통로가 없다 — 시그니처에 그 인자가 없으니까. 결과적으로:

- 항상 `sentence === lines.join(" ")`
- 항상 `letters === lines.flatMap(parseSentence)`

가 **컴파일 타임에 보장**된다. 객체를 만들 수 있는 **유일한 합법 경로**가 이 함수뿐이다(아래 MOCK_CHALLENGES 모두 이 함수를 통과한다).

### 코드 어디서 쓰였나

- `src/lib/constants/challenges.ts:9-17` — 팩토리 정의. 주석에 불변식까지 못 박았다:
  > "불변식: `lines.join(" ") === sentence`, `lines.flatMap(parseSentence) === letters`."
- `src/lib/constants/challenges.ts:19-30` — 10개 mock 챌린지 모두 팩토리를 통과:
  ```typescript
  challenge("1", ["오늘도", "화이팅"], "2026-05-26"),
  challenge("2", ["참 좋은 날"], "2026-05-27"),
  challenge("3", ["어서 오세요"], "2026-05-28"),
  ...
  ```

> **언제 팩토리가 빛나나**: 객체에 "여러 필드 간의 약속(불변식)"이 있을 때. 자유롭게 객체 리터럴을 쓰게 두면 그 약속이 깨진다. 팩토리로 한 곳에만 생성 경로를 두면 약속이 **항상 지켜진다**.

---

## 4. 데이터 불변식(invariants)

### 개념

여러 필드 사이에 **항상 성립해야 하는 등식·규칙**. 예: "이 객체에서는 A === f(B)가 항상 참이다."

### 왜 이렇게 했나

이 데이터 모델의 핵심 불변식은 두 개다:

1. **`lines.join(" ") === sentence`**
   — sentence는 줄들을 공백으로 합친 결과여야만 한다.
2. **`lines.flatMap(parseSentence) === letters`**
   — letters는 각 줄을 한글로 쪼개 평탄화한 결과여야만 한다.

이 불변식이 **사용자(작성자)의 의도와 화면 표시가 일치한다는 보증**이다. 작성자가 "오늘도 / 화이팅" 두 줄을 의도했으면, 정확히 그 줄들을 합친 한 문장이 표시되고, 정확히 그 줄들에서 나온 글자 슬롯이 만들어진다.

이 불변식은 어떻게 지켜지나? **팩토리 안에서 항상 그렇게 계산하기 때문에**. 외부에서 객체 리터럴로 우회할 수 없으므로(시그니처가 막음), 모든 `Challenge` 객체에서 두 불변식은 100% 참이다.

> **불변식과 파생값과 팩토리는 한 세트다**:
> - **불변식**: 무엇이 항상 참이어야 하는가 (`sentence = lines.join(" ")`).
> - **파생값**: 그 불변식이 가리키는 "계산되는 값"이 무엇인가 (`sentence`, `letters`).
> - **팩토리**: 불변식을 강제하는 **유일한 객체 생성 통로**가 무엇인가 (`challenge(...)`).
>
> 셋 중 하나만 빠져도 보증이 약해진다.

### 코드 어디서 쓰였나

- `src/lib/constants/challenges.ts:7` — 팩토리 주석에 두 불변식이 명시적으로 기록됨.
- `src/lib/constants/challenges.ts:13-14` — 불변식을 **실제로 만드는** 두 줄. 이 두 줄이 곧 불변식의 정의다.
- `src/types/index.ts:9, 11` — 두 파생 필드의 JSDoc에 각 불변식이 다시 한 번 적혀 있다(타입을 읽는 사람도 즉시 알게).

---

## 5. (보너스) TS strict에서 필수 필드 추가가 기존 객체 리터럴을 깨뜨리는 이유

### 무슨 일이 있었나

`Challenge` 타입에 **필수 필드 `lines: string[]`을 추가**했더니, **타입 정의는 안 바꿨는데도** 기존에 잘 돌던 테스트가 컴파일이 안 됐다. 그래서 테스트 픽스처를 **인라인으로 보정**해야 했다.

### 왜 그런가

TypeScript strict 모드는 객체 리터럴에 대해 **"필수 필드를 모두 채웠는지" 검사**한다. 예전 테스트 픽스처는 이렇게 생겼었다:
```typescript
const mockChallenge: Challenge = {
  id: "test-1",
  sentence: "오늘도 화이팅",
  letters: ["오", "늘", "도", "화", "이", "팅"],
  activeDate: "2026-05-26",
}
```
이때 `Challenge`에 `lines`가 없으니 위 객체는 합법이었다. 그런데 타입에 **`lines: string[]`이 추가**되면, 위 리터럴은 갑자기 **"필수 필드 lines 누락"**으로 컴파일 에러가 난다. **선택적(`?`)이 아닌 한, 필수 필드 추가는 기존 객체 리터럴을 전부 깨뜨리는 "breaking change"다.**

`MOCK_CHALLENGES`는 팩토리를 통과하기 때문에 자동으로 새 필드가 채워졌지만, **테스트 픽스처는 객체 리터럴을 직접 적었기에** 자동 채움의 혜택을 못 받았다.

### 어떻게 보정했나

테스트 파일의 두 인라인 픽스처에 `lines`를 직접 더했다:

- `tests/unit/challenge-store.test.ts:5-11` — 메인 mockChallenge:
  ```typescript
  const mockChallenge: Challenge = {
    id: "test-1",
    lines: ["오늘도", "화이팅"],      // ← 추가
    sentence: "오늘도 화이팅",
    letters: ["오", "늘", "도", "화", "이", "팅"],
    activeDate: "2026-05-26",
  }
  ```
- `tests/unit/challenge-store.test.ts:67-73` — "다른 챌린지" 픽스처에도 동일하게 `lines: ["참 좋은 날"]` 추가.

### 무엇을 배웠나

1. **TS strict는 좋다, 하지만 비싸다**: "필수 필드 추가"는 **타입 시그니처를 단단하게** 만들지만, **객체 리터럴을 쓰는 모든 곳을 같이 손봐야** 한다. 컴파일러가 다 잡아주니 안전하지만, 손이 가는 건 사실이다.

2. **팩토리가 그 비용을 흡수한다**: 만약 모든 객체 생성을 팩토리로 통일했으면, 필드 추가의 **모든 변경이 팩토리 한 곳에서** 끝난다. 사용처는 그냥 `challenge(...)`만 부르고 있으면 자동으로 새 필드가 붙는다. **객체 리터럴은 미래의 비용**이다.

3. **그래서 픽스처도 팩토리를 쓰면 더 좋다**: 테스트에서 `challenge("test-1", ["오늘도","화이팅"], "...")`로 만들었다면 이번 변경에서 픽스처 보정이 필요 없었다. 다만 테스트의 의도(특정 셋업 강제, 일부 필드 일부러 비정상으로 만들기 등)에 따라 객체 리터럴이 더 적합할 때도 있다 — 트레이드오프다.

### 코드 어디서 쓰였나

- `tests/unit/challenge-store.test.ts:5-11` — `mockChallenge` 픽스처 보정.
- `tests/unit/challenge-store.test.ts:67-73` — `otherChallenge` 픽스처 보정.

---

## 핵심 요약 (한눈에)

| 개념 | 한 줄 요약 | 코드 위치 |
|------|-----------|-----------|
| 단일 소스 | `lines`가 진짜. 화면 셋이 모두 이걸 따른다 | `types/index.ts:4-7`, `challenges.ts:9` |
| 파생값 | `sentence`/`letters`는 저장 안 하고 계산 | `types/index.ts:8-11`, `challenges.ts:13-14` |
| 팩토리 함수 | 생성 경로를 한 곳에 모아 불변식 강제 | `challenges.ts:9-17` |
| 데이터 불변식 | `lines.join(" ")===sentence`, `lines.flatMap(parseSentence)===letters` | `challenges.ts:7` (주석), `13-14` (구현) |
| TS strict 픽스처 보정 | 필수 필드 추가 → 객체 리터럴 픽스처 직접 보정 | `challenge-store.test.ts:7, 69` |

---

## 자주 하는 실수 (이번 변경을 응용할 때)

1. **파생값을 외부에서 따로 받는다** — 팩토리에 `sentence` 인자를 추가하면, 작성자가 lines와 다른 sentence를 적을 수 있게 된다. **계산되는 값은 시그니처에서 빼라.**

2. **타입은 추가했지만 팩토리에서 계산을 빠뜨린다** — 타입에 `lines`만 추가하고 `sentence: lines.join(" ")` 줄을 안 적으면, sentence가 undefined인 객체가 나온다. **타입 변경과 팩토리 변경은 짝이다.**

3. **객체 리터럴을 여러 곳에 흩뿌린다** — `MOCK_CHALLENGES`는 팩토리를 쓰지만 픽스처는 리터럴로 쓰면, 이번처럼 픽스처가 깨진다. **불변식이 있는 객체는 가능한 한 팩토리로 통일하라.**

4. **불변식을 주석에만 적고 강제는 안 한다** — 주석은 잘못된 코드를 막지 못한다. **계산식을 팩토리 안에 박아라** — 그게 강제다.

---

## 다음 단계로 이어지는 함의

- **Task B/C(수집·preview·PNG 화면 적용)**: 이번 Task A로 `Challenge.lines`가 데이터에 들어왔다. 다음 단계는 **세 화면이 모두 `slots`를 평탄한 배열이 아니라 `lines`로 그룹화해서 렌더링**하도록 바꾸는 것. 데이터 계층이 먼저 안정화돼야 화면 계층 변경이 단순해진다(데이터/표시 분리 — Day 4.5·5·6에서 반복된 원칙).
- **Phase 2 백엔드 연동**: mock 단계의 `MOCK_CHALLENGES`가 Supabase 테이블로 바뀌어도, **단일 소스로 `lines` 컬럼을 두고 `sentence`/`letters`는 클라이언트에서 파생**하면 같은 원칙이 유지된다. 백엔드 스키마도 이 원칙을 그대로 옮길 수 있다.
- **테스트 정비**: 인라인 픽스처를 매번 보정하는 비용을 줄이려면, 픽스처도 `challenge(...)` 팩토리(또는 테스트 헬퍼 `makeChallenge(overrides)`)로 통일하는 정리가 다음 후보다.

> 관련 개념의 상세 설명은 `docs/learning/learning-first-roadmap.md`의 Phase 1/2를 참고. 직전 노트는 `docs/learning/phase-1-day-6.md`.
