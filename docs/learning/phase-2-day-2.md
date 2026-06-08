# Phase 2 Day 2 — 인증(Google OAuth) + Supabase 클라이언트 3종 + Next 16 proxy 학습 노트

> 대상 작업: Supabase 클라이언트 3종(browser/server/admin) + proxy 세션 헬퍼 + Google OAuth 플로우 + Next.js 16 proxy 보호 라우트 + runtime Drizzle client + M2 중복 인덱스 제거
> 산출물: `src/lib/supabase/{browser,server,admin,proxy}.ts`, `src/proxy.ts`, `src/app/api/auth/callback/route.ts`, `src/app/login/page.tsx`, `src/db/index.ts`, `src/db/migrations/0002_eager_hulk.sql`
> QA 리포트: `docs/reviews/phase2-day2-qa-review.md` (Critical 0 / High 0, Reviewer High 2건 구현 단계 반영)
>
> 이 노트는 한 번에 하나씩 읽도록 개념별 섹션으로 나눴다. 순서는 "왜 클라이언트가 3개인가 → 쿠키를 어떻게 다루나 → 로그인은 어떻게 흐르나 → 누구를 신뢰하나 → 문을 어떻게 지키나 → 함정들"이다.

---

## 이번 Day의 큰 그림 (먼저 읽기)

Day 1은 **DB에 자물쇠(RLS/GRANT)를 달았다.** 그런데 자물쇠는 "열쇠를 가진 사람"이 와야 의미가 있다. Day 2는 그 **열쇠(JWT 세션)를 발급하고, 매 요청마다 들고 다니게 하고, 열쇠 없는 사람을 현관에서 돌려보내는** 일을 했다.

한 문장으로: **"사용자가 Google로 로그인하면 JWT가 쿠키에 담기고, 그 쿠키로 DB를 칠 때 Day 1의 RLS가 비로소 `auth.uid()`라는 실제 값을 받기 시작한다."**

전체 흐름을 한 장으로:

```
[로그인]  /login 버튼 클릭
   │  signInWithOAuth (browser client)
   ▼
[Google]  동의 화면 → 인증 코드 발급
   │  redirectTo=/api/auth/callback?next=/
   ▼
[콜백]    /api/auth/callback (server client)
   │  exchangeCodeForSession(code) → JWT를 쿠키에 굽는다
   ▼
[홈 복귀]  next='/'로 redirect
   │
   ▼
[이후 모든 요청]  src/proxy.ts가 가로챔
   │  updateSession() → 만료 토큰 갱신 + 인증 여부 판정
   ├─ 인증 O → 통과 (갱신된 쿠키 실린 응답 반환)
   └─ 인증 X + 보호 라우트 → /login으로 redirect (fail-closed)
```

이 흐름에 **세 가지 Supabase 클라이언트**가 각자 다른 역할로 등장한다. 그게 이 노트의 출발점이다.

---

## 1. 클라이언트 3종 — 왜 하나로 안 되고 셋인가

### 왜 필요한가? — "누구 권한으로 DB를 치느냐"가 다르다

Supabase에 쿼리를 보낼 때, DB 입장에서 "이 요청은 **어떤 역할(role)**로 온 건가?"가 결정된다. 그리고 그 역할에 따라 Day 1에 만든 GRANT·RLS가 다르게 적용된다. **역할이 다르면 클라이언트도 달라야 한다.** 하나로 묶으면 "관리자 권한 키를 브라우저에 노출"하는 사고가 난다.

| 클라이언트 | 파일 | 실행 위치 | 인증 출처 | 역할 | RLS |
|-----------|------|----------|----------|------|-----|
| **Browser** | `browser.ts` | 브라우저 | 사용자 JWT (메모리/쿠키) | anon → authenticated | **적용 O** |
| **Server** | `server.ts` | Next 서버 | 요청 쿠키의 JWT | anon → authenticated | **적용 O** |
| **Admin** | `admin.ts` | Next 서버 전용 | `SUPABASE_SECRET_KEY` | service_role | **우회 (무시)** |

비유: 같은 건물이라도 **방문객 출입증(browser/server, RLS 검문 통과)**과 **마스터키(admin, 모든 문 무조건 열림)**는 전혀 다른 물건이다. 마스터키를 방문객 라운지(클라이언트 번들)에 두면 안 된다.

### Browser vs Server — 둘 다 RLS인데 왜 또 나누나

핵심 차이는 **"JWT를 어디서 읽느냐"**다.

- **Browser**(`browser.ts:4-9`): 브라우저에서 직접 돈다. Supabase JS가 알아서 로컬 세션을 들고 있다. 주 용도는 **로그인 트리거**(`login/page.tsx`)와 추후 **Storage 업로드**(클라이언트에서 파일을 직접 올릴 때).
- **Server**(`server.ts:6-30`): Next 서버(Route Handler·Server Component·Server Action)에서 돈다. 브라우저 세션이 없으니 **요청에 실려온 쿠키에서 JWT를 꺼내** 인증한다. 그래서 `cookies()`(next/headers)를 받아 `getAll/setAll`을 넘긴다.

같은 "사용자 권한"이라도 실행 환경(브라우저 vs 서버)이 다르면 JWT를 얻는 경로가 달라서 두 개로 나뉜다.

### Admin — 강력하고 위험한 마스터키

`admin.ts`는 `@supabase/ssr`이 아니라 순수 `@supabase/supabase-js`로 만든다(`admin.ts:4,19`). `SUPABASE_SECRET_KEY`(구 service_role key)를 쓰므로 **RLS를 통째로 우회**한다. Day 1에서 service_role에 `GRANT ALL`을 준 게 바로 이 클라이언트를 위한 것이다.

