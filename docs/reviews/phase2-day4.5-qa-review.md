# Phase 2 Day 4.5 QA 리뷰

- **작성일**: 2026-06-11
- **리뷰어**: QA Agent
- **브랜치**: worktree-phase2-day45-client-connect
- **베이스**: main (f9290f0)

---

## 검증 방법 요약

| 방법 | 적용 범위 |
|------|-----------|
| 정적 코드 리뷰 | 모든 변경 파일 전수 |
| `pnpm lint` | 린트 오류 없음 확인 |
| `pnpm type-check` | 타입 오류 없음 확인 |
| `pnpm test:run` | Vitest 단위 테스트 9파일 127케이스 |
| curl API 호출 | GET /api/challenges/today (비인증 공개 경로) — 실제 200 확인 |
| curl API 호출 (실패) | POST /api/submissions 등 인증 필요 경로 — 환경 이슈로 정적 리뷰 대체 (아래 설명) |
| 브라우저 렌더링 | 사용자 E2E로 위임 (GitHub issue #34) |

### curl API 검증 환경 이슈 메모

dev 서버(PID 68241, localhost:3002)가 이미 실행 중이었으나, 미들웨어(proxy.ts)에서 Supabase 환경변수를 읽지 못해 모든 보호 라우트에서 500이 반환됐다. 스택 트레이스: `edge-server`에서 `createServerClient` 호출 시 "URL and Key are required" 오류. 단, GET /api/challenges/today는 실제로 `HTTP 200` 정상 응답했다(이 라우트는 Supabase 클라이언트가 아닌 DB 직접 조회 사용). 인증 필요 경로(POST /api/submissions, GET/PATCH /api/submissions/[id], POST /api/submissions/[id]/letters)는 정적 리뷰로 판단했다.

> **[정정 — 메인 세션 후속 조사, 2026-06-11]** 위 500의 원인은 QA 시점에 추정한 Turbopack 워크스페이스 루트 감지 이슈가 아니라, **이 워크트리의 `.env.local`이 stale한 메인 repo 사본**(Next 파서 기준 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`·`SUPABASE_SECRET_KEY` 누락)이었기 때문으로 확정됐다. Node 런타임 라우트(POST /api/submissions)도 동일 에러로 500이었음이 근거(edge 한정 문제가 아님). Day 4 워크트리의 정상 `.env.local`로 교체 후 `/` 307 · `/login` 200 · 비인증 POST 401 정상 확인. **Day 4.5 코드 결함 아님** — 이슈 분류에 미포함.

---

## QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|----------|------|-----------|
| C1 | `types/api.ts`에 런타임 import 없음 (타입만) | PASS | 정적 리뷰 — import 구문 없음 |
| C2 | `api-client.ts`가 서버 전용 모듈 미임포트 | PASS | 정적 리뷰 — `import type`만, server-only 없음 |
| C3 | `providers.tsx` 'use client' 선언 | PASS | 정적 리뷰 — 첫 줄 확인 |
| C4 | TanStack QueryClient singleton 패턴 (isServer 분기) | PASS | 정적 리뷰 — 공식 advanced-ssr 패턴 정확히 구현 |
| C5 | 전역 staleTime 60s, 4xx 재시도 금지 | PASS | 정적 리뷰 — makeQueryClient() 내 retry 로직 ✓ |
| C6 | useTodayChallenge staleTime 5분 | PASS | 정적 리뷰 — 5 * 60 * 1000 ✓ |
| C7 | useSubmissionDetail staleTime 30분 | PASS | 정적 리뷰 — 30 * 60 * 1000 = 1800s ✓ |
| C8 | signed URL TTL(1h) > staleTime(30m) 정합 | PASS | 정적 리뷰 — EDIT: 3600s > 1800s ✓ |
| C9 | 제출 완료 후 invalidateQueries(['submission', id]) | PASS | 정적 리뷰 — onSuccess에서 1회 호출 ✓ |
| C10 | A2 create-or-get: 201 통과 / 409 SUBMISSION_EXISTS 재사용 | PASS | Vitest + 정적 리뷰 ✓ |
| C11 | A2 409에 submission null이면 ApiError throw | PASS | Vitest ✓ |
| C12 | 비-JSON 에러 바디 → UNKNOWN 코드 ApiError | PASS | Vitest ✓ |
| C13 | 완성 제출 멱등 단축 (status=completed이면 바로 return) | PASS | Vitest + 정적 리뷰 ✓ |
| C14 | 중간 실패 시 이후 단계 미실행 + 에러 전파 | PASS | Vitest ✓ |
| C15 | A5 FormData 숫자 필드 문자열 변환 | PASS | Vitest ✓ |
| C16 | JPEG 검증 허용 (validateLetterImage) | PASS | Vitest ✓ |
| C17 | PNG 거부 400 INVALID_IMAGE_TYPE | PASS | Vitest ✓ |
| C18 | 500KB 경계값 통과 | PASS | Vitest ✓ |
| C19 | LETTER_IMAGE_MIMES = ['image/webp', 'image/jpeg'] | PASS | Vitest ✓ |
| C20 | to-webp.ts: WebP 인코더 미지원 시 JPEG로 폴백 | PASS | 정적 리뷰 — blob.type !== candidate.type이면 break ✓ |
| C21 | to-webp.ts: 변환 중 createObjectURL → finally에서 revoke | PASS | 정적 리뷰 ✓ |
| C22 | CollagePreviewClient: objectUrlsRef unmount 시 revoke | PASS | 정적 리뷰 — cleanup effect ✓ |
| C23 | handleSubmit: IDB Blob 직접 fetch, 내부 createObjectURL 없음 | PASS | 정적 리뷰 — Blob만 letters에 담고 URL 생성 없음 ✓ |
| C24 | QA Day4 M2: ApiLetterPiece.image_url string \| null 타입 | PASS | 정적 리뷰 + Vitest ✓ |
| C25 | TodayChallengeGate: URL id 불일치 시 홈 redirect | PASS | 정적 리뷰 — useEffect + router.replace('/') ✓ |
| C26 | TodayChallengeGate: CHALLENGE_NOT_FOUND 시 refetch 버튼 숨김 | PASS | 정적 리뷰 ✓ |
| C27 | A5 서버 라우트: JPEG 확장자 분기 (jpg/webp) | PASS | 정적 리뷰 ✓ |
| C28 | 마이그레이션 0004: letter-pieces 버킷 MIME 확장 SQL | PASS | 정적 리뷰 — 이미 Supabase에 적용 완료 |
| C29 | GET /api/challenges/today 비인증 공개 응답 200 | PASS | curl 실제 호출 ✓ |
| C30 | pnpm lint 오류 없음 | PASS | 실행 결과 ✓ |
| C31 | pnpm type-check 오류 없음 | PASS | 실행 결과 ✓ |
| C32 | Vitest 127건 전체 통과 | PASS | 실행 결과 ✓ |

---

## 발견된 이슈

### Medium

#### M1 — A5 응답 상태 코드 200 (스펙 비명시)

- **파일**: `src/app/api/submissions/[id]/letters/route.ts:128`
- **현상**: UPSERT 성공 시 `NextResponse.json(piece, { status: 200 })`으로 반환한다. 클라이언트(`api-client.ts`)는 `res.ok` 체크만 하므로 동작에는 무관하나, REST 관행(신규 생성 201 / 업데이트 200) 및 스펙 문서가 상태 코드를 명시하지 않아 모호하다.
- **영향**: 현재 기능 동작에 영향 없음. 단, 향후 클라이언트가 201/200을 구분해 처리하는 코드를 추가할 경우 혼동 유발 가능.
- **제안**: 스펙(backend-design-plan.md §6.3 A5)에 "UPSERT라 항상 200" 또는 "신규 201, 교체 200"으로 명시. 코드 변경은 불필요.

---

#### M2 — JPEG → WebP 포맷 교체 시 고아 파일 발생 가능

- **파일**: `src/app/api/submissions/[id]/letters/route.ts:91-96`, `src/lib/image/to-webp.ts`
- **현상**: 슬롯 재업로드 시 포맷이 바뀌면(예: 첫 업로드 `0.webp` → 재업로드 `0.jpg`) 이전 파일이 Storage에 남는다. DB `image_url`은 최신 경로를 가리키므로 화면 손상은 없으나, `letter-pieces/{userId}/{submissionId}/0.webp`가 고아 파일로 누적된다.
- **판단 근거**: 라우트 주석에 이 리스크가 이미 기록되어 있고("고아 파일이 남을 수 있으나 DB image_url이 최신 경로를 가리키므로 표시 손상 없음"), 같은 슬롯 포맷 교체는 MVP에서 드문 케이스. 기존 §8.3-3의 Storage clean-up 이관 결정과 일관됨.
- **제안**: 현 MVP 결정과 일치하므로 즉시 수정 불필요. Phase 3 Storage cleanup 잡 설계 시 포맷 교체 고아 파일도 범위에 포함할 것.

---

#### M3 — `@tanstack/react-query-devtools`가 devDependency이나 클라이언트 번들에 포함됨

- **파일**: `package.json`, `src/app/providers.tsx`
- **현상**: `@tanstack/react-query-devtools`가 `devDependencies`에 선언됐으나 `providers.tsx`('use client')에서 직접 import되어 클라이언트 번들에 포함된다. TanStack Query Devtools v5는 production 빌드에서 자체적으로 no-op 처리되므로 기능 손상은 없다. 그러나 Next.js App Router는 devDependency/dependency 구분을 번들링에 반영하지 않으므로, production 빌드에서 devtools 모듈이 번들에 포함될 수 있다(v5 자체 최적화 의존).
- **영향**: production 번들 크기 미미한 증가 가능성. v5 공식 문서에 "excluded from production bundle automatically"로 명시되어 있어 실제 영향 낮음.
- **제안**: `providers.tsx`에 `process.env.NODE_ENV === 'development'` 조건 추가 또는 `@tanstack/react-query-devtools`를 `dependencies`로 이동 검토. 단, v5 자체 처리를 신뢰한다면 현 상태 유지 가능.

---

## 커버되지 않는 영역 (리스크)

| 항목 | 이유 |
|------|------|
| 브라우저 렌더링 · 화면 전환 · 진행 UI | 브라우저 도구 없음 → 사용자 E2E(GitHub issue #34)로 위임 |
| Safari iOS 실기기 WebP 폴백 동작 | 실기기 없음 — vitest-canvas-mock은 항상 webp 반환해 폴백 경로 미실행 |
| 인증 완료 후 A2/A5/A6/A4 실제 호출 | curl 비인증 검증 환경 제약 — 개발 서버 환경변수 문제로 500 |
| 콜라주 PNG 2MB 초과 시 서버 413 처리 후 클라이언트 에러 표시 | 실제 Blob 생성 없이 curl로 검증 불가 |
| TanStack Query refetchOnWindowFocus (자정 전환 시나리오) | 실제 브라우저 KST 자정 E2E 불가 |
| optimistic update 없음 (Phase 3 이관) | 범위 외 |

---

## 사용자 모바일 수동 테스트 체크리스트

> iPhone 14 / Pixel 7 기준 (Safari iOS, Chrome Android)

### 홈 화면
- [ ] 앱 처음 진입 시 스켈레톤 로딩이 표시되고 챌린지 데이터가 로드된다
- [ ] 오늘의 문장과 글자 수가 정상 표시된다
- [ ] "시작하기" 버튼을 누르면 `/challenge/[id]`로 이동한다
- [ ] 네트워크 오프 후 새로고침 시 "챌린지를 불러오지 못했어요" 에러 + "다시 시도" 버튼이 표시된다
- [ ] "다시 시도" 버튼 탭 후 네트워크 복구 시 데이터가 로드된다

### 수집 화면 (챌린지 진행)
- [ ] `/challenge/[id]`에서 URL의 id가 오늘 챌린지 id와 다르면 홈으로 redirect된다
- [ ] 글자 슬롯 탭 → 이미지 선택 시트 → 갤러리에서 이미지 선택 → 크롭 → 슬롯 채워짐
- [ ] 모든 슬롯 채워지면 "콜라주 만들기" 버튼 활성화된다
- [ ] Safari iOS에서 이미지 업로드 후 WebP/JPEG 변환이 정상 동작한다 (콘솔 에러 없음)

### 미리보기 화면
- [ ] 미리보기 화면 진입 시 콜라주 카드가 정상 렌더된다
- [ ] 배경색 변경이 카드에 즉시 반영된다
- [ ] "제출하기" 버튼 탭 시 진행 단계 라벨이 표시된다 (예: "글자 업로드 중 1/N")
- [ ] 제출 완료 후 "제출 완료!" 상태 UI가 표시된다
- [ ] 제출 완료 후 콜라주 signed URL 이미지가 썸네일로 표시된다
- [ ] Safari iOS에서 JPEG 폴백으로 글자 이미지 업로드가 성공한다
- [ ] 네트워크 오류 시 에러 메시지 표시 + 같은 "제출하기" 버튼으로 재시도 가능하다
- [ ] "저장하기" 버튼으로 콜라주 PNG를 저장할 수 있다

### 인증 / 보호 라우트
- [ ] 미로그인 상태에서 `/` 접근 시 `/login`으로 redirect된다
- [ ] 미로그인 상태에서 `/challenge/[id]` 접근 시 `/login`으로 redirect된다

### TanStack Query 캐시 동작
- [ ] 홈 → 수집 화면 이동 시 챌린지 데이터 재요청 없음 (캐시 재사용)
- [ ] 제출 완료 후 브라우저 탭 포커스 전환 시 submission 상세 자동 갱신
- [ ] DevTools(개발 빌드)에서 캐시 상태 확인 가능

---

## 커밋 가능 여부

**조건부 가능 (Critical 0건 · High 0건 · Medium 3건 — 모두 즉시 수정 불필요)**

Medium 이슈 3건 모두 기존 설계 결정과 일치하거나(M2: Phase 3 cleanup 이관), 동작에 영향 없거나(M1: 상태 코드 문서화), v5 공식 문서로 보증되는 사항(M3: devtools production no-op)이다.

- `pnpm lint`: 오류 없음
- `pnpm type-check`: 오류 없음
- `pnpm test:run`: 9파일 127케이스 전체 통과
- 사용자 E2E (GitHub issue #34) 완료 후 최종 커밋 진행 권장

---

## 게이트 B 최종 판정 (메인 세션 기록, 2026-06-12)

사용자 E2E (GitHub issue #34) 결과:

- **완료**: 1-1~1-6(핵심 플로우·Storage), 2-1(재제출 멱등), 3-1~3-3(엣지·PNG 회귀), 4-1·4-2(권한, curl), 5-2(WebP 경로), 6-1·6-2(콘솔·캐시)
- **스킵(사용자 결정)**: 5-1 iOS 실기기 JPEG 폴백 — 단위 테스트(C16~C20)·정적 리뷰로 갈음. **잔여 리스크**: 실기기 Safari에서 toBlob JPEG 폴백·업로드 경로 미실증 → Day 5 검증 또는 배포 전 실기기 확인 권장. 2-2 오프라인 재시도(선택 항목) 스킵
- **6-1 참고 판정**: 재제출 시 콘솔에 `POST /api/submissions` 409 네트워크 로그 1줄 — A2 create-or-get의 **설계된 응답**(C10·C11 검증 경로)을 브라우저가 자동 출력한 것으로, 미처리 에러 아님. 통과 판정

**게이트 B 통과 확정** (QA 리포트 Critical 0 · High 0 + E2E 완료, 사용자 확인 2026-06-12) → 게이트 C(학습) 진행.
