# Phase 3 Day 7 — 반응 토글(optimistic) + 신고(Server Action)

> 대상 작업: S1 `toggleReaction`(낙관적 좋아요 토글) + S2 `createReport`(신고) — 프로젝트 **최초로 Server Action**을 도입한 Day.
> 게이트 C(학습) 산출물. 코드는 수정하지 않고 개념만 정리한다.
> 선행 노트: `docs/learning/phase-3-day-6.md`(피드·`useInfiniteQuery` 캐시·onMutate/onError 롤백 토대 = "Day 7로 가는 다리"), `docs/learning/phase-2-day-5.md`(RLS 우회·코드 가시성)

---

## 한 줄 요약

Day 7은 **"하트를 누르면 서버를 기다리지 않고 즉시 칠하고(낙관적), 서버가 틀리면 되돌리거나 권위값으로 정정한다"** 를 만드는 일이다. 이때 서버 함수를 REST URL이 아니라 **함수 호출(Server Action)** 로 부르고, DB는 RLS를 우회하므로 **소유권(누가 좋아요/신고했는지)을 코드가 직접 못 박으며**, 좋아요는 "INSERT or DELETE"의 **멱등 토글**이라 경합에도 안전하다.

---

## 이번 Day에서 배운 8개 개념 (우선순위 순)

1. Server Actions (`'use server'`) — REST URL 대신 RPC로 서버 함수 직접 호출
2. Optimistic update — useMutation의 onMutate/onError/onSuccess 3단(+onSettled 미사용)
3. `useInfiniteQuery` 중첩 캐시(`setQueryData`) — `pages[].items[]`에서 1개만 갱신·참조 보존
4. 멱등 토글 — INSERT or DELETE(UPDATE 없음), `onConflictDoNothing`, UNIQUE, 권위값 재조회
5. RLS 우회 환경의 코드 레벨 소유권 강제 — `user_id`/`reporter_id`를 서버 인증 사용자로 고정
6. Server Action 에러 전달 — throw(롤백만) vs 구조화 반환객체(사유별 메시지)
7. 자기 신고 차단의 2겹 — 서버 권위(`SELF_REPORT`) + 클라 보조(`is_mine` 숨김), 클라 숨김 ≠ 인가
8. `server-only` + `'use server'` 이중 가드

> Day 6에서 미리 깔아 둔 두 토대 위에 그대로 올라선다: ① 와이어 타입 `ApiFeedItem.reaction_count`/`user_reacted` 계약이 이미 확정 → **새 필드 불필요**, ② 캐시가 `pages[].items[]` 중첩이고 queryKey가 `['feed', challengeId]`(커서 미포함)로 고정 → **토글이 가리킬 캐시 키가 명확**. 이 다리 덕에 Day 7이 가벼워졌다(`docs/learning/phase-3-day-6.md` "Day 7로 가는 다리").

---

## 1. Server Actions (`'use server'`) — REST URL 대신 함수 호출

### 왜 필요한가? (Route Handler만으로도 되는데 왜 또 다른 것)

지금까지 Typolog의 모든 서버 코드는 **Route Handler**였다. `GET /api/feed`, `POST /api/submissions/[id]/letters`처럼 **URL이 있는 엔드포인트**를 만들고, 클라이언트가 `fetch('/api/...')`로 호출했다. 좋아요 토글도 이렇게 만들 수 있다 — `POST /api/reactions`를 파고 fetch로 부르면 된다.

그런데 좋아요 토글은 "submissionId 하나 받아서 INSERT/DELETE 하고 끝"인 **단순 mutation**이다. 이걸 Route Handler로 만들면 매번:

- 라우트 파일을 파고(`route.ts`), `POST` 함수를 export하고,
- `request.json()`으로 body를 파싱하고,
- 클라이언트엔 `fetch('/api/reactions', { method, body })`를 짜고, 응답을 `.json()`으로 풀고,
- URL·HTTP 메서드·요청/응답 직렬화를 **양쪽에서 손으로 맞춰야** 한다.

이 보일러플레이트 전부가 "함수 하나 호출"이라는 본질에 비해 과하다.

**Server Action**은 이 본질을 그대로 코드로 쓰게 해준다. 파일 맨 위에 `'use server'`를 붙인 함수를 export하면, Next.js가 그 함수를 **숨겨진 RPC 엔드포인트**로 만들고, 클라이언트는 그냥 **그 함수를 import해서 호출**한다. URL도, fetch도, 직렬화 코드도 안 보인다.

§6.4의 선택 기준이 정확히 이거다: **단순 mutation → Server Action, 조회·파일 업로드 → Route Handler.** 그래서 지금까지의 GET·업로드는 Route Handler였고, Day 7의 좋아요/신고는 Server Action으로 처음 갈라졌다.

### 비유

- **Route Handler** = 식당의 주문 카운터. 메뉴판(URL)이 붙어 있고, 누구나(외부 앱·curl 포함) 와서 정해진 양식(HTTP 메서드·body)으로 주문한다. "파일 한 박스 가져왔어요(FormData)"처럼 큰 짐을 다룰 때 좋다.
- **Server Action** = 테이블 벨. 손님은 그냥 벨을 누르면(함수 호출) 되고, 어느 주방으로 신호가 가는지(URL), 어떤 전선을 타는지(fetch·직렬화)는 몰라도 된다.

