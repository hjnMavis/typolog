# Typolog — Learning-First Roadmap

> 타이포로그를 만들면서 배우는 풀스택 개발 개념 20가지.
> 각 개념을 "왜 필요한지 → 쉬운 비유 → 프로젝트에서 어디에 쓰이는지 → 직접 해보기" 순서로 정리했다.

---

## 목차

| # | 개념 | Phase | 난이도 |
|---|------|-------|--------|
| 1 | [Next.js App Router](#1-nextjs-app-router) | 0 | ★☆☆ |
| 2 | [Client Component vs Server Component](#2-client-component-vs-server-component) | 0 | ★★☆ |
| 3 | [Route Handler vs Server Action](#3-route-handler-vs-server-action) | 2-3 | ★★☆ |
| 4 | [Supabase Auth](#4-supabase-auth) | 2 | ★★☆ |
| 5 | [Supabase Storage](#5-supabase-storage) | 2 | ★★☆ |
| 6 | [RLS (Row Level Security)](#6-rls-row-level-security) | 2 | ★★★ |
| 7 | [Signed URL](#7-signed-url) | 2 | ★☆☆ |
| 8 | [Browser File API](#8-browser-file-api) | 1 | ★☆☆ |
| 9 | [Blob](#9-blob) | 1 | ★★☆ |
| 10 | [Object URL](#10-object-url) | 1 | ★☆☆ |
| 11 | [Canvas API](#11-canvas-api) | 1 | ★★★ |
| 12 | [Image Crop](#12-image-crop) | 1 | ★★★ |
| 13 | [EXIF Metadata](#13-exif-metadata) | 1 | ★★☆ |
| 14 | [Zustand](#14-zustand) | 1 | ★★☆ |
| 15 | [TanStack Query](#15-tanstack-query) | 2~3 | ★★★ |
| 16 | [Optimistic Update](#16-optimistic-update) | 3 | ★★★ |
| 17 | [PostHog Event Tracking](#17-posthog-event-tracking) | 4 | ★★☆ |
| 18 | [Sentry](#18-sentry) | 4 | ★☆☆ |
| 19 | [Vitest](#19-vitest) | 4 | ★★☆ |
| 20 | [Playwright](#20-playwright) | 4 | ★★☆ |

> OpenTelemetry는 별도 섹션 [부록: OpenTelemetry](#부록-opentelemetry)에서 다룬다.

---

## Phase 0: 프로젝트 기초 세우기

### 1. Next.js App Router

**언제 공부하나**: Phase 0 — 프로젝트 폴더 구조를 잡기 전에

**쉬운 설명**

Next.js App Router는 **파일 이름이 곧 URL**이 되는 시스템이다.

```
src/app/
  page.tsx          → /
  login/page.tsx    → /login
  challenge/
    [id]/page.tsx   → /challenge/abc123
```

폴더를 만들면 URL이 생기고, 그 안에 `page.tsx`를 넣으면 해당 URL에 보여줄 화면이 된다.
`layout.tsx`는 여러 페이지가 공유하는 "틀"이다 — 하단 네비게이션 바처럼 모든 페이지에 공통으로 보여야 하는 것은 layout에 넣는다.

**비유**: 건물(앱)의 층(폴더)과 방(page.tsx). 엘리베이터 로비(layout.tsx)는 모든 방에 도달하기 전에 거쳐간다.

**Route Group `(이름)`**: 괄호로 감싼 폴더는 URL에 나타나지 않는다. 레이아웃만 분리할 때 사용한다.

```
src/app/
  (auth)/           ← URL에 안 나옴. 로그인 관련 레이아웃
    login/page.tsx   → /login
  (main)/           ← URL에 안 나옴. 메인 앱 레이아웃 (하단 네비 포함)
    page.tsx         → /
    feed/page.tsx    → /feed
```

**프로젝트에서 쓰이는 위치**

| 파일/경로 | 역할 |
|-----------|------|
| `src/app/layout.tsx` | 루트 레이아웃 — Provider, 폰트, 글로벌 CSS |
| `src/app/(auth)/layout.tsx` | 로그인 전용 레이아웃 — 심플한 UI |
| `src/app/(main)/layout.tsx` | 메인 레이아웃 — 하단 네비게이션 포함 |
| `src/app/(main)/challenge/[id]/page.tsx` | 동적 라우트 — 오늘의 챌린지 페이지 |

**실습 태스크**

- [ ] `src/app/(main)/page.tsx`에 "오늘의 문장" 텍스트를 하드코딩해서 보여주기
- [ ] `src/app/(auth)/login/page.tsx`에 "로그인" 버튼 UI 만들기
- [ ] `src/app/(main)/layout.tsx`에 하단 네비게이션 (홈, 피드, 마이) 배치하기
- [ ] `src/app/(main)/challenge/[id]/page.tsx`에서 `params.id`를 화면에 출력하기

---

### 2. Client Component vs Server Component

**언제 공부하나**: Phase 0 — 첫 번째 컴포넌트를 만들기 전에

**쉬운 설명**

Next.js App Router에서 모든 컴포넌트는 **기본적으로 Server Component**이다.

| | Server Component | Client Component |
|---|---|---|
| **어디서 실행?** | 서버 (Node.js) | 브라우저 (사용자 기기) |
| **할 수 있는 것** | DB 조회, 파일 읽기, API 키 사용 | `useState`, `useEffect`, 클릭 이벤트, 브라우저 API |
| **할 수 없는 것** | `useState`, `onClick` 등 인터랙션 | DB에 직접 접근, 서버 전용 비밀 값 |
| **선언 방법** | 아무것도 안 쓰면 됨 (기본값) | 파일 맨 위에 `'use client'` |
| **JS 번들** | 클라이언트로 안 보냄 (가볍다) | 클라이언트로 보냄 (무겁다) |

**비유**: 식당으로 비유하면 —
- **Server Component** = 주방(서버)에서 요리를 다 해서 완성된 음식(HTML)을 테이블(브라우저)에 내놓는 것
- **Client Component** = 테이블(브라우저)에서 손님(사용자)이 직접 양념을 뿌리고 조합하는 것

**핵심 판단 기준**: "이 컴포넌트에서 사용자 인터랙션(클릭, 입력, 스크롤)이 있나?"
- **있다** → `'use client'` 필요
- **없다** → Server Component로 유지

**프로젝트에서 쓰이는 위치**

| 컴포넌트 | 타입 | 이유 |
|----------|------|------|
| 홈 페이지 (오늘의 문장 표시) | Server | DB에서 데이터 가져오기만 하면 됨 |
| 글자 그리드 (LetterGrid) | Client | 슬롯 탭, 상태 변경, Zustand |
| 이미지 크로퍼 (ImageCropper) | Client | Canvas API, 터치 이벤트, 파일 접근 |
| 콜라주 미리보기 (CollagePreview) | Client | Canvas 렌더링 |
| 피드 페이지 (서버 초기 데이터 + 무한 스크롤) | 혼합 | 초기 데이터는 Server, 스크롤/좋아요는 Client |
| 공유 페이지 (`/share/[id]`) | Server | OG 메타태그만 필요, 인터랙션 없음 |

**실습 태스크**

- [ ] Server Component에서 `console.log("server")`를 찍고, 터미널(서버)에서만 보이는지 확인
- [ ] Client Component에서 `console.log("client")`를 찍고, 브라우저 콘솔에서 보이는지 확인
- [ ] Server Component에서 `useState`를 쓰면 어떤 에러가 나는지 직접 확인해보기
- [ ] 홈 페이지를 Server Component로 만들어서 하드코딩된 챌린지 데이터를 표시하기

---

## Phase 1: 브라우저에서 이미지 다루기

### 3. Route Handler vs Server Action

**언제 공부하나**: Phase 2에서 본격적으로 쓰지만, Phase 1에서 개념만 먼저 잡아두면 좋다

**쉬운 설명**

둘 다 "서버에서 실행되는 코드"이지만, **호출 방식**이 다르다.

**Route Handler** — 전통적인 REST API 엔드포인트

```typescript
// src/app/api/feed/route.ts
export async function GET(request: Request) {
  const feed = await db.query.submissions.findMany();
  return Response.json(feed);
}
```
- 파일 위치가 URL이 된다: `src/app/api/feed/route.ts` → `GET /api/feed`
- `GET`, `POST`, `PUT`, `DELETE` 함수를 export
- 외부에서도 호출 가능 (curl, 다른 앱)
- **파일 업로드처럼 FormData를 받아야 할 때 적합**

**Server Action** — 서버 함수를 클라이언트에서 직접 호출

```typescript
// src/actions/toggle-like.ts
'use server'

export async function toggleLike(submissionId: string) {
  // DB에서 좋아요 토글
}
```

```tsx
// 클라이언트 컴포넌트에서
<button onClick={() => toggleLike(id)}>좋아요</button>
```

- `'use server'`를 붙이면 자동으로 API 엔드포인트가 만들어짐
- 클라이언트에서 **함수 호출하듯** 사용
- URL이 숨겨져 있어서 외부 호출은 어렵다
- **단순한 데이터 변경(mutation)에 적합**

**비유**:
- Route Handler = 식당의 주문 카운터. 메뉴판(URL)이 있고, 누구나 와서 주문 가능
- Server Action = 테이블 벨. 버튼 누르면 직원(서버)이 알아서 처리

**선택 기준**

| 상황 | 선택 |
|------|------|
| 파일 업로드 (이미지) | Route Handler (`POST`) |
| 데이터 조회 (피드 목록) | Route Handler (`GET`) |
| 단순 mutation (좋아요, 프로필 수정) | Server Action |
| 외부에서 호출 필요 | Route Handler |

**프로젝트에서 쓰이는 위치**

| 기능 | 방식 | 경로/파일 |
|------|------|-----------|
| 오늘의 챌린지 조회 | Route Handler GET | `src/app/api/challenges/today/route.ts` |
| 피드 조회 (무한 스크롤) | Route Handler GET | `src/app/api/feed/route.ts` |
| 글자 이미지 업로드 | Route Handler POST | `src/app/api/letters/route.ts` |
| 콜라주 이미지 업로드 | Route Handler POST | `src/app/api/collages/route.ts` |
| 좋아요 토글 | Server Action | `src/actions/toggle-like.ts` |
| 프로필 수정 | Server Action | `src/actions/update-profile.ts` |
| 공개/비공개 토글 | Server Action | `src/actions/toggle-visibility.ts` |
| 신고하기 | Server Action | `src/actions/report-submission.ts` |

**실습 태스크**

- [x] Route Handler로 `GET /api/hello`를 만들어서 브라우저에서 JSON 응답 확인 — (Phase 2 Day 3: `GET /api/challenges/today` 공개 GET Route Handler, `runtime='nodejs'`+`force-dynamic`)
- [ ] Server Action으로 버튼 클릭 시 `console.log`를 서버에서 찍어보기
- [x] Route Handler에서 `request.json()`으로 body를 받아 echo하는 POST API 만들기 — (Phase 2 Day 3: `POST /api/submissions`에서 `request.json()`+zod safeParse, `POST /api/submissions/[id]/letters`에서 `request.formData()` 파일 업로드)

> **Phase 2 Day 3 학습 노트**: `docs/learning/phase-2-day-3.md` — zod 검증(isomorphic·safeParse vs parse·user_id를 body에서 안 받기), 표준 에러 `{error,code}`+403 vs 404 존재 은폐+검사 순서(401→404→409), Storage 버킷·`storage.objects` 정책(경로 첫 폴더=user_id, UPSERT엔 INSERT+UPDATE 둘 다, collages 조건부 공개), **Drizzle 직결의 RLS 우회 함정**, 소유권 코드 검증(getAuthUser=getClaims, getOwnedSubmission), UPSERT 2종(DoNothing vs DoUpdate), 파일 검증 MVP 범위(MIME+크기, magic-byte 미룸), Storage+DB 비원자성·고아 파일, M2(복귀 화이트리스트)/M3(proxy `/api` 제외)/seed 분리.

---

### 4. Supabase Auth

**언제 공부하나**: Phase 2 시작할 때 — DB 연동 전에 인증부터

**쉬운 설명**

"로그인"이란 결국 **"이 요청을 보낸 사람이 누구인지 확인하는 것"**이다.

Supabase Auth는 이 과정을 대신 해준다:

```
1. 유저가 "Google로 로그인" 클릭
2. Google 로그인 화면으로 이동
3. Google이 "이 사람은 javis.hwang@..." 이라고 알려줌
4. Supabase가 이 정보로 유저를 생성/확인하고 JWT 토큰 발급
5. 브라우저 쿠키에 토큰 저장
6. 이후 모든 요청에 이 쿠키가 자동으로 따라감
```

**핵심 용어**

| 용어 | 뜻 | 비유 |
|------|------|------|
| **OAuth 2.0** | "다른 서비스(Google, Kakao)한테 인증을 맡기는 표준 방법" | 호텔 체크인할 때 여권(Google)으로 신분 증명 |
| **JWT** | 서버가 발급하는 "신분증 토큰". 누가 언제까지 유효한지 담겨 있음 | 놀이공원 팔찌. 찍으면 신분 확인됨 |
| **PKCE** | OAuth 과정에서 코드를 가로채는 공격을 방지하는 보안 기법 | 택배(인증 코드)를 받을 때 본인 확인 서명 추가 |
| **Refresh Token** | JWT가 만료되면 새 JWT를 받기 위한 긴 수명 토큰 | 놀이공원 팔찌 유효기간 연장 쿠폰 |
| **Session** | 로그인 상태를 유지하는 데이터 묶음 (JWT + Refresh Token) | 호텔 체크인 후 방 카드키 |

**프로젝트에서 쓰이는 위치** (실제 구현 경로 — 설계 초안과 다른 부분은 ※ 표시)

| 파일/경로 | 역할 |
|-----------|------|
| `src/lib/supabase/browser.ts` | 브라우저에서 사용하는 Supabase 클라이언트 (로그인/로그아웃) ※ 구 `client.ts` |
| `src/lib/supabase/server.ts` | 서버에서 사용하는 Supabase 클라이언트 (쿠키에서 세션 읽기) |
| `src/lib/supabase/admin.ts` | service_role secret 키로 RLS 우회하는 관리용 클라이언트 ※ 초안에 없던 3번째 |
| `src/lib/supabase/proxy.ts` | proxy 전용 세션 갱신 헬퍼 (`updateSession`) ※ 신규 분리 |
| `src/app/login/page.tsx` | Google 로그인 버튼 |
| `src/app/api/auth/callback/route.ts` | OAuth 콜백 처리 — Google에서 돌아온 후 `exchangeCodeForSession`으로 세션 설정 ※ 구 `app/auth/callback` |
| `src/proxy.ts` | 모든 요청에서 세션 확인 → 비로그인 시 `/login`으로 리다이렉트 ※ Next.js 16 개명(구 `middleware.ts`) |

> **경로 정정 메모**: 위 ※ 항목들은 설계 초안 시점의 가상 경로와 실제 구현 경로가 달라 Phase 2 Day 2에서 실제 경로로 바로잡았다. 핵심 차이: browser/server 2종 → admin 추가 **3종**, proxy 세션 헬퍼 분리, Next 16 middleware→proxy 개명. 상세는 `docs/learning/phase-2-day-2.md` "부록: 로드맵 경로 정정 메모".

**실습 태스크**

- [x] Supabase 대시보드에서 Google OAuth Provider 설정하기 — (Phase 2 Day 2: redirectTo `/api/auth/callback` 등록 + OAuth 동의 화면 E2E 확인, QA 권장 체크리스트)
- [x] 로그인 버튼 클릭 → Google 로그인 → 콜백으로 돌아오는 플로우 완성 — (Phase 2 Day 2: `login/page.tsx` signInWithOAuth → `api/auth/callback/route.ts` exchangeCodeForSession → `/` 복귀, QA C22/C23/C26)
- [ ] 로그인 후 `supabase.auth.getUser()`로 유저 정보 콘솔에 찍어보기
- [x] 로그아웃 후 보호된 페이지 접근 시 `/login`으로 리다이렉트되는지 확인 — (Phase 2 Day 2: `src/proxy.ts` 보호 라우트 4종 307 redirect 검증, QA C20/라우팅 시나리오)

> **Phase 2 Day 2 학습 노트**: `docs/learning/phase-2-day-2.md` — 클라이언트 3종(browser/server/admin) 역할 차이, `getAll/setAll` 청크 쿠키, Server Component 쿠키 불가 + try/catch, Google OAuth+PKCE 플로우, `getClaims` vs `getSession`(서버 신뢰), Next 16 proxy(matcher·fail-closed), `supabaseResponse` 반환과 로그인 루프, open-redirect 방어, `server-only` 가드, M2 중복 인덱스, (보너스) Self-XSS 콘솔 경고.

---

### 5. Supabase Storage

**언제 공부하나**: Phase 2 — Auth 설정 직후

**쉬운 설명**

Supabase Storage는 **파일 전용 서버**다. 사진, 이미지 같은 파일을 저장하고 URL로 접근할 수 있게 해준다.

구조가 컴퓨터 폴더와 같다:
```
Storage
├── letter-pieces/          (버킷 = 최상위 폴더)
│   └── {user_id}/
│       └── {submission_id}/
│           ├── 0.webp      (첫 번째 글자)
│           ├── 1.webp
│           └── ...
├── collages/               (버킷)
│   └── {user_id}/
│       └── {submission_id}.png
└── avatars/                (버킷)
    └── {user_id}.webp
```

**Public vs Private 버킷**

| 타입 | 접근 | 타이포로그에서 |
|------|------|---------------|
| **Public** | URL만 알면 누구나 접근 | `avatars` — 프로필 사진은 누구나 볼 수 있어야 함 |
| **Private** | 인증 + 권한 확인 필요 | `letter-pieces` — 내 글자 조각은 나만 볼 수 있어야 함 |
| **Private + 조건부 공개** | 특정 조건에서만 공개 | `collages` — `is_public=true`인 콜라주만 다른 사람이 볼 수 있음 |

**프로젝트에서 쓰이는 위치**

| 기능 | 버킷 | 접근 정책 |
|------|------|-----------|
| 글자 크롭 이미지 저장 | `letter-pieces` (private) | 본인만 read/write |
| 완성된 콜라주 저장 | `collages` (private + 조건부) | 본인 write, `is_public`이면 모두 read |
| 프로필 사진 | `avatars` (public) | 모두 read, 본인만 write |

**실습 태스크**

- [x] Supabase 대시보드에서 `letter-pieces` 버킷 만들기 (private) — (Phase 2 Day 3: 대시보드 대신 커스텀 SQL 마이그레이션 `0003_storage_buckets_and_policies.sql`로 letter-pieces/collages/avatars 3종 + `file_size_limit`/`allowed_mime_types` 코드화)
- [x] 코드에서 이미지 파일을 `letter-pieces` 버킷에 업로드하기 — (Phase 2 Day 3: `letters/route.ts`에서 `supabase.storage.from('letter-pieces').upload(path, bytes, {upsert:true})`, path=`{user_id}/{submission_id}/{slot}.webp`)
- [ ] 업로드한 파일의 URL을 가져와서 `<img>`에 표시해보기 — (Day 4 예정: private 버킷이라 signed URL 필요, Day 3는 `image_url`에 경로만 저장)
- [x] 다른 유저로 접근 시 403 에러가 나는지 확인 — (Phase 2 Day 3: Storage 정책 `(storage.foldername(name))[1] = auth.uid()`로 타인 경로 차단 + 서버 path 구성으로 이중 방어, `0003_...sql:24-27`)

---

### 6. RLS (Row Level Security)

**언제 공부하나**: Phase 2 — 테이블을 만든 직후, API를 만들기 전에

**쉬운 설명**

RLS는 **데이터베이스가 직접 "이 데이터를 이 사람이 볼 수 있는지" 판단하는 보안 기능**이다.

보통 보안은 이렇게 한다:
```
API 코드에서: if (user.id !== row.user_id) throw new Error("권한 없음")
```

RLS는 이것을 **DB 레벨**에서 한다:
```sql
CREATE POLICY "본인 데이터만 읽기" ON submissions
  FOR SELECT
  USING (user_id = auth.uid());
```

이렇게 하면 어떤 경로로 DB에 접근하든 (API, 직접 쿼리, 실수) **무조건** 본인 데이터만 나온다.

**비유**: 아파트 보안으로 비유하면 —
- API 레벨 인증 = 현관문(API)에서 신분증 확인. 하지만 창문(다른 경로)으로 들어오면 막을 수 없음
- RLS = 각 방(테이블 행)에 스마트 잠금장치. 어떤 경로로 들어오든 열쇠(인증)가 맞아야 열림

**핵심 개념**

| 용어 | 뜻 |
|------|------|
| `auth.uid()` | 현재 로그인한 유저의 ID (Supabase가 JWT에서 추출) |
| `USING (조건)` | SELECT, UPDATE, DELETE 시 "이 행을 볼 수 있는 조건" |
| `WITH CHECK (조건)` | INSERT, UPDATE 시 "이 데이터를 넣을 수 있는 조건" |
| `FOR SELECT` / `FOR INSERT` 등 | 어떤 작업에 대한 정책인지 |

**프로젝트에서 쓰이는 위치**

| 테이블 | 정책 예시 |
|--------|-----------|
| `submissions` | SELECT: 본인 것 + `is_public=true`인 다른 사람 것 |
| `submissions` | INSERT: `user_id = auth.uid()` 본인으로만 생성 |
| `submissions` | UPDATE: 본인 것만 수정 |
| `letter_pieces` | SELECT/INSERT/UPDATE/DELETE: 본인 것만 |
| `reactions` | INSERT: 본인 ID로만 생성 |
| `reactions` | DELETE: 본인 것만 삭제 (좋아요 취소) |
| `profiles` | SELECT: 모두 읽기 가능 (공개 프로필) |
| `profiles` | UPDATE: 본인 것만 수정 |

**실습 태스크**

- [x] RLS 없이 테이블에 데이터를 넣고, 다른 유저의 데이터도 조회되는지 확인 — (Phase 2 Day 1: QA RLS 시나리오 S4/S5에서 본인/타인 접근 차이 검증)
- [x] RLS를 켜고 같은 쿼리를 실행 — 본인 데이터만 나오는지 확인 — (Phase 2 Day 1: submissions_select 정책, `0001_..._trigger.sql:54-67`)
- [x] `USING`과 `WITH CHECK`를 각각 써서 읽기/쓰기 정책을 다르게 설정해보기 — (Phase 2 Day 1: submissions_update의 비대칭 — H2 사례, `docs/learning/phase-2-day-1.md §4`)
- [ ] Supabase 대시보드의 "RLS Policy" 탭에서 정책 확인하는 방법 익히기

> **Phase 2 Day 1 학습 노트**: `docs/learning/phase-2-day-1.md` — RLS(USING vs WITH CHECK), GRANT vs RLS 2단 관문, SECURITY DEFINER trigger, 하이브리드 마이그레이션, Drizzle 스키마 표현, `(SELECT auth.uid())` 캐싱, DATABASE_URL % 인코딩. QA H1(GRANT 누락)/H2(hidden 복원) 실전 사례 포함.
>
> **Phase 2 Day 2 RLS 연결**: Day 1에 만든 RLS가 Day 2에서 "실제로 작동하기 시작"한다. ① OAuth 로그인으로 발급된 JWT가 쿠키에 담기고, 그 안의 user id가 RLS의 `(SELECT auth.uid())`로 흘러온다(`docs/learning/phase-2-day-2.md §4·§5`). ② 클라이언트 3종 중 browser/server는 **RLS 적용**, admin은 **RLS 우회** — "어느 권한으로 DB를 치느냐"가 RLS 적용 여부를 가른다(§1). ③ 첫 로그인 시 Day 1의 `handle_new_user` trigger가 실전 발동해 `profiles`가 자동 생성된다(QA 권장 체크리스트). RLS 정책을 대시보드에서 눈으로 확인하는 마지막 태스크는 Day 3에서 함께 익힌다.

---

### 7. Signed URL

**언제 공부하나**: Phase 2 — Storage 설정 후

**쉬운 설명**

Signed URL은 **"기간 한정 입장권이 붙은 URL"**이다.

Private 버킷의 파일은 URL만으로는 접근할 수 없다. 하지만 가끔 임시로 공개해야 할 때가 있다:
- 피드에서 다른 사람의 공개 콜라주 이미지를 보여줄 때
- 공유 페이지에서 비로그인 유저에게 콜라주를 보여줄 때

```typescript
const { data } = await supabase.storage
  .from('collages')
  .createSignedUrl('user123/submission456.png', 3600); // 1시간 유효

// data.signedUrl = "https://xxx.supabase.co/storage/v1/object/sign/collages/...?token=abc123&expires=..."
```

이 URL은 **1시간 동안만** 유효하고, 그 후에는 접근이 막힌다.

**Public URL vs Signed URL**

| | Public URL | Signed URL |
|---|---|---|
| 만료 | 영구 | 설정한 시간 후 만료 |
| 보안 | 누구나 영구 접근 | 기간 제한 접근 |
| 용도 | 프로필 사진 | 비공개 버킷의 파일을 임시로 보여줄 때 |

**프로젝트에서 쓰이는 위치**

| 상황 | URL 타입 |
|------|----------|
| 아바타 이미지 (`avatars` 버킷) | Public URL |
| 피드에서 공개 콜라주 표시 | Signed URL (1시간) |
| 공유 페이지에서 콜라주 표시 | Signed URL (24시간) |
| 내 글자 조각 편집 중 미리보기 | Signed URL (1시간) |

**실습 태스크**

- [ ] Private 버킷의 파일에 일반 URL로 접근 시 403 에러 확인
- [ ] `createSignedUrl()`로 임시 URL 생성 후 접근 성공 확인
- [ ] 만료 시간을 10초로 설정하고, 10초 후 접근 실패 확인
- [ ] Public 버킷 vs Private 버킷의 URL 차이를 비교해보기

---

### 8. Browser File API

**언제 공부하나**: Phase 1 — 카메라/갤러리 연동 전에

**쉬운 설명**

Browser File API는 **브라우저에서 사용자가 선택한 파일을 읽는 방법**이다.

모바일에서 "카메라로 찍기" 또는 "갤러리에서 선택"을 하면, 브라우저가 `File` 객체를 준다:

```html
<input type="file" accept="image/*" capture="environment" />
```

| 속성 | 뜻 |
|------|------|
| `type="file"` | 파일 선택 input |
| `accept="image/*"` | 이미지 파일만 허용 |
| `capture="environment"` | 모바일에서 후면 카메라 바로 열기 |

```typescript
function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]; // File 객체
  if (!file) return;

  console.log(file.name);   // "IMG_1234.jpg"
  console.log(file.size);   // 3145728 (바이트)
  console.log(file.type);   // "image/jpeg"
}
```

**`File` 객체는 파일의 "메타정보 + 실제 데이터"를 담고 있다.** 하지만 데이터를 바로 사용할 수는 없고, Blob이나 Object URL로 변환해야 한다.

**프로젝트에서 쓰이는 위치**

| 기능 | 사용하는 곳 |
|------|------------|
| 카메라로 글자 사진 찍기 | `<input capture="environment">` |
| 갤러리에서 이미지 선택 | `<input accept="image/*">` |
| 파일 유효성 검사 (크기, 타입) | `file.size`, `file.type` 체크 |

**실습 태스크**

- [ ] `<input type="file">`로 파일을 선택하고, `file.name`, `file.size`, `file.type`을 화면에 출력
- [ ] `accept="image/*"`로 이미지만 선택되게 제한해보기
- [ ] 모바일 기기에서 `capture="environment"` 추가 시 카메라가 바로 열리는지 확인

---

### 9. Blob

**언제 공부하나**: Phase 1 — File API를 배운 직후

**쉬운 설명**

Blob(Binary Large Object)은 **바이너리 데이터 덩어리**다. 텍스트가 아닌 데이터(이미지, 비디오, 오디오 등)를 자바스크립트에서 다루기 위한 객체이다.

**`File`은 `Blob`의 자식(상속)**이다:
```
Blob (바이너리 데이터 덩어리)
  └── File (Blob + 파일 이름 + 수정일)
```

그래서 `File`을 받는 곳에 `Blob`도 쓸 수 있고, 그 반대도 된다.

**타이포로그에서 Blob이 중요한 이유**:

Canvas에서 이미지를 크롭하면, 결과물이 `Blob`으로 나온다:
```typescript
canvas.toBlob((blob) => {
  // blob = 크롭된 이미지의 바이너리 데이터
  // 이걸 Storage에 업로드하거나, 미리보기에 표시
}, 'image/webp', 0.8);
```

**프로젝트에서의 Blob 흐름**:
```
카메라 촬영 → File(Blob) → Canvas에 그리기 → 크롭 → canvas.toBlob() → Blob
                                                                          ├→ Object URL로 미리보기
                                                                          └→ Supabase Storage에 업로드
```

**프로젝트에서 쓰이는 위치**

| 상황 | Blob의 역할 |
|------|------------|
| Canvas에서 크롭한 이미지를 추출할 때 | `canvas.toBlob()` → Blob |
| 크롭 이미지를 Zustand에 저장할 때 | Blob을 Object URL로 변환해서 저장 |
| 크롭 이미지를 서버에 업로드할 때 | Blob을 FormData에 담아서 전송 |
| 콜라주를 PNG로 내보낼 때 | `canvas.toBlob()` → 다운로드 |

**실습 태스크**

- [ ] `new Blob(["Hello"], { type: "text/plain" })`로 텍스트 Blob을 만들어보기
- [ ] Canvas에 간단한 도형을 그리고 `toBlob()`으로 이미지 Blob 추출하기
- [ ] Blob의 `size`와 `type` 속성을 확인해보기
- [ ] Blob을 FormData에 담아서 `fetch`로 전송하는 코드 작성해보기

---

### 10. Object URL

**언제 공부하나**: Phase 1 — Blob과 함께

**쉬운 설명**

Object URL은 **메모리에 있는 데이터(Blob)에 대한 임시 URL**이다.

이미지를 `<img>` 태그에 표시하려면 URL이 필요하다. 하지만 Canvas에서 크롭한 이미지는 서버에 없고, 메모리(Blob)에만 있다. 이때 Object URL을 쓴다:

```typescript
const blob = /* canvas.toBlob()에서 받은 이미지 */;
const url = URL.createObjectURL(blob);
// url = "blob:http://localhost:3000/abc-123-def"

// <img src={url} /> ← 이렇게 쓸 수 있다!
```

**주의: 메모리 누수**

Object URL은 **명시적으로 해제하지 않으면 메모리에 계속 남는다**:
```typescript
// 더 이상 필요 없을 때 반드시 해제
URL.revokeObjectURL(url);
```

**비유**: 도서관 열람실 임시 좌석번호. 책(Blob)에 임시로 좌석번호(URL)를 부여해서 찾을 수 있게 하지만, 다 읽으면 반납(revoke)해야 한다.

**프로젝트에서 쓰이는 위치**

| 상황 | 용도 |
|------|------|
| 카메라로 찍은 사진을 Canvas에 로드 | `URL.createObjectURL(file)` → `img.src` |
| 크롭한 글자를 슬롯에 미리보기 | `URL.createObjectURL(croppedBlob)` → `<img>` |
| 콜라주 미리보기 | 각 글자 Object URL → Canvas `drawImage()` |
| 컴포넌트 언마운트 시 | `URL.revokeObjectURL(url)` 호출하여 정리 |

**실습 태스크**

- [ ] `<input type="file">`로 이미지를 선택하고, Object URL로 `<img>`에 표시하기
- [ ] 같은 이미지로 Object URL을 2개 만들고, 서로 다른 URL인지 확인
- [ ] `URL.revokeObjectURL()` 호출 전후로 이미지가 어떻게 되는지 확인
- [ ] React `useEffect` cleanup에서 Object URL을 해제하는 패턴 구현

---

### 11. Canvas API

**언제 공부하나**: Phase 1 — 이미지 크로퍼를 만들기 전에

**쉬운 설명**

Canvas API는 **브라우저에서 픽셀 단위로 그림을 그리는 API**이다.

HTML의 `<canvas>` 요소는 빈 도화지다. JavaScript로 이 도화지 위에 이미지, 도형, 텍스트를 그린다:

```typescript
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;

// 이미지 그리기
ctx.drawImage(image, 0, 0);

// 특정 영역만 잘라서 새 Canvas에 그리기 (= 크롭)
ctx.drawImage(image,
  sx, sy, sWidth, sHeight,  // 원본에서 잘라낼 영역
  0, 0, dWidth, dHeight     // 새 Canvas에 그릴 위치와 크기
);
```

**Canvas 좌표계**:
```
(0,0) ─────────→ x
  │
  │    Canvas
  │
  ↓
  y
```
왼쪽 위가 (0,0)이고, 오른쪽으로 x가 증가, 아래로 y가 증가한다.

**Retina 디스플레이 대응**:
```typescript
const dpr = window.devicePixelRatio; // Retina면 2 또는 3
canvas.width = displayWidth * dpr;
canvas.height = displayHeight * dpr;
canvas.style.width = `${displayWidth}px`;
canvas.style.height = `${displayHeight}px`;
ctx.scale(dpr, dpr);
```

**프로젝트에서 쓰이는 위치**

| 기능 | Canvas 사용법 |
|------|-------------|
| 이미지 크로퍼 | 사진 위에 크롭 영역을 표시하고, 해당 영역을 추출 |
| 콜라주 미리보기 | 6개 글자 이미지를 한 Canvas에 배치하여 렌더링 |
| 콜라주 PNG 내보내기 | `canvas.toBlob()` → 다운로드 또는 업로드 |
| EXIF 회전 보정 | 이미지를 Canvas에 올바른 방향으로 그리기 |

**실습 태스크**

- [ ] `<canvas>`에 이미지를 그려보기 (`drawImage`)
- [ ] `drawImage`의 9개 인자 버전으로 이미지의 일부분만 잘라서 그려보기
- [ ] Retina 디스플레이 대응 코드를 작성하고 선명도 차이 비교
- [ ] `canvas.toBlob()`으로 Canvas 내용을 PNG로 내보내기
- [ ] 터치 이벤트로 Canvas 위에 드래그하여 사각형 영역을 그려보기

---

### 12. Image Crop

**언제 공부하나**: Phase 1 — Canvas API를 배운 직후

**쉬운 설명**

이미지 크롭(crop)은 **사진에서 원하는 영역만 잘라내는 것**이다. 타이포로그에서 가장 핵심적인 기능이다.

**크롭 과정**:
```
1. 사용자가 사진을 찍는다 (File API)
2. 사진을 Canvas에 그린다 (drawImage)
3. 사용자가 터치/드래그로 잘라낼 영역을 선택한다
4. 선택된 영역의 좌표를 기록한다 (x, y, width, height)
5. 새 Canvas에 해당 영역만 그린다 (drawImage 9인자 버전)
6. 결과를 Blob으로 추출한다 (toBlob)
```

**핵심 좌표 계산**:
```typescript
interface CropArea {
  x: number;      // 크롭 시작 x
  y: number;      // 크롭 시작 y
  width: number;  // 크롭 너비
  height: number; // 크롭 높이
}

function cropImage(source: HTMLImageElement, crop: CropArea): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(source,
    crop.x, crop.y, crop.width, crop.height, // 원본에서 잘라낼 영역
    0, 0, crop.width, crop.height             // 새 Canvas에 그릴 영역
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/webp', 0.8);
  });
}
```

**모바일 터치 인터랙션**:
- **핀치 줌**: 두 손가락으로 확대/축소
- **드래그**: 한 손가락으로 이미지 이동
- **크롭 영역 조절**: 크롭 박스의 모서리를 드래그

**프로젝트에서 쓰이는 위치**

| 컴포넌트 | 역할 |
|----------|------|
| `ImageCropper` | 핵심 크로퍼 컴포넌트 — 사진을 보여주고 터치로 크롭 영역 선택 |
| `LetterSlot` | 크롭된 이미지를 표시하는 슬롯 |
| `LetterGrid` | 6개 슬롯을 그리드로 배치 |

**실습 태스크**

- [ ] 고정된 이미지와 고정된 좌표로 `drawImage` 9인자 버전 크롭 해보기
- [ ] 마우스/터치 이벤트로 드래그하여 크롭 영역을 선택하는 UI 만들기
- [ ] 크롭한 결과를 `toBlob()`으로 추출하고 Object URL로 미리보기
- [ ] 핀치 줌(두 손가락 확대/축소) 구현 — `touchstart`, `touchmove` 이벤트

---

### 13. EXIF Metadata

**언제 공부하나**: Phase 1 — 이미지 크롭과 함께

**쉬운 설명**

EXIF(Exchangeable Image File Format)는 **사진 파일에 숨어 있는 메타데이터**이다.

카메라로 사진을 찍으면 이미지 픽셀 외에 이런 정보가 같이 저장된다:

| EXIF 정보 | 예시 | 위험도 |
|-----------|------|--------|
| GPS 좌표 | 위도 37.5, 경도 127.0 | **높음** — 위치 노출 |
| 촬영 시간 | 2025-01-15 14:30:22 | 중간 |
| 기기 정보 | iPhone 15 Pro | 낮음 |
| **Orientation** | 6 (= 90도 회전) | **중요** — 이미지 방향 문제 |

**왜 타이포로그에서 중요한가**:
1. **프라이버시**: 유저가 찍은 사진의 GPS 정보가 서버에 저장되면 위치가 노출된다 → **업로드 전에 EXIF를 제거해야 한다**
2. **회전 문제**: 모바일 사진은 EXIF Orientation 값에 따라 실제 픽셀과 다른 방향으로 보일 수 있다 → **Canvas에 그릴 때 보정해야 한다**

**EXIF 제거 전략**:
```
원본 사진 (EXIF 포함)
  → Canvas에 drawImage() → Canvas에는 EXIF가 없다!
  → canvas.toBlob() → 깨끗한 이미지 (EXIF 없음)
```

Canvas에 그리는 행위 자체가 EXIF를 제거한다. Canvas는 순수 픽셀 데이터만 다루기 때문이다.

**프로젝트에서 쓰이는 위치**

| 기능 | EXIF 관련 처리 |
|------|---------------|
| 이미지 크롭 | Canvas를 거치면서 자연스럽게 EXIF 제거 |
| EXIF Orientation 보정 | `drawImage` 전에 orientation 값 읽고 Canvas를 회전 |
| 업로드 전 검증 | 최종 Blob에 EXIF가 없는지 확인 |

**실습 태스크**

- [ ] 모바일 사진의 EXIF 데이터를 읽어보기 (라이브러리 또는 ArrayBuffer 직접 파싱)
- [ ] EXIF Orientation 값이 6인 사진을 Canvas에 그렸을 때 90도 돌아가는 현상 확인
- [ ] Canvas를 거친 이미지에서 EXIF가 제거되었는지 확인
- [ ] EXIF orientation에 따라 Canvas를 회전/뒤집는 유틸 함수 만들기

---

### 14. Zustand

**언제 공부하나**: Phase 1 — 글자 슬롯 상태 관리를 시작할 때

**쉬운 설명**

Zustand는 **React 앱에서 여러 컴포넌트가 같은 데이터를 공유하는 상태 관리 라이브러리**이다.

React의 `useState`는 한 컴포넌트 안에서만 쓸 수 있다. 하지만 타이포로그에서는:
- `LetterSlot` 컴포넌트가 크롭된 이미지를 저장하면
- `LetterGrid` 컴포넌트가 채워진 슬롯 수를 표시하고
- `CollagePreview` 컴포넌트가 모든 슬롯의 이미지를 가져와서 콜라주를 만들어야 한다

이 모든 컴포넌트가 **같은 데이터**를 봐야 한다. 이게 Zustand의 역할이다.

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChallengeStore {
  slots: (string | null)[];          // 6개 슬롯의 이미지 URL
  setSlot: (index: number, url: string) => void;
  clearSlot: (index: number) => void;
  reset: () => void;
}

const useChallengeStore = create<ChallengeStore>()(
  persist(
    (set) => ({
      slots: [null, null, null, null, null, null],
      setSlot: (index, url) =>
        set((state) => {
          const slots = [...state.slots];
          slots[index] = url;
          return { slots };
        }),
      clearSlot: (index) =>
        set((state) => {
          const slots = [...state.slots];
          slots[index] = null;
          return { slots };
        }),
      reset: () => set({ slots: [null, null, null, null, null, null] }),
    }),
    { name: 'challenge-draft' } // localStorage에 자동 저장
  )
);
```

**`persist` 미들웨어**: 상태를 localStorage에 자동 저장한다. 페이지를 새로고침해도 진행 중인 글자들이 사라지지 않는다.

**selector로 성능 최적화**:
```typescript
// 나쁜 예: 슬롯 하나가 바뀌면 모든 컴포넌트가 리렌더링
const { slots } = useChallengeStore();

// 좋은 예: 슬롯 0만 바뀌면 이 컴포넌트만 리렌더링
const slot0 = useChallengeStore((state) => state.slots[0]);
```

**프로젝트에서 쓰이는 위치**

| Store | 관리하는 상태 |
|-------|-------------|
| `challenge-store` | 현재 진행 중인 글자 슬롯 (이미지 URL 6개), 선택된 배경색 |
| `ui-store` (선택) | 현재 열린 모달, 크로퍼 상태 등 UI 상태 |

**실습 태스크**

- [ ] 간단한 counter store를 만들어서 두 컴포넌트에서 같은 값을 공유하기
- [ ] `persist` 미들웨어를 추가하고, 새로고침 후에도 값이 유지되는지 확인
- [ ] selector를 써서 특정 데이터가 바뀔 때만 리렌더링되는지 `console.log`로 확인
- [ ] 글자 슬롯 6개를 관리하는 `useChallengeStore` 구현

---

## Phase 3: 서버 데이터와 실시간 피드

### 15. TanStack Query

**언제 공부하나**: Phase 2 Day 4.5에서 **도입**(클라이언트↔서버 동기화) → Phase 3 피드에서 본격 활용

**쉬운 설명**

TanStack Query(구 React Query)는 **서버에서 가져온 데이터를 자동으로 관리해주는 라이브러리**이다.

`fetch`로 직접 데이터를 가져오면 이런 것들을 전부 직접 만들어야 한다:
- 로딩 상태 관리
- 에러 처리
- 캐싱 (같은 데이터를 두 번 안 가져오기)
- 데이터 갱신 (stale 데이터 자동 리페치)
- 무한 스크롤

TanStack Query는 이걸 전부 해준다:

```typescript
// 데이터 조회
const { data, isLoading, error } = useQuery({
  queryKey: ['challenge', 'today'],
  queryFn: () => fetch('/api/challenges/today').then(r => r.json()),
});

// 데이터 변경
const likeMutation = useMutation({
  mutationFn: (submissionId: string) => toggleLike(submissionId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['feed'] });
  },
});
```

**Zustand vs TanStack Query — 왜 둘 다 쓰나?**

| | Zustand | TanStack Query |
|---|---|---|
| 무엇을 관리? | **클라이언트 상태** (UI 상태, 로컬 draft) | **서버 상태** (DB에서 온 데이터) |
| 데이터 원천 | 브라우저 메모리 / localStorage | 서버 API |
| 예시 | 현재 크롭 중인 슬롯, 선택된 배경색 | 피드 목록, 오늘의 챌린지, 좋아요 수 |
| 만료 개념 | 없음 (수동 관리) | 있음 (`staleTime`, 자동 리페치) |

**프로젝트에서 쓰이는 위치**

| Query Key | 용도 |
|-----------|------|
| `['challenge', 'today']` | 오늘의 챌린지 데이터 |
| `['feed', cursor]` | 피드 무한 스크롤 (Infinite Query) |
| `['my-collages']` | 내 콜라주 목록 |
| `['submission', id]` | 특정 제출물 상세 |

**실습 태스크**

- [ ] `useQuery`로 하드코딩된 API에서 데이터를 가져와서 표시하기
- [ ] 로딩/에러/성공 상태를 각각 다른 UI로 보여주기
- [ ] `useMutation`으로 좋아요 API를 호출하고, 성공 후 피드를 `invalidateQueries`로 갱신
- [ ] `useInfiniteQuery`로 무한 스크롤 구현 (커서 기반)
- [ ] DevTools를 열어서 Query 캐시 상태를 확인해보기

---

### 16. Optimistic Update

**언제 공부하나**: Phase 3 — TanStack Query를 배운 직후

**쉬운 설명**

Optimistic Update는 **서버 응답을 기다리지 않고, "성공할 것이라 낙관(optimistic)하고" UI를 먼저 바꾸는 기법**이다.

**일반적인 좋아요 플로우**:
```
1. 하트 클릭 → 서버에 요청 → [0.5초 대기] → 응답 → 하트 빨갛게
```
사용자는 0.5초 동안 아무 반응이 없어서 "눌린 건가?" 하고 다시 누른다.

**Optimistic Update 플로우**:
```
1. 하트 클릭 → 즉시 하트 빨갛게 + 서버에 요청 → [0.5초] → 응답 → (이미 반영됨)
                                                              ↘ 실패 시 → 하트 되돌리기
```

```typescript
const likeMutation = useMutation({
  mutationFn: (submissionId: string) => toggleLike(submissionId),

  // 서버 응답 전에 UI를 먼저 업데이트
  onMutate: async (submissionId) => {
    // 현재 캐시 백업 (롤백용)
    const previousFeed = queryClient.getQueryData(['feed']);

    // 캐시를 낙관적으로 업데이트
    queryClient.setQueryData(['feed'], (old) => {
      // 좋아요 수 +1, isLiked = true로 변경
    });

    return { previousFeed }; // rollback 데이터
  },

  // 서버 에러 시 되돌리기
  onError: (err, submissionId, context) => {
    queryClient.setQueryData(['feed'], context?.previousFeed);
  },
});
```

**프로젝트에서 쓰이는 위치**

| 기능 | 왜 Optimistic Update가 필요한가 |
|------|-------------------------------|
| 좋아요 토글 | 빠른 피드백. 하트가 즉시 반응해야 자연스러움 |
| 공개/비공개 토글 | 토글 스위치가 즉시 바뀌어야 함 |

**실습 태스크**

- [ ] 좋아요 버튼을 만들고, 서버 요청 없이 `useState`로 즉시 UI를 바꿔보기
- [ ] TanStack Query `onMutate`에서 캐시를 수동 업데이트하기
- [ ] 의도적으로 API를 실패시켜서, `onError`에서 롤백이 잘 되는지 확인
- [ ] 네트워크를 느리게 설정(DevTools Throttling)하고 optimistic vs non-optimistic 비교

---

## Phase 4: 품질 보증과 관측

### 17. PostHog Event Tracking

**언제 공부하나**: Phase 4 — 핵심 기능이 완성된 후

**쉬운 설명**

PostHog는 **"사용자가 앱에서 무엇을 하는지"를 추적하는 분석 도구**이다.

Google Analytics와 비슷하지만, **이벤트 기반**이라 더 세밀하게 추적할 수 있다:

```typescript
import posthog from 'posthog-js';

// 이벤트 보내기
posthog.capture('challenge_started', {
  challenge_id: 'abc123',
  sentence_length: 6,
});

// 유저 속성 설정
posthog.identify(userId);
posthog.people.set({
  total_submissions: 5,
  last_submission_date: '2025-01-15',
});
```

**이벤트 기반 분석이란**: 페이지뷰만 세는 게 아니라, "글자 슬롯 탭함", "크롭 완료", "콜라주 완성" 같은 **구체적인 행동**을 추적하는 것.

**퍼널(funnel) 분석**: 이벤트를 순서대로 연결하면 "어디서 사용자가 이탈하는지" 보인다:
```
challenge_viewed (100명)
  → challenge_started (60명, 40명 이탈)
    → letter_cropped (48명, 12명 이탈) ← 크롭이 어려운가?
      → collage_preview_entered (24명, 24명이 중간에 포기)
        → submission_created (22명)
```

**프로젝트에서 쓰이는 위치**

| 이벤트 카테고리 | 핵심 이벤트들 |
|----------------|-------------|
| Challenge | `challenge_viewed`, `challenge_started`, `challenge_resumed` |
| Letter | `letter_slot_tapped`, `letter_cropped`, `letter_replaced` |
| Collage | `collage_preview_entered`, `collage_background_changed`, `collage_completed` |
| Share | `share_link_copied`, `share_page_viewed`, `share_page_cta_clicked` |
| Feed | `feed_viewed`, `feed_card_tapped`, `reaction_toggled` |

**실습 태스크**

- [ ] PostHog 프로젝트 만들고 API 키 설정
- [ ] 버튼 클릭 시 `posthog.capture()` 호출하고, PostHog 대시보드에서 이벤트 확인
- [ ] 챌린지 완료 퍼널을 PostHog에서 만들어보기
- [ ] 유저 속성(`$set`)을 설정하고, 유저 프로필에서 확인

---

### 18. Sentry

**언제 공부하나**: Phase 4 — PostHog과 함께

**쉬운 설명**

Sentry는 **앱에서 에러가 발생하면 자동으로 알려주는 도구**이다.

유저가 앱을 쓰다가 에러가 나면, 대부분 "새로고침"하고 끝이다. 개발자는 모른다. Sentry를 쓰면:

```
유저 기기에서 에러 발생
  → Sentry가 자동으로 캡처
  → 에러 메시지 + 스택 트레이스 + 브라우저 정보 + 유저 행동 이력
  → 개발자 이메일/Slack 알림
```

```typescript
// 자동 캡처 (설정만 하면 됨)
Sentry.init({
  dsn: 'https://xxx@sentry.io/123',
});

// 수동 캡처 (특정 상황에서)
try {
  await uploadImage(blob);
} catch (error) {
  Sentry.captureException(error, {
    extra: { blobSize: blob.size, userId },
  });
}
```

**Source Map 연동**: 프로덕션 코드는 압축(minify)되어 있어서 에러 스택 트레이스가 읽기 어렵다. Source map을 Sentry에 업로드하면 원본 코드 위치를 보여준다.

**프로젝트에서 쓰이는 위치**

| 추적 대상 | 위치 |
|-----------|------|
| 클라이언트 에러 (JS) | `sentry.client.config.ts` |
| 서버 에러 (API) | `sentry.server.config.ts` |
| 이미지 업로드 실패 | Route Handler에서 `captureException` |
| Canvas 처리 에러 | ImageCropper에서 `captureException` |

**실습 태스크**

- [ ] Sentry 프로젝트 만들고 `@sentry/nextjs` 설정
- [ ] 의도적으로 에러를 발생시키고 Sentry 대시보드에서 확인
- [ ] `captureException`에 `extra` 정보를 추가해서 디버깅에 도움이 되는지 확인
- [ ] Source map 업로드 설정하고, 에러 스택 트레이스가 원본 코드를 가리키는지 확인

---

### 19. Vitest

**언제 공부하나**: Phase 4 — 하지만 Phase 1부터 유틸 함수 테스트를 조금씩 작성하면 좋다

**쉬운 설명**

Vitest는 **코드가 올바르게 동작하는지 자동으로 검증하는 테스트 러너**이다.

Jest와 거의 같은 문법이지만, Vite 기반이라 Next.js 프로젝트에서 더 빠르다:

```typescript
import { describe, it, expect } from 'vitest';
import { stripExif } from '@/lib/image/strip-exif';

describe('stripExif', () => {
  it('EXIF가 포함된 JPEG에서 메타데이터를 제거한다', async () => {
    const input = await readFixture('photo-with-gps.jpg');
    const result = await stripExif(input);

    expect(hasExifData(result)).toBe(false);
    expect(result.size).toBeLessThan(input.size);
  });

  it('이미 EXIF가 없는 이미지는 그대로 반환한다', async () => {
    const input = await readFixture('clean-photo.jpg');
    const result = await stripExif(input);

    expect(result).toEqual(input);
  });
});
```

**테스트 피라미드**:
```
       /  E2E  \         ← 적게 (느리지만 현실적)
      / Component \      ← 중간
     /    Unit     \     ← 많이 (빠르고 정확)
```

**프로젝트에서 쓰이는 위치**

| 테스트 대상 | 종류 | 예시 |
|------------|------|------|
| EXIF 제거 유틸 | Unit | GPS 좌표가 제거되는지 |
| 이미지 유효성 검사 | Unit | 10MB 초과 파일 거부 |
| zod 스키마 | Unit | 잘못된 형식 입력 시 에러 |
| Zustand store | Unit | 슬롯 설정/초기화 동작 |
| Canvas crop 유틸 | Unit | 크롭 좌표 계산 |
| LetterGrid 컴포넌트 | Component | 빈 슬롯 클릭 시 카메라 input 트리거 |
| FeedCard 컴포넌트 | Component | 좋아요 버튼 클릭 시 mutation 호출 |

**실습 태스크**

- [ ] Vitest 설치하고 `vitest.config.ts` 설정
- [ ] 간단한 순수 함수 (예: `formatDate`) 테스트 작성
- [ ] Zustand store의 `setSlot`, `clearSlot`, `reset` 동작 테스트
- [ ] React Testing Library로 버튼 클릭 → 상태 변경 → UI 반영 테스트
- [ ] `vitest --coverage`로 커버리지 리포트 확인

---

### 20. Playwright

**언제 공부하나**: Phase 4 — Vitest를 배운 후

**쉬운 설명**

Playwright는 **실제 브라우저를 자동으로 조작하여 테스트하는 E2E 테스트 도구**이다.

Vitest가 코드 단위를 테스트한다면, Playwright는 **사용자 시나리오 전체**를 테스트한다:

```typescript
import { test, expect } from '@playwright/test';

test('챌린지 완료 플로우', async ({ page }) => {
  // 로그인
  await page.goto('/login');
  await page.click('button:has-text("Google로 시작")');

  // 챌린지 시작
  await page.goto('/');
  await page.click('button:has-text("시작하기")');

  // 첫 번째 슬롯 클릭
  await page.click('[data-testid="slot-0"]');

  // 이미지 업로드 (카메라 대신 파일로)
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('tests/fixtures/letter-a.jpg');

  // 크롭 확인
  await page.click('button:has-text("확인")');

  // 슬롯이 채워졌는지 확인
  await expect(page.locator('[data-testid="slot-0"] img')).toBeVisible();
});
```

**Vitest vs Playwright**

| | Vitest | Playwright |
|---|---|---|
| 테스트 단위 | 함수, 컴포넌트 | 전체 사용자 시나리오 |
| 속도 | 빠름 (ms) | 느림 (초) |
| 브라우저 | 시뮬레이션 (jsdom) | 실제 브라우저 (Chromium, Firefox, WebKit) |
| 적합한 테스트 | 로직 검증, 단위 동작 | 로그인 → 챌린지 → 크롭 → 제출 → 피드 확인 |

**프로젝트에서 쓰이는 위치**

| E2E 시나리오 | 검증 내용 |
|-------------|-----------|
| 로그인 → 챌린지 시작 | OAuth 플로우가 동작하는지 |
| 글자 크롭 → 슬롯 채움 | 이미지 크롭 UX가 동작하는지 |
| 모든 슬롯 채움 → 콜라주 완성 → 제출 | 전체 핵심 플로우 |
| 피드 보기 → 좋아요 | 피드 인터랙션 |
| 공유 링크 → 비로그인 접근 | 공유 페이지가 동작하는지 |

**실습 태스크**

- [ ] Playwright 설치하고 `playwright.config.ts` 설정
- [ ] 홈 페이지에 접속해서 "오늘의 문장"이 표시되는지 확인하는 테스트
- [ ] 파일 업로드를 시뮬레이션하는 테스트 (`.setInputFiles()`)
- [ ] `npx playwright test --ui`로 테스트 실행 과정을 시각적으로 확인
- [ ] GitHub Actions에서 Playwright가 자동 실행되게 CI 설정

---

## 부록: OpenTelemetry

**언제 공부하나**: Phase 5 이후 — 프로덕션 운영이 안정화된 후 (MVP에서는 불필요)

**쉬운 설명**

OpenTelemetry(OTel)는 **앱의 성능과 동작을 추적하는 관측(observability) 표준**이다.

Sentry가 "에러가 났다"를 알려준다면, OpenTelemetry는 "이 요청이 어떤 경로로 얼마나 걸렸는지"를 알려준다.

**3가지 신호(Signal)**:

| 신호 | 뜻 | 비유 | 예시 |
|------|------|------|------|
| **Traces** | 하나의 요청이 거치는 경로와 각 단계 소요 시간 | 택배 추적 | "피드 API 응답 800ms = DB 쿼리 600ms + 이미지 URL 생성 200ms" |
| **Metrics** | 숫자로 측정되는 집계 데이터 | 대시보드 계기판 | "분당 요청 수 150, 평균 응답 시간 200ms, 에러율 0.5%" |
| **Logs** | 이벤트 기록 (구조화된 형태) | 일기장 | `{ level: "error", message: "upload failed", userId: "abc" }` |

**왜 MVP에서는 불필요한가**: Sentry(에러) + PostHog(행동 분석)으로 충분하다. OpenTelemetry는 트래픽이 많아지고, 성능 병목을 정밀하게 찾아야 할 때 도입한다.

**나중에 도입할 때 쓰이는 위치**:
- Route Handler의 응답 시간 추적
- Supabase 쿼리 소요 시간
- Storage 업로드 시간
- 캐시 히트율

---

## 학습 순서 요약

```
Phase 0 (프로젝트 시작 전)
│
├─ 1. Next.js App Router ─────────── 폴더 = URL. layout으로 공통 틀.
├─ 2. Server vs Client Component ─── "인터랙션 있으면 Client"
│
Phase 1 (Mock 기반 개발)
│
├─ 8. Browser File API ──────────── input[type=file]로 사진 가져오기
├─ 9. Blob ──────────────────────── 바이너리 데이터 덩어리
├─ 10. Object URL ───────────────── Blob에 임시 URL 붙이기
├─ 11. Canvas API ───────────────── 픽셀 단위로 이미지 그리기
├─ 12. Image Crop ───────────────── Canvas로 영역 잘라내기
├─ 13. EXIF Metadata ────────────── GPS 제거 + 회전 보정
├─ 14. Zustand ──────────────────── 글자 슬롯 상태 공유
│
Phase 2 (서버 연동)
│
├─ 3. Route Handler vs Server Action ── API 설계 기준
├─ 4. Supabase Auth ─────────────── OAuth 로그인
├─ 5. Supabase Storage ──────────── 이미지 파일 저장
├─ 6. RLS ───────────────────────── DB 레벨 접근 제어
├─ 7. Signed URL ────────────────── 비공개 파일 임시 공개
│
Phase 3 (피드와 인터랙션)
│
├─ 15. TanStack Query ──────────── 서버 데이터 캐싱과 동기화
├─ 16. Optimistic Update ────────── 즉각 반응하는 좋아요
│
Phase 4 (품질과 관측)
│
├─ 17. PostHog ──────────────────── 유저 행동 추적과 퍼널
├─ 18. Sentry ───────────────────── 에러 자동 알림
├─ 19. Vitest ───────────────────── 유닛/컴포넌트 테스트
├─ 20. Playwright ───────────────── E2E 테스트
│
Phase 5+ (프로덕션 운영)
│
└─ 부록. OpenTelemetry ──────────── 성능 추적 (나중에)
```

---

## 체크리스트

### Phase 0 체크리스트
- [ ] App Router 폴더 구조를 설명할 수 있다
- [ ] Server Component와 Client Component의 차이를 설명할 수 있다
- [ ] `'use client'`가 필요한 경우를 판단할 수 있다
- [ ] Route Group `()`의 용도를 설명할 수 있다

### Phase 1 체크리스트
- [ ] `<input type="file">`로 이미지를 선택할 수 있다
- [ ] Blob과 File의 관계를 설명할 수 있다
- [ ] Object URL을 생성하고 해제할 수 있다
- [ ] Canvas에 이미지를 그리고 특정 영역을 크롭할 수 있다
- [ ] EXIF가 왜 위험한지, Canvas가 어떻게 제거하는지 설명할 수 있다
- [ ] Zustand store를 만들고, persist로 새로고침 후에도 상태를 유지할 수 있다
- [ ] selector로 리렌더링을 최적화할 수 있다

### Phase 2 체크리스트
- [x] Route Handler와 Server Action의 차이를 설명할 수 있다 — (Phase 2 Day 3: GET/POST Route Handler 3종 구현, FormData 파일 업로드는 Route Handler 채택, `docs/learning/phase-2-day-3.md §1·§6`)
- [x] 어떤 상황에서 어느 것을 쓸지 판단할 수 있다 — (Phase 2 Day 3: 파일 업로드=Route Handler+FormData, `request.json()` vs `request.formData()` 구분)
- [ ] OAuth 로그인 플로우 전체를 설명할 수 있다
- [ ] JWT가 뭔지, 어디에 저장되는지 설명할 수 있다
- [x] Supabase Storage에 파일을 업로드/다운로드할 수 있다 — (Phase 2 Day 3: `letter-pieces` 버킷 업로드 구현. 다운로드(signed URL)는 Day 4)
- [x] Public vs Private 버킷의 차이를 설명할 수 있다 — (Phase 2 Day 3: avatars(public, 읽기 정책 없음) vs letter-pieces/collages(private, 경로 소유권 정책), `docs/learning/phase-2-day-3.md §3`)
- [x] RLS 정책을 읽고 "누가 무엇을 할 수 있는지" 해석할 수 있다 — (Phase 2 Day 1: 15정책 + 요약표 해석, `docs/learning/phase-2-day-1.md §4`)
- [ ] Signed URL을 만들고 사용할 수 있다

#### Phase 2 Day 1에서 추가로 익힌 것 (DB 기반 설정)
- [x] GRANT와 RLS가 별개의 2단 관문임을 설명할 수 있다 — GRANT 없으면 RLS에 도달 못 함 (QA H1)
- [x] USING(기존 행 선택)과 WITH CHECK(새 행 저장)의 차이를 hidden 복원 사례로 설명할 수 있다 (QA H2)
- [x] SECURITY DEFINER trigger의 3종 안전장치를 설명할 수 있다 (`SET search_path=''` + `REVOKE EXECUTE` + 입력 클램프)
- [x] 하이브리드 마이그레이션(`generate` vs `generate --custom`)과 저널 테이블을 설명할 수 있다
- [x] Drizzle 스키마로 check/unique/부분 인덱스/authUsers FK를 표현할 수 있다
- [x] `(SELECT auth.uid())` 래핑이 행마다 재평가를 막는 캐시임을 설명할 수 있다
- [x] DATABASE_URL의 비밀번호 % 인코딩 함정을 설명할 수 있다 (Session pooler 5432)

#### Phase 2 Day 3에서 추가로 익힌 것 (핵심 API + Storage)
- [x] 인증(누구인가)과 검증(보낸 게 올바른가)이 별개임을 설명할 수 있다 — zod safeParse(API 400) vs parse(seed 중단), isomorphic 모듈
- [x] 소유 식별자(user_id)를 body가 아니라 JWT(`claims.sub`)에서 꺼내는 이유를 설명할 수 있다 (명의 도용 방지)
- [x] 표준 에러 `{error, code}` + `details`를 개발 모드에서만 노출하는 이유를 설명할 수 있다
- [x] 타인 리소스에 403이 아니라 404로 존재를 은폐하는 이유(enumeration 차단)와 검사 순서(401→404→409)를 설명할 수 있다
- [x] Storage가 `storage.objects`라는 별도 정책 표면이고, 경로 첫 폴더(`(storage.foldername(name))[1]`)=user_id로 소유권을 표현함을 설명할 수 있다
- [x] UPSERT에 INSERT+UPDATE 정책이 둘 다 필요한 이유, collages가 `submissions`를 EXISTS 조인해 조건부 공개하는 구조를 설명할 수 있다
- [x] **Drizzle 직결이 RLS를 우회**하므로 소유권을 코드(getOwnedSubmission)로 검증해야 함을 설명할 수 있다 (Day 3 1급 함정)
- [x] `onConflictDoNothing`(중복 방지) vs `onConflictDoUpdate`(값 교체)의 의도 차이를 설명할 수 있다
- [x] 파일 검증 MVP 범위(MIME 자기신고값 + 크기 413)와 미룬 리스크(magic-byte, 서버 EXIF strip)를 구분할 수 있다
- [x] Storage+DB가 한 트랜잭션이 아니라 고아 파일이 생길 수 있음과 대응(파일 먼저·행 나중 + path 로깅 + 이중 방어)을 설명할 수 있다
- [x] M2(복귀 경로 화이트리스트), M3(proxy `/api` 제외), seed를 마이그레이션 lineage 밖에 두는 이유를 설명할 수 있다

### Phase 3 체크리스트
- [ ] `useQuery`와 `useMutation`의 차이를 설명할 수 있다
- [ ] Query Key와 캐시 관리 전략을 설명할 수 있다
- [ ] Zustand(클라이언트 상태)와 TanStack Query(서버 상태)를 왜 분리하는지 설명할 수 있다
- [ ] Optimistic Update를 구현할 수 있다
- [ ] 실패 시 롤백 로직을 구현할 수 있다
- [ ] Infinite Query로 무한 스크롤을 구현할 수 있다

### Phase 4 체크리스트
- [ ] PostHog에서 이벤트를 보내고 대시보드에서 확인할 수 있다
- [ ] 퍼널 분석의 의미를 설명할 수 있다
- [ ] Sentry에서 에러를 확인하고 원본 코드 위치를 찾을 수 있다
- [ ] Vitest로 유틸 함수와 컴포넌트 테스트를 작성할 수 있다
- [ ] Playwright로 E2E 테스트를 작성하고 CI에서 자동 실행할 수 있다

---

## 추천 학습 노트 구조

`docs/learning/` 디렉토리에 Phase별로 노트를 만든다. 각 노트는 "배운 것 + 삽질 기록 + 프로젝트 적용"을 포함한다.

```
docs/learning/
├── learning-first-roadmap.md          ← 이 파일 (전체 로드맵)
├── learning-roadmap.md                ← 기존 체크리스트 버전
│
├── phase-0/
│   ├── 01-nextjs-app-router.md        ← App Router 구조, 라우팅 규칙
│   └── 02-server-vs-client.md         ← SC/CC 차이, 판단 기준, 실수 기록
│
├── phase-1/
│   ├── 03-file-blob-objecturl.md      ← File API + Blob + Object URL 통합
│   ├── 04-canvas-and-crop.md          ← Canvas API + 이미지 크롭 실습 기록
│   ├── 05-exif-metadata.md            ← EXIF 구조, 제거 방법, 프라이버시
│   └── 06-zustand.md                  ← Store 패턴, persist, selector
│
├── phase-2/
│   ├── 07-route-handler-vs-action.md  ← 선택 기준 정리
│   ├── 08-supabase-auth.md            ← OAuth 플로우, JWT, 세션 관리
│   ├── 09-supabase-storage.md         ← 버킷 설정, 업로드, Signed URL
│   └── 10-rls.md                      ← RLS 정책 작성법, 디버깅
│
├── phase-3/
│   ├── 11-tanstack-query.md           ← useQuery, useMutation, 캐시 전략
│   └── 12-optimistic-update.md        ← 구현 패턴, 롤백, 실패 처리
│
└── phase-4/
    ├── 13-posthog.md                  ← 이벤트 설계, 퍼널, 대시보드
    ├── 14-sentry.md                   ← 설정, Source Map, 알림
    ├── 15-vitest.md                   ← 설정, 테스트 패턴, 커버리지
    └── 16-playwright.md               ← E2E 시나리오, CI 연동

각 노트 권장 구조:
─────────────────
# [개념 이름]

## 한 줄 요약
(이 개념을 한 문장으로)

## 배운 것
(핵심 내용 3-5줄)

## 삽질 기록
(실수한 것, 헷갈렸던 것, 해결 방법)

## 프로젝트 적용
(타이포로그에서 실제로 어떻게 사용했는지)

## 참고 자료
(공식 문서 링크, 도움된 글)
```