용도는 챌린지 등록·신고 처리 같은 **관리 작업에만 제한적으로** 쓴다(`admin.ts:7`). 세션 개념이 없으므로 옵션도 다르다:

```typescript
// admin.ts:19-21
return createSupabaseClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

`persistSession: false` — 사용자처럼 세션을 저장할 필요가 없다(요청 단위 일회성). `autoRefreshToken: false` — 갱신할 토큰 자체가 없다(secret key는 만료 안 됨). 이 두 옵션을 끄는 건 "이건 사용자 세션이 아니라 서버 도구"라는 선언이다.

### Typolog에서는?

- `browser.ts:5` — `createBrowserClient(URL, PUBLISHABLE_KEY)` — publishable 키는 공개돼도 안전(RLS가 막아줌).
- `server.ts:9` — `createServerClient(URL, PUBLISHABLE_KEY, { cookies })` — 같은 publishable 키 + 쿠키 어댑터.
- `admin.ts:10` — `process.env.SUPABASE_SECRET_KEY` — **유일하게 secret 키를 쓰는 곳.** 그래서 `import 'server-only'`로 잠갔다(§8 참고).

### 자주 하는 실수

- **`SUPABASE_SECRET_KEY`에 `NEXT_PUBLIC_` 접두어를 붙임**: 1급 사고. `NEXT_PUBLIC_`이 붙은 env는 **클라이언트 번들에 그대로 인라인**된다. RLS 우회 키가 누구나 볼 수 있는 JS에 박힌다 = DB 전체 무방비. `.env.local.example:9`에 "서버 전용 — NEXT_PUBLIC_ 접두사 절대 금지" 경고가 있다.
- **admin 클라이언트를 편하다고 일반 조회에 씀**: RLS를 우회하니 "잘 되는 것처럼" 보이지만, 소유권 검증이 사라진다. browser/server로 충분한 작업에 admin을 쓰면 안 된다.
- **publishable 키를 비밀로 착각해서 숨김**: publishable 키는 공개 전제다(RLS가 방어선). 숨길 필요 없고, `NEXT_PUBLIC_`이 정상이다. secret 키와 혼동하지 말 것.

### 나중에 배울 것
- Drizzle 직결(`src/db/index.ts`, postgres role)은 **네 번째 경로**다. RLS를 우회하므로 API 코드에서 소유권을 손으로 검증한다(설계 §10.3). Day 3 API에서 본격화.

---

## 2. `@supabase/ssr`의 쿠키 어댑터 — 왜 `get/set`이 아니라 `getAll/setAll`인가

### 왜 필요한가? — JWT는 한 덩어리가 아니다

Supabase 세션 쿠키는 우리 생각보다 크다. JWT(access token) + refresh token + 사용자 메타데이터가 다 들어간다. 그런데 브라우저 쿠키는 **하나당 약 4KB 제한**이 있다. 그래서 `@supabase/ssr`은 큰 세션을 **여러 청크로 쪼개** 저장한다:

```
sb-<project>-auth-token.0   ← 1번 조각
sb-<project>-auth-token.1   ← 2번 조각
sb-<project>-auth-token.2   ← 3번 조각
```

여기서 문제가 생긴다. 만약 어댑터가 `get(name)` / `set(name)`처럼 **쿠키 하나씩** 다루면, 라이브러리가 "지금 청크가 몇 개인지" 추적하느라 복잡해지고, 청크 경계가 어긋나면 세션이 깨진다. `getAll()`(전부 읽기) / `setAll()`(전부 쓰기)을 받으면, 라이브러리가 **청크 분할/병합을 내부에서 알아서** 처리하고 우리는 "쿠키 묶음 전체"만 넘기면 된다.

비유: 큰 짐을 옮길 때 "박스 한 개씩 손으로 받아"(get/set)가 아니라 "팔레트째 통째로 넘겨"(getAll/setAll). 박스를 몇 개로 나눌지는 이삿짐센터(라이브러리)가 정한다.

> 참고: 구버전 `@supabase/auth-helpers`는 `get/set/remove` 방식이었다. 이 옛 예제를 보고 따라 하면 청크 쿠키가 깨진다. 현행 `@supabase/ssr`은 `getAll/setAll`만 쓴다.

### Typolog에서는?

`server.ts:13-27`와 `proxy.ts:12-24` 두 곳에 어댑터가 있다. **모양이 비슷하지만 setAll의 목적지가 다르다** — 이게 다음 섹션의 핵심이다.

```typescript
// server.ts:14-26 — Next.js의 cookieStore에 쓴다
cookies: {
  getAll() { return cookieStore.getAll(); },
  setAll(cookiesToSet) {
    try {
      cookiesToSet.forEach(({ name, value, options }) =>
        cookieStore.set(name, value, options));
    } catch { /* Server Component에선 쿠키 쓰기 불가 → 삼킨다 (§3) */ }
  },
},
```

### 자주 하는 실수

- **옛 예제 보고 `get/set/remove`로 어댑터를 짬**: 청크 쿠키 경계가 깨져 세션이 간헐적으로 풀린다. 디버깅이 지옥인 이유는 "작은 세션일 땐 청크가 1개라 잘 되다가, 토큰이 커지면 갑자기 깨지기" 때문이다. 처음부터 `getAll/setAll`만 쓴다.
- **`setAll`에서 options를 빠뜨림**: `options`엔 `httpOnly`, `secure`, `maxAge`, `path` 등 보안·수명 설정이 들어 있다. 이걸 안 넘기면 쿠키가 영속되지 않거나 보안 속성이 사라진다. `server.ts:20`·`proxy.ts:20`이 `options`까지 그대로 전달하는 이유다.

### 나중에 배울 것
- 쿠키의 `httpOnly` 속성 — JS에서 못 읽게 막아 XSS로부터 세션을 보호한다. Supabase가 이 옵션을 `options`에 담아준다. §9의 Self-XSS와 연결.

---

## 3. Server Component는 쿠키를 못 쓴다 — try/catch로 삼키고 proxy가 책임진다

### 왜 필요한가? — React가 HTML을 다 그린 뒤엔 헤더를 못 고친다

Next.js Server Component는 HTML을 **스트리밍**으로 내려보낸다. 그런데 쿠키를 설정하려면 HTTP 응답 **헤더**(`Set-Cookie`)를 써야 하고, 헤더는 본문(HTML)이 나가기 **전에** 확정돼야 한다. 이미 HTML을 그리기 시작한 Server Component에서 쿠키를 쓰려 하면 Next가 **에러를 던진다.**

여기서 딜레마: Supabase 서버 클라이언트는 토큰이 만료되면 자동 갱신하면서 `setAll`로 새 쿠키를 쓰려고 한다. Server Component에서 이게 호출되면 throw가 난다.

### Typolog의 해법 — 역할 분담

```
Server Component에서의 setAll  →  try/catch로 조용히 삼킨다 (어차피 못 씀)
                                    │
                                    ▼