### Typolog에서는?

`src/lib/actions/reactions.ts:1`이 `'use server'`로 시작하고, `toggleReaction(submissionId: string)`을 export한다(`reactions.ts:30`). 클라이언트 훅 `src/hooks/use-reaction.ts:4`는 이 함수를 **그냥 import**한다:

```ts
import { toggleReaction, type ToggleReactionResult } from '@/lib/actions/reactions';
// ...
mutationFn: (submissionId: string) => toggleReaction(submissionId),  // use-reaction.ts:22
```

`fetch`도 URL도 없다. Next.js가 빌드 타임에 이 import를 "서버 함수로 가는 RPC 참조"로 바꿔준다. 신고도 똑같이 `src/lib/actions/reports.ts:20`의 `createReport(...)`를 `src/hooks/use-report.ts:15`에서 직접 호출한다.

여기서 `'use server'`(파일 단위)는 "**이 모듈의 export 함수들은 클라이언트가 호출할 수 있는 서버 함수**"라는 선언이다. 컴포넌트의 `'use client'`와 정반대 방향임에 주의 — `'use client'`는 "이 코드는 브라우저로 보내라", `'use server'`는 "이 함수는 서버에만 두고 클라엔 호출용 참조만 보내라"다.

### 자주 하는 실수

- **Server Action 함수의 인자를 "신뢰할 수 있는 내부 함수 인자"로 착각.** 클라이언트가 부르는 함수이므로 **인자는 전부 외부 입력**이다. Day 7도 `toggleReaction(submissionId)`의 submissionId를 `z.uuid()`로 다시 검증한다(`reaction.ts:5`, `reactions.ts:31`). RPC가 함수처럼 "보일" 뿐, 신뢰 경계는 Route Handler와 동일하다.
- **`'use server'`를 컴포넌트 파일에 붙임.** 그 파일은 더 이상 컴포넌트 모듈이 아니라 "서버 액션 모듈"로 취급된다. Day 7은 액션을 `src/lib/actions/`에 **별도 파일로 분리**해 이 혼선을 피했다.

---

## 2. Optimistic update — 기다리지 않고 먼저 칠하고, 틀리면 되돌린다

### 왜 필요한가? (네트워크 왕복의 체감 지연)

좋아요를 "정직하게" 만들면 이렇다: 하트 클릭 → 서버 요청 → (모바일 네트워크 0.3~1초 대기) → 응답 → 그제서야 하트가 빨개진다. 사용자는 그 공백 동안 "눌린 건가?" 하고 **또 누른다.** 좋아요처럼 결과가 거의 항상 성공하는 가벼운 액션은 이 지연이 UX를 망친다.

**낙관적 업데이트(optimistic update)** 는 "어차피 성공할 거니까(낙관)" UI를 **먼저** 바꾸고, 서버 요청은 뒤에서 돌린다. 실패하면 그때 되돌린다. 성공이 압도적으로 흔한 액션에서 체감 속도가 즉각적이 된다.

### onMutate / onError / onSuccess — 3단 안전장치

TanStack `useMutation`의 생명주기 훅으로 이 패턴을 짠다(`src/hooks/use-reaction.ts:23-42`):

| 훅 | 시점 | Typolog에서 하는 일 |
|----|------|---------------------|
| `onMutate` | 요청 보내기 **직전** | ① 진행 중 리페치 취소 → ② 현재 캐시 **스냅샷 백업** → ③ 낙관적으로 ±1 반영. 백업을 `return { previous }`로 넘겨 다음 단계가 받게 한다 |
| `onError` | 요청 **실패** | 백업(`context.previous`)으로 캐시를 **롤백** |
| `onSuccess` | 요청 **성공** | 서버 **권위값**(`{ user_reacted, reaction_count }`)으로 해당 항목만 **정정** |
| `onSettled` | 성공/실패 무관 끝난 뒤 | **의도적으로 안 씀** (아래 설명) |

`onMutate`의 세 줄(`use-reaction.ts:25-30`):

```ts
await queryClient.cancelQueries({ queryKey });          // ① 진행 중 리페치 취소
const previous = queryClient.getQueryData(queryKey);    // ② 스냅샷 백업
if (previous)
  queryClient.setQueryData(queryKey, optimisticToggleReaction(previous, submissionId)); // ③ 낙관 반영
return { previous };                                    // 백업을 context로 전달
```

`cancelQueries`가 ①번째인 이유가 핵심이다. 만약 백그라운드 리페치가 진행 중이라면, 내가 낙관적으로 칠한 값을 그 리페치 응답이 **덮어써서** 하트가 도로 꺼진다. 그래서 낙관 반영 전에 먼저 진행 중 쿼리를 취소한다(QA T-6).

`onSuccess`에서 **왜 또 정정**하나? 낙관값은 "내 화면 기준 ±1"이라 추정이다. 그 사이 다른 사람도 같은 글에 좋아요를 눌렀다면 실제 카운트는 다르다. 서버는 토글 후 **DB를 재조회한 권위값**을 돌려주므로(§4), 그걸로 덮어써 **동시성 드리프트**를 바로잡는다(`reconcileReaction`, QA T-8).

