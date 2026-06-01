# Phase 1 — Task C: 개발용 구조화 로깅 + revoked Object URL 버그 수정 학습 노트

> 작업 브랜치: `phase1-authored-collage-lines`
> 변경 파일 (Part 1 — Task C 로깅):
> - `src/lib/debug/log.ts` (신규)
> - `src/features/challenge/CaptureClient.tsx` (로그 호출 추가)
> - `src/features/compose/CollagePreviewClient.tsx` (로그 호출 추가)
>
> 변경 파일 (Part 2 — 버그 수정, 커밋 `5cc0f25`):
> - `src/stores/challenge-store.ts` (`clearImageUrls()` 액션 추가)
> - `src/features/challenge/CaptureClient.tsx` (unmount cleanup 보강)
> - `tests/unit/challenge-store.test.ts` (회귀 테스트)

---

## 이 작업이 한 일 (두 문장)

**Part 1 (Task C)**: 개발/프리뷰 빌드에서만 동작하는 **구조화 로그**(`debugLog`)를 깔아 E2E 동안 어떤 챌린지가 로드됐는지, 어떤 슬롯이 채워졌는지, 어떤 콜라주가 복원·내보내기됐는지를 일관된 형태(`{ts, scope, message, data}`)로 남기게 했다.
**Part 2 (버그 수정)**: 그 로그를 켜고 실제 사용 시나리오를 돌리다, **"미리보기 → 다시 수정으로 돌아오기"** 시 글자 사진이 깨지는 버그를 발견하고 고쳤다 — 죽은 Object URL이 store에 남아 재진입 시 그대로 렌더됐기 때문.

---

# Part 1 — Task C: 구조화 로깅

## 1. 구조화 로깅(structured logging) — `{ts, scope, message, data}`가 주는 이점

### 개념

로그를 **자유 문자열**(예: `"loaded challenge 4 with 5 letters"`)로 남기지 않고, **고정된 키 셋의 객체**로 남긴다. 사람도 읽을 수 있고, 기계도 파싱·집계·필터링할 수 있는 형태로.

```typescript
// src/lib/debug/log.ts:15-24
export interface LogEntry {
  ts: number       // Unix epoch ms
  scope: string    // "capture" | "preview" | "export" 같은 범위 태그
  message: string  // 사람이 읽는 메시지
  data?: unknown   // 부가 데이터 (선택)
}
```

### 왜 이렇게 했나

자유 텍스트 로그의 문제:
- 검색하기 어렵다. `"slot filled"`를 찾으려면 정규식.
- 시간순 정렬·기간 필터·범위(scope) 필터를 후처리로 다시 짜야 한다.
- 데이터(어떤 슬롯? 어떤 challengeId?)가 문자열에 박혀 있어 추출이 깨지기 쉽다.

구조화 로그는 처음부터 **읽기·파싱·필터링·집계가 가능한 형태**다. 이번 작업의 직접 동기는 **E2E 시나리오 증거**다: "X 시나리오에서 Y 일이 일어났다"를 화면에 떠 있는 콘솔만 보고 확신할 수 있어야 한다. 자유 텍스트는 흘러내려 사라지지만, 구조화 엔트리는 메모리 버퍼에 쌓인다 → 나중에 `typologDump()`로 JSON 전체를 통째로 뽑아낼 수 있다.

특히 **`data: unknown`** 선택. `any`가 아닌 `unknown`인 이유: 호출부는 자유롭게 객체를 넣을 수 있지만, sink/소비자는 **타입 확인 없이 직접 사용할 수 없다** — `unknown`은 `any`의 강제 검사 버전이다. CLAUDE.md의 "any 사용 금지" 규칙과 일치한다.

### 코드 어디서 쓰였나

- `src/lib/debug/log.ts:15-24` — `LogEntry` 타입 정의.
- `src/features/challenge/CaptureClient.tsx:52-57` — 챌린지 로드 시:
  ```typescript
  debugLog("capture", "challenge loaded", {
    id: challenge.id,
    lines: challenge.lines,
    layout: getCollageLines(challenge.lines),
    letters: challenge.letters.length,
  })
  ```