실제 세션 갱신·쿠키 굽기  ←  proxy(updateSession)가 전담한다 (응답을 직접 만듦)
```

`server.ts:22-25`의 빈 catch가 바로 이 결정이다:

```typescript
} catch {
  // Server Component에서는 쿠키 쓰기가 불가능해 setAll이 throw한다.
  // proxy(updateSession)가 세션 갱신을 담당하므로 무시해도 안전하다.
}
```

이게 안전한 이유: **모든 요청은 `src/proxy.ts`를 먼저 거친다.** proxy의 `updateSession`은 `NextResponse`를 직접 만들어 거기에 쿠키를 굽는다(`proxy.ts:18-21`) — 이 시점엔 아직 응답 헤더를 자유롭게 쓸 수 있다. 그래서 Server Component가 쿠키 쓰기에 실패해도, proxy가 이미 갱신해줬으니 세션이 유지된다.

비유: 가게(Server Component)는 영수증(HTML)을 이미 손님에게 건넨 뒤라 도장(쿠키)을 못 찍는다. 대신 입구의 안내데스크(proxy)가 손님이 들어올 때 미리 도장을 찍어준다. 가게는 "내가 못 찍어도 안내데스크가 찍었겠지" 하고 조용히 넘어간다.

### 자주 하는 실수

- **catch 블록에서 throw를 다시 던지거나 로그를 시끄럽게 찍음**: 이 throw는 **정상 동작**이다(Server Component의 구조적 제약). 에러로 취급해 다시 던지면 멀쩡한 페이지가 500으로 죽는다. **조용히 삼키는 게 정답.** (단, Route Handler·Server Action에서는 쿠키 쓰기가 되므로 거기선 throw가 안 난다.)
- **proxy 없이 server client만으로 세션 갱신이 될 거라 기대**: try/catch로 삼켰으니 Server Component 단독으론 토큰 갱신이 안 된다. proxy가 반드시 짝으로 있어야 만료 세션이 살아난다.

### 나중에 배울 것
- Route Handler(`/api/auth/callback`)에서는 `setAll`이 정상 동작한다. 그래서 콜백에서 `exchangeCodeForSession`이 쿠키를 직접 구울 수 있다(§4). "어디선 되고 어디선 안 되는지"의 경계가 핵심.

---

## 4. Google OAuth 플로우 전체 — PKCE로 코드를 세션으로 교환하기

### 왜 필요한가? — 비밀번호를 우리가 안 받기 위해

직접 이메일·비밀번호를 받으면 우리가 비밀번호를 저장·관리해야 하고, 그게 유출되면 끝장이다. OAuth는 **인증을 Google에 위임**한다. 우리는 "이 사람이 누구인지"만 Google에게 보증받고, 비밀번호는 만지지도 않는다.

### 핵심 원리 — 4단계 + PKCE

```
1. /login에서 signInWithOAuth({ provider: 'google' })
     → 브라우저가 Google 동의 화면으로 이동
     → 이때 PKCE: 브라우저가 비밀(code_verifier)을 만들고,
       그 해시(code_challenge)만 Google에 보낸다

2. Google 동의 → 인증 "코드"를 우리 콜백 URL에 붙여 돌려보냄
     → redirectTo=/api/auth/callback?next=/  (login/page.tsx:14)

3. /api/auth/callback에서 exchangeCodeForSession(code)
     → 이때 PKCE: 아까 만든 비밀(code_verifier)을 함께 제출
     → Supabase가 "코드 + 검증값"이 맞는지 확인하고 JWT 세션 발급
     → 세션을 쿠키에 굽는다 (server client의 setAll, Route Handler라 정상 동작)

4. next='/'로 redirect → 홈 복귀, 이후 요청에 쿠키 자동 동봉
```

**PKCE(Proof Key for Code Exchange)가 왜 있나?** 2단계에서 인증 코드가 URL에 실려 돌아온다. 만약 누군가 이 코드를 가로채면 세션을 훔칠 수 있다. PKCE는 1단계에서 만든 비밀(code_verifier)을 3단계에서 함께 제출하게 해서, **코드만 훔친 공격자는 비밀이 없어 교환에 실패**하게 만든다. 택배 코드(인증 코드)를 가로채도, 본인 서명(verifier)이 없으면 못 받는 것과 같다.

### Typolog에서는?

- `login/page.tsx:11-16` — 1단계:
  ```typescript
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/api/auth/callback?next=/` },
  })
  ```