### onSettled를 일부러 안 쓴 이유 (이 Day의 설계 판단)

흔한 교과서 패턴은 `onSettled`에서 `invalidateQueries(['feed'])`로 "최종적으로 서버 진실과 한 번 더 맞춘다"이다. Day 7은 **이걸 의도적으로 뺐다**(`use-reaction.ts:15-16` 주석, QA T-9). 이유:

피드는 **무한 쿼리**라 `['feed', challengeId]`를 invalidate하면 **누적된 모든 페이지가 통째로 재fetch**된다. 그러면 ① 항목마다 **signed URL이 새로 서명**되고(§Day6 5), ② 사용자의 **스크롤 위치가 점프**할 수 있고, ③ 새 제출이 끼어들어 **재정렬**될 수 있다. 좋아요 하나 누른 대가로는 너무 크다.

`onSuccess`의 **단일 항목 권위값 정정**으로 정확성은 이미 확보되므로, 전체 invalidate는 불필요하다. "낙관적 업데이트 + 단일 항목 정정"이 무한 쿼리에 맞는 절제된 조합이다.

### 비유

낙관적 업데이트는 **연필로 먼저 답을 적고 → 채점 후 틀린 것만 지우개로 고치는** 시험 방식이다. 매 문제 채점을 기다렸다 적으면(정직한 방식) 시험이 한없이 느리다. 대부분 맞으니 일단 적고(onMutate), 틀리면 지우고(onError), 채점관이 정답을 알려주면 그 값으로 맞춘다(onSuccess).

### 자주 하는 실수

- **백업(스냅샷)을 안 떠 놓고 롤백하려 함.** `onMutate`에서 `return { previous }`를 안 하면 `onError`가 되돌릴 원본이 없다. Day 7은 `context.previous`로 되돌린다(`use-reaction.ts:32-35`).
- **`cancelQueries`를 빼먹음.** 진행 중 리페치가 낙관값을 덮어써 "눌렀는데 잠깐 뒤 풀리는" 깜빡임이 생긴다.
- **낙관값을 서버 진실로 착각.** 낙관값은 추정일 뿐, 권위는 항상 서버 반환값이다. `onSuccess` 정정이 그래서 필요하다.

---

## 3. `useInfiniteQuery` 중첩 캐시 — `pages[].items[]`에서 1개만 갈아끼우기

### 왜 까다로운가?

`useQuery`의 캐시는 보통 평평한 객체/배열이라 갱신이 쉽다. 그런데 무한 쿼리의 캐시는 **2겹 중첩**이다(Day 6 §7):

```
InfiniteData
 ├ pages:      [ page0, page1, page2 ]   ← 페이지 배열
 │               └ items: [ item, item, ... ]  ← 각 페이지 안에 항목 배열
 └ pageParams: [ ... ]                   ← 페이지별 커서
```

좋아요 토글은 이 중첩 어딘가에 있는 **submission 1개**의 두 필드만 바꿔야 한다. 순진하게 전체를 새 객체로 만들면, **바뀌지 않은 다른 항목·페이지까지 새 참조**가 되어 React가 그것들도 전부 리렌더한다(피드가 길면 비용이 크다).

### 핵심 원칙: 바뀐 것만 새 참조, 나머지는 원본 참조 보존

`src/features/feed/reaction-cache.ts`의 `mapFeedItem`(`reaction-cache.ts:36-54`)이 이 원칙을 구현한다:

```ts
pages: data.pages.map((page) => {
  if (!page.items.some((it) => it.submission.id === submissionId)) {
    return page;                       // 대상이 없는 페이지는 "원본 그대로" 반환 → 참조 유지
  }
  return {
    ...page,
    items: page.items.map((it) =>
      it.submission.id === submissionId ? fn(it) : it),  // 대상만 fn, 나머지는 원본 it
  };
}),
```

두 겹 모두에서 "대상이 아니면 원본 객체를 그대로 돌려준다":
- **페이지 레벨:** 대상 submission이 없는 페이지는 `return page`로 통째로 보존(QA O-2). `next.pages[1] === data.pages[1]`이 성립한다.
- **항목 레벨:** 대상이 아닌 항목은 `: it`로 원본 참조 유지(QA O-1).

그래서 토글 1회의 리렌더는 **그 카드 하나로 국한**된다. `pageParams`도 `{ ...data }` spread로 보존된다(`reaction-cache.ts:42`, QA O-4).

### 순수 함수로 분리한 이유

`reaction-cache.ts`의 두 함수(`optimisticToggleReaction`, `reconcileReaction`)는 React·queryClient를 모르는 **순수 함수**다. 입력(캐시 데이터, submissionId)을 받아 새 캐시 데이터를 반환할 뿐이다. 덕분에 **렌더 없이 단위 테스트**가 가능하다(`reaction-cache.ts:6` 주석). QA O-1~O-6 7건이 전부 이 순수 함수를 직접 호출해 참조 동일성(`toBe`)·클램프·no-op을 검증했다. 훅(`use-reaction.ts`)은 이 순수 함수를 `setQueryData`로 캐시에 꽂는 얇은 껍데기다.

### 비유

