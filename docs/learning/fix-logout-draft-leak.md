# 로그아웃(#52) + 계정 전환 draft 누수 방어(#53)

> 대상 작업: #52 로그아웃 신설 + #53 계정 전환 시 로컬 draft 누수 방어 (owner-scope 가드).
> 게이트 C(학습) 산출물. 코드는 수정하지 않고 개념만 정리한다.
> 선행 노트: `docs/learning/phase-3-day-7.md`("Day 8·다음 작업으로 가는 다리" — #52 로그아웃·세션 종료 + #53 클라 상태 사용자 경계를 선행 개념으로 예고),
> `docs/learning/phase-2-day-2.md`(getClaims·proxy 보호 라우트), `docs/learning/phase-3-day-6.md`(TanStack Query 캐시)

---

## 한 줄 요약

이 작업은 **"손님이 나갈 때(로그아웃) 테이블을 어디까지 치우고, 다음 손님(다음 로그인)이 앉을 때(진입) 이전 손님의 흔적을 한 번 더 점검하는가"** 를 설계하는 일이다.
핵심은 **무엇을 비우고 무엇을 보존할지의 의도적 선택**이다 — 로그아웃은 서버 세션·서버 캐시만 비우고 **로컬 draft는 보존**(본인 재로그인 이어작업), 타 계정 노출은 **진입 시점의 owner-guard**가 따로 막는다.

---

## 왜 필요한가? (이것 없이 만들면 생기는 문제)

Day 7까지 우리는 "들어온 사용자"만 다뤘다. 로그인하고, 좋아요를 누르고, 신고를 했다.
그런데 **나가는 동작(로그아웃)** 과 **다른 사람이 같은 브라우저로 들어오는 동작(계정 전환)** 을 처리하지 않으면 두 가지가 새어 나온다:

1. **로그아웃이 서버 세션만 끊으면** — Supabase 쿠키는 사라졌는데, 브라우저 메모리에 남은 TanStack Query 캐시(이전 사용자의 피드·좋아요 상태)가 화면에 그대로 남는다. "로그아웃했는데 내 피드가 보인다."
2. **로컬 draft에 사용자 경계가 없으면(#53)** — Zustand `persist`는 draft를 localStorage에 **계정 구분 없이** 저장하고, IndexedDB도 `challengeId:slotIndex`라는 **계정과 무관한 키**로 크롭 이미지를 저장한다. A가 글자 사진을 올리다 로그아웃하지 않고 B가 로그인하면, **A의 진행 중 사진이 B 화면에 뜬다.** 명백한 프라이버시 누수다.

이 작업은 ①을 로그아웃 시점에, ②를 진입 시점에 각각 막는다.

---

## Typolog에서는? — 4계층 상태와 "비울 것 / 보존할 것"

이 앱의 클라이언트에는 사용자별로 다른 **상태가 4계층**으로 쌓인다. 로그아웃이 무엇을 건드릴지 결정하려면 이 4층을 먼저 봐야 한다:

| 계층 | 저장소 | 무엇이 들었나 | 키/이름 | 로그아웃 시 |
|------|--------|---------------|---------|-------------|
| ① 세션 | Supabase 쿠키 | JWT·refresh token | (Supabase 관리) | **비운다** |
| ② 서버 캐시 | TanStack Query (메모리) | 피드·제출·챌린지 | `['feed', ...]` 등 | **비운다** |
| ③ 로컬 draft 메타 | Zustand `persist` (localStorage) | 슬롯 메타·challengeId·ownerId | `typolog-challenge` | **보존**(현 구현) |
| ④ 로컬 draft 블롭 | IndexedDB | 크롭 이미지 Blob | `challengeId:slotIndex` | **보존**(현 구현) |

### 설계 결정: 로그아웃은 ①②만 비운다 (③④는 보존)

`src/hooks/use-logout.ts:8-12`의 주석이 이 결정을 명시한다:

```ts
// 로컬 draft(글자 크롭)는 일부러 지우지 않는다 — 본인이 재로그인하면 이어서 작업할 수 있게
// 보존한다. 계정 전환 시 타인에게 draft가 노출되는 문제는 TodayChallengeGate의 owner-scope
// 가드(#53)가 진입 시점에 막으므로, 로그아웃이 draft를 비울 필요가 없다.
```

**왜 보존하나?** 같은 사람이 실수로 로그아웃했다 다시 들어오면 작업 중이던 글자들이 그대로 있어야 자연스럽다. draft를 로그아웃 때 매번 날리면 이 UX가 깨진다.
**그럼 누수는 누가 막나?** "비우는 시점"을 로그아웃이 아니라 **다음 진입 시점**으로 옮긴다. 진입할 때 "이 draft가 지금 들어온 사람 것인가?"를 묻고, 아니면 그때 비운다. 이게 owner-guard(#53)다.

> 핵심 통찰: 누수 방어를 **"나갈 때 지우기"가 아니라 "들어올 때 점검하기"** 로 설계하면, 보존과 보안을 동시에 얻는다. 로그아웃 안 한 계정 전환·세션 만료·시크릿창 등 "로그아웃을 거치지 않는 경로"까지 한 곳에서 막을 수 있기 때문이다.

> 참고로 `use-logout.ts`는 실제로 ③④까지 함께 비우는 더 보수적인 구현(IDB clear + persist.clearStorage)도 가질 수 있고, QA 리포트(L-2~L-5)는 그 형태를 점검했다. 어느 쪽이든 **"진입 시 owner-guard가 최종 방어선"** 이라는 설계 의도는 동일하다 — 로그아웃 정리는 즉시성을 위한 것이고, 누수의 진짜 방어는 가드가 책임진다.

---

## 1. 로그아웃 = 세션 teardown + 상태 정리

### 왜 단순히 `signOut()`만으로 안 되나

`signOut()`은 ①(서버 세션 쿠키)만 무효화한다. 하지만 브라우저 메모리의 ②(TanStack Query 캐시)는 그대로다. 그래서 로그아웃은 **두 동작의 묶음**이다: "세션을 끊는다(서버)" + "캐시를 비운다(클라)".

### Typolog에서는?

`src/hooks/use-logout.ts:18-33`의 흐름:

```ts
// 1) Supabase 세션 종료 (쿠키 제거)
try {
  await createClient().auth.signOut();
} catch {
  // 세션 종료가 실패해도 캐시 정리·이동은 계속한다
}

// 2) 서버 상태 캐시(TanStack Query) 비우기
queryClient.clear();

// 3) 로그인 화면으로 (replace — 뒤로가기로 보호 화면 재진입 차단)
router.replace('/login');
```

세 가지 설계 포인트:

- **부분 실패 내성(`use-logout.ts:22-26`):** `signOut()`을 `try/catch`로 감싸고 catch를 비워 둔다. 네트워크가 끊겨 서버 세션 종료가 실패해도 **로컬 캐시 정리와 리다이렉트는 계속**된다. "서버가 안 되면 로컬도 안 함"이면, 오프라인에서 로그아웃이 영원히 안 끝나는 사용자가 갇힌다(잠김). 로그아웃은 "최대한 치우고 무조건 나간다"가 맞다.
- **`queryClient.clear()`(`use-logout.ts:29`):** 피드·제출·챌린지 등 **이전 사용자의 모든 서버 캐시**를 한 번에 비운다. 특정 키만 `invalidate`하지 않고 `clear()`로 통째로 비우는 이유는, 로그아웃 후엔 "어떤 키가 이전 사용자 것인지" 가려낼 필요 없이 전부 무효이기 때문이다.
- **`router.replace('/login')`(§5에서 상세):** `push`가 아니라 `replace`.

### 비유

식당 마감과 같다. 손님을 내보내고(세션 종료) 테이블 위 주문 내역·영수증을 치운다(캐시 정리). 주방에 불이 안 꺼져도(signOut 실패) 일단 테이블은 치우고 문은 잠근다(리다이렉트).

### 자주 하는 실수

- **`signOut()`만 부르고 캐시를 안 비움.** 쿠키는 사라졌는데 메모리의 피드가 남아, 로그아웃 직후 화면에 이전 사용자 데이터가 잠깐 보인다.
- **`signOut()` 실패를 throw로 터뜨려 정리·이동을 막음.** 오프라인 사용자가 로그아웃에 갇힌다. catch로 흡수하고 진행해야 한다.

---

## 2. 클라이언트 상태의 user-scope 문제 (#53의 본질)

### 왜 로컬 저장이 위험한가

서버 데이터는 **사용자별로 격리**된다(RLS·JWT). 그런데 **기기 단위 로컬 저장**(localStorage·IndexedDB)은 그렇지 않다. 저장 키가 계정을 모르기 때문이다:

- Zustand persist 키: `typolog-challenge`(`challenge-store.ts:170`) — **브라우저당 하나**. 누가 로그인했든 같은 키를 공유.
- IndexedDB 키: `challengeId:slotIndex`(`indexed-image-store.ts:3-5`) — **챌린지·슬롯 기준**. 계정 정보가 키에 없다.

즉 "이 기기의 draft"는 있어도 "이 **사용자**의 draft"라는 개념이 저장소엔 없다. 그래서 A의 draft를 B가 그대로 읽는다.

### 해결: 데이터에 소유자 도장(ownerId)을 찍는다

`src/stores/challenge-store.ts`에 `ownerId` 필드를 추가했다(`challenge-store.ts:14-15`):

```ts
/** 이 draft의 소유자 user id — 계정 전환 시 타 계정 draft 노출 방지 (#53) */
ownerId: string | null
```

그리고 이 `ownerId`를 **persist에 함께 저장**한다(`challenge-store.ts:178`의 `partialize`에 `ownerId: state.ownerId`). 이게 핵심이다 — draft 자체에 "누구 것인지"를 박아 둬야, 다음 진입 때 "지금 들어온 사람과 같은가?"를 비교할 수 있다.

`setOwner`(`challenge-store.ts:158`)로 도장을 찍고, `reset()`(`challenge-store.ts:160-167`)이 `ownerId`까지 포함해 전부 초기화한다.

### 비유

택배 보관함이다. 보관함 번호(challengeId:slotIndex)만으로 열면 누구든 남의 택배를 가져간다. 그래서 택배에 **받는 사람 이름표(ownerId)** 를 붙이고, 꺼낼 때 "내 이름이 맞나"를 확인하게 만든다.

### 자주 하는 실수

- **로컬 저장이 서버처럼 격리될 거라 가정.** localStorage·IndexedDB는 **origin(도메인) 단위**로 공유되지 계정 단위가 아니다. 멀티 계정·공용 기기를 항상 가정해야 한다.
- **`ownerId`를 persist에서 빼먹음.** 메모리에만 있고 localStorage에 안 들어가면, 브라우저를 닫았다 열었을 때(세션 간 재수화) 비교 기준이 사라져 가드가 무력화된다. `partialize`에 반드시 포함해야 한다(QA G-1).

---

## 3. owner-scope 가드 — 진입 시점에 점검한다

### 동작

`src/features/challenge/TodayChallengeGate.tsx:43-66`가 가드의 본체다. 수집·미리보기 화면에 진입할 때:

```ts
const store = useChallengeStore.getState();
if (store.ownerId !== userId) {        // 도장이 지금 사람과 다르면
  try { await clearAllImages(); }      // ④ IDB 블롭 전체 삭제
  catch { /* 비필수 */ }
  store.reset();                       // ③ store(+persist) 초기화
  store.setOwner(userId);              // 새 주인으로 도장 갱신
}
if (active) setGuarded(true);          // 정리 끝나야 통과
```

- `store.ownerId !== userId`가 참 → **다른 사람의 draft** → IDB clear + reset 후 새 주인 등록.
- `store.ownerId === userId` → **같은 사람** → 분기 진입 안 함 → draft 보존(QA G-6).

`userId`가 `null`이어도(getClaims 실패 등) `ownerId`가 남아 있으면 `ownerId !== null`이 참이라 **fail-safe로 비운다**(`TodayChallengeGate.tsx:48-50`, QA G-7). "확실치 않으면 보존이 아니라 정리" 쪽으로 기운다 — 누수보다 약간의 불편이 낫다.

### 비유

호텔 객실 청소다. 새 손님이 들어오기 직전, 직원이 "이 방 마지막 투숙객이 지금 들어올 손님과 같은가?"를 확인한다. 다르면 침대·욕실을 싹 청소(reset + IDB clear)하고 새 이름표를 건다(setOwner). 같으면(연박) 짐을 그대로 둔다(보존).

### 자주 하는 실수

- **로그아웃 시점에만 정리하고 진입 점검을 생략.** 로그아웃을 **거치지 않는** 계정 전환(시크릿창, 세션 만료 후 재로그인)은 정리가 안 돼 누수가 그대로 난다. 진입 가드가 이 모든 경로의 공통 최종 방어선이다.

---

## 4. React 효과 실행 순서 함정 + "정리 전 children 마운트 금지" 게이트

### 왜 위험한가 (자식이 부모보다 먼저 실행된다)

React에서 `useEffect`는 **자식 컴포넌트가 부모보다 먼저** 실행된다(레이아웃이 아래에서 위로 완성되기 때문). 만약 부모(`TodayChallengeGate`)가 draft 정리 effect를 돌리는 동안 자식(수집·미리보기)을 **이미 렌더해 버리면**, 자식의 effect가 **정리 전에 먼저 실행**되어 **stale draft(이전 사용자 사진)를 읽어** 화면에 그린다. 정리가 0.1초 뒤에 와도 이미 노출된 뒤다.

### 해결: `!guarded` early-return 게이트

`src/features/challenge/TodayChallengeGate.tsx:71`:

```ts
if (isPending || isMismatch || !guarded) {
  return ( /* 로딩 UI */ );
}
// ↓ guarded === true 가 되어야만 children에 도달
return <>{children(challenge)}</>
```

`guarded`는 가드 async 함수가 끝난 뒤에야 `setGuarded(true)`로 켜진다(`TodayChallengeGate.tsx:60`). 그 전까지는 **로딩 화면만** 그리고 **자식을 아예 마운트하지 않는다.** 자식이 마운트조차 안 되니 자식 effect가 실행될 기회 자체가 없다(`:68-70` 주석, QA G-4·G-5).

```ts
// `!guarded`는 프라이버시 게이트다 — owner-guard가 store/IDB 정리를 마치기 전에는
// children(수집/미리보기)을 마운트하지 않는다. React 효과는 자식이 부모보다 먼저
// 실행되므로, 여기서 막지 않으면 정리 전에 자식이 stale draft를 읽는다 (#53).
```

### 비유

청소 중인 방에 "청소 완료(guarded)" 팻말이 걸리기 전엔 손님(children)을 절대 안 들인다. 청소부(부모 effect)가 일하는 동안 손님이 먼저 들어와 이전 투숙객 짐을 보는 일을 원천 차단한다.

### 자주 하는 실수

- **정리 effect만 추가하고 children 렌더는 그대로 둠.** effect는 비동기라, 동기적으로 그려지는 children이 항상 먼저다. **렌더 차단(early-return)** 이 없으면 정리는 "한 박자 늦게" 도착해 이미 노출된 뒤다.
- **`isResolved`를 안 기다림.** `useCurrentUser`가 getClaims를 끝내기 전(`isResolved === false`)에 가드를 돌리면 `userId`가 아직 `null`이라 오판한다. 가드는 `if (!isResolved) return`(`:44`)으로 기다린다.

---

## 5. defense-in-depth — 서버 1차 방어 + 클라 보강

### 두 층의 신뢰 수준이 다르다

이 작업의 인증/인가는 **두 층**으로 짜여 있고, 둘의 권위가 다르다:

| 층 | 위치 | 역할 | 신뢰 수준 |
|----|------|------|-----------|
| 서버 1차 | `src/proxy.ts` | 보호 라우트 미인증 → `/login` redirect | **인가(authoritative)** |
| 클라 보강 | owner-guard + `useCurrentUser` | 로컬 draft 정리 트리거 | **정리용(트리거 only)** |

`src/proxy.ts:8-26`가 1차 방어다. `/`, `/challenge/*`, `/feed/*`, `/admin/*`를 `PROTECTED_PREFIXES`로 두고, 미인증이면 페이지 도달 전에 `/login`으로 돌린다. **로그인 안 한 사람은 애초에 수집 화면에 못 온다.**

owner-guard는 그 위의 보강이다. proxy를 통과한(=로그인된) 사용자에 대해 "**로컬 draft가 이 사람 것인가**"만 추가로 본다.

### `getClaims`는 인가가 아니라 정리 트리거다

`src/hooks/use-current-user.ts:13-16`이 이 경계를 명시한다:

```ts
// 이 값은 인가(authorization)가 아니라 로컬 draft 정리 트리거 전용이다 —
// 서버측 인증은 src/proxy.ts가 강제하고, 보호 라우트라 정상 흐름에선 곧 값이 채워진다.
```

같은 `getClaims`라도 **신뢰 수준이 다르다**:

- **서버 `getClaims`**(proxy·API의 `getAuthUser`): 서버에서 JWT를 검증한 **권위 있는** 신원. 인가에 쓴다.
- **클라 `getClaims`**(`useCurrentUser`): 브라우저에서 읽은 값. 조작 가능성이 있으므로 **인가에 쓰면 안 되고**, "로컬 draft를 비울지 말지" 트리거로만 쓴다. 설령 이 값이 틀려도 최악은 "내 draft가 불필요하게 비워짐"이지 "남의 데이터 노출"이 아니다 — 실제 데이터 접근은 서버 RLS·proxy가 막으니까.

### 비유

건물 출입은 1층 경비(proxy)가 신분증으로 통제한다(인가). 사무실 책상 위 메모(로컬 draft)를 치우는 건, 들어온 사람이 "어, 이 메모 내 거 아니네" 하고 정리하는 것(클라 가드)이다. 책상 메모 정리를 경비 수준의 보안으로 착각하면 안 된다 — 진짜 출입 통제는 1층에 있다.

### 자주 하는 실수

- **클라 `getClaims` 값으로 인가를 판단.** 브라우저 값은 변조 가능하다. "이 사람이 admin인가" 같은 판단을 클라에서 하면 안 된다. owner-guard처럼 **"내 로컬 데이터를 비울지"** 같은 무해한 결정에만 쓴다.
- **서버 1차 방어를 생략하고 클라 가드에만 의존.** 클라 가드를 우회하면(JS 비활성·직접 요청) 그대로 뚫린다. proxy의 redirect가 반드시 있어야 한다.

---

## 6. `router.replace` vs `push` — 그리고 OAuth 히스토리 잔재

### 왜 `replace`인가

브라우저 히스토리는 방문 스택이다. `push`는 스택에 **쌓고**, `replace`는 현재 항목을 **갈아끼운다**.

`use-logout.ts:32`는 `router.replace('/login')`을 쓴다(`push` 아님, QA L-6). 이유: `push`로 `/login`을 쌓으면, 로그아웃 후 사용자가 **뒤로가기**를 눌렀을 때 직전의 **보호 화면(피드·수집)** 으로 돌아간다. `replace`는 현재(보호 화면) 항목을 `/login`으로 덮어쓰므로, 뒤로가기를 눌러도 보호 화면으로 못 돌아간다.

> 단, 뒤로가기로 보호 화면에 "도달"해도 proxy가 다시 `/login`으로 돌린다(§5). 그래도 화면이 깜빡 보이는 걸 막으려면 history 자체를 안 남기는 `replace`가 깔끔하다 — 방어 두 겹.

### OAuth 리다이렉트 히스토리 잔재 (혼동 주의)

로그아웃 후 뒤로가기를 계속 누르면 **외부 구글 로그인 페이지**가 뜰 수 있다. 이건 우리 앱이 아니라 **OAuth 로그인 과정에서 거쳐 간 외부 페이지(`accounts.google.com`)가 브라우저 히스토리에 남은 것**이다.

- **데이터 노출이 아니다.** 그 페이지는 구글 소유이고 우리 세션·draft와 무관하다.
- `router.replace`는 **우리 앱 내부** 히스토리만 통제한다. 앱 밖(구글)으로 나갔다 돌아온 외부 페이지 항목까지는 지우지 못한다. 그래서 "왜 뒤로가기에서 구글 로그인이 뜨지?"는 정상이며, 누수가 아니다.

### 비유

`push`는 발자국을 남기며 걷기(왔던 길을 되짚을 수 있음), `replace`는 방금 디딘 자리를 지우며 걷기. 로그아웃은 보호 화면으로 되짚어 가지 못하게 자리를 지운다. 단, 앱 밖(구글)에 찍힌 발자국까지는 우리가 못 지운다.

### 자주 하는 실수

- **로그아웃에 `push` 사용.** 뒤로가기로 보호 화면이 다시 보인다(proxy가 막아도 깜빡임 발생).
- **OAuth 외부 페이지 잔재를 앱 버그로 오인.** 외부 origin 히스토리는 앱이 통제 못 한다. 데이터 노출이 아닌지부터 구분한다.

---

## 7. 정리 mechanics — clear/clearStorage/IDB 트랜잭션

세 저장소를 비우는 **기술적 방법**이 각각 다르다:

### ① TanStack Query: `queryClient.clear()`

`use-logout.ts:29`. 모든 쿼리 캐시를 메모리에서 제거. 키별 `invalidate`(재fetch 표시)와 달리 `clear()`는 **데이터 자체를 버린다** — 로그아웃 후엔 재fetch도 불필요하므로 통째로 비운다.

### ② Zustand persist: `store.reset()` (+ `persist.clearStorage()`)

`reset()`(`challenge-store.ts:160-167`)은 **메모리 state**를 초기값으로 set한다. Zustand persist는 state가 바뀌면 자동으로 localStorage에 다시 쓰므로, reset만으로도 localStorage의 `typolog-challenge` 값이 빈 상태로 갱신된다. 더 확실히 키를 지우려면 `persist.clearStorage()`로 localStorage 항목 자체를 삭제할 수도 있다(QA L-4).

### ③ IndexedDB: `clearAllImages()` + `tx.oncomplete` 대기

`src/lib/image/indexed-image-store.ts:152-171`:

```ts
const tx = db.transaction(STORE_NAME, "readwrite");
const store = tx.objectStore(STORE_NAME);
store.clear();                       // 비동기 시작
tx.oncomplete = () => resolve();     // 완료 이벤트를 기다려야 함
tx.onerror = () => reject(...);
```

**핵심: `store.clear()`는 호출 즉시 끝나지 않는다.** IndexedDB는 트랜잭션 기반이라 실제 삭제 완료는 `tx.oncomplete` 이벤트로 통지된다. 그래서 `store.clear()` 호출 후 바로 `resolve()`하면 **아직 안 지워진 상태에서 "끝났다"** 고 보고하는 버그가 된다. 반드시 `tx.oncomplete`를 기다려야 한다(`:163`, QA I-3).

SSR 안전성도 챙긴다 — `isSupported()`(`:152-153`)로 `window`·`indexedDB` 존재를 확인하고 없으면 조용히 return(서버 렌더 시 안전).

### 비유

세 종류의 쓰레기통이 분리수거다. 메모리 캐시는 그냥 비우면 되고(clear), localStorage는 라벨 붙은 통이라 라벨까지 떼고(clearStorage), IndexedDB는 "수거 완료 도장(oncomplete)"을 받아야 진짜 비워진 것이다 — 도장 없이 "비웠다"고 하면 거짓 보고다.

### 자주 하는 실수

- **IDB `clear()` 후 `oncomplete`를 안 기다리고 resolve.** 삭제가 끝나기 전에 다음 단계(예: 새 draft 저장)가 끼어들어 경합이 난다.
- **IDB 정리 실패를 throw로 전파.** 호출부(`use-logout.ts`·`TodayChallengeGate.tsx`)는 IDB 실패를 `try/catch`로 흡수한다 — 디스크에 블롭이 남아도 **슬롯이 비워져 화면엔 안 보이므로**(reset이 됐으니) 비필수다. "치우면 좋지만 실패해도 노출은 없다"가 판단 기준.

---

## 자주 하는 실수 모음

| 실수 | 무슨 일이 벌어지나 | 올바른 방법 |
|------|-------------------|------------|
| `signOut()`만 부르고 캐시 안 비움 | 로그아웃 후 이전 사용자 피드가 잔존 | `queryClient.clear()` 함께 |
| `signOut()` 실패를 throw로 전파 | 오프라인 사용자가 로그아웃에 갇힘 | catch로 흡수하고 정리·이동 진행 |
| 로컬 저장이 계정별 격리될 거라 가정 | A draft가 B에게 노출 | `ownerId` 도장 + 진입 가드 |
| `ownerId`를 persist에서 누락 | 세션 간 재수화 시 비교 기준 소실 | `partialize`에 `ownerId` 포함 |
| 로그아웃 시점에만 정리, 진입 점검 생략 | 시크릿창·세션 만료 경로로 누수 | 진입 owner-guard가 공통 방어선 |
| 정리 effect만 추가, children 렌더 그대로 | 자식 effect가 정리 전 stale draft 읽음 | `!guarded` early-return으로 마운트 차단 |
| 클라 `getClaims`로 인가 판단 | 변조 가능한 값으로 보안 결정 | 인가는 proxy/서버, 클라는 정리 트리거만 |
| 로그아웃에 `router.push` | 뒤로가기로 보호 화면 재진입 | `router.replace` |
| OAuth 외부 히스토리를 앱 버그로 오인 | 멀쩡한 동작을 디버깅 | 외부 origin은 앱이 통제 못 함·노출 아님 |
| IDB `clear()` 후 `oncomplete` 미대기 | 삭제 완료 전 "끝남" 거짓 보고 | `tx.oncomplete`에서 resolve |

---

## 다음 작업으로 가는 다리

### 직전 노트(Day 7)에서 예고된 다리를 이번에 건넜다

`docs/learning/phase-3-day-7.md`의 "Day 8·다음 작업으로 가는 다리"는 #52·#53을 **선행 개념**으로 예고했다:
- "세션 종료의 양면성: `signOut()`(서버) + TanStack 캐시·Zustand 상태 비우기(클라)" → 이번 §1에서 구현됨.
- "클라이언트 상태의 사용자 경계가 없는 누수" → 이번 §2·§3의 `ownerId` + owner-guard로 해결됨.
- "Day 2에서 익힌 proxy 보호 라우트 리다이렉트가 로그아웃 후 동작의 뒷받침" → 이번 §5의 defense-in-depth로 연결됨.

Day 7이 "하트·신고 버튼을 단" 일이라면, 이번 작업은 예고대로 **"손님이 나갈 때 테이블을 치우고, 다음 손님이 앉을 때 한 번 더 점검하는"** 일이었다.

### 다음 작업 선행 개념 (가볍게)

- **#50 제출 병렬화:** 현재 제출 체인(A2→A5×N→A6→A4)은 순차다. 글자 업로드(A5×N)를 `Promise.all`로 병렬화하면 체감 속도가 오른다. 이때 **이번에 배운 IDB 트랜잭션 완료 대기·부분 실패 내성**(어떤 업로드는 성공, 어떤 건 실패)이 그대로 재사용된다 — "여러 비동기 중 일부 실패를 어떻게 흡수하나"가 공통 주제다.
- **Day 8 공유/OG:** 공유 페이지(`/s/[id]`)는 **비인증** 라우트라 proxy의 `PROTECTED_PREFIXES`에서 제외된다(`proxy.ts:8` 주석의 공개 라우트 목록). 이번에 잡은 **"보호 vs 공개 라우트 경계"** 감각이 공유 링크 설계의 출발점이다. 또 공유는 "로그인 안 한 사람에게 무엇까지 보여줄지"라 **이번의 user-scope·공개 범위 사고**와 직결된다.

---

## 핵심 한 장 요약

- 로그아웃 = **세션 teardown(`signOut`·쿠키) + 서버 캐시 정리(`queryClient.clear`)**. 부분 실패는 catch로 흡수하고 무조건 `/login`으로 `replace`.
- 클라 상태는 **4계층**(①세션 ②서버캐시 ③persist ④IDB). 로그아웃은 **①②를 비우고 로컬 draft(③④)는 보존** — 누수 방어는 진입 가드로 분리.
- #53의 본질은 **로컬 저장의 user-scope 부재**(persist 키·IDB 키가 계정 무관). 해결은 **`ownerId` 도장 + persist 저장 + 진입 시 불일치면 reset+IDB clear**.
- React effect는 **자식이 부모보다 먼저** → 정리 전 children 마운트를 `!guarded` early-return으로 **차단**해야 stale draft를 안 읽는다.
- **defense-in-depth**: 서버 1차(`proxy.ts` redirect = 인가) + 클라 보강(owner-guard = 정리 트리거). **클라 `getClaims`는 인가가 아니다**(서버 getClaims와 신뢰 수준 다름).
- `router.replace`로 뒤로가기 보호. 뒤로가기 시 뜨는 **구글 로그인은 OAuth 외부 히스토리 잔재**(데이터 노출 아님, 앱이 통제 못 함).
- IDB 정리는 `clear()` 후 **`tx.oncomplete` 대기**가 필수(비동기 트랜잭션). 실패는 흡수(슬롯이 비워져 화면엔 안 보임).

---

## 참고

- 코드: `src/hooks/use-logout.ts`(로그아웃 정리·replace), `src/hooks/use-current-user.ts`(클라 getClaims·정리 트리거), `src/stores/challenge-store.ts`(ownerId·setOwner·reset·partialize), `src/features/challenge/TodayChallengeGate.tsx`(owner-guard·`!guarded` 게이트), `src/lib/image/indexed-image-store.ts`(`clearAllImages`·`tx.oncomplete`), `src/features/home/HomeClient.tsx`(로그아웃 버튼·전 상태 노출), `src/proxy.ts`(보호 라우트 1차 redirect)
- 설계: `docs/architecture.md`(렌더링·상태 관리), `docs/backend-design-plan.md` §8(보안)·§10.9(JWT·쿠키)
- QA: `docs/reviews/fix-logout-draft-leak-qa-review.md` (L-1~L-8 로그아웃 정리, G-1~G-8 owner-scope 가드, C-1~C-5 useCurrentUser, I-1~I-4 IDB clear, R-1~R-5 회귀, Low 5건)
- 이슈: #52(로그아웃), #53(계정 전환 draft 누수), #56(연계)
- 선행 노트: `docs/learning/phase-3-day-7.md`("Day 8·다음 작업으로 가는 다리"에서 #52·#53 예고), `docs/learning/phase-2-day-2.md`(getClaims·proxy 보호 라우트), `docs/learning/phase-3-day-6.md`(TanStack Query 캐시)
</content>
</invoke>