- `src/features/challenge/CaptureClient.tsx:191-195` — 슬롯 채워졌을 때.
- `src/features/compose/CollagePreviewClient.tsx:87-91` — 미리보기 복원 완료 시.
- `src/features/compose/CollagePreviewClient.tsx:163-170` — PNG export 완료 시.

> 모든 호출이 `scope("capture"/"preview"/"export") + message + data` 한 줄로 정렬된 모양이다. **호출 형태가 일정**하면 grep도 일정한 키로 된다 — `scope: "preview"` 한 줄로 미리보기 관련 모든 이벤트가 잡힌다.

---

## 2. sink(출력처) 추상화 — 콘솔/메모리 기본 + `addLogSink`로 확장

### 개념

로그를 어디로 보낼지(콘솔? 메모리 버퍼? 외부 서비스?)를 호출부가 알 필요가 없다. 호출부는 그냥 `debugLog(...)`만 한다. **출력처(sink)**가 무엇이든 호출 코드는 그대로다.

### 왜 이렇게 했나

**기본 설계**: 콘솔 출력 + 메모리 버퍼 누적. 둘 다 호출부에 노출되지 않는다.

```typescript
// src/lib/debug/log.ts:42, 47-54, 80-82
const buffer: LogEntry[] = []
function consoleSink(entry: LogEntry): void {
  console.log(`[typolog:${entry.scope}] ${entry.message}`, entry.data)
}
// debugLog 내부:
buffer.push(entry)
consoleSink(entry)
for (const sink of sinks) { try { sink(entry) } catch {} }
```

**확장 지점**: `addLogSink(sink)`로 출력처를 더할 수 있다.

```typescript
// src/lib/debug/log.ts:60-66
export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink)
  return () => { /* 등록 해제 */ }
}
```

미래의 시나리오:
- PostHog 이벤트 트랙 → `addLogSink(e => posthog.capture(e.scope + ":" + e.message, e.data))`
- Sentry breadcrumb → `addLogSink(e => Sentry.addBreadcrumb({ category: e.scope, ... }))`
- 자체 OpenSearch 로그 수집 → `addLogSink(e => fetch("/log", { body: JSON.stringify(e) }))`

**핵심**: 호출부(`CaptureClient.tsx` 등)는 절대 바뀌지 않는다. 출력처 추가는 한 곳(`addLogSink` 호출 — 보통 앱 부트스트랩)에서 끝난다.

이는 Day 5의 `indexed-image-store.ts`가 IDB라는 저장 방식을 숨긴 것과 같은 원리 — **인터페이스를 좁게, 구현을 자유롭게**.

**try/catch로 sink 격리**:
```typescript
// src/lib/debug/log.ts:82-88
for (const sink of sinks) {
  try { sink(entry) } catch {
    // sink 오류가 로깅 흐름 자체를 막지 않도록 무시한다
  }
}
```
한 sink(예: 외부 네트워크)가 죽어도 다른 sink와 메모리 버퍼는 계속 동작한다. 로깅은 **부수 기능**이지 메인 흐름을 막아선 안 된다.

### 코드 어디서 쓰였나

- `src/lib/debug/log.ts:27` — `LogSink` 타입 (`(entry: LogEntry) => void`).
- `src/lib/debug/log.ts:45, 60-66` — sinks 배열과 등록 함수.
- `src/lib/debug/log.ts:47-54, 80-88` — 기본 콘솔 sink + 커스텀 sink 호출.

> 모듈 헤더 주석(`:10-11`)이 의도를 명시: "sink 추상화: addLogSink로 출력처를 추가할 수 있어, 향후 OpenSearch/PostHog/Sentry 등으로 호출부 변경 없이 확장·교체할 수 있다."

---

## 3. production no-op 가드 — `process.env.NODE_ENV !== "production"`

### 개념

production 빌드에서는 `debugLog`가 **아무것도 하지 않는다**. 빌드 도구(Webpack/Turbopack/SWC)가 `process.env.NODE_ENV`를 컴파일 타임 상수로 치환하므로, `if (false) return`은 **데드코드 제거(tree shaking) 대상**이 되어 prod 번들에서 함수 본문이 사라진다.