도서관 서가(pages) 안의 책장(page) 안의 책(item) 한 권 표지만 바꾸는 일이다. 그 책이 없는 책장은 **건드리지 않고 그대로** 두고(참조 보존), 대상 책장만 열어 해당 책 한 권만 교체한다. 서가 전체를 다시 정리하면(전체 새 참조) 사서가 모든 책을 다시 꽂는 헛수고를 한다.

### 자주 하는 실수

- **불변성 깨고 직접 변형(`item.reaction_count++`).** React/TanStack은 참조 비교로 변화를 감지하므로 원본을 변형하면 리렌더가 안 일어나거나 롤백용 스냅샷이 오염된다. 항상 새 객체(`{ ...item, ... }`)를 만든다.
- **전체를 `map`으로 새로 만들어 모든 참조를 바꿈.** 대상 없는 페이지/항목은 원본을 그대로 반환해야 리렌더가 국소화된다.

---

## 4. 멱등 토글 — INSERT or DELETE, UPDATE는 없다

### 왜 토글에 UPDATE를 안 쓰나

좋아요는 "있음 ↔ 없음" 두 상태뿐이다. 그래서 `reactions` 행 자체가 **있으면 좋아요 / 없으면 취소**다(`type` 컬럼은 'like' 기본값 — 향후 확장용). 토글은 곧 **행을 INSERT(좋아요) 하거나 DELETE(취소)** 하는 것이고, "기존 행을 UPDATE"할 일이 없다.

`src/lib/actions/reactions.ts:42-59`의 흐름:

```
1. 본인 반응 행이 있나? (SELECT)
2. 있으면 → DELETE (취소)
   없으면 → INSERT ... onConflictDoNothing()  (좋아요)
3. 토글 후 실제 카운트·본인 반응 여부 재조회 → 권위값 반환
```

### 멱등성의 근거: UNIQUE 제약 + onConflictDoNothing + DELETE 무해성

이 토글은 **동시 요청·중복 요청에도 DB가 깨지지 않게(멱등)** 설계됐다. 근거가 세 개다:

- **UNIQUE(user_id, submission_id)** (`schema.ts:110`): 한 사용자가 한 글에 좋아요 행을 **최대 1개**만 갖게 강제한다. 멱등성의 1차 근거(QA T-1).
- **`onConflictDoNothing()`** (`reactions.ts:58`): 거의 동시에 두 INSERT 요청이 와도, 두 번째는 UNIQUE 위반 대신 **조용히 무시**된다. 에러 없이 흡수(QA T-2).
- **DELETE의 0행 무해성** (`reactions.ts:51-54`): 이미 취소된 상태에서 또 DELETE해도 WHERE가 0행 매칭일 뿐 에러가 없다(QA T-3).

### read-then-write race가 있는데 왜 안전한가

`1. SELECT → 2. INSERT/DELETE`는 둘 사이에 다른 요청이 끼어들 수 있는 **read-then-write 경합**이다. 같은 사용자의 두 토글이 거의 동시에 오면 최종 방향(좋아요/취소)은 **도착 순서**에 의존한다. 그래도 안전한 이유:

- **무결성:** UNIQUE 제약이 "중복 좋아요 행"을 물리적으로 막는다. 경합이 나도 DB 상태는 항상 정합.
- **UX 정합:** 3단계에서 토글 직후 **DB를 재조회한 권위값**을 반환하므로(`reactions.ts:62-76`), 클라이언트가 무엇을 낙관했든 최종 화면은 DB 실제값으로 self-correct된다(QA T-4).
- **연타 방지:** 클라이언트가 `disabled={toggle.isPending}`로 카드별 연타를 막는다(`FeedCard.tsx:81`, QA T-5). 단, **mutation 인스턴스가 카드별**이라 카드 A 진행 중에도 카드 B는 독립적으로 눌린다.

즉 "권위값 재조회 반환"이 read-then-write race의 잔여 드리프트를 흡수하는 마지막 안전장치다. 그 권위값을 받아 §2의 `onSuccess`가 캐시를 정정한다 — 4번과 2번이 여기서 맞물린다.

### 비유

전등 스위치다. 켜져 있으면 끄고(DELETE), 꺼져 있으면 켠다(INSERT). 누가 동시에 스위치를 두 번 쳐도 전등은 "켜짐 한 개" 또는 "꺼짐"의 둘 중 하나로 수렴한다(UNIQUE). 마지막에 "지금 전등 켜져 있나?"를 직접 보고 보고하는 것(권위값 재조회)이 안전을 마무리한다.

### 자주 하는 실수

- **토글을 UPDATE 한 컬럼(`liked: true/false`)으로 모델링.** 행 존재 자체로 상태를 표현하는 편이 UNIQUE로 멱등성을 공짜로 얻고, 카운트도 `COUNT(*)`로 단순해진다.
- **`onConflictDoNothing` 없이 INSERT.** 동시 INSERT가 UNIQUE 위반 예외를 던져 토글이 실패한다.
- **토글 후 권위값을 안 돌려주고 낙관값만 믿음.** 동시성 드리프트가 누적돼 카운트가 실제와 어긋난다.

---

## 5. RLS 우회 환경에서 코드가 소유권을 강제한다