- `app/api/auth/callback/route.ts:16-22` — 3단계:
  ```typescript
  if (code) {
    const supabase = await createClient();  // server client
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  ```
- 실패(코드 없음 or 교환 실패) 시 `route.ts:25` — `/login?error=auth`로 되돌린다.

> **Day 1 trigger와의 연결**: 이 플로우로 **처음** 로그인하면 Supabase가 `auth.users`에 행을 만들고, Day 1에 심은 `on_auth_user_created` trigger가 발동해 `public.profiles`에 행이 자동 생성된다(QA 권장 체크리스트의 "profiles 자동 생성 확인"). 즉 OAuth 플로우가 Day 1 trigger의 첫 실전 무대다.

### 자주 하는 실수

- **`redirectTo`를 Supabase Dashboard의 허용 URL에 등록 안 함**: Supabase는 등록되지 않은 redirect URL을 거부한다. 로컬은 `http://localhost:3000/api/auth/callback`을 Dashboard → Authentication → URL Configuration에 넣어야 한다(QA 권장 체크리스트).
- **`window.location.origin`을 배포에서 그대로 씀**: 로컬은 되지만 커스텀 도메인 ↔ Vercel 기본 URL이 섞이면 허용 목록과 어긋나 로그인 실패. QA M1이 "배포 전 `NEXT_PUBLIC_APP_URL`로 전환"을 권고했다. MVP 로컬 단계라 지금은 무해.
- **`signInWithOAuth` 에러를 삼킴**: `login/page.tsx:18`이 `if (error) console.error(...)`로 최소 처리한다. 에러를 통째로 무시하면 "버튼을 눌렀는데 아무 일도 안 일어나는" 디버깅 불가 상태가 된다(Reviewer H2 반영분).

### 나중에 배울 것
- 로그아웃(`signOut`)과 세션 만료 후 refresh token으로 자동 갱신되는 흐름. Day 2는 로그인까지만 다뤘다.

---

## 5. `getClaims()` vs `getSession()` vs `getUser()` — 서버에서 무엇을 신뢰하나

### 왜 필요한가? — "쿠키에 적힌 글자"를 그대로 믿으면 안 된다

세션 쿠키는 **사용자 브라우저에 저장**된다. 즉 사용자(또는 공격자)가 손댈 수 있는 영역이다. 만약 서버가 쿠키 내용을 **검증 없이** 그대로 믿으면, 누군가 쿠키를 위조해 "나는 admin이다"라고 우길 수 있다. 그래서 서버에서 인증을 판단할 땐 **"이 토큰이 진짜 Supabase가 발급한 게 맞는지" 검증**이 핵심이다.

| 메서드 | 무엇을 하나 | 검증? | 서버에서 신뢰? |
|--------|------------|------|--------------|
| `getSession()` | 쿠키/스토리지의 세션을 **그냥 읽어옴** | ❌ 안 함 | **❌ 신뢰 금지** |
| `getUser()` | Supabase 서버에 물어 토큰 유효성 확인 | ✅ (네트워크 왕복) | ✅ |
| `getClaims()` | JWT 서명을 검증하고 claims를 돌려줌 + 만료 시 갱신 | ✅ | ✅ (현행 가이드 권장) |

**`getSession()`을 서버에서 신뢰하면 안 되는 이유**: 이건 "쿠키에 뭐가 적혀 있나"를 읽기만 한다. 위조 여부를 검사하지 않는다. 브라우저에선 편의상 쓰지만, **인가 판단**에 쓰면 구멍이 된다.

비유: `getSession()` = 손님이 내민 종이쪽지를 그대로 읽기. `getClaims()`/`getUser()` = 그 쪽지에 찍힌 정부 발행 위조방지 도장(JWT 서명)을 검증하기. 보안 결정은 도장을 확인하고 내려야 한다.

### Typolog에서는?

proxy의 `updateSession`이 `getClaims()`를 쓴다(`proxy.ts:31`):

```typescript
// 중요: createServerClient와 getClaims() 사이에 다른 로직을 두지 않는다.
let isAuthenticated = false;
try {
  const { data } = await supabase.auth.getClaims();
  isAuthenticated = Boolean(data?.claims);
} catch {
  // 검증 실패·네트워크 오류 시 미인증으로 폴백 (fail-closed)
}
```

두 가지 디테일:
1. **`getClaims()`가 만료된 토큰을 갱신**한다. 그래서 이 호출 전에 다른 로직을 끼우지 말라는 주석(`proxy.ts:27`)이 있다 — 갱신 타이밍을 보장하기 위해.
2. **fail-closed**: 검증 실패하면 `isAuthenticated`를 `false`로 둔다(초기값도 false). "애매하면 막는다"가 보안 기본값(§6).

### 자주 하는 실수

- **`getSession()` 결과로 보호 라우트 통과 여부를 판단**: 서버 코드에서 가장 흔한 보안 실수. 위조 쿠키로 인증을 우회당할 수 있다. 서버에서는 `getClaims()`(또는 `getUser()`)를 쓴다.
- **`getClaims()` 호출을 try/catch 없이 둠**: 네트워크 오류·만료로 throw가 나면 proxy 전체가 죽고, 최악의 경우 모든 요청이 에러난다. try/catch로 감싸 미인증 폴백(fail-closed)해야 안전하다(Reviewer H1 반영분, QA C17).

### 나중에 배울 것
- `getClaims()`가 돌려주는 `claims` 안에는 `sub`(user id), `role`, `exp`(만료) 등이 들어 있다. Day 3 API에서 이 `sub`를 꺼내 Drizzle 쿼리의 소유권 검증에 쓰게 된다.

---

## 6. Next.js 16 proxy — 구 middleware의 새 이름과 문지기 역할

