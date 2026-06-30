# Phase 3 Day 8 QA 리뷰 — 공유 기능 (비인증 공유, OG 이미지, 공유 UI, #51)

> 검증일: 2026-06-19
> 검증자: QA Agent
> 기준 커밋: worktree-phase3-day8-share (base: f3f21c4)

---

## 1. 검증 범위

| 대상 파일 | 신규/수정 |
|-----------|---------|
| `src/lib/share/get-shared-submission.ts` | 신규 |
| `src/app/api/og/[id]/route.tsx` | 신규 |
| `src/app/s/[id]/page.tsx` | 스텁 → 교체 |
| `src/features/share/ShareActions.tsx` | 신규 |
| `src/app/s/[id]/not-found.tsx` | 신규 |
| `src/features/compose/CollagePreviewClient.tsx` | 수정 (#51) |

---

## 2. 자동 검증 결과

| 명령 | 결과 | 비고 |
|------|------|------|
| `pnpm type-check` | **PASS** | 오류 0건 |
| `pnpm lint` | **PASS** | 경고·오류 0건 |
| `pnpm test:run` | **PASS** | 12 파일 / 157 테스트 전원 통과 |
| `pnpm build` | **PASS** | `/api/og/[id]` 라우트(ƒ Dynamic) 포함 컴파일 성공 |

빌드 결과에서 `/api/og/[id]`가 Dynamic 라우트로 정상 등록됨을 확인했다.

---

## 3. QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|---------|
| S1 | 가시성 술어 코드 강제: `status='completed' AND is_public=true` | PASS | 정적 리뷰 — `get-shared-submission.ts:51-57` Drizzle WHERE절 직접 확인 |
| S2 | 잘못된 형식 id(uuid 아님) → null 반환(존재 은폐) | PASS | 정적 리뷰 — `submissionIdSchema.safeParse()` 실패 시 즉시 null 반환(line 34-35) |
| S3 | `server-only` 가드 — 클라이언트 번들 유입 차단 | PASS | 정적 리뷰 — `get-shared-submission.ts:5`, `signed-url.ts:4` 모두 `import 'server-only'` 확인 |
| S4 | `any` 타입 사용 없음 | PASS | grep + type-check PASS |
| S5 | collage_url null 폴백 처리 | PASS | 정적 리뷰 — `page.tsx:77-95` 이니셜 폴백, `route.tsx:77-95` 브랜드 "T" 폴백 |
| S6 | `ShareActions.tsx` 'use client' 선언 + 서버 컴포넌트 경계 분리 | PASS | 정적 리뷰 — line 1 'use client', page.tsx는 async 서버 컴포넌트 |
| S7 | `useSyncExternalStore` hydration-safe 패턴 (서버 스냅샷 = false) | PASS | 정적 리뷰 — `ShareActions.tsx:12-17`: getServerSnapshot = `() => false` |
| S8 | OG route `runtime = 'nodejs'` 선언 | PASS | 정적 리뷰 — `route.tsx:6` |
| S9 | OG `Cache-Control` 헤더 설정 | PASS | 정적 리뷰 — `route.tsx:118`: `s-maxage=86400, stale-while-revalidate=604800` |
| S10 | OG 버퍼 크기 상한(4MB) 및 content-type 화이트리스트(`image/*`) | PASS | 정적 리뷰 — `route.tsx:38-41` |
| S11 | React `cache()` 래핑 — generateMetadata·본문 중복 DB 조회 방지 | PASS | 정적 리뷰 — `get-shared-submission.ts:32`: `export const getSharedSubmission = cache(async ...)` |
| S12 | `generateMetadata` 비공개/미존재 시 noindex + og 미포함 | PASS | 정적 리뷰 — `page.tsx:27-29`: `{ title: 'Typolog', robots: { index: false, follow: false } }` |
| S13 | `metadataBase` 설정 + og:image 상대→절대 URL 변환 | PASS | 정적 리뷰 — `page.tsx:37`: `new URL(APP_URL)`, ogImage = `/api/og/${shared.id}` |
| S14 | `/s/*`, `/api/og/*` proxy 공개 경계 미보호 | PASS | 정적 리뷰 — `proxy.ts:8`: `PROTECTED_PREFIXES = ['/challenge', '/feed', '/admin']`, `/s/`·`/api/`는 미포함 |
| S15 | not-found.tsx — 존재/비공개/미완성 동일 화면으로 원인 미구분 | PASS | 정적 리뷰 — `not-found.tsx:8-20`: "삭제됐거나, 비공개이거나, 존재하지 않는" 통합 메시지 |
| S16 | `#51` 제출 완료 후 "피드 보러가기" 링크 추가 | PASS | 정적 리뷰 + grep — `CollagePreviewClient.tsx:473-476` Link href="/feed/today" 확인 |
| N1 | `/api/og/<없는UUID>` → HTTP 404 | PASS | curl 라이브 검증 — `http://localhost:3099/api/og/00000000-0000-0000-0000-000000000000` → 404 |
| N2 | `/api/og/abc` (잘못된 형식) → HTTP 404 | PASS | curl 라이브 검증 — `http://localhost:3099/api/og/abc` → 404 |
| N3 | `/s/<없는UUID>` → HTTP 404 | PASS | curl 라이브 검증 — 404 응답 확인 |
| N4 | `/s/abc` (잘못된 형식) → HTTP 404 | PASS | curl 라이브 검증 — 404 응답 확인 |
| N5 | `/s/abc` not-found 화면 본문 텍스트 | PASS | curl + grep — "콜라주를 찾을 수 없어요" 렌더 확인 |
| N6 | 회귀: `/feed/today` 비인증 → 307 redirect `/login` | PASS | curl 라이브 검증 — `Location: http://localhost:3099/login` 확인 |
| P1 | 공개 완성 submission의 OG 200 + 콜라주 이미지 임베드 | **이관** | 실제 공개 완성 submission id 필요 — 사용자 E2E로 이관 (§4 참조) |
| P2 | 카카오톡/X 링크 미리보기 og:image 표시 | **이관** | SNS 크롤러 실환경 필요 — 사용자 E2E로 이관 |
| P3 | Web Share API 네이티브 공유 시트 동작 | **이관** | 모바일 브라우저 실환경 필요 — 사용자 E2E로 이관 |
| P4 | 클립보드 복사 + "복사됨!" 2초 피드백 | **이관** | 브라우저 클립보드 API, 사용자 E2E로 이관 |

---

## 4. 이슈 목록

이슈 없음. Critical / High 건 0건.

### 관찰 사항 (이슈 아님 — 참고용)

**[Medium-관찰] OG 이미지에서 콜라주 signed URL을 서버에서 재fetch하는 방식**
- 위치: `route.tsx:31-47`
- 내용: OG 라우트가 이미 서명된 URL로 콜라주를 fetch해 data-URI로 변환한다. 장점: signed URL이 OG 이미지 픽셀로 구워져 24h 서명 만료와 무관하게 캐시 가능. 단점: OG 요청 시마다 Supabase Storage에 1회 outbound fetch가 발생. 현재 트래픽 수준(MVP)에서는 문제 없다.
- 판단: 설계 의도가 명확히 주석 처리됨. 이슈 아님.

**[Low-관찰] `#51` 피드 보러가기 링크가 항상 `/feed/today` 고정**
- 위치: `CollagePreviewClient.tsx:473`
- 내용: 비공개 제출(is_public=false)의 경우에도 `/feed/today`로 안내된다. 비공개 제출자는 피드에서 본인 콜라주를 볼 수 없으나, 피드 진입 자체가 막히지는 않으므로 기능 오류는 아니다. UX상 약한 불일치. MVP 수준에서 허용 가능.
- 판단: Low. 향후 마이페이지(Day 9) 구현 후 `/u/me` 링크로 개선 여지 있음.

**[Low-관찰] 클립보드 복사 실패 시 무음 무시(silent fail)**
- 위치: `ShareActions.tsx:28-35`
- 내용: HTTPS가 아닌 컨텍스트나 권한 거부 시 클립보드 API가 예외를 던지면 조용히 무시된다. 사용자에게 실패 피드백이 없다. 모바일 환경(HTTPS 배포)에서는 재현 가능성이 낮으나, HTTP 로컬 개발 환경에서는 복사가 실패해도 사용자가 인지 못 한다.
- 판단: Low. 배포 환경(HTTPS)에서는 문제 없음.

---

## 5. 긍정 경로 검증 — 사용자 E2E 이관 항목

아래 항목은 실제 공개 완성 submission id 또는 실환경이 필요하다. `.env.local`을 읽지 않고는 DB에서 안전하게 id를 취득하기 어려우므로 **사용자 직접 E2E**로 이관한다. 가짜 데이터를 만들지 않는다.

| # | 시나리오 | 전제 조건 |
|---|---------|---------|
| E1 | 실제 공개 완성 submission id로 `/s/{id}` 접근 → 콜라주·문장·닉네임 표시 | 공개 완성 submission 1건 필요 |
| E2 | 실제 submission id로 `/api/og/{id}` 접근 → HTTP 200 + PNG 반환 | 위와 동일 |
| E3 | 카카오톡/X에 공유 링크 붙여넣기 → og:image 미리보기 표시 | SNS 크롤러 실환경 |
| E4 | 모바일 브라우저에서 "공유하기" 버튼 → 네이티브 공유 시트 표시 | Web Share API 지원 기기 |
| E5 | "링크 복사" 버튼 클릭 → 2초간 "복사됨!" 피드백 → 복사된 URL 붙여넣기 확인 | 브라우저 클립보드 |
| E6 | 비인증 상태로 "나도 만들기" 클릭 → `/` 이동(proxy가 `/login`으로 리다이렉트) | 비인증 세션 |
| E7 | 인증 상태로 "나도 만들기" 클릭 → `/` 홈 이동 | 인증 세션 |
| E8 | 제출 완료 후 "피드 보러가기" 클릭 → `/feed/today` 이동 | 제출 완료 상태 |

---

## 6. 핵심 판단

### 가시성 단일 소스 설계

`getSharedSubmission`이 `status='completed' AND is_public=true` 술어를 Drizzle WHERE절에 직접 박아 `/s/[id]` 화면과 `/api/og/[id]` 이미지 라우트가 동일한 함수를 호출한다. 화면과 OG가 각자 가시성을 판정하면 "화면은 보여주고 OG는 막는" 누수가 발생할 수 있는데, 이 설계가 그 가능성을 원천 차단한다(§7.4). 단일 소스 원칙이 잘 지켜졌다.

### Drizzle 직결 + RLS 우회의 의도성

`getSharedSubmission`은 service role이 아닌 anon server client로 서명하되, DB 조회는 Drizzle 직결(RLS 우회)로 수행하고 가시성 필터를 코드로 강제한다. 이는 Phase 3 피드(Day 6)에서도 동일하게 채택된 패턴으로, Drizzle 사용 이유는 RLS 우회가 목적이 아니라 복잡한 JOIN(submissions ⨝ profiles ⨝ challenges)을 타입 안전하게 작성하기 위함이며, 가시성 강제가 코드 레벨에서 이뤄지므로 보안상 동등하거나 더 명시적이다.

### OG 이미지 한글 미포함 결정

Satori(next/og 내부)가 기본적으로 한글 폰트를 지원하지 않으므로(두부 문제) 이미지에는 라틴 브랜드명 "Typolog"만 그리고, 한글 문장·닉네임은 메타태그(og:title, og:description)에 싣는다. 카카오톡·X가 링크 카드 제목/설명으로 이를 네이티브 렌더하므로 실질적인 정보 전달에는 문제 없다. 폰트 로딩 없이 빌드·런타임을 단순하게 유지한다.

---

## 7. 리스크

| 항목 | 수준 | 내용 |
|------|------|------|
| collage_url signed URL 만료(24h) | Low | OG 라우트가 콜라주 바이트를 data-URI로 구워 넣어 캐시하므로 서명 만료와 무관. 단, 최초 요청 시 signed URL이 유효해야 한다. |
| OG 이미지 캐시 무효화 | Low | `s-maxage=86400`으로 CDN이 하루 캐시. 제출이 비공개로 전환돼도 OG 이미지가 24h 잔류할 수 있다. MVP에서는 허용 수준. |
| Web Share API 미지원 브라우저 | Low | `canNativeShare=false` 시 공유 버튼 자체가 렌더되지 않고 "링크 복사"만 표시 — 폴백 정상 작동. |
| 모바일 환경 클립보드 HTTPS 의존 | Low | HTTP 로컬에서 복사 silent fail. 배포 환경(HTTPS)에서는 무관. |
| E2E 긍정 경로 미검증 | Medium | 실제 공개 완성 submission id가 없어 라이브 콜라주 렌더·OG 200·SNS 미리보기를 자동 검증하지 못했다. 사용자 E2E 필수. |

---

## 8. 다음 액션 (사용자 E2E 체크리스트)

아래를 순서대로 직접 수행한다. 실제 공개 완성 submission이 있어야 하며, 없으면 전체 제출 플로우(E2E-3)를 먼저 실행한다.

- [ ] 공개 완성 submission id를 메모한다 (피드 또는 제출 완료 화면에서 확보)
- [ ] `https://{domain}/s/{id}` 접근 → 콜라주·문장·닉네임 정상 표시 확인
- [ ] `https://{domain}/api/og/{id}` 접근 → HTTP 200 + PNG 이미지 다운로드 확인
- [ ] "링크 복사" 버튼 클릭 → 2초 "복사됨!" 피드백 → 붙여넣기로 URL 확인
- [ ] (선택) 카카오톡 채팅창에 공유 링크 입력 → OG 이미지 미리보기 표시 확인
- [ ] 비인증 상태에서 "나도 만들기" 클릭 → `/login` 리다이렉트 확인
- [ ] 제출 완료 후 "피드 보러가기" 클릭 → `/feed/today` 이동 확인
- [ ] 없는 UUID `/s/00000000-0000-0000-0000-000000000000` → "콜라주를 찾을 수 없어요" 화면 확인
- [ ] 모바일에서 "공유하기" 버튼 표시 여부 확인 (iOS Safari / Android Chrome)

---

## 9. 커밋 가능 여부

**가능** — Critical / High 이슈 0건.

자동 검증(type-check / lint / test:run 157 / build) 전원 PASS.
부정 경로(없는 UUID, 잘못된 형식 id, 회귀 인증 리다이렉트) curl 라이브 검증 전원 PASS.
긍정 경로(실제 콜라주 렌더, OG 200, SNS 미리보기)는 사용자 E2E 이관 후 위 체크리스트 완료 시 최종 확인.