### 왜 또 코드가 막아야 하나 (Day 5의 1급 함정 재등장)

Typolog의 DB 접근은 **Drizzle 직결**(postgres role)이라 **RLS를 우회**한다(Day 3·5의 1급 함정). `reactions`·`reports` 테이블에 "본인 ID로만 INSERT" RLS 정책이 있어도, **Server Action의 Drizzle 쿼리에는 그 정책이 적용되지 않는다.** 그래서 RLS가 했어야 할 "본인 강제"를 **앱 코드가 1차로 못 박아야** 한다.

핵심 규칙: **클라이언트가 보낸 식별자를 절대 신뢰하지 않고, 행위자(user_id/reporter_id)는 항상 서버 인증 사용자로 고정한다.**

### Typolog에서는?

- **toggleReaction**: 클라이언트가 보내는 건 `submissionId`(UUID) **하나뿐**이다(`reaction.ts:5` 스키마). user_id는 `getAuthUser()`가 JWT에서 꺼낸 서버 값으로 고정한다(`reactions.ts:37`, 이후 `user.id`만 사용, QA P-1). 클라이언트가 "남의 id로 좋아요"를 보낼 통로 자체가 없다.
- **createReport**: `reporter_id: user.id`로 서버 인증 사용자를 박는다(`reports.ts:53`, QA P-3). 클라이언트는 `submissionId`·`reason`만 보낸다.

`getAuthUser`(`src/lib/api/auth.ts:16-22`)는 `getClaims()`로 JWT를 검증해 `sub`(사용자 id)만 돌려준다. Server Action도 서버에서 실행되므로 `cookies()`로 쿠키(세션)에 접근할 수 있다(QA P-7).

미인증 방어도 양쪽에 있다: `toggleReaction`은 `throw new Error('UNAUTHENTICATED')`(`reactions.ts:38-40`), `createReport`는 `return { ok:false, code:'UNAUTHENTICATED' }`(`reports.ts:35-37`). 둘의 차이는 §6.

### 비유

Day 6 §6 비유의 연장이다. RLS는 각 방의 스마트 잠금이지만, **직원용 마스터키(Drizzle 직결)** 로 들어오면 안 열린다. 마스터키를 든 직원(Server Action)은 "이 좋아요/신고를 누구 이름으로 기록할지"를 손님 말(클라 입력)이 아니라 **자기 손에 든 신분증(서버 JWT)** 으로 정해야 한다.

### 자주 하는 실수

- **클라이언트가 보낸 user_id를 그대로 INSERT.** RLS가 막아주리라 믿고 코드 검증을 생략하면, Drizzle 직결이라 RLS가 안 돌아 **남의 이름으로 좋아요/신고**가 박힌다.
- **Server Action 인자를 내부 함수처럼 신뢰.** §1과 동일 — 인자는 외부 입력이다.

---

## 6. Server Action 에러 전달 — throw vs 구조화 반환객체

### 왜 둘을 갈라 쓰나 (Next.js의 production throw 마스킹)

Server Action에서 실패를 알리는 방법은 두 가지다: **throw** 하거나, **`{ ok, code }` 같은 객체를 return** 하거나. Day 7은 둘을 **목적에 따라 의도적으로 다르게** 쓴다. 결정적 이유는:

> **Next.js는 production 빌드에서 Server Action이 throw한 에러 메시지를 보안상 마스킹한다.** 클라이언트엔 "An error occurred in the Server Components render..." 같은 일반 메시지만 도달하고, `throw new Error('SELF_REPORT')`의 'SELF_REPORT'는 **사라진다.**

### 그래서 어떻게 갈랐나

- **`toggleReaction` → throw** (`reactions.ts:33, 39`): 실패 시 클라이언트가 할 일은 **롤백뿐**이다. "왜 실패했는지"별로 다른 UI를 보일 필요가 없다. throw하면 `useMutation`의 `onError`가 잡아 스냅샷 롤백을 한다(`use-reaction.ts:32-35`). 메시지가 마스킹돼도 **롤백엔 지장 없다**(에러가 났다는 사실만 필요).
- **`createReport` → 구조화 반환객체** (`reports.ts:13-15`): 신고는 실패 **사유별로 다른 메시지**를 보여야 한다 — "본인 글은 신고할 수 없어요", "이미 삭제된 글이에요", "로그인이 필요해요". throw하면 production에서 사유가 마스킹돼 다이얼로그가 사유를 구분할 수 없다. 그래서 `{ ok:false, code:'SELF_REPORT' | 'NOT_FOUND' | ... }`로 **코드를 데이터로** 돌려준다(QA R-2).

다이얼로그는 그 코드를 메시지로 매핑한다(`ReportDialog.tsx:24-35` `resultMessage`, QA R-3). union 타입이라 `switch`에서 4종 누락 시 TypeScript가 잡아준다.

또 다이얼로그는 두 종류의 실패를 **분리**한다(`ReportDialog.tsx:48-52`, QA R-4): `report.isError`(네트워크/진짜 throw)와 `report.data && !report.data.ok`(서버가 정상 반환한 ok:false). 전자는 "잠시 후 다시", 후자는 사유별 메시지.

### 판단 기준 한 줄