### 왜 이렇게 했나

```typescript
// src/lib/debug/log.ts:38-39, 75-76
const isEnabled = process.env.NODE_ENV !== "production"
// ...
export function debugLog(scope: string, message: string, data?: unknown): void {
  if (!isEnabled) return
  // ... 나머지는 prod에서 도달 불가
}
```

**production에서 부작용 차단**:
- 콘솔 노이즈 없음 (사용자가 DevTools 열어도 깨끗).
- 메모리 누적 없음 (`buffer`에 안 쌓이므로 누수 없음).
- `window.__typolog`/`typologDump` 미설치 (개발자 도구의 우연한 탐지에 안 잡힘).
- 외부 sink가 등록돼 있어도 안 호출 (네트워크 부하 0).

**production에서 데드코드 제거**:
- `isEnabled`는 컴파일 타임에 `false`로 결정 → `if (!false) return`이 함수 진입 직후의 무조건 return.
- 모든 호출부(`debugLog("capture", ...)`)는 결국 "아무것도 안 하는 함수 호출"이 된다. 번들러가 더 똑똑하면 호출 자체도 제거된다.

**왜 모듈 최상단에 상수로 잡았나** (`const isEnabled = ...`):
- 매번 `process.env.NODE_ENV !== "production"`을 평가하지 않고 모듈 로드 시 한 번만.
- 번들러의 정적 분석이 잘 작동하려면 **상수 비교가 모듈 스코프**에 있는 게 가장 확실하다.

> 이건 "기능을 끄는 if"가 아니라 **빌드 단계에서 사라지는 if**다. 같은 문법이지만 결과가 완전히 다르다.

### 코드 어디서 쓰였나

- `src/lib/debug/log.ts:38-39` — 가드 상수.
- `src/lib/debug/log.ts:75-77` — `debugLog`의 첫 줄 `if (!isEnabled) return`.

---

## 4. `window` 전역 안전 접근 — `typeof window` 가드 + `declare global` 타입 명시

### 개념

브라우저 콘솔에서 개발자가 `window.__typolog`(로그 배열 보기)·`typologDump()`(JSON+클립보드 복사) 같은 디버깅 헬퍼를 호출할 수 있게 **window에 두 개의 키를 단다**. 단, SSR(서버)에는 `window`가 없고, 타입 시스템에는 알려진 키가 아니다.

### 왜 이렇게 했나

두 가지 함정을 동시에 풀어야 한다.

**함정 1 — SSR 크래시**: Next.js는 컴포넌트(나 그 import 체인)를 서버에서 한 번 렌더한다. 서버에 `window`는 없다. 모듈 최상단이나 렌더 중에 `window.__typolog = ...`를 적으면 즉시 `ReferenceError`. 그래서 **`typeof window !== "undefined"` 가드**가 필요하다:

```typescript
// src/lib/debug/log.ts:91-96
if (typeof window !== "undefined") {
  window.__typolog = buffer
  if (!window.typologDump) {
    window.typologDump = typologDump
  }
}
```

**함정 2 — TypeScript strict에서 `window.__typolog`는 타입 에러**: `Window` 인터페이스에 `__typolog` 키가 없다. 일반적으로 `(window as any).__typolog = ...`로 도망가지만, CLAUDE.md는 `any` 금지다.

**해결책 — `declare global`로 Window 인터페이스 확장**:

```typescript
// src/lib/debug/log.ts:29-36
declare global {
  interface Window {
    /** 개발 중 수집된 로그 엔트리 버퍼 (production에서는 미설정) */
    __typolog?: LogEntry[]
    /** 콘솔에서 호출: 버퍼를 JSON으로 출력 + 클립보드 복사 */
    typologDump?: () => void
  }
}
```

TypeScript의 **interface 병합(declaration merging)** 기능: 같은 이름의 interface를 다른 곳에서 또 선언하면 합쳐진다. 위 코드는 전역 `Window` 타입에 두 키를 합법적으로 더한다. 이제 `window.__typolog`이 컴파일러에게 합법이고, `any` 없이도 정확한 타입(`LogEntry[]`)을 가진다.

