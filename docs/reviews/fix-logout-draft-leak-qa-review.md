# QA Review — Logout (#52) + Account-Switch Draft Leak Defense (#53)

> 검증 일자: 2026-06-18
> 검증자: QA Agent (독립 정적 검증)
> 대상 브랜치: worktree-phase3-day7-reactions
> 선행 QA: Phase 3 Day 7 (`docs/reviews/phase3-day7-qa-review.md`) — Critical/High 0건 통과
> PR 범위: #52 로그아웃 신설, #53 계정 전환 draft 누수 방어
> **게이트 B 반영 (2026-06-19)**: 본 리뷰 이후 설계 변경 — 로그아웃은 본인 draft(localStorage·IndexedDB)를 **보존**하고 세션·서버캐시(TanStack Query)만 정리한다. 계정 전환 누수 방어는 owner-guard(`TodayChallengeGate`)가 전담하며 `clearAllImages`는 U2 소속이다. Critical/High 0 판정은 불변(정리 범위 축소이므로 위험 감소).

---

## 검증 방식

- 정적 코드 리뷰: 변경 파일 전체 정독
  - `src/lib/image/indexed-image-store.ts` (`clearAllImages` 신규 함수)
  - `src/hooks/use-logout.ts` (신규)
  - `src/features/home/HomeClient.tsx` (로그아웃 버튼 추가)
  - `src/hooks/use-current-user.ts` (신규)
  - `src/stores/challenge-store.ts` (`ownerId` + `setOwner` + `reset` 강화)
  - `src/features/challenge/TodayChallengeGate.tsx` (owner-scope 가드 추가)
  - `tests/unit/challenge-store.test.ts` (`ownerId` 테스트 4건 추가)
  - `src/proxy.ts` (보호 라우트 1차 방어 확인)
- 정적 분석 툴 실행 결과 기록 (lint / type-check / test:run / build)
- 중점 검증 포인트 5개에 대한 코드 레벨 추론
- 라이브 Supabase 의존 항목은 사용자 수동 E2E로 위임

---

## 1. 정적 분석 결과

| 명령어 | 결과 | 비고 |
|--------|------|------|
| `pnpm lint` | PASS | 경고 0건, exit 0 |
| `pnpm type-check` | PASS | 오류 0건, exit 0 |
| `pnpm test:run` | PASS | 12 파일 / 157 테스트 전통과 (Day 7 153건 대비 +4건: `ownerId` 관련 테스트 4건 신규) |
| `pnpm build` | PASS | Compiled successfully, 정적 분석 0건 오류, 빌드 라우트 테이블 정상 |

---

## 2. QA 체크포인트 표

### 2-A. 로그아웃 정리 완전성 (#52)

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[L-1] Supabase 세션 종료(쿠키 제거)** | PASS | `use-logout.ts` line 22-26: `createClient().auth.signOut()`. try/catch로 분리 — 실패해도 로컬 정리는 계속 진행 |
| **[L-2] IndexedDB 블롭 전체 삭제** | PASS | `use-logout.ts` line 29-33: `clearAllImages()`. try/catch 독립 — 비필수(다음 진입 시 owner-guard가 재정리). `indexed-image-store.ts` line 152-171: `store.clear()` + `tx.oncomplete`로 완료 확인 |
| **[L-3] Zustand 상태 전체 초기화** | PASS | `use-logout.ts` line 36: `useChallengeStore.getState().reset()`. `reset()`은 `challengeId`, `ownerId`, `slots`, `activeSlotIndex`, `isComplete` 모두 초기값으로 set |
| **[L-4] localStorage persist 비우기** | PASS | `use-logout.ts` line 37: `useChallengeStore.persist.clearStorage()`. Zustand persist API — `typolog-challenge` 키 전체 삭제 |
| **[L-5] TanStack Query 캐시 전체 비우기** | PASS | `use-logout.ts` line 40: `queryClient.clear()`. 피드·제출·챌린지 모든 이전 사용자 캐시 제거 |
| **[L-6] /login 리다이렉트** | PASS | `use-logout.ts` line 43: `router.replace('/login')`. `push`가 아닌 `replace` — 로그아웃 후 뒤로가기로 보호 화면 재진입 방지 |
| **[L-7] signOut 실패 시 로컬 정리·리다이렉트 계속** | PASS | `use-logout.ts` line 22-26: catch 블록이 비어있어 이후 정리 단계 계속 실행됨. 설계 의도(주석 명시) |
| **[L-8] isPending 로딩 상태 관리** | PASS (주의 참조) | `use-logout.ts` line 16, 19: `useState(false)` + `setIsPending(true)`. 단, `setIsPending(false)` 호출 없음 — router.replace 후 컴포넌트 언마운트가 정상 경로이므로 실질 문제 없음. 네트워크 실패+라우팅 실패 동시 발생 시 버튼이 영구 비활성화될 수 있음(Low 이슈 참조) |