**"실패 사유에 따라 클라이언트가 다른 행동을 해야 하나?"**
- 아니오(롤백·재시도만) → **throw** (toggleReaction)
- 예(사유별 메시지·분기) → **`{ ok, code }` 반환** (createReport)

### 비유

throw는 "그냥 실패!"라고 외치고 끊는 전화다 — 듣는 쪽은 "안 됐구나"만 알면 되는 좋아요엔 충분하다. 반환객체는 "주소가 틀렸습니다(NOT_FOUND)", "본인 주문은 취소 불가(SELF_REPORT)"처럼 **사유 코드가 적힌 반송장**이다 — 신고처럼 사유별 안내가 필요할 때 쓴다.

### 자주 하는 실수

- **사유별 메시지가 필요한데 throw의 메시지에 의존.** 로컬 dev에선 메시지가 보여서 잘 되는 듯하지만 **production 배포 후 전부 일반 메시지로 뭉개진다.** 이 함정을 피하려고 `createReport`를 반환객체로 설계했다.
- **항상 반환객체로 통일.** 롤백만 하면 되는 toggleReaction까지 `{ ok }` 객체로 만들면 `onError` 자동 롤백을 못 쓰고 호출부가 매번 분기해야 해 번거롭다. 목적에 맞게 가른다.

---

## 7. 자기 신고 차단의 2겹 — 클라 숨김 ≠ 인가

### 왜 두 겹인가

본인 글은 신고할 수 없어야 한다(게이트 A 결정 5). 이걸 **클라이언트에서 버튼을 숨기는 것만으로** 처리하면 안 된다 — 버튼 숨김은 UI 편의일 뿐, 개발자 도구로 Server Action을 직접 부르면 우회된다. **인가(authorization)는 반드시 서버에서** 일어나야 한다.

그래서 Day 7은 두 겹으로 막는다:

- **서버 권위(1차·필수):** `createReport`가 대상 제출의 `user_id`를 조회해, `target.user_id === user.id`면 `{ ok:false, code:'SELF_REPORT' }`를 돌려준다(`reports.ts:40-51`, QA P-4). 클라이언트가 무슨 짓을 해도 본인 글 신고는 서버에서 **독립적으로** 차단된다. 대상이 아예 없으면 `NOT_FOUND`(`reports.ts:46-48`).
- **클라 보조(2차·UX):** 피드 응답에 `is_mine`을 실어, FeedCard가 본인 카드의 신고 버튼(`⋯`)을 **아예 숨긴다**(`FeedCard.tsx:75` `{!is_mine && <ReportDialog .../>}`). 이건 "보일 필요 없는 걸 안 보이게"하는 UX이지 인가가 아니다.

`is_mine`은 **서버가 계산**한다(`route.ts:169` `is_mine: r.sub_user_id === user.id`, QA P-6). 여기서 `user`는 피드 라우트의 `getAuthUser()` 결과라 클라이언트가 조작할 수 없다. 와이어 타입엔 `is_mine: boolean` 필수 필드로 박혀 있다(`types/api.ts:95`).

### 핵심 격언

> **클라이언트 숨김은 인가가 아니다(client-side hiding is not authorization).** UI에서 안 보이는 것과 서버가 막는 것은 전혀 다른 보장 수준이다. 숨김은 "보기 좋게", 차단은 "안전하게".

### 비유

은행 앱에서 "타인 계좌 이체"가 막혀야 한다면, 화면에서 그 버튼을 숨기는 것(is_mine)은 친절이고, 서버가 "이 계좌가 네 것이 맞나"를 검사하는 것(SELF_REPORT)이 보안이다. 버튼을 숨겼다고 서버 검사를 빼면, 화면을 우회한 요청에 그대로 뚫린다.

### 자주 하는 실수

- **`is_mine`으로 버튼만 숨기고 서버 차단 생략.** 개발자 도구로 `createReport({ submissionId: 본인글ID })`를 직접 부르면 통과한다. QA 7-D가 바로 이 우회를 실 기기에서 점검하는 항목이다.
- **`is_mine`을 클라이언트에서 계산.** 클라이언트엔 "내가 누구인지"의 권위가 없다. 서버가 JWT 기준으로 계산해 내려줘야 신뢰할 수 있다.

---

## 8. `server-only` + `'use server'` 이중 가드

### 두 지시어는 막는 방향이 다르다

이름이 비슷해 헷갈리지만 역할이 다르다:

| 지시어 | 무엇을 보장하나 |
|--------|-----------------|
| `'use server'` (파일 1행) | "이 모듈의 export는 **클라이언트가 호출 가능한 서버 함수**"라고 Next.js에 선언. RPC 참조 생성을 켠다. |
| `import 'server-only'` | "이 모듈이 **클라이언트 번들에 들어가면 빌드 실패**"라는 안전망. 실수로 클라 컴포넌트가 이 모듈을 통째로 import하면 빌드 타임에 막는다. |

`'use server'`만 있고 누군가 액션 파일의 **다른 서버 전용 심볼**(예: `db`, `createClient`)을 클라에서 import하려 하면 위험할 수 있다. `import 'server-only'`가 그 경로에 빌드 타임 차단막을 한 겹 더 친다.

### Typolog에서는?

