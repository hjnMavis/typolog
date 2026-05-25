# Typolog — Learning Roadmap

## 개요

이 문서는 Typolog을 만들면서 배워야 할 개발 개념을 정리한 것이다. 각 개념이 프로젝트의 어디에서 쓰이는지, 어떤 순서로 배워야 하는지를 포함한다.

학습 방법: 각 Phase를 시작할 때 해당 Phase에 필요한 개념을 먼저 읽고, 구현하면서 이해를 확인한다. Claude에게 "이 개념 설명해줘"라고 요청하면 프로젝트 맥락에 맞춰 설명을 받을 수 있다.

---

## Phase 0: 프로젝트 세팅

### Next.js App Router 기초

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| App Router vs Pages Router 차이 | 전체 프로젝트 구조 | [ ] |
| Server Component vs Client Component | 모든 페이지 | [ ] |
| `'use client'` 지시어가 필요한 경우 | 카메라, Canvas, Zustand 사용 컴포넌트 | [ ] |
| Route Group `(folder)` | `(auth)`, `(main)` 레이아웃 분리 | [ ] |
| `layout.tsx` vs `page.tsx` 역할 | 공통 레이아웃, 하단 네비게이션 | [ ] |
| `loading.tsx`, `error.tsx` 컨벤션 | 로딩/에러 UI | [ ] |

**핵심 질문**: "이 컴포넌트는 서버에서 렌더링되어야 하나, 브라우저에서 렌더링되어야 하나?"

### TypeScript Strict Mode

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| `strict: true`가 켜는 옵션들 | tsconfig.json | [ ] |
| `strictNullChecks` | 모든 코드에서 null/undefined 처리 | [ ] |
| 타입 추론 vs 명시적 타입 선언 | 변수, 함수 반환값 | [ ] |

### Tailwind CSS v4

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| 유틸리티 퍼스트 접근법 | 모든 UI 컴포넌트 | [ ] |
| v4의 CSS-first 설정 방식 (tailwind.config.ts 대신 CSS에서 설정) | 프로젝트 초기 설정 | [ ] |
| 반응형 디자인 (`sm:`, `md:`, `lg:`) | 모바일 우선 레이아웃 | [ ] |
| `cn()` 유틸과 조건부 클래스 | shadcn/ui 컴포넌트 커스터마이즈 | [ ] |

### shadcn/ui

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| shadcn/ui가 일반 컴포넌트 라이브러리와 다른 점 | UI 전체 | [ ] |
| copy-paste 방식의 의미와 장점 | 컴포넌트 커스터마이즈 | [ ] |
| Radix UI 프리미티브 | Dialog, Sheet, Popover 등 | [ ] |

---

## Phase 1: Mock 기반 핵심 UX

### Canvas API

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| `<canvas>` 엘리먼트와 2D Context | crop UI, 콜라주 미리보기 | [ ] |
| `drawImage()` — 이미지를 Canvas에 그리기 | crop, 콜라주 렌더링 | [ ] |
| `getImageData()` / `putImageData()` | 이미지 픽셀 조작 (필요 시) | [ ] |
| `toBlob()` / `toDataURL()` | 콜라주 PNG 내보내기 | [ ] |
| Canvas 좌표계와 변환 (scale, translate) | 핀치 줌, 드래그 | [ ] |
| `OffscreenCanvas` | 웹 워커에서 이미지 처리 (성능 최적화 시) | [ ] |

**핵심 질문**: "Canvas는 비트맵 기반인데, 어떻게 높은 해상도(Retina)에서 선명하게 보이게 하지?"

### 모바일 웹 카메라 접근

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| `<input type="file" accept="image/*" capture="environment">` | 카메라/갤러리 선택 | [ ] |
| `capture` 속성의 `user` vs `environment` | 전/후면 카메라 | [ ] |
| `FileReader` vs `URL.createObjectURL()` | 선택된 이미지를 Canvas에 로드 | [ ] |
| `navigator.mediaDevices.getUserMedia()` | (고급) 실시간 카메라 프리뷰 — MVP에서는 미사용 | [ ] |