**`?` 옵셔널 표시**: production에서는 절대 안 설정되므로 `__typolog?: LogEntry[]`. 호출자는 `window.__typolog`가 `undefined`일 수 있음을 인지해야 한다 — 타입이 안전을 강제한다.

### 코드 어디서 쓰였나

- `src/lib/debug/log.ts:29-36` — `declare global` interface 병합.
- `src/lib/debug/log.ts:91-96` — `typeof window` 가드 + 안전한 할당.
- `src/lib/debug/log.ts:103-111` — `typologDump`의 `typeof navigator` 가드도 같은 패턴.

---

# Part 2 — 버그 수정: revoked Object URL

## 5. 증상 — "다시 수정" 재진입 시 사진이 깨진다 (새로고침하면 살아난다)

### 무슨 일이 일어났나

1. 사용자가 6글자를 다 채우고 "콜라주 만들기" → 미리보기 진입.
2. 미리보기에서 "다시 수정" → 수집 화면으로 돌아옴.
3. **수집 화면의 슬롯들이 빈 글자(폴백 텍스트)로 나오거나, 깨진 이미지가 뜸.**
4. 그 상태에서 **F5(새로고침)**를 누르면 사진이 정상 복원된다.

### 단서들

E2E 로그를 켜고 시나리오를 돌리면 콘솔에 이런 흔적이 보였다:
- 첫 진입 시: `[typolog:capture] challenge loaded { lines, layout, letters }`
- 슬롯 채울 때: `[typolog:capture] slot filled { index, char, imageKey }`
- 미리보기 진입 시: 수집 컴포넌트가 **언마운트** → 복원 useEffect가 만든 Object URL들이 `revokeObjectURL`로 해제됨.
- 미리보기 → 다시 수정: 수집 컴포넌트가 **재마운트**.

다시 수집으로 돌아온 시점에 **복원 이펙트는 동작하지 않는다**. 이미지가 깨진 채로 남는다.