`src/lib/actions/reactions.ts:1, 5`와 `src/lib/actions/reports.ts:1, 3`이 둘 다 **`'use server'` + `import 'server-only'`** 를 같이 둔다. 액션이 `db`(Drizzle)·`createClient`(쿠키 접근) 같은 **서버 전용 모듈**을 import하므로, 이들이 실수로 클라 번들에 새는 걸 빌드 타임에 차단한다(QA B-1·B-2). `pnpm build`가 통과한다는 것 자체가 이 경계가 안 깨졌다는 증거다(QA "Server Action 번들 규칙 통과").

반대편에서 클라이언트 훅(`use-reaction.ts:1`, `use-report.ts:1`)은 `'use client'`다. 이들은 액션을 import하지만, Next.js가 그 import를 "함수 본문"이 아니라 **RPC 참조**로 바꾸므로 서버 코드가 번들에 안 실린다(QA B-3·B-4).

참고로 `src/types/api.ts`는 `server-only` 가드가 **없다** — 런타임 import 없이 **타입만** 정의해 클라·서버가 공유하는 와이어 타입이라 번들에 들어가도 안전하기 때문이다(`types/api.ts:1-3` 주석). "서버 전용 런타임 코드"와 "타입 전용 공유 모듈"의 경계를 구분하는 감각이 여기서 드러난다.

### 비유

`'use server'`는 주방 문에 "여기 직원만, 단 벨로 호출은 받음"이라고 붙이는 안내문이고, `import 'server-only'`는 그 주방 도구가 **객석으로 실려 나가면 경보가 울리는** 센서다. 둘이 함께 있어야 "호출은 받되, 도구는 절대 안 나간다"가 보장된다.

---

## 자주 하는 실수 모음

| 실수 | 무슨 일이 벌어지나 | 올바른 방법 |
|------|-------------------|------------|
| **단순 mutation을 굳이 Route Handler로** | URL·fetch·직렬화 보일러플레이트 중복 | 단순 mutation은 Server Action(`'use server'`) |
| **Server Action 인자를 신뢰** | 클라가 부르는 함수 = 외부 입력 미검증 | 서버에서 zod로 재검증(`reaction.ts`/`report.ts`) |
| **낙관 반영 전 `cancelQueries` 생략** | 진행 중 리페치가 낙관값 덮어씀(깜빡임) | `onMutate` 첫 줄에서 `cancelQueries` |
| **스냅샷 백업 없이 롤백 시도** | `onError`가 되돌릴 원본이 없음 | `onMutate`에서 `return { previous }` |
| **무한 쿼리 전체 invalidate로 정합** | 모든 페이지 재fetch(signed URL 재서명·스크롤 점프) | `onSuccess` 단일 항목 권위값 정정, onSettled 미사용 |
| **캐시 갱신 시 전체 새 참조** | 안 바뀐 항목·페이지까지 리렌더 | 대상 아니면 원본 참조 그대로 반환 |
| **불변성 깨고 직접 변형** | 변화 감지 실패·스냅샷 오염 | `{ ...item, ... }` 새 객체 |
| **토글을 UPDATE 컬럼으로 모델링** | 멱등성·동시성 직접 관리 부담 | 행 존재로 상태 표현 + UNIQUE + INSERT/DELETE |
| **`onConflictDoNothing` 없이 INSERT** | 동시 INSERT가 UNIQUE 위반 예외 | `onConflictDoNothing()` + 권위값 재조회 |
| **클라가 보낸 user_id를 INSERT** | RLS 우회라 남의 이름으로 기록됨 | user_id/reporter_id는 서버 인증 사용자 고정 |
| **사유별 메시지를 throw 메시지에 의존** | production에서 메시지 마스킹됨 | `{ ok:false, code }` 반환객체로 분기 |
| **`is_mine` 숨김만으로 자기 신고 차단** | 개발자 도구로 Server Action 직접 호출 시 우회 | 서버에서 `SELF_REPORT` 독립 차단(클라 숨김은 보조) |
| **`is_mine`을 클라에서 계산** | 클라엔 신원 권위 없음 | 서버가 JWT 기준 계산해 내려줌 |
| **액션 파일에 `server-only` 누락** | 서버 전용 import가 클라 번들로 셀 위험 | `'use server'` + `import 'server-only'` 둘 다 |

---

## Day 8·다음 작업으로 가는 다리

### 이번 Day가 남긴 패턴 자산