### 이미지 처리

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| EXIF 메타데이터란 무엇인가 | 프라이버시 보호 (GPS 정보 제거) | [ ] |
| EXIF orientation과 이미지 회전 문제 | 모바일 사진이 90도 회전되어 보이는 문제 | [ ] |
| WebP 포맷의 장점과 변환 방법 | 글자 조각 용량 절약 | [ ] |
| 이미지 리사이즈와 품질 트레이드오프 | 업로드 전 이미지 최적화 | [ ] |

### Zustand

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Store 생성과 구독 패턴 | `challenge-store.ts` | [ ] |
| `persist` 미들웨어 | 진행 중 draft를 localStorage에 저장 | [ ] |
| selector로 리렌더링 최적화 | 특정 슬롯만 변경될 때 해당 슬롯만 리렌더링 | [ ] |
| immer 미들웨어 (선택) | 중첩 상태 불변 업데이트 | [ ] |

---

## Phase 2: Supabase 연동

### Supabase Auth

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| OAuth 2.0 플로우 (Authorization Code) | Google/Kakao 로그인 | [ ] |
| JWT (JSON Web Token)란 | Supabase 세션 관리 | [ ] |
| Supabase Auth의 세션 관리 (쿠키 vs 로컬 스토리지) | 서버/클라이언트 인증 | [ ] |
| PKCE (Proof Key for Code Exchange) | Supabase의 기본 OAuth 보안 | [ ] |
| Refresh Token과 세션 갱신 | 자동 로그인 유지 | [ ] |

**핵심 질문**: "사용자가 로그인하면 브라우저에서 서버까지 인증 정보가 어떻게 전달되는 거지?"

### Row Level Security (RLS)

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| RLS란 무엇이고 왜 필요한가 | 모든 테이블 | [ ] |
| `auth.uid()` 함수 | "본인만 수정 가능" 정책 | [ ] |
| SELECT/INSERT/UPDATE/DELETE별 정책 분리 | 테이블별 접근 제어 | [ ] |
| `USING` vs `WITH CHECK` 차이 | 읽기 정책 vs 쓰기 정책 | [ ] |
| RLS 디버깅 방법 | 정책이 의도대로 동작하는지 확인 | [ ] |

**핵심 질문**: "RLS 없이 API 레벨에서만 인증을 체크하면 안 되나? 왜 DB 레벨에서도 해야 하지?"

### Drizzle ORM

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| ORM이란 무엇이고 왜 쓰는가 | DB 접근 전체 | [ ] |
| Drizzle 스키마 정의 방법 | `src/db/schema.ts` | [ ] |
| 마이그레이션이란 무엇이고 왜 필요한가 | DB 스키마 변경 관리 | [ ] |
| 타입 안전한 쿼리 빌더 | SELECT, INSERT, UPDATE | [ ] |
| 관계(relation) 정의와 조인 | submission + user 정보 함께 조회 | [ ] |

### Supabase Storage

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Bucket과 Object 구조 | letter-pieces, collages, avatars | [ ] |
| Public vs Private 버킷 | 공개 콜라주 vs 비공개 글자 조각 | [ ] |
| Storage 접근 정책 | 본인 파일만 접근 | [ ] |
| Signed URL vs Public URL | 비공개 파일 임시 접근 | [ ] |

### Next.js Middleware

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Middleware란 무엇이고 언제 실행되나 | 인증 체크 | [ ] |
| Middleware에서 세션 확인하고 리다이렉트 | 보호 페이지 접근 제어 | [ ] |
| `matcher` 설정 | 특정 경로에만 Middleware 적용 | [ ] |

---

## Phase 3: 피드/공유/반응

### TanStack Query

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Query Key와 캐시 관리 | 모든 서버 데이터 조회 | [ ] |
| `useQuery` vs `useMutation` | 조회 vs 변경 | [ ] |
| Optimistic Update | 좋아요 클릭 시 즉시 반영 | [ ] |
| Infinite Query | 피드 무한 스크롤 | [ ] |
| Cache Invalidation | 제출 후 피드 새로고침 | [ ] |
| Stale Time vs Cache Time | 데이터 신선도 관리 | [ ] |

**핵심 질문**: "서버 상태와 클라이언트 상태를 왜 분리해야 하지? Zustand에 다 넣으면 안 되나?"

### Cursor 기반 Pagination

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Offset vs Cursor pagination 차이 | 피드 API | [ ] |
| Cursor pagination의 장점 (성능, 일관성) | 실시간 피드에서 데이터 정합성 | [ ] |
| 구현 방법 (created_at + id 조합) | `GET /api/feed?cursor=xxx` | [ ] |