### 2-B. draft 소유자 스코프 가드 (#53 핵심)

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[G-1] ownerId 필드가 persist partialize에 포함됨** | PASS | `challenge-store.ts` line 177-188: `partialize`에 `ownerId: state.ownerId` 포함. 다음 브라우저 재진입 시 소유자 비교 가능. 단위 테스트 [ownerId-3]: `localStorage`에서 `persisted.state.ownerId` 확인 |
| **[G-2] reset()이 ownerId를 null로 초기화** | PASS | `challenge-store.ts` line 160-167: `reset()`에 `ownerId: null` 포함. 단위 테스트 [ownerId-2]: reset 후 `ownerId === null` + `slots === []` 확인 |
| **[G-3] 계정 전환(ownerId !== userId) 시 IDB clear + store reset** | PASS | `TodayChallengeGate.tsx` line 51-59: `store.ownerId !== userId`이면 `clearAllImages()` → `store.reset()` → `store.setOwner(userId)`. IDB 실패 시도 try/catch로 흡수하고 reset은 실행됨 |
| **[G-4] 가드 완료 전 children 차단** | PASS | `TodayChallengeGate.tsx` line 71: `if (isPending || isMismatch || !guarded) return <로딩 UI>`. `!guarded`가 프라이버시 게이트로 작동 — `setGuarded(true)` 전 children 마운트 불가 |
| **[G-5] React 효과 자식 우선 실행 함정 방어** | PASS | `TodayChallengeGate.tsx` line 68-77: 주석에 "React 효과는 자식이 부모보다 먼저 실행되므로 여기서 막지 않으면 자식이 stale draft를 읽는다" 명시. `!guarded` 조건이 children return을 완전 차단함으로써 자식 컴포넌트 마운트 자체를 방지 — 자식 useEffect 실행 기회 없음 |
| **[G-6] 같은 사용자 재진입 시 draft 보존** | PASS | `TodayChallengeGate.tsx` line 51: `if (store.ownerId !== userId)` — 같은 사용자(ownerId === userId)이면 분기 진입 안 함. 기존 slots/metadata 유지. `setGuarded(true)` 즉시 실행 |
| **[G-7] userId가 null인 경우(getClaims 실패) 처리** | PASS | `TodayChallengeGate.tsx` line 48-50: 주석에 "userId가 null이어도 ownerId가 남아 있으면 fail-safe로 비운다" 명시. `ownerId !== null`이면 `null !== null`이 false이므로 정리 실행. `ownerId === null`이고 `userId === null`이면 `null !== null`은 false → 정리 없이 통과 — 이 경우 proxy.ts가 이미 /login redirect를 보냈으므로 정상 흐름에선 도달 불가 |
| **[G-8] 서버측 1차 방어(proxy.ts) 확인** | PASS | `proxy.ts` line 8, 10-14: `/`, `/challenge/*`, `/feed/*`, `/admin/*`를 PROTECTED_PREFIXES로 선언. 미인증이면 즉시 `/login` redirect. owner-guard는 proxy.ts 통과 후 2차 보강(defense-in-depth) |