- **Server Action 도입 패턴**(`'use server'` + `server-only` + zod 재검증 + 서버 행위자 고정)이 확립됐다. Day 8 이후의 단순 mutation(예: 공개/비공개 토글, 프로필 수정)은 이 틀을 재사용한다(로드맵 #3 표: visibility 토글·프로필 수정도 Server Action 후보).
- **낙관적 업데이트 + 단일 항목 정정** 패턴은 좋아요 외의 토글(공개/비공개)에도 그대로 적용된다.

### 이슈 #52 (로그아웃) — 선행 개념: 세션 종료와 캐시 무효화

Day 7에서 미인증 분기를 양쪽에 깔아 뒀다(`toggleReaction` throw / `createReport` `UNAUTHENTICATED`). **로그아웃**은 이 미인증 상태로 **의도적으로 전이**시키는 작업이다. 선행으로 잡아 둘 개념:

- **세션 종료의 양면성:** Supabase `signOut()`으로 서버 쿠키 세션을 무효화하는 것(서버) + 브라우저에 남은 **TanStack Query 캐시·Zustand 상태를 비우는 것**(클라). 서버만 끊고 클라 캐시를 안 비우면, 로그아웃 후에도 이전 사용자의 피드·좋아요 상태가 화면에 남는다(이게 #53과 직접 연결된다).
- Day 2에서 익힌 `proxy.ts`의 보호 라우트 리다이렉트가 로그아웃 후 동작의 뒷받침이다(`docs/learning/phase-2-day-2.md`).

### 이슈 #53 (로컬 draft 누수) — 선행 개념: 클라이언트 상태의 사용자 경계

Zustand `persist`는 draft를 **localStorage에 사용자 구분 없이** 저장한다(Day 1 §14). 사용자 A가 로그아웃하고 B가 같은 브라우저로 로그인하면, A의 진행 중 draft가 B에게 보인다 — **사용자 경계가 없는 클라이언트 상태의 누수**다. 선행으로 잡아 둘 개념:

- **서버 상태 vs 클라이언트 상태의 생명주기 차이**(로드맵 #15 Zustand vs TanStack Query 표): 서버 상태(TanStack 캐시)는 로그아웃 시 `queryClient.clear()`로, 클라 상태(Zustand persist)는 store의 reset + persist 스토리지 정리로 비워야 한다.
- **언제 비우나:** 로그아웃 시점(#52)에 캐시·draft를 함께 비우는 것이 #53 해결의 핵심 — 그래서 #52와 #53이 한 묶음이다.

비유: Day 7이 "하트와 신고 버튼을 단" 일이라면, #52·#53은 **손님이 나갈 때 테이블을 깨끗이 치우는** 일이다 — 다음 손님(다음 로그인 사용자)에게 이전 손님의 흔적(캐시·draft)이 남지 않게.

---

## 핵심 한 장 요약

- **Server Action**(`'use server'`)은 단순 mutation을 URL·fetch 없이 **함수 호출**로 만든다. 조회·업로드는 여전히 Route Handler(§6.4). 인자는 외부 입력이라 서버에서 zod 재검증.
- **낙관적 업데이트**는 onMutate(취소→백업→낙관)/onError(롤백)/onSuccess(권위값 정정)의 3단. 무한 쿼리라 **onSettled 전체 invalidate는 의도적으로 안 쓰고** 단일 항목 정정으로 끝낸다.
- 무한 쿼리 캐시 `pages[].items[]`는 **대상 1개만 새 참조, 나머지는 원본 참조 보존**(순수 함수 `reaction-cache.ts`).
- 좋아요는 **INSERT or DELETE 멱등 토글** — UNIQUE + `onConflictDoNothing` + DELETE 무해 + **권위값 재조회**가 동시성을 흡수.
- DB는 Drizzle 직결로 **RLS 우회** → user_id/reporter_id를 **서버 인증 사용자로 고정**(클라 입력 미신뢰).
- 에러 전달은 **throw(롤백만)** vs **`{ ok, code }` 반환(사유별 메시지)** — Next.js production throw 마스킹 때문.
- 자기 신고는 **서버 `SELF_REPORT`(인가) + 클라 `is_mine` 숨김(UX)** 2겹. **클라 숨김 ≠ 인가.**
- 액션은 **`'use server'` + `import 'server-only'`** 이중 가드로 서버 코드의 클라 번들 유입을 빌드 타임 차단.

---

## 참고

- 코드: `src/lib/actions/reactions.ts`(S1 토글), `src/lib/actions/reports.ts`(S2 신고), `src/features/feed/reaction-cache.ts`(순수 캐시 함수), `src/hooks/use-reaction.ts`(낙관 mutation), `src/hooks/use-report.ts`, `src/features/feed/ReportDialog.tsx`, `src/features/feed/FeedCard.tsx`, `src/app/api/feed/route.ts`(`is_mine` 계산 169행), `src/types/api.ts`(`is_mine` 95행), `src/lib/validations/reaction.ts`, `src/lib/validations/report.ts`, `src/lib/api/auth.ts`(`getAuthUser`), `src/db/schema.ts`(reactions UNIQUE 110행·reports 118행)
- 설계: `docs/backend-design-plan.md` §6.2(S1/S2)·§6.4(Route Handler vs Server Action 선택 기준)·§3.5/§3.6(reactions/reports)·§8.4(권한)
- QA: `docs/reviews/phase3-day7-qa-review.md` (B-1~B-5 번들 경계, P-1~P-7 소유권, T-1~T-9 멱등·동시성, O-1~O-6 캐시 불변식, R-1~R-6 신고 결과 분기, L-2 자기 좋아요·L-3 신고 중복)
- 선행 노트: `docs/learning/phase-3-day-6.md`("Day 7로 가는 다리" — onMutate/onError 롤백·`useInfiniteQuery` 캐시·확정된 reaction 계약), `docs/learning/phase-2-day-5.md`(RLS 우회·코드 가시성), `docs/learning/phase-2-day-2.md`(getClaims·proxy 보호 라우트 — #52 로그아웃 연결)