### 왜 필요한가? — RLS는 "마지막 방어선", proxy는 "현관 안내"

RLS만 있어도 데이터는 안전하다(타인 데이터가 안 나옴). 하지만 비로그인 사용자가 `/feed/today`에 들어오면, RLS는 "0행"을 돌려줄 뿐 **"로그인하세요"라고 안내하지는 않는다.** 빈 화면만 본다. proxy는 요청이 페이지에 닿기 **전에** 가로채서 "당신은 로그인 안 했으니 `/login`으로 가세요"라고 **현관에서 돌려보낸다.** 둘은 층위가 다르고 둘 다 필요하다.

### Next.js 16의 변화 — middleware → proxy

| 구분 | Next 15 이하 | Next 16 (Typolog) |
|------|-------------|-------------------|
| 파일명 | `src/middleware.ts` | `src/proxy.ts` |
| export 이름 | `export function middleware()` | `export function proxy()` |
| 런타임 | Edge 기본 | **항상 Node.js** (게이트 A 결정 f) |
| 빌드 표기 | `ƒ Middleware` | `ƒ Proxy (Middleware)` |

Node.js 런타임이 기본이라 Supabase SSR 같은 Node 의존 패키지를 자유롭게 쓸 수 있다(과거 Edge에선 제약이 있었다).

### 핵심 원리 — matcher와 보호 라우트

`src/proxy.ts`는 두 부분이다.

**(1) matcher — "어떤 요청에 proxy를 돌릴까"** (`proxy.ts:30-35`):

```typescript
matcher: [
  '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
],
```

이 정규식의 `(?!...)`는 **negative lookahead**("이게 아닌 경우만")다. 풀어 읽으면 "`_next/static`, `_next/image`, `favicon.ico`, 이미지 확장자로 끝나는 경로**가 아닌** 모든 경로". 즉 **정적 자산은 제외**하고 나머지 모든 페이지·API에 proxy를 적용한다. 정적 파일은 세션 갱신이 불필요하니 빼서 성능을 아낀다.

비유: 건물 정문에 경비(proxy)를 세우되, 자판기·화분(정적 자산)은 검문 안 하고 사람(페이지 요청)만 검문한다.

**(2) 보호 라우트 판정 + redirect** (`proxy.ts:7-28`):

```typescript
const PROTECTED_PREFIXES = ['/challenge', '/feed', '/admin'];

function isProtectedPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, isAuthenticated } = await updateSession(request);
  if (!isAuthenticated && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return supabaseResponse;  // ← §7의 핵심
}
```

보호 라우트(`/`, `/challenge/*`, `/feed/*`, `/admin/*`)는 미인증 시 `/login`으로 redirect. 그 외(`/login`, `/s/*`, `/u/*`, `/api/auth/callback`)는 공개. QA 라우팅 시나리오에서 보호 라우트 4종이 모두 307 redirect, 공개 라우트가 200으로 검증됐다.

> **API는 proxy가 redirect하지 않는다**(`proxy.ts:5-6` 주석). API의 401 응답은 각 핸들러 책임(Day 3+). proxy는 "페이지 redirect"만 담당한다. `/api/auth/callback`이 공개여야 하는 이유: 콜백은 로그인 **전에** 호출되므로 보호 라우트면 영원히 로그인 못 한다(닭-달걀).

### 자주 하는 실수

- **`prefix.startsWith` 없이 `pathname.includes(prefix)`로 판정**: `/myfeed` 같은 경로가 `/feed`를 포함한다고 오판될 수 있다. `pathname === prefix || pathname.startsWith(`${prefix}/`)`로 **경계를 정확히** 잡는다(`proxy.ts:11-13`).
- **matcher에서 `/api/auth/callback`을 제외 안 함**: 현재는 무해(콜백이 공개라 redirect 안 됨)하지만, 콜백마다 불필요한 세션 검증이 한 번씩 돈다(QA M3, Day 3 정리 예정). 동작엔 문제없고 성능 미세 손해.

### 나중에 배울 것
- "로그인 후 원래 가려던 페이지로 복귀" UX: 지금은 `url.search = ''`로 쿼리를 지우지만(`proxy.ts:23`), Day 3+에 `next=원래경로`를 붙여 콜백 후 복귀시킬 수 있다(QA M2).

---

## 7. `supabaseResponse`를 그대로 반환해야 하는 이유 — 로그인 루프 방지

### 왜 필요한가? — 갱신된 쿠키가 응답에 안 실리면 매번 만료된다

이게 Supabase SSR에서 가장 악명 높은 함정이다. proxy는 두 가지를 한다: ① 토큰을 갱신하고(새 쿠키 생성) ② 그 응답을 브라우저에 돌려준다. 그런데 **새 쿠키를 담은 응답(`supabaseResponse`)이 아니라 다른 응답을 돌려주면**, 브라우저는 갱신된 쿠키를 못 받는다. 다음 요청에서 또 만료된 토큰을 들고 오고, proxy가 또 갱신하고... **세션이 영원히 정착하지 못하는 루프**가 생긴다. 심하면 로그인 → 갱신 실패 → `/login` redirect → 다시 로그인의 무한 반복이다.

### Typolog에서는?

`proxy.ts(lib)`의 `updateSession`은 `supabaseResponse`를 만들어 **그 객체에 쿠키를 굽고 그대로 반환**한다:

```typescript
// proxy.ts:16-21 — setAll이 supabaseResponse에 직접 쿠키를 쓴다
setAll(cookiesToSet) {
  cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
  supabaseResponse = NextResponse.next({ request });
  cookiesToSet.forEach(({ name, value, options }) =>
    supabaseResponse.cookies.set(name, value, options),
  );
},
```

