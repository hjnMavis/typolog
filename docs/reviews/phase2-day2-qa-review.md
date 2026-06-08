# Phase 2 Day 2 — QA 리뷰

> 검토 일시: 2026-06-05
> 검토 범위: 인증 + 클라이언트 — runtime Drizzle client / M2 중복 인덱스 제거 / env 키명 정리 / Supabase 클라이언트 3종 / Google OAuth 플로우 / Next.js 16 proxy 보호 라우트
> 검증 방식: 정적 분석 + dev 서버 실행 검증(http://localhost:3000) + 패키지 API 존재 확인
> Reviewer 리뷰 반영 분: Critical 0 / High 2 반영 완료 (H1: getClaims try/catch fail-closed, H2: signInWithOAuth error 처리)
> Medium 이관 결정: M1(redirectTo origin 정책·배포 전), M2(callback next 협소화·Day 3+), M3(proxy matcher api/auth·Day 3)

---

## 툴체인 결과

| 명령 | 결과 | 비고 |
|------|------|------|
| `pnpm lint` | PASS | 0 오류, 0 경고 |
| `pnpm type-check` | PASS | 0 오류 |
| `pnpm test:run` | PASS | 6 파일, 105 테스트 전체 통과 |
| `pnpm build` | PASS | 정적/동적 라우트 모두 컴파일 성공, `ƒ Proxy (Middleware)` 확인 |

---

## QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|----------|
| C01 | `src/db/index.ts` server-only 가드 | PASS | 정적 분석 — `import 'server-only'` 1행 확인 |
| C02 | `src/db/index.ts` prepare:false 설정 | PASS | 정적 분석 — `postgres(databaseUrl, { prepare: false })` |
| C03 | DATABASE_URL 미설정 시 명시적 throw | PASS | 정적 분석 — 조건 분기 + throw Error 확인 |
| C04 | `src/db/index.ts` schema 포함 | PASS | 정적 분석 — `drizzle({ client, schema })` |
| C05 | 0002 마이그레이션: DROP INDEX 내용 | PASS | 정적 분석 — `DROP INDEX "idx_challenges_active_date"` 단독 1행 |
| C06 | schema.ts에서 idx_challenges_active_date 제거 | PASS | `grep` 결과 0건 확인 |
| C07 | pg_indexes 커스텀 인덱스 4개 (idx_challenges_active_date 제거 확인) | PASS | 사전 실행 검증 완료 (프롬프트 명시) |
| C08 | .env.local.example — `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 키명 | PASS | 정적 분석 — 구 키명(ANON_KEY) 0건, 신규 키명 확인 |
| C09 | .env.local.example — `SUPABASE_SECRET_KEY` 키명 | PASS | 정적 분석 — SERVICE_ROLE_KEY 0건, 신규 키명 확인 |
| C10 | .env.local.example — 서버 전용 보안 주석 | PASS | "서버 전용 — NEXT_PUBLIC_ 접두사 절대 금지" 2곳 확인 |
| C11 | browser.ts — createBrowserClient, PUBLISHABLE_KEY 참조 | PASS | 정적 분석 — `createBrowserClient`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| C12 | server.ts — createServerClient, getAll/setAll 패턴 | PASS | 정적 분석 — getAll/setAll 구현, try/catch(Server Component 쿠키 쓰기 제한) |
| C13 | admin.ts — server-only 가드 + createClient(supabase-js) | PASS | 정적 분석 — `import 'server-only'`, `createSupabaseClient` |
| C14 | admin.ts — persistSession: false, autoRefreshToken: false | PASS | 정적 분석 — auth 옵션 확인 |
| C15 | admin.ts — 환경변수 미설정 시 명시적 throw | PASS | 정적 분석 — url/secretKey 모두 조건 체크 후 throw |
| C16 | admin.ts가 클라이언트 번들에 유입 시 빌드 실패 | PASS | 사전 실행 검증 완료 (프롬프트 명시) |
| C17 | proxy.ts(lib) — getClaims() try/catch fail-closed | PASS | 정적 분석 — try/catch, `isAuthenticated = false` 초기값, fail-closed 주석 |
| C18 | getClaims()가 @supabase/supabase-js 2.107.0에 존재 | PASS | `node -e` prototype chain 탐색 — getClaims 확인 |
| C19 | proxy.ts(src) — PROTECTED_PREFIXES 보호 라우트 목록 | PASS | 정적 분석 — `/challenge`, `/feed`, `/admin`, 루트 `/` |
| C20 | 보호 라우트 307 → /login redirect | PASS | curl 실행 — `/`, `/feed/today`, `/admin/challenges`, `/challenge/test-id` 모두 307 |
| C21 | 공개 라우트 200 응답 | PASS | curl 실행 — `/login` 200, `/s/test-id` 200, `/u/test-handle` 200 |
| C22 | /api/auth/callback — 코드 없을 때 /login?error=auth redirect | PASS | curl 실행 — `status=307 redirect=.../login?error=auth` |
| C23 | /api/auth/callback — 잘못된 코드 시 /login?error=auth redirect | PASS | curl `code=fake` — `status=307 redirect=.../login?error=auth` |
| C24 | open-redirect 방지: `//evil.com` → `/` fallback | PASS | 정적 분석 — `!nextParam.startsWith('//')` 조건 확인 |
| C25 | open-redirect 방지: `/\host` → `/` fallback | PASS | 정적 분석 — `!nextParam.startsWith('/\\')` 조건 확인 |
| C26 | /login 페이지 접근 가능 + "Google로 시작하기" 렌더링 | PASS | curl + HTML 파싱 — h1·button 텍스트 확인 |
| C27 | login.tsx — signInWithOAuth error 처리 (Reviewer H2) | PASS | 정적 분석 — `if (error) console.error(...)` |
| C28 | login.tsx — browser.ts createClient() 사용 | PASS | 정적 분석 — `import { createClient } from "@/lib/supabase/browser"` |
| C29 | isProtectedPath 로직 — architecture.md 표와 일치 | PASS | node 실행 검증 — `/api/auth/callback` PUBLIC, `/challenge/*` PROTECTED 등 전항목 일치 |
| C30 | Data API 비노출: `/rest/v1/challenges`, `/rest/v1/profiles` 404 | PASS | curl + 사전 실행 검증 완료 (§8.5-1) |
| C31 | 구 env 키명(ANON_KEY, SERVICE_ROLE_KEY) 코드/예제 파일 잔존 | PASS | grep 결과 0건 |
| C32 | SUPABASE_SECRET_KEY가 NEXT_PUBLIC_ 접두사로 노출되지 않음 | PASS | grep 결과 0건 — 전 ts/tsx/env.example 파일 대상 |
| C33 | 마이그레이션 저널 0002 등록 | PASS | `_journal.json` — idx=2, tag=`0002_eager_hulk` 확인 |
| C34 | 빌드 output — `ƒ Proxy (Middleware)` 인식 | PASS | `pnpm build` 출력 직접 확인 |

---

## 라우팅 시나리오 검증 결과

dev 서버(`http://localhost:3000`) 실행 상태에서 비인증 curl로 검증.

| 경로 | 예상 | 실제 | 상세 |
|------|------|------|------|
| `GET /` | 307 → /login | PASS | status=307 redirect=http://localhost:3000/login |
| `GET /feed/today` | 307 → /login | PASS | status=307 |
| `GET /admin/challenges` | 307 → /login | PASS | status=307 |
| `GET /challenge/test-id` | 307 → /login | PASS | status=307 |
| `GET /challenge/test-id/preview` | 307 → /login | PASS | status=307 |
| `GET /login` | 200 | PASS | status=200 |
| `GET /s/test-id` | 200 | PASS | status=200 |
| `GET /u/test-handle` | 200 | PASS | status=200 |
| `GET /api/auth/callback` (코드 없음) | 307 → /login?error=auth | PASS | status=307, redirect 확인 |
| `GET /api/auth/callback?code=fake` | 307 → /login?error=auth | PASS | exchangeCodeForSession 실패 후 정상 fallback |
| `GET /rest/v1/challenges` | 404 | PASS | Data API 비노출 확인 |
| `GET /rest/v1/profiles` | 404 | PASS | Data API 비노출 확인 |

---

## isProtectedPath 로직 검증

```
/api/auth/callback  → PUBLIC  (proxy 통과, isProtectedPath=false — 교환 정상 진행)
/api/challenges/today → PUBLIC
/login              → PUBLIC
/                   → PROTECTED (→/login)
/feed/today         → PROTECTED
/challenge/test     → PROTECTED
/admin/challenges   → PROTECTED
/s/test             → PUBLIC
/u/test             → PUBLIC
```

모든 경로가 `architecture.md` 페이지별 인증 요구사항 표와 일치한다.

---

## 이슈 목록

### Critical (커밋 차단)

없음.

---

### High (커밋 전 수정 필수)

없음.

> Reviewer 리뷰에서 지적된 High 2건은 구현 단계에서 반영 완료:
> - H1(getClaims try/catch fail-closed): `src/lib/supabase/proxy.ts` L29~35 — isAuthenticated=false 초기값 + try/catch 패턴 확인
> - H2(signInWithOAuth error 처리): `src/app/login/page.tsx` L17~18 — `if (error) console.error(...)` 확인

---

### Medium (이관 결정 유지, 커밋 차단 사유 아님)

#### M1: login.tsx의 redirectTo가 window.location.origin — 배포 환경 고려 미흡

**현상**: `redirectTo: \`${window.location.origin}/api/auth/callback?next=/\`` — `window.location.origin`은 클라이언트 브라우저의 현재 출처를 그대로 사용한다. 로컬(http://localhost:3000)에서는 정상이나, 배포 환경에서 커스텀 도메인이 없는 Vercel 기본 URL과 커스텀 도메인이 혼재하면 Supabase OAuth 허용 URL 목록과 불일치하여 로그인 실패 가능성이 있다.

**Reviewer 이관 결정**: 배포 전(`NEXT_PUBLIC_APP_URL` 환경변수를 사용하는 방식으로 전환 권장).

**판정 근거**: 현재 MVP는 localhost 개발 단계이므로 기능상 무해. 배포 전 반드시 Supabase Dashboard → Authentication → URL Configuration의 허용 URL 목록과 redirectTo 값을 일치시켜야 한다.

---

#### M2: /api/auth/callback의 `next` 파라미터가 `/` 고정

**현상**: login.tsx에서 `next=/`만 전송. 공개 URL 협소화 검증(내부 경로만 허용)을 callback에서 수행하지만, 현재 login이 `next=/`만 보내므로 실질적으로 리다이렉션 경로가 고정된다.

**Reviewer 이관 결정**: Day 3+에서 "로그인 후 원래 요청하던 페이지로 돌아가기" UX 구현 시 함께 처리.

**판정 근거**: 현재 MVP에서 모든 보호 라우트 접근 시 `/`로 돌아가는 것은 기능상 수용 가능.

---

#### M3: proxy matcher가 `/api/auth/callback`을 포함

**현상**: matcher `'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'`는 `/api/auth/callback`을 포함한다. proxy의 `updateSession()`이 먼저 호출된 뒤 실제 callback handler가 실행된다.

**영향 분석(현재)**: `isProtectedPath('/api/auth/callback') = false`이므로 redirect 없이 handler로 전달된다. `updateSession()`의 `getClaims()` 호출 시 세션이 없으면(코드 교환 전) 단순히 isAuthenticated=false로 처리되어 무해하다. 세션 갱신 시도가 먼저 발생하더라도 코드 교환을 방해하지 않는다.

**Reviewer 이관 결정**: Day 3 API 작업과 함께 matcher에서 `/api/auth`를 명시적으로 제외하는 방식으로 정리.

**판정 근거**: 현재 동작상 무해. 단, 성능 관점에서 불필요한 세션 검증이 callback마다 추가 발생한다.

---

### Low (참고 사항)

#### L1: server.ts에 server-only 가드 없음

`src/lib/supabase/server.ts`는 `server-only` 임포트가 없다. 다만 내부에서 `cookies()`(next/headers)를 사용하므로, 클라이언트 컴포넌트에서 import하면 Next.js가 빌드 타임 또는 런타임에 자체 오류를 발생시킨다. 실질적 보호는 되어 있으나, 에러 메시지가 `server-only` 가드보다 덜 명시적이다.

**권장**: Day 3 작업 시 server.ts 상단에 `import 'server-only'`를 추가하면 오류 메시지가 명확해진다. 당장 커밋을 차단하는 수준은 아님.

#### L2: login.tsx — 에러 UI 미구현 (console.error만)

Phase 3 Frontend 이관으로 확정된 사항. `signInWithOAuth` 실패 시 사용자에게 시각적 피드백 없음. MVP에서는 수용 가능하며, Reviewer H2 대응으로 error 삼킴은 제거됨.

#### L3: /api/og/* 미구현 — 공개 라우트지만 404 반환

Day 3+ 구현 예정. 현재 접근 시 404 반환. Day 2 범위 외이므로 이슈 아님.

---

## §8.5 보안 결정 준수 확인

| 결정 | 내용 | 결과 |
|------|------|------|
| §8.5-1 Data API 비노출 | `/rest/v1/challenges`, `/rest/v1/profiles` → 404 | PASS (curl + 사전 검증) |
| §8.5-2 신규 키체계 env 네이밍 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | PASS (.env.local.example + 코드 전체) |
| §8.5-2 SUPABASE_SECRET_KEY 서버 전용 | NEXT_PUBLIC_ 접두사 없음, admin.ts에서만 사용 | PASS |
| §8.4-③ SECURITY DEFINER 가드 | server-only + admin client server-only | PASS |

---

## Day 2 게이트 A 결정 구현 완료 체크

| 항목 | 결정 내용 | 구현 확인 |
|------|----------|----------|
| (a) env 변수명 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | PASS |
| (b) /login | `src/app/login/page.tsx` 신규 생성, Google 버튼만 | PASS |
| (c) 보호 라우트 | `/`, `/challenge/*`, `/feed/*`, `/admin/*` / 공개: `/login`, `/s/*`, `/u/*`, `/api/auth/callback` 등 | PASS |
| (d) M2 중복 인덱스 | schema.ts 제거 + 0002 DROP INDEX + §1.2 동기화 | PASS |
| (e) 작업 단위 3개 | U1(db+M2) / U2(env+clients) / U3(login+callback+proxy) — 미커밋 상태에서 QA 수행 | PASS (PR 분리는 커밋 단계에서) |
| (f) proxy.ts 파일명 | `src/proxy.ts`, 빌드 output `ƒ Proxy (Middleware)` | PASS |
| (g) server-only 가드 | `src/db/index.ts` + `src/lib/supabase/admin.ts` | PASS |

---

## 사용자 수동 테스트 체크리스트 (모바일 브라우저, iPhone 14 기준)

### 필수 확인 (커밋 전)

- [ ] Safari(iPhone 14) → `http://localhost:3000/` 접속 → `/login`으로 리다이렉트 되는지 확인
- [ ] Safari(iPhone 14) → `/login` 직접 접속 → "Google로 시작하기" 버튼 표시 확인
- [ ] Safari(iPhone 14) → `/feed/today`, `/admin/challenges` 직접 접속 → `/login` 리다이렉트 확인
- [ ] Safari(iPhone 14) → `/s/test`, `/u/test` 직접 접속 → 200 (리다이렉트 없음) 확인
- [ ] Google 로그인 버튼 클릭 → Google OAuth 동의 화면으로 이동하는지 확인 (실제 OAuth E2E)
- [ ] Google 로그인 완료 → `/` 로 리다이렉트 확인
- [ ] 로그인 완료 후 `/` 접근 → 307 redirect 없이 정상 로드 확인

### 권장 확인

- [ ] Supabase Dashboard → Authentication → Users → 로그인한 사용자 계정 생성 확인
- [ ] Supabase Dashboard → Table Editor → profiles 테이블 → trigger 자동 생성 레코드 확인 (nickname, id)
- [ ] Supabase Dashboard → Authentication → URL Configuration → Site URL이 localhost:3000, Redirect URLs에 `http://localhost:3000/api/auth/callback` 등록 확인
- [ ] Chrome DevTools → Application → Cookies → `localhost` → `sb-*` 세션 쿠키 생성 확인
- [ ] 로그인 후 브라우저 새로고침 → 로그인 상태 유지 (세션 쿠키 동작)
- [ ] 브라우저 쿠키 직접 삭제 후 보호 라우트 접근 → `/login` 리다이렉트 확인

### 네트워크 연결 없을 때 (모바일 엣지 케이스)

- [ ] 비행기 모드 → `/login` 접속 → 페이지 로드 실패 대신 적절한 화면 표시 여부 (현재 에러 UI 없음, Phase 3에서 처리 예정)
- [ ] 비행기 모드 → Google 로그인 버튼 클릭 → 네트워크 오류 발생 시 콘솔 에러만 출력됨 (현재 사용자 피드백 없음 — L2 이슈)

---

## 커밋 가능 여부

**커밋 가능** — Critical 0건, High 0건.

Reviewer 리뷰에서 지적된 High 2건(H1: getClaims fail-closed, H2: signInWithOAuth error 처리)이 구현 단계에서 반영 완료되어 QA 검증에서 모두 PASS 확인됐다.

Medium 3건(M1: redirectTo 정책, M2: next 협소화, M3: proxy matcher)은 Reviewer 리뷰와 사용자 승인을 통해 각각 배포 전 / Day 3+ / Day 3으로 이관이 확정된 사항으로, 커밋 차단 사유가 아니다.

Low 2건(L1: server.ts server-only 미가드, L2: 에러 UI 미구현)은 기능 동작에 영향 없으며 Day 3+ 이관 적절하다.

Day 2 게이트 A 결정 (a)~(g) 전항목 구현 완료 확인됨. 커밋 및 PR 진행 가능.

---

## 다음 액션 (구현 Agent)

**Day 3 시작 전 권장 (낮은 우선순위)**

1. **[L1 — 선택]** `src/lib/supabase/server.ts` 상단에 `import 'server-only'` 추가 — 에러 메시지 명확성 향상

**Day 3 포함 필수**

2. **[M3]** proxy matcher에서 `/api/auth`를 명시적 제외 패턴으로 추가 — Day 3 API 작업과 함께

**배포 전 필수**

3. **[M1]** `login.tsx`의 `redirectTo`를 `window.location.origin` 대신 `process.env.NEXT_PUBLIC_APP_URL` 기반으로 전환, Supabase Dashboard Redirect URL 목록 등록

**Day 3+ UX 개선**

4. **[M2]** proxy에서 보호 라우트 접근 시 `next` 파라미터에 원래 경로를 포함해 콜백 후 복귀 UX 구현
5. **[L2]** `login.tsx` — Google 로그인 실패 시 사용자 표시 에러 UI 구현

---

## 재검증 섹션

> 해당 없음 — Critical/High 이슈가 없어 재검증 사이클 불필요.
> Reviewer High 2건은 구현 단계 반영으로 초회 QA에서 PASS 확인됐다.