### 2-C. useCurrentUser — getClaims API 검증

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[C-1] getClaims가 supabase-js에 존재** | PASS | `pnpm type-check` PASS 확인. `node_modules/@supabase/supabase-js` v2.107.0 UMD 번들에 `getClaims` 1회 포함 확인 |
| **[C-2] getClaims 반환값에서 sub 추출** | PASS | `use-current-user.ts` line 24-27: `data?.claims?.sub`. optional chaining으로 null-safe. `typeof sub === 'string'`으로 타입 좁히기 후 사용 |
| **[C-3] getClaims 실패 시 isResolved: true 반환** | PASS | `use-current-user.ts` line 29-31: catch 블록에서 `{ userId: null, isResolved: true }` — 가드가 getClaims 실패 시에도 진행 가능 |
| **[C-4] active flag로 마운트 해제 후 setState 방지** | PASS | `use-current-user.ts` line 21, 25, 30: `let active = true` + cleanup에서 `active = false`. 컴포넌트 언마운트 후 비동기 콜백이 setState 호출하지 않음 |
| **[C-5] getClaims는 인가 아닌 정리 트리거 전용** | PASS | `use-current-user.ts` line 13-15: 주석에 "이 값은 인가(authorization)가 아니라 로컬 draft 정리 트리거 전용" 명시. 실제 보호 라우트 인증은 proxy.ts + 서버 API의 getAuthUser()가 담당 |

### 2-D. clearAllImages IDB 구현 검증

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[I-1] SSR 안전성 — isSupported() 가드** | PASS | `indexed-image-store.ts` line 152-153: `if (!isSupported()) return`. `isSupported()`는 `typeof window !== "undefined" && "indexedDB" in window` 확인 |
| **[I-2] openDb() 실패 시 무해하게 반환** | PASS | `indexed-image-store.ts` line 155-156: `openDb().catch(() => null)` — DB 열기 실패 시 null 반환 후 early return |
| **[I-3] tx.oncomplete로 완료 확인** | PASS | `indexed-image-store.ts` line 163: `tx.oncomplete = () => resolve()`. `store.clear()`는 비동기이므로 `oncomplete` 이벤트 대기가 올바른 패턴 |
| **[I-4] tx.onerror로 실패 거부** | PASS | `indexed-image-store.ts` line 164-168: `tx.onerror = () => reject(...)`. 호출자(`use-logout.ts`, `TodayChallengeGate.tsx`)는 모두 try/catch로 이 거부를 흡수 |

### 2-E. 회귀 — 기존 수집·복원·제출 동작

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[R-1] initSlots 로직 무변경** | PASS | `challenge-store.ts` line 78-98: `initSlots` 함수 변경 없음. 단위 테스트 4건(initSlots) 전통과 |
| **[R-2] fillSlot/clearSlot/resetDraft 로직 무변경** | PASS | 해당 함수 변경 없음. 단위 테스트 10건+ 전통과 |
| **[R-3] partialize — imageDataUrl 비직렬화 유지** | PASS | `challenge-store.ts` line 176-188: partialize에서 `imageDataUrl` 여전히 제외. 단위 테스트 [persist partialize-2]: `raw`에 `blob:` 미포함 확인 |
| **[R-4] ownerId 추가로 인한 기존 테스트 회귀 없음** | PASS | `pnpm test:run`: 157건 전통과. 기존 153건 회귀 없음 + 신규 4건 통과 |
| **[R-5] TodayChallengeGate 기존 로직 유지** | PASS | `TodayChallengeGate.tsx`: isMismatch(챌린지 id 불일치) 리다이렉트, isError 처리, refetch 버튼 — 변경 없음 |

---

## 3. 이슈 목록

### Critical — 0건

없음.

### High — 0건

없음.

### Medium — 0건

없음.

### Low

#### L-1: isPending이 로그아웃 실패+라우팅 실패 시 영구 true 상태 유지