### OG 이미지 (Open Graph)

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Open Graph 프로토콜이란 | SNS 공유 시 미리보기 | [ ] |
| `@vercel/og`를 이용한 동적 OG 이미지 생성 | `/api/og/[id]` | [ ] |
| Next.js의 `metadata` API | 페이지별 메타태그 설정 | [ ] |

### Server Actions vs Route Handlers

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Server Action이란 무엇이고 언제 쓰는가 | 좋아요 토글, 프로필 수정 | [ ] |
| `'use server'` 지시어 | Server Action 함수 | [ ] |
| Route Handler와의 차이점과 선택 기준 | API 설계 | [ ] |
| progressive enhancement | JS 없이도 form이 동작하는가 | [ ] |

### react-hook-form + zod

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| react-hook-form의 기본 사용법 (register, handleSubmit) | 프로필 수정 폼, 신고 사유 입력 | [ ] |
| zod 스키마 정의와 타입 추론 | API 요청/응답 validation, 폼 validation | [ ] |
| zod + react-hook-form 연동 (@hookform/resolvers) | 클라이언트/서버 validation 로직 공유 | [ ] |

---

## Phase 4: 로깅/테스트/모니터링

### 테스트

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| 단위 테스트 vs 통합 테스트 vs E2E 테스트 | 테스트 전략 전체 | [ ] |
| Vitest 설정과 사용법 | 유닛/컴포넌트 테스트 | [ ] |
| React Testing Library 철학 ("유저처럼 테스트") | 컴포넌트 테스트 | [ ] |
| Playwright 기본 사용법 | E2E 테스트 | [ ] |
| MSW (Mock Service Worker) | API mock | [ ] |
| 테스트 커버리지의 의미와 한계 | CI에서 커버리지 리포트 | [ ] |

### 에러 트래킹 & 분석

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Sentry 설정과 Source Map 연동 | 에러 추적 | [ ] |
| PostHog 이벤트 설계와 퍼널 분석 | 유저 행동 분석 | [ ] |
| 이벤트 기반 분석이란 | PostHog 대시보드 | [ ] |

### CI/CD

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| GitHub Actions 기본 구조 (workflow, job, step) | PR 체크, 배포 | [ ] |
| Vercel의 자동 배포 (Preview / Production) | 배포 전략 | [ ] |

---

## Phase 5: 베타 운영

### 성능 최적화

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| Core Web Vitals (LCP, FID, CLS) | Vercel Analytics | [ ] |
| `next/image` 최적화 | 피드 이미지 로딩 | [ ] |
| 번들 크기 분석과 최적화 | 초기 로딩 속도 | [ ] |
| `React.lazy` / dynamic import | 코드 스플리팅 | [ ] |

### 운영

| 개념 | 프로젝트에서 쓰이는 곳 | 상태 |
|------|---------------------|------|
| 환경 변수 관리 전략 | `.env.local`, Vercel env | [ ] |
| 에러 바운더리 (Error Boundary) | 글로벌 에러 처리 | [ ] |
| 사용자 피드백 수집과 분석 | 베타 운영 | [ ] |

---

## 학습 우선순위 요약

```
즉시 필요 (Phase 0)
├── Next.js App Router 기초
├── TypeScript strict
├── Tailwind CSS + shadcn/ui
└── 프로젝트 구조 설계

1주차 필요 (Phase 1)
├── Canvas API (crop, drawImage, toBlob)
├── 모바일 카메라 접근
├── EXIF 처리
└── Zustand (store, persist)

2주차 필요 (Phase 2)
├── Supabase Auth (OAuth)
├── RLS (Row Level Security)
├── Drizzle ORM
├── Supabase Storage
└── Next.js Middleware

3주차 필요 (Phase 3)
├── TanStack Query (특히 infinite query, optimistic update)
├── Cursor pagination
├── OG 이미지
├── Server Actions
└── react-hook-form + zod (폼 validation)

4주차 필요 (Phase 4)
├── Vitest + React Testing Library
├── Playwright
├── Sentry + PostHog
└── GitHub Actions

나중에 (Phase 5+)
├── 성능 최적화
├── PWA
└── 고급 Canvas (WebGL, OffscreenCanvas)
```