```typescript
// proxy.ts:37-38 — 그대로 반환
// 갱신된 세션 쿠키가 실린 supabaseResponse를 그대로 반환해야 쿠키가 유실되지 않는다.
return { supabaseResponse, isAuthenticated };
```

그리고 `src/proxy.ts:27`에서 인증된 경우 이 `supabaseResponse`를 최종 반환한다. **새 `NextResponse.next()`를 따로 만들어 반환하면 안 된다** — 그러면 쿠키가 유실된다.

단, redirect 케이스(`src/proxy.ts:20-25`)는 새 redirect 응답을 만든다. 이건 의도된 것 — 미인증이라 어차피 세션이 없고, `/login`으로 보내는 게 목적이라 쿠키 유실이 문제되지 않는다.

비유: 갱신된 회원증(쿠키)을 손님 지갑에 넣어 돌려줘야 하는데, 빈 봉투(새 response)를 대신 건네면 손님은 다음에 또 옛 회원증을 들고 온다.

### 자주 하는 실수

- **`updateSession` 안에서 갱신해놓고, proxy에서 `NextResponse.next()`를 새로 만들어 반환**: 가장 흔한 로그인 루프 원인. 반드시 **`updateSession`이 돌려준 그 `supabaseResponse`**를 반환한다.
- **`supabaseResponse`에 커스텀 헤더를 새 응답으로 갈아끼움**: 헤더를 추가하고 싶으면 기존 `supabaseResponse`에 `.headers.set()`을 해야지, 새 객체로 교체하면 쿠키가 날아간다.

### 나중에 배울 것
- `request.cookies.set` + `supabaseResponse.cookies.set`을 둘 다 하는 이유(`proxy.ts:17,20`): 앞은 **현재 요청 내에서** 후속 코드가 새 쿠키를 읽게 하고, 뒤는 **브라우저로 내려보내** 다음 요청에 반영한다. "요청 안"과 "응답 밖" 양쪽을 맞춘다.

---

## 8. open-redirect 방어 + `server-only` 가드 — 작은 코드 두 줄의 보안

### 8.1 open-redirect — `next` 파라미터를 함부로 믿지 않기

**왜 위험한가?** 콜백 URL은 `?next=/`처럼 "로그인 후 어디로 보낼지"를 쿼리로 받는다. 공격자가 `?next=//evil.com`이나 `?next=/\evil.com`을 끼워 피싱 링크를 뿌리면, 사용자가 우리 도메인에서 로그인한 직후 **악성 사이트로 튕겨나간다**(open redirect). 우리 도메인을 믿고 들어온 사용자가 공격에 노출된다.

**Typolog의 방어** (`route.ts:11-14`):

```typescript
const next =
  nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.startsWith('/\\')
    ? nextParam
    : '/';
```

- `'/'`로 시작 → **우리 사이트 내부 경로**만 허용.
- `'//'` 차단 → `//evil.com`은 브라우저가 `https://evil.com`처럼 해석하는 **프로토콜 상대 URL**이다. 막아야 한다.
- `'/\'` 차단 → 일부 브라우저가 `/\`를 `//`처럼 취급하는 우회를 막는다.
- 셋 다 통과 못 하면 안전한 `'/'`로 fallback.