- **위치**: `src/hooks/use-logout.ts` line 19 (`setIsPending(true)`)
- **내용**: `setIsPending(false)` 복원 경로가 없다. 정상 흐름(`router.replace('/login')` → 컴포넌트 언마운트)에서는 문제없지만, Next.js router가 예외를 throw하거나 테스트 환경처럼 언마운트 없이 동일 컴포넌트가 유지되는 경우 "로그아웃 중…" 버튼이 영구 비활성화 상태로 남는다. 실제 모바일 웹 환경에서 router.replace가 실패하는 케이스는 극히 드물다.
- **위험도 판단**: 정상 흐름에서 발생 불가. Day 9 마이페이지로 로그아웃 진입점 이동 예정이므로 임시 구현에 해당. 실질 위험 없음.
- **권고**: Day 9 마이페이지 이전 또는 이후, `try/finally` 패턴으로 `setIsPending(false)` 복원 추가 권장.
- **게이트 B 영향**: 없음.

#### L-2: 최초 진입(ownerId: null) 시 불필요한 reset() 실행

- **위치**: `src/features/challenge/TodayChallengeGate.tsx` line 51-59
- **내용**: `ownerId`가 null이고 `userId`가 non-null인 최초 진입 상황에서 `null !== "user-A"`이므로 `reset()` + `setOwner("user-A")`가 실행된다. 이 시점에 stores가 비어 있다면 reset()은 빈 상태를 다시 초기화하는 무해한 no-op이다. 하지만 일반 고유 로직으로 보면 최초 진입마다 slots가 있어도 강제 초기화되므로 앱 재진입 시 매번 챌린지 재시작을 요구한다.
- **위험도 판단**: 의도된 동작일 가능성이 높다(ownerId가 없다는 것은 이전에 setOwner가 호출된 적 없다는 의미이므로 고아 draft일 수 있음). 다만 동일 기기 동일 계정으로 앱을 재시작할 때도 기존 draft가 지워지는 효과가 있다. ownerId가 localStorage에 persist되므로 실제로는 로그인 후 첫 진입에서만 발생하고, 이후 재진입 시는 ownerId===userId로 통과한다.
- **위험도 판단 보충**: 최초 로그인 → `/challenge/[id]` 진입 시 ownerId가 null이므로 무조건 reset+setOwner 실행. 이후 같은 세션에서 재진입 시 ownerId===userId → 통과. 세션 간(localStorage 재수화) 동일 계정이면 ownerId===userId → 통과. 설계 의도로 판단.
- **게이트 B 영향**: 없음.

#### L-3: Day 7 기존 Low 이슈 현황 (승계 확인)