> 새로고침이 고치는 이유는 [7번 절](#7-새로고침은-왜-증상을-가리나)에서 다룬다. 그 차이가 진단의 결정적 단서였다.

---

## 6. 원인 — 죽은 `blob:` 문자열을 store가 계속 들고 있었다

### 코드 흐름 추적

복원 이펙트의 가드 조건:
```typescript
// src/features/challenge/CaptureClient.tsx:71-72
if (slot.status === "filled" && slot.imageKey && !slot.imageDataUrl) {
  // IDB에서 Blob을 꺼내 URL 만들고 setSlotImageUrl
}
```

가드의 마지막 항목: `!slot.imageDataUrl`. "이미 URL이 있으면 복원하지 마라"는 뜻이다. **상식적**으로 보인다 — 중복 작업 방지.

언마운트 시 cleanup (수정 전):
```typescript
// 수정 전 — store는 안 건드림
useEffect(() => {
  const urls = objectUrlsRef.current
  return () => {
    urls.forEach((url) => URL.revokeObjectURL(url))  // 브라우저 객체 해제
    urls.clear()                                       // ref 정리
    // store의 slot.imageDataUrl은 그대로 남음 — "blob:..." 문자열
  }
}, [challenge.id])
```

**문제**: `URL.revokeObjectURL`은 **브라우저의 Blob 매핑**을 끊는다. 하지만 그 URL 문자열(`"blob:http://localhost:3000/abc..."`)은 **그냥 string**이다. store의 `slot.imageDataUrl`에는 그 string이 그대로 살아 있다.

재마운트 후:
1. 복원 이펙트 진입 → 가드 `!slot.imageDataUrl` 평가
2. `slot.imageDataUrl`은 죽은 `"blob:..."` 문자열 → truthy → `!truthy === false`
3. **가드 통과 안 됨 → 복원 안 함**
4. 렌더 단계: `<img src={죽은_blob_URL}>` → 브라우저가 매핑을 못 찾음 → 깨진 이미지

### 핵심 통찰

**Object URL의 "두 번째 정체"**: 그것은 단순한 string인 동시에, 브라우저 내부의 Blob 테이블에 키로 등록된 식별자다. `revokeObjectURL`은 후자만 끊는다 — string 자체는 살아 있다.

따라서 **불변식**:
> **"URL을 revoke했으면 그 string 참조도 함께 비워라."**

이 불변식이 어디서도 강제되지 않았다. 코드는 "URL 해제"만 신경 썼고 "store에서 그 string도 같이 비우기"는 빠뜨렸다.

### 코드 어디서 쓰였나 (원인 지점)

- `src/features/challenge/CaptureClient.tsx:71-72` — 가드 `!slot.imageDataUrl`이 죽은 문자열을 truthy로 판단.
- `src/stores/challenge-store.ts:25` (주석) — "imageDataUrl is runtime-only Object URL". **런타임 전용임을 알면서도 cleanup에서 함께 비우지 않았다는 점이 빈틈**.

---

## 7. 새로고침은 왜 증상을 가리나

이 질문이 진단의 결정타였다 — "왜 새로고침하면 멀쩡한가?"

### 흐름

새로고침 시:
1. zustand `persist`가 localStorage에서 슬롯 상태를 **rehydrate**한다.
2. `partialize`는 **`imageDataUrl`을 직렬화 대상에서 제외**한다 — runtime-only 전용이라 영속에 적합하지 않기 때문(Day 5 노트의 핵심 결론).
3. 결과적으로 rehydrate된 슬롯 객체에는 **`imageDataUrl` 키 자체가 없다** → 접근하면 **`undefined`**.
4. `initSlots`의 동일-챌린지 가드(`challenge-store.ts:78-86`)가 **`undefined`를 `null`로 정규화**한다:
   ```typescript
   const slots = get().slots.map((s) => ({
     ...s,
     imageDataUrl: s.imageDataUrl ?? null,
   }))
   ```
5. 복원 가드 `!slot.imageDataUrl`이 이제 `!null === true` → **가드 통과** → IDB 재로드 → 새 URL 생성 → 화면 정상.

### 즉:

- **새로고침** = persist 우회로 우연히 `imageDataUrl`을 비우게 됨 → 복원 가드 활성 → 정상.
- **재진입(언마운트→재마운트)** = persist 거치지 않음 → 죽은 string 그대로 → 가드 차단 → 깨짐.

이 비대칭이 **버그가 영속 데이터 vs 런타임 데이터 경계의 헷갈림에서 왔다는 결정적 증거**다. 새로고침은 우연한 "리셋 효과"였고, 진짜 고침은 **재진입 경로에 같은 리셋 효과를 주는 것**이다.

---

## 8. 수정 — `clearImageUrls()` 액션 + cleanup에서 호출

### 추가된 store 액션

```typescript
// src/stores/challenge-store.ts:33-40 (타입)
/**
 * Null out every slot's runtime-only imageDataUrl.
 * Call right after revoking the corresponding Object URLs (e.g. on unmount):
 * a revoked URL must not stay referenced in state, or a later re-mount would
 * render a dead `blob:` URL. Persisted metadata (imageKey/status) is kept, so
 * the next restore re-creates fresh URLs from IndexedDB.
 */
clearImageUrls: () => void
```

```typescript
// src/stores/challenge-store.ts:128-133 (구현)
clearImageUrls: () =>
  set((state) => ({
    slots: state.slots.map((slot) =>
      slot.imageDataUrl === null ? slot : { ...slot, imageDataUrl: null }
    ),
  })),
```

**왜 별도 액션인가**:
- `clearSlot`은 슬롯을 **빈 상태로 되돌린다** — imageKey, fileName, status 모두 null/empty. 우리는 그걸 원하지 않는다. **메타데이터는 유지**해야 다음 복원이 IDB에서 정확한 키로 찾을 수 있다.
- `setSlotImageUrl(index, url)`은 **한 슬롯의 URL을 설정**한다. 일괄로 비우는 데 안 맞는다.
- 새 액션 `clearImageUrls`는 **모든 슬롯의 imageDataUrl만 null로** 만들고 메타는 보존 — 이 시나리오에 정확히 맞는 도구.

**얕은 비교 최적화**:
```typescript
slot.imageDataUrl === null ? slot : { ...slot, imageDataUrl: null }
```
이미 null인 슬롯은 같은 참조로 둔다. 새 객체를 안 만들면 React/Zustand selector의 얕은 비교가 "이 슬롯은 안 바뀌었다"고 판단해 불필요한 리렌더링을 줄인다.

### cleanup에서 호출

```typescript
// src/features/challenge/CaptureClient.tsx:94-105 (수정 후)
useEffect(() => {
  const urls = objectUrlsRef.current
  const sourceRef = cropSourceUrlRef
  return () => {
    urls.forEach((url) => URL.revokeObjectURL(url))
    urls.clear()
    // 폐기한 URL 문자열이 스토어에 남으면 재진입 시 죽은 blob:을 렌더하므로 함께 비운다.
    // (재진입 시 복원 이펙트가 IDB에서 새 URL을 다시 만들도록)
    clearImageUrls()
    if (sourceRef.current) {
      URL.revokeObjectURL(sourceRef.current)
      sourceRef.current = null
    }
  }
}, [challenge.id, clearImageUrls])
```

**불변식의 코드화**: "revoke 직후에는 store 참조도 비운다." 이제 cleanup이 끝나면 store의 `imageDataUrl`이 전부 `null`이다. 재마운트 시 복원 가드가 정상 동작 → IDB → 새 URL → 화면 정상.

> 이는 Day 4·5에서 본 **"Object URL의 책임은 컴포넌트, 데이터는 store"** 분리 원칙의 한 단계 더 진화한 모습이다. 그땐 "store는 string만 들고 있고 컴포넌트가 만들고 해제한다"였는데, 이번엔 거기에 **"해제 시 store의 string도 함께 null로 만들 의무"**가 추가됐다.

### 회귀 테스트

```typescript
// tests/unit/challenge-store.test.ts (요지)
describe("clearImageUrls", () => {
  it("모든 슬롯의 imageDataUrl을 null로 만들고 메타는 유지한다", () => { ... })
  it("이미 null인 슬롯은 같은 참조로 둔다 (얕은 비교 보존)", () => { ... })
})
```

CI가 다시 이 버그를 잡아낸다. **로그가 버그를 발견했고, 테스트가 재발을 막는다.**

### 코드 어디서 쓰였나

- `src/stores/challenge-store.ts:33-40, 128-133` — 액션 정의·구현.
- `src/features/challenge/CaptureClient.tsx:94-105` — cleanup에서 호출.
- `tests/unit/challenge-store.test.ts` — 회귀 테스트.

---

## 핵심 요약 (한눈에)

### Part 1 — 로깅

| 개념 | 한 줄 요약 | 코드 위치 |
|------|-----------|-----------|
| 구조화 로깅 | `{ts, scope, message, data}` 형태로 검색·집계 가능 | `log.ts:15-24` |
| sink 추상화 | 호출부 변경 없이 출력처(PostHog/Sentry) 교체 | `log.ts:27, 60-66, 80-88` |
| production no-op | `NODE_ENV` 가드 → 데드코드 제거 + 부작용 0 | `log.ts:38-39, 75-76` |
| window 안전 접근 | `typeof window` 가드 + `declare global` 타입 병합 | `log.ts:29-36, 91-96` |
| 호출부 예시 | scope 단위 일관성 (`"capture"`/`"preview"`/`"export"`) | `CaptureClient.tsx:52, 191`, `CollagePreviewClient.tsx:87, 163` |

### Part 2 — 버그 수정

| 개념 | 한 줄 요약 | 코드 위치 |
|------|-----------|-----------|
| Object URL 이중성 | string + 브라우저 내부 매핑. revoke는 후자만 끊음 | `CaptureClient.tsx:90-91` (revokeObjectURL) |
| revoke + 참조 비우기 불변식 | "URL을 폐기했으면 store의 string도 같이 null" | `CaptureClient.tsx:94-105` |
| 런타임 vs 영속 상태 | `imageDataUrl`(런타임) / `imageKey`(영속). partialize가 분리 | `challenge-store.ts:25, 163-179` |
| 새로고침이 가리는 메커니즘 | persist 우회 → undefined → null 정규화 → 복원 발동 | `challenge-store.ts:78-86` |
| 복원 가드의 함정 | `!slot.imageDataUrl`이 죽은 string을 truthy로 잡음 | `CaptureClient.tsx:71-72` |
| `clearImageUrls` 액션 | URL만 null, 메타는 보존, 얕은 비교 최적화 | `challenge-store.ts:33-40, 128-133` |
| 회귀 테스트로 못 박기 | CI가 재발 차단 | `challenge-store.test.ts` |

---

## 자주 하는 실수

1. **자유 문자열 로그를 남긴다** — 나중에 어떤 시나리오에서 어떤 일이 일어났는지 추적할 때 마법 같은 정규식이 필요해진다. **scope + message + data 구조화하라.**

2. **로그 호출부가 출력처를 알게 한다** (`console.log` 직접, 또는 `posthog.capture` 직접) — 출력처 교체 시 수십 곳 변경. **`debugLog` 같은 어댑터를 거쳐라.**

3. **production에서 개발용 코드를 그대로 둔다** — 사용자가 콘솔에서 디버깅 헬퍼를 발견하거나, 외부 sink가 의도치 않게 prod에서 동작. **NODE_ENV 가드로 빌드 시점에 잘라라.**

4. **`window.커스텀키`를 `any`로 캐스팅한다** — 타입 안전성 포기. **`declare global`로 합법적으로 확장하라.**

5. **`URL.revokeObjectURL`만 호출하고 store의 string은 안 비운다** — 이번 버그의 본질. **revoke와 참조 비우기를 한 동작으로 묶어라.**

6. **`!slot.imageDataUrl` 같은 truthy 가드가 죽은 문자열을 신뢰한다** — string은 truthy니까 가드를 통과. **상태가 "유효한" 게 아니라 "참조 가능한" 것임을 매번 검증하라** (또는 무효화 시 즉시 null로 만들라).

7. **새로고침으로 해결되는 버그를 "환경 문제"로 치부한다** — 새로고침이 우회하는 메커니즘을 추적하면, **상태 일관성 버그**일 확률이 매우 높다. 새로고침은 종종 우연한 리셋 효과로 진짜 버그를 가린다.

---

## Task A·B·C를 합치면 보이는 큰 그림

```
[데이터 — Task A] challenge.lines (단일 소스)
                  ├─ sentence  = lines.join(" ")        (파생)
                  └─ letters   = lines.flatMap(parse)   (파생)

[레이아웃 — Task B] getCollageLines(lines)               (순수 함수)
                  ├─ 수집 행 스택
                  ├─ 미리보기 행 스택
                  └─ PNG Canvas 셀 좌표

[관측 — Task C]    debugLog(scope, message, data)        (개발 전용)
                  ├─ capture: challenge loaded / slot filled
                  ├─ preview: restored / export
                  └─ ↑ E2E 시나리오의 증거 + 버그 발견 도구

[안정성 — 버그 수정] revoke + clearImageUrls 불변식
                  └─ runtime URL과 store 참조의 동시 정리
```

**Task A**는 데이터를 단일 소스로 정리했다. **Task B**는 그 데이터를 화면 셋이 같은 함수로 소비하게 만들었다. **Task C**는 그 흐름을 **관측 가능**하게 만들었고, 그 관측 덕분에 **숨어 있던 상태 일관성 버그**를 빛에 드러냈다. 그리고 그 버그를 다시 코드 불변식 + 테스트로 못 박았다.

**관측 → 발견 → 불변식화 → 테스트** 사이클이 한 번 돌았다. 다음 사이클(Phase 2 백엔드 연동·실기기 검증)을 위한 도구가 이제 자리 잡았다.

> 관련 개념의 상세 설명은 `docs/learning/learning-first-roadmap.md`의 Phase 1·4(관측 #17~18)를 참고. 직전 노트는 `docs/learning/phase-1-authored-lines-task-b.md`, Day 5(persist/IDB)는 `docs/learning/phase-1-day-5.md`.