비유: "우리 건물 안 어느 방으로 갈래?"라고 물었는데 "옆 건물로"라고 답하면 무시하고 로비로 보낸다. 내부 주소(`/`로 시작, `//`·`/\` 아님)만 받아들인다.

### 8.2 `server-only` — secret이 브라우저로 새면 빌드를 깨뜨린다

**왜 필요한가?** `admin.ts`와 `db/index.ts`는 `SUPABASE_SECRET_KEY`·`DATABASE_URL` 같은 **절대 노출되면 안 되는 값**을 쓴다. 실수로 이 파일을 클라이언트 컴포넌트(`'use client'`)에서 import하면, 번들러가 secret을 클라이언트 번들에 끌어와 노출시킬 수 있다. `import 'server-only'`는 **이런 import가 발생하면 빌드 타임에 즉시 실패**시키는 가드다.

```typescript
// admin.ts:1-2, db/index.ts:1-2
// 클라이언트 번들에 유입되면 빌드 타임에 실패하도록 가드 (게이트 A 결정 g)
import 'server-only';
```

런타임에 사고가 터지기 전에 **빌드에서 막는다**는 게 핵심. "노출되면 안 되는 코드"에 붙이는 안전벨트다.

비유: `server-only`는 "이 문은 직원 전용"이라고 붙여둔 게 아니라, 손님이 그 문에 손대는 순간 **건물 설계 검수(빌드)에서 통째로 반려**되게 만드는 강제 장치다.

> 참고: `server.ts`에는 `server-only` 가드가 없다(QA L1). 다만 내부에서 `cookies()`(next/headers)를 쓰므로 클라이언트에서 import하면 Next가 자체 오류를 낸다 — 보호는 되지만 에러 메시지가 덜 명시적이라 Day 3에 추가 권장.

### 자주 하는 실수

- **`next` 검증에서 `//`만 막고 `/\`를 빠뜨림**: 일부 브라우저에서 우회된다. 두 패턴을 다 막아야 한다(`route.ts:12`, QA C24/C25).
- **상대경로 화이트리스트 대신 블랙리스트로 접근**: "evil.com을 막자"처럼 나쁜 패턴을 일일이 막으려 하면 항상 빠지는 게 생긴다. "`/`로 시작하는 내부 경로만 허용"이라는 **화이트리스트**가 안전하다.
- **secret 쓰는 파일에 `server-only`를 안 붙임**: 당장은 문제없어 보여도, 누군가 무심코 클라이언트에서 import하는 순간 런타임에 secret이 샌다. 빌드 타임 가드가 훨씬 안전하다.

### 나중에 배울 것
- Day 3 Storage 작업에서 클라이언트 업로드(browser client)와 서버 처리(server/admin)의 경계가 또 등장한다. "이 코드가 어느 쪽에서 도는가"를 항상 의식하는 습관.

---

## 9. (보너스) Self-XSS 콘솔 경고 — 우리 버그가 아니다

### 무엇인가?

Google 로그인 버튼을 눌러 `accounts.google.com`으로 넘어가면, 브라우저 콘솔에 빨간/노란 큰 글씨로 **"Self-XSS 경고"**나 "여기에 코드를 붙여넣지 마세요" 같은 문구가 뜬다. 처음 보면 "내 코드에 문제가 있나?" 싶지만, **이건 우리 코드가 찍는 게 아니다.** `accounts.google.com`이 **자기 페이지에** 띄우는 보안 안내문이다(우리 도메인 `localhost:3000`이 아니다).

### Self-XSS가 뭐길래?

**Self-XSS**는 기술적 취약점이 아니라 **사회공학 공격**이다. 공격자가 사용자를 속여 **"이 코드를 콘솔에 붙여넣으면 친구 계정을 해킹할 수 있어요"** 같은 말로 꾀어, 사용자가 **스스로** 자기 브라우저 콘솔에 악성 JS를 실행하게 만든다. 그러면 그 JS가 사용자 본인의 세션 쿠키·토큰을 훔쳐 공격자에게 보낸다.

```
일반 XSS:   공격자가 사이트에 악성 코드를 "주입"
Self-XSS:   사용자가 속아서 악성 코드를 "스스로 붙여넣음"  ← 콘솔 경고가 막으려는 것
```

Google·Facebook 같은 대형 서비스는 콘솔을 여는 사용자에게 "모르는 코드를 여기 붙여넣지 마세요"라고 경고를 띄운다. 우리도 Day 2에서 `httpOnly` 쿠키(§2)를 쓰니 JS로 세션을 직접 읽긴 어렵지만, 경고 자체는 방어 심리선이다.

### 게이트 B에 영향이 있나?

**없다.** 이유 세 가지:
1. **우리 도메인이 아니다** — `accounts.google.com`이 찍는 것. `localhost:3000` 콘솔이 아니다.
2. **빨간 에러(실행 중단)가 아니다** — 안내성 경고 메시지다.
3. **우리 코드 산출물이 아니다** — Day 2 QA 체크포인트(C01~C34) 어디에도 해당 없음.

그래서 QA 게이트 B 통과에 아무 영향이 없다. "OAuth 페이지에서 본 콘솔 경고"가 보이면 무시하면 된다.

### 자주 하는 실수

- **외부 OAuth 페이지의 콘솔 경고를 자기 앱 버그로 오인해 디버깅에 시간 낭비**: 콘솔 경고를 볼 땐 항상 **어느 origin(도메인)에서 찍혔는지** 먼저 확인한다. 출처가 외부면 우리 책임이 아니다.
- **"누가 콘솔에 코드 붙여넣으래"라고 가볍게 넘기다 실제로 당함**: Self-XSS는 의외로 잘 통하는 공격이다. 사용자에게 "콘솔에 코드 붙여넣으라는 요청은 100% 사기"라고 교육하는 게 유일한 방어다.

### 나중에 배울 것
- 진짜 XSS(주입형) 방어: React가 기본으로 JSX를 이스케이프하는 것, `dangerouslySetInnerHTML`의 위험, CSP 헤더. Phase 4 보안 점검에서.

---

## 부록: M2 중복 인덱스 제거 — `unique`는 인덱스를 공짜로 만든다

### 왜 제거했나?

Day 1 QA에서 이관된 항목(M2)이다. `challenges.active_date`에 이미 `.unique()` 제약이 걸려 있다(`schema.ts:37`):

```typescript
active_date: date('active_date').notNull().unique(),
```

PostgreSQL은 **UNIQUE 제약을 강제하려고 내부적으로 유니크 인덱스를 자동 생성**한다. "중복을 막으려면 빠르게 중복 여부를 찾아야" 하는데, 그 빠른 조회를 위해 인덱스가 필수이기 때문이다. 그런데 Day 1엔 같은 컬럼에 `idx_challenges_active_date`라는 **별도 인덱스를 또** 만들었다. 같은 컬럼·같은 종류 인덱스가 둘 = **저장 공간 낭비 + 쓰기마다 두 인덱스를 갱신하는 비용**.

### Typolog에서는?

`0002_eager_hulk.sql`이 `DROP INDEX "idx_challenges_active_date"` 한 줄로 중복 인덱스를 제거하고, `schema.ts`에서도 해당 index 정의를 지웠다(QA C05/C06). UNIQUE가 만든 인덱스가 그 역할을 그대로 대신한다.

비유: 책에 색인이 이미 있는데(UNIQUE 자동 인덱스), 똑같은 색인을 한 장 더 인쇄해 끼운 격(중복 index). 한 장이면 충분하다.

### 자주 하는 실수
- **UNIQUE 컬럼에 또 index를 명시적으로 만듦**: "조회 빠르게 하려면 인덱스 필요하지"라는 생각은 맞지만, UNIQUE/PRIMARY KEY는 **이미 인덱스를 동반**한다. 중복으로 만들지 않는다. PRIMARY KEY도 마찬가지(자동 인덱스).

---

## 다음 Day(Day 3) 전에 알면 좋은 선행 개념

Day 3는 **Storage + API(Route Handler) + zod validation**이다. 오늘 만든 클라이언트 3종과 인증이 거기서 "실제로 일하는" 순간이 온다.

1. **세 클라이언트의 분업이 Day 3에서 본격화**
   - 클라이언트 파일 업로드(글자 이미지) → **browser client** + Storage RLS.
   - API에서 소유권 검증 후 DB 쓰기 → **server client**(getClaims로 user id 확보) 또는 **Drizzle 직결**.
   - 관리 작업(챌린지 등록 등) → **admin client**(RLS 우회, 소유권 수동 검증).
   - 오늘 §1의 "어느 권한으로 치느냐"가 Day 3 API 설계의 출발점이다.

2. **Route Handler에서는 쿠키 쓰기가 된다** (§3의 경계)
   - Server Component는 setAll이 throw(삼킴)지만, Route Handler·Server Action은 정상 동작한다.
   - 그래서 `/api/auth/callback`이 쿠키를 직접 구울 수 있었다. Day 3 API들도 Route Handler라 세션 쿠키를 다룰 수 있다.

3. **getClaims()의 `claims.sub`가 소유권 검증의 열쇠** (§5)
   - Drizzle은 RLS를 우회하므로, API에서 "이 행이 정말 이 사용자 것인지"를 손으로 검증해야 한다.
   - `const { data } = await supabase.auth.getClaims(); const userId = data?.claims?.sub;` → 이 `userId`를 Drizzle `where`에 넣는다.

4. **zod — 입력 검증의 첫 관문** (설계 §7)
   - OAuth로 인증된 사용자라도, 그가 **보내는 데이터**(파일 크기, status 값, 닉네임 길이)는 따로 검증해야 한다. 인증(누구인가) ≠ 검증(보낸 게 올바른가).
   - Day 1의 DB CHECK 제약(`status IN (...)`)·`LEFT(...,20)` 클램프와 zod가 **2중 방어선**을 이룬다. zod는 API 입구에서, DB 제약은 최후에서.

5. **Storage RLS는 DB RLS와 또 다른 정책 표면** (로드맵 §5·§7)
   - Storage 버킷에도 별도 정책이 있다(private/public). Signed URL로 비공개 파일을 한시적으로 공개한다.
   - Day 1·2의 DB RLS 감각을 Storage로 확장하는 작업이 Day 3다.

---

## 한 줄 정리 모음 (복습용)

- **클라이언트 3종**: browser/server는 사용자 JWT로 **RLS 적용**, admin은 secret 키로 **RLS 우회**. 역할이 다르면 클라이언트도 다르다. secret엔 `NEXT_PUBLIC_` 절대 금지.
- **getAll/setAll**: JWT가 4KB를 넘어 청크로 쪼개지므로, 쿠키를 하나씩(`get/set`)이 아니라 묶음(`getAll/setAll`)으로 다룬다. 옛 `get/set/remove` 예제를 따라 하면 청크가 깨진다.
- **Server Component 쿠키 불가**: setAll이 throw → **try/catch로 삼키고** proxy(updateSession)가 갱신 전담. 다시 throw하면 페이지가 죽는다.
- **OAuth + PKCE**: signInWithOAuth → Google → exchangeCodeForSession. PKCE 비밀로 코드 가로채기를 막는다. 첫 로그인 시 Day 1 trigger가 profiles를 자동 생성.
- **getSession 신뢰 금지**: 서버 인증 판단은 검증하는 `getClaims()`로. getSession은 쿠키를 읽기만 한다(위조 가능).
- **proxy(Next 16)**: `src/proxy.ts`의 named export `proxy`, negative lookahead matcher로 정적 자산 제외, 보호 라우트 미인증 시 `/login` redirect, fail-closed.
- **supabaseResponse 반환**: 갱신된 쿠키가 실린 그 응답을 **그대로** 반환해야 한다. 새 response를 만들면 **로그인 루프**.
- **open-redirect 방어**: `next`는 `/`로 시작 + `//`·`/\` 아닌 **내부 경로만** 허용(화이트리스트).
- **server-only**: secret 쓰는 `admin.ts`·`db/index.ts`에 import 가드 → 클라이언트 유입 시 **빌드 타임 실패**.
- **M2 중복 인덱스**: `unique()`는 인덱스를 자동 생성한다. 같은 컬럼에 또 index를 만들지 않는다.
- **Self-XSS 콘솔 경고**: `accounts.google.com`이 자기 페이지에 찍는 사회공학 경고. 우리 도메인·우리 버그·게이트 B 영향 아님.

---

## 부록: 로드맵 경로 정정 메모

`learning-roadmap.md §4`의 파일 경로 표가 **설계 초안 시점의 가상 경로**였고, 실제 구현 경로와 달라서 이번에 로드맵을 실제 경로로 바로잡았다.

| 로드맵(구) | 실제 구현 | 비고 |
|-----------|----------|------|
| `src/lib/supabase/client.ts` | `src/lib/supabase/browser.ts` (+ `proxy.ts`) | 브라우저용은 `browser.ts`, proxy 전용 헬퍼는 별도 `proxy.ts`로 분리 |
| `src/lib/supabase/server.ts` | `src/lib/supabase/server.ts` | 동일 |
| (없음) | `src/lib/supabase/admin.ts` | 관리용 3번째 클라이언트는 로드맵 초안에 없었다 |
| `src/app/auth/callback/route.ts` | `src/app/api/auth/callback/route.ts` | API 라우트 컨벤션상 `api/` 하위로 |
| `src/middleware.ts` | `src/proxy.ts` | Next.js 16 개명(middleware → proxy) |

차이의 본질: 초안은 "browser/server 2종 + middleware"였는데, 실제로는 **관리용 admin client가 추가돼 3종**이 됐고, proxy용 세션 헬퍼도 분리됐으며, Next 16 개명까지 반영됐다. 로드맵은 살아있는 문서라 실제 구현에 맞춰 갱신하는 게 맞다.