- **L-3-1 (Day 7 L-1 승계)**: reconcileReaction 단위 테스트 커버리지 — 미변경. Low 유지.
- **L-3-2 (Day 7 L-2 승계)**: 자기 좋아요 비제한 미문서화 — 미변경. Low 유지.
- **L-3-3 (Day 7 L-3 승계)**: 신고 중복 허용(이슈 #48 이관) — 미변경. Low 유지.
- **L-3-4 (Day 7 L-4 승계)**: Day 6 기존 Low 2건(커서 마이크로초, challenge_id 존재 검증) — 미변경. Low 유지.

---

## 4. 중점 검증 포인트 결론

| 검증 포인트 | 결론 |
|------------|------|
| **1. 프라이버시(#53 핵심)** | PASS. A 로그아웃 시 IDB(clearAllImages)+store(reset)+localStorage(clearStorage)+서버캐시(queryClient.clear) 4종 정리 완료. 무로그아웃 계정 전환은 TodayChallengeGate의 owner-guard(ownerId≠userId → reset+IDB clear)가 차단. proxy.ts가 보호 라우트에서 미인증 세션 /login 1차 redirect로 정상 흐름 보장. |
| **2. owner-guard 레이스** | PASS. `!guarded` 조건이 children을 완전 차단(return 로딩 UI)하므로 guard async 함수 완료 전 자식 컴포넌트 마운트 불가. React 효과 자식 우선 실행 함정이 설계적으로 회피됨. |
| **3. 회귀(same-user draft 보존)** | PASS. ownerId===userId이면 guard 분기 미진입 → reset 없음. 기존 수집 테스트 157건 전통과. |
| **4. 로그아웃 정리 완전성·부분 실패 처리** | PASS. 각 정리 단계가 독립 try/catch로 분리되어 signOut 실패 시에도 로컬 정리+리다이렉트 진행. persist.clearStorage로 localStorage까지 제거. |
| **5. Client/Server 경계 + any 0 + getClaims 용도** | PASS. `use-current-user.ts`에 'use client' 지정. getClaims는 정리 트리거 전용(주석 명시). type-check PASS로 any 0 확인. 실제 인가는 proxy.ts + 서버 getAuthUser()가 담당하는 계층이 코드로 명확히 분리됨. |

---

## 5. 커버리지 갭 — 런타임 위임 항목

| 영역 | 이유 | 위임 |
|------|------|------|
| 로그아웃 버튼 탭 → /login 실제 이동 | 실 브라우저 라우팅 필요 | 수동 E2E L-A |
| A 로그아웃 후 B 로그인 시 피드 캐시 갱신 | TanStack Query 실 인스턴스 필요 | 수동 E2E L-B |
| owner-guard가 실제 IDB 블롭을 차단하는지 | IDB 실 데이터 + 계정 2개 필요 | 수동 E2E L-C |
| getClaims 실패 시(네트워크 차단) owner-guard 동작 | Supabase 실 세션 + 네트워크 조작 필요 | 수동 E2E L-C (선택) |

---

## 6. 변경 파일별 점검

### `src/lib/image/indexed-image-store.ts` (`clearAllImages` 신규)

- 기존 `saveImageBlob/getImageBlob/deleteImageBlob/deleteImageBlobs`와 동일한 SSR-safe 패턴 적용.
- `store.clear()`의 비동기 완료를 `tx.oncomplete`로 대기 — IDB 표준 패턴.
- 실패 시 reject — 호출자 모두 try/catch로 흡수.

### `src/hooks/use-logout.ts` (신규)

- 5단계 정리(signOut → IDB → store.reset → clearStorage → queryClient.clear) 순서 타당.
- 각 단계 독립 try/catch — 부분 실패 내성.
- `router.replace` (뒤로가기 방지) 올바른 선택.
- `isPending` reset 경로 없음 — Low 이슈 L-1 참조.

### `src/hooks/use-current-user.ts` (신규)

- getClaims를 통한 브라우저 JWT sub 추출 — 서버 왕복 없이 빠름.
- `isResolved: false` 초기값으로 가드가 getClaims 완료 전 진행 차단.
- cleanup의 `active = false` 패턴으로 메모리 누수 방지.
- 설계 주석이 용도(인가 아닌 정리 트리거)를 명확히 구분.

### `src/stores/challenge-store.ts` (ownerId 추가)

- `ownerId: string | null` 필드 + `setOwner` 액션 + `reset`에 포함 + `partialize`에 포함.
- 단위 테스트 4건이 ownerId 동작을 완전 커버(setOwner 기록, reset 초기화, localStorage 영속, 불일치 감지).

### `src/features/challenge/TodayChallengeGate.tsx` (owner-guard 추가)

- `useCurrentUser`(isResolved 대기) + `useState(guarded)` + async guard 함수 조합.
- `!guarded` 조건이 `isPending || isMismatch` 조건과 같은 return 분기에 포함 — 단일 로딩 화면 유지.
- `active` flag로 언마운트 후 `setGuarded(true)` 방지.
- setOwner 호출이 분기 내부에만 있으므로 같은 사용자 재진입 시 호출 없음 — 의도적 설계.

### `src/features/home/HomeClient.tsx` (로그아웃 버튼 추가)

- `useLogout()` 훅 연결.
- 로딩/에러/성공 세 상태 모두에서 `logoutButton` 노출 — 잠김 방지.
- `button type="button"` + `disabled={isLoggingOut}` — 중복 실행 방지.
- `isPending: isLoggingOut` 별칭으로 네이밍 충돌 방지.

### `tests/unit/challenge-store.test.ts` (ownerId 4건 추가)

- `beforeEach`에 `ownerId: null` 초기화 포함 — 기존 테스트와 상태 격리.
- 4건 커버리지: setOwner 기록, reset 초기화, localStorage 영속, 불일치 감지.

---

## 7. 사용자 모바일 수동 E2E 체크리스트

> 아래 항목은 QA 에이전트가 정적으로 검증할 수 없는 런타임 시나리오다.
> iPhone 14 또는 Pixel 7 기준으로 진행한다.

### 사전 조건

- [ ] 계정 A, 계정 B 두 개의 로그인 가능한 계정 보유
- [ ] 계정 A로 로그인된 상태

### L-A. 로그아웃 기본 동작 (필수)

- [ ] 홈(`/`) 진입 → 페이지 하단 "로그아웃" 텍스트 버튼 노출 확인
- [ ] "로그아웃" 탭 → "로그아웃 중…"으로 텍스트 변경 + 버튼 비활성화 확인
- [ ] 잠시 후 `/login` 화면으로 이동 확인
- [ ] 브라우저 뒤로가기 → `/login` 유지 (`router.replace` 효과 확인)
- [ ] 로그인 화면에서 챌린지 URL 직접 입력 → `/login` redirect 확인 (proxy.ts 보호)

### L-B. 로그아웃 후 재로그인 캐시 격리 (필수)

- [ ] 계정 A로 로그인 → 피드(`/feed/today`) 진입 → 피드 데이터 표시 확인
- [ ] 홈에서 로그아웃 → `/login` 이동
- [ ] 계정 B로 로그인 → 피드 진입 → 계정 A 세션의 캐시가 아닌 새 데이터 로드 확인
  (계정 A가 반응했던 카드가 B 기준으로 `user_reacted: false`인지 확인)

### L-C. 계정 전환 draft 격리 — owner-guard (필수)

- [ ] 계정 A로 로그인 → `/challenge/[id]` 진입 → 슬롯 1개 이상 이미지 업로드
- [ ] 홈으로 이동 → **로그아웃 없이** 로그아웃 (또는 시크릿창으로 계정 B 로그인)
- [ ] 계정 B로 로그인 → `/challenge/[id]` 진입
- [ ] A가 업로드한 이미지가 B 화면에 노출되지 않음 확인 (슬롯 빈 상태)
- [ ] 수집 화면이 빈 슬롯 상태로 정상 렌더됨 확인

### L-D. 같은 계정 draft 보존 (필수)

- [ ] 계정 A로 로그인 → `/challenge/[id]` 진입 → 슬롯 1개 이상 이미지 업로드
- [ ] 홈으로 이동 후 `/challenge/[id]` 재진입
- [ ] 이전에 업로드한 이미지가 유지됨 확인 (draft 보존)

### L-E. 에러 상태에서 로그아웃 버튼 노출 (선택)

- [ ] 챌린지 없는 상태(또는 네트워크 차단)에서 홈 접근 → 에러 화면에서도 "로그아웃" 버튼 노출 확인

---

## 8. 이슈 요약

| 등급 | 건수 | 내용 |
|------|------|------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low | 5 | L-1(isPending 복원 경로 없음 — 정상 흐름에서 발생 불가, Day 9 이전 보완 권장), L-2(최초 진입 시 불필요한 reset — 의도된 설계로 판단), L-3(Day 7 기존 Low 4건 승계 — 미변경) |

---

## 9. 커밋 가능 여부

**조건부 가능**

정적 분석(lint, type-check, test:run, build) 4종 전통과 + Critical/High/Medium 0건이므로 **코드 품질 측면에서 커밋 가능하다.**

단, 아래 런타임 조건이 충족되어야 게이트 B가 완전히 통과된다:

1. **사용자 수동 E2E L-A~L-D 완료**: 로그아웃 동작, 캐시 격리, draft 격리, draft 보존을 실 기기에서 확인.
2. **계정 2개 필요**: L-C(계정 전환 draft 격리) 검증에 계정 B가 필요.

Low 5건은 MVP 수준에서 수용 가능 — 게이트 B를 차단하지 않는다.
