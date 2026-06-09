# Phase 2 Day 4 — QA 리뷰

> 검토 일시: 2026-06-09
> 검토 범위: 제출 완성 API 3종 + Day 3 이월 정리
>   - A3 `GET /api/submissions/[id]` (상세 조회 + signed URL)
>   - A6 `POST /api/submissions/[id]/collage` (콜라주 업로드)
>   - A4 `PATCH /api/submissions/[id]` (status 완성 전이 / is_public 토글)
>   - 이월 정리: getKSTDateString 공유 유틸, errors.ts server-only, SubmissionConflictBody 전용 타입, seed 06-30까지 연장
> 검증 방식: 정적 코드 리뷰 + 라이브 엔드포인트(localhost:3102, pnpm dev) + 툴체인 실행
> 환경 상태: 이 worktree의 `.env.local`이 구 키명(`NEXT_PUBLIC_SUPABASE_ANON_KEY`)으로 설정되어
>   Supabase Auth 초기화 실패 → 인증 의존 엔드포인트 비인증 요청 시 401 대신 500 반환.
>   코드 버그 아님, 환경 설정 이슈. 아래 H1에 기록. 인증 경로 검증은 코드 추적 + 사용자 E2E 위임.

---

## 툴체인 결과

| 명령 | 결과 | 비고 |
|------|------|------|
| `pnpm lint` | PASS | 0 오류, 0 경고 |
| `pnpm type-check` | PASS | 0 오류 |
| `pnpm test:run` | PASS | 6 파일, 105 테스트 전체 통과 |
| `pnpm build` | PASS | 신규 라우트 3개(`/api/submissions/[id]`, `/api/submissions/[id]/collage` + 기존 `[id]/letters`) 동적 라우트로 인식. `ƒ Proxy (Middleware)` 확인 |

---

## Day 4 합격 기준 판정

| # | 합격 기준 | 판정 | 근거 |
|---|----------|------|------|
| ① | 툴체인 green (lint/type-check/test:run/build) | PASS | 전항목 0 오류 |
| ② | Day 3 이월 정리 4건 완료 | PASS | getKSTDateString 공유화, errors.ts server-only, SubmissionConflictBody 타입, seed 06-30 연장 (코드 추적 + 라이브 /today 200) |
| ③ | GET /api/submissions/[id] — auth→id→visibility 검사 순서, letter_pieces 소유자만, collage 서명 URL | PASS(코드 추적) | 정적 검증. 실제 Supabase Auth 동작은 사용자 E2E 위임 |
| ④ | POST /api/submissions/[id]/collage — draft-only, PNG≤2MB, Storage upsert + DB 갱신 | PASS(코드 추적) | 정적 검증. 실 업로드는 사용자 E2E 위임 |
| ⑤ | PATCH — completed 전이 전제(슬롯+콜라주), completed_at 세팅, is_public 토글, hidden 차단 | PASS(코드 추적) | 정적 검증. zod로 status 역전 차단 확인 |
| ⑥ | 검사 순서 401→404→409 일관성 (3개 라우트 모두) | PASS | 코드 추적 — GET L20-44, PATCH L96-115, collage L20-41 |
| ⑦ | 타인 비공개 → 404 존재 은폐 | PASS | 코드 추적 — GET: `!submission || (!isOwner && !isPublicCompleted)` → 404 |
| ⑧ | 잘못된 UUID → 404 존재 은폐(auth 통과 후) | PASS | 코드 추적 — 3개 라우트 모두 auth 직후 submissionIdSchema.safeParse 실패 → 404 |
| ⑨ | 비인증 → 401 | PARTIAL — 코드 추적 PASS, 라이브 500 | .env.local 키명 불일치로 Supabase 초기화 실패. 코드 경로는 auth 첫 번째 가드로 올바름. 사용자 E2E 필요 |
| ⑩ | serialize.ts — collage_image_url 원시 경로 미노출 | PASS | 코드 추적 — serializeSubmission에서 collage_image_url 제외 확인 |
| ⑪ | letter_pieces — image_url 원시 경로 미노출 | PASS | 코드 추적 — GET L68-80: p.image_url로 signed URL 생성, 응답의 image_url 값은 signed URL |
| ⑫ | seed 재실행 완료 (challenges total=36, 2026-06-09 포함) | PASS | 라이브 `/api/challenges/today` → `{"sentence":"고마운 하루","active_date":"2026-06-09"}` 200 |

---

## QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|----------|
| C01 | 툴체인 green (lint/type-check/test:run/build) | PASS | 실행 결과 |
| C02 | getKSTDateString — @/lib/utils/date 단일 소스 추출 | PASS | 코드 추적 — date.ts 신규, today/route.ts + submissions/route.ts 모두 import '@/lib/utils/date' |
| C03 | challenges.ts — @/lib/utils/date에서 re-export (기존 import 경로 호환) | PASS | 코드 추적 — L3: `import { getKSTDateString } from "@/lib/utils/date"`, L6: `export { getKSTDateString }` |
| C04 | errors.ts — import 'server-only' 가드 추가 (Day 3 L1 처리) | PASS | 코드 추적 — errors.ts L3: `import 'server-only'` |
| C05 | SubmissionConflictBody 전용 타입 정의 (Day 3 M2 처리) | PASS | 코드 추적 — errors.ts L39-50: `SubmissionConflictBody = ApiErrorBody & { submission: Submission \| null }` |
| C06 | submissionConflict() 헬퍼 — SubmissionConflictBody 타입으로 409 반환 | PASS | 코드 추적 — errors.ts L43-50 |
| C07 | signed-url.ts — server-only 가드 | PASS | 코드 추적 — signed-url.ts L5: `import 'server-only'` |
| C08 | serialize.ts — collage_image_url 제외 | PASS | 코드 추적 — serialize.ts에 collage_image_url 없음 (id/user_id/challenge_id/status/is_public/created_at/completed_at만) |
| C09 | seed 날짜 범위 2026-06-30까지 연장 | PASS | 코드 추적 — EXTRA_ROWS 마지막 항목 `'2026-06-30'` |
| C10 | seed: 오늘(2026-06-09) 포함 | PASS | 라이브 확인 — `/api/challenges/today` 200, `active_date: "2026-06-09"` |
| C11 | seed total = 36 (MOCK 10 + EXTRA 26) | PASS | 코드 추적 — MOCK_ROWS(10) + EXTRA_ROWS(26 = 06-05~06-30) |
| C12 | GET route — runtime='nodejs' 명시 | PASS | 코드 추적 — [id]/route.ts L13: `export const runtime = 'nodejs'` |
| C13 | collage route — runtime='nodejs' 명시 | PASS | 코드 추적 — collage/route.ts L13: `export const runtime = 'nodejs'` |
| C14 | GET — auth 가드 최우선 (L20-22) | PASS | 코드 추적 — L18: createClient, L19: getAuthUser(supabase), L21: 401 반환 |
| C15 | GET — invalid UUID → 404 존재 은폐 (auth 통과 후) | PASS | 코드 추적 — L25-29: submissionIdSchema.safeParse 실패 → 404 |
| C16 | GET — 본인=모든 상태 조회 가능 | PASS | 코드 추적 — L40: `isOwner = submission.user_id === user.id` → visibility 체크 통과 |
| C17 | GET — 타인 비공개 → 404 존재 은폐 | PASS | 코드 추적 — L43: `!isOwner && !isPublicCompleted` → 404 |
| C18 | GET — 타인 공개완성 → 200 (letter_pieces=[]) | PASS | 코드 추적 — L61-83: `isOwner` false → pieces = [] |
| C19 | GET — letter_pieces는 소유자에게만 signed URL 포함 | PASS | 코드 추적 — L61: `const pieces = isOwner ? await Promise.all(...) : []` |
| C20 | GET — collage signed URL — 소유자+공개 모두 반환 | PASS | 코드 추적 — L49-56: isOwner/isPublicCompleted 구분 없이 collage_image_url 있으면 서명 |
| C21 | GET — letter_pieces 응답에 버킷 내 원시 경로(image_url) 미포함 | PASS | 코드 추적 — L68-80: p.image_url 인자로 createSignedUrl 호출, 응답 image_url = signed URL |
| C22 | collage POST — auth 가드 최우선 | PASS | 코드 추적 — collage/route.ts L19-22 |
| C23 | collage POST — invalid UUID → 404 존재 은폐 | PASS | 코드 추적 — collage/route.ts L26-30 |
| C24 | collage POST — 타인 submission → 404 (getOwnedSubmission) | PASS | 코드 추적 — L34-37: getOwnedSubmission → null → 404 |
| C25 | collage POST — draft 아닌 submission → 409 SUBMISSION_NOT_DRAFT | PASS | 코드 추적 — L39-41: `status !== 'draft'` → 409 (completed, hidden 모두 차단) |
| C26 | collage POST — image 없음 → 400 IMAGE_REQUIRED | PASS | 코드 추적 — L51-53: `!(image instanceof File)` → 400 |
| C27 | collage POST — PNG 아닌 파일 → 400 INVALID_IMAGE_TYPE | PASS | 코드 추적 — validateCollageImage: `file.type !== 'image/png'` → 400 |
| C28 | collage POST — 2MB 초과 → 413 IMAGE_TOO_LARGE | PASS | 코드 추적 — validateCollageImage: `file.size > 2097152` → 413 |
| C29 | collage POST — Storage 경로 user.id 기반 (타인 경로 업로드 원천 불가) | PASS | 코드 추적 — L62: `path = \`${user.id}/${submissionId}/collage.png\`` |
| C30 | collage POST — DB UPDATE 실패 → 500 PERSIST_FAILED + path 로깅 | PASS | 코드 추적 — L82-83: try/catch → `console.error(path)` + `jsonError(500, 'PERSIST_FAILED')` |
| C31 | collage POST — 응답에 collage_url (signed URL) 포함 | PASS | 코드 추적 — L91-93: createSignedUrl(supabase, 'collages', path, EDIT) |
| C32 | PATCH — auth 가드 최우선 | PASS | 코드 추적 — route.ts L96-99 |
| C33 | PATCH — invalid UUID → 404 존재 은폐 | PASS | 코드 추적 — L102-105 |
| C34 | PATCH — 타인 submission → 404 (getOwnedSubmission) | PASS | 코드 추적 — L109-111 |
| C35 | PATCH — hidden submission → 409 SUBMISSION_HIDDEN | PASS | 코드 추적 — L113-115: `status === 'hidden'` → 409 |
| C36 | PATCH — 빈 바디 {} → 400 VALIDATION_ERROR (zod refine) | PASS | 코드 추적 — updateSubmissionSchema refine: status/is_public 둘 다 undefined → 400 |
| C37 | PATCH — status='draft' 요청 → 400 (zod literal 차단) | PASS | 코드 추적 — `z.literal('completed')` → 'draft' 불일치 → 400 |
| C38 | PATCH — status='hidden' 요청 → 400 (zod literal 차단) | PASS | 코드 추적 — `z.literal('completed')` → 'hidden' 불일치 → 400 |
| C39 | PATCH — draft→completed 전이 전제: 슬롯수 == letters.length | PASS | 코드 추적 — L154: `pieceCount !== challenge.letters.length` → 409 SUBMISSION_INCOMPLETE |
| C40 | PATCH — draft→completed 전제: collage_image_url 존재 | PASS | 코드 추적 — L155: `submission.collage_image_url === null` → 409 SUBMISSION_INCOMPLETE |
| C41 | PATCH — completed_at 세팅 | PASS | 코드 추적 — L162: `updates.completed_at = sql\`now()\`` |
| C42 | PATCH — 이미 completed에 status='completed' → idempotent (현재 상태 반환) | PASS | 코드 추적 — L140: `submission.status === 'draft'` → false → updates에 status 미추가 → updates={} → L167 현재 상태 반환 |
| C43 | PATCH — completed에서 is_public 토글 가능 | PASS | 코드 추적 — L133: is_public 있으면 updates에 추가, L170 UPDATE: status!='hidden' 조건만 → completed 통과 |
| C44 | PATCH — 조건부 UPDATE WHERE 소유권+non-hidden (TOCTOU 방어) | PASS | 코드 추적 — L173-179: WHERE id AND user_id AND status!='hidden' |
| C45 | PATCH — UPDATE 0행 (경합) → 404 | PASS | 코드 추적 — L182-184: `!updated` → 404 |
| C46 | TOCTOU 비원자성 코드 주석 명시 | PASS | 코드 추적 — route.ts L158-160: "삭제 API 도입 시 원자화" 명시 |
| C47 | collage POST — upsert: true — INSERT 정책으로 처리됨 | PASS | Storage SDK 분석 — upload()=uploadOrUpdate('POST',...): HTTP POST + x-upsert 헤더, INSERT 정책으로 처리, UPDATE 정책 불필요 |
| C48 | signed URL TTL: EDIT=1h, SHARE=24h | PASS | 코드 추적 — signed-url.ts SIGNED_URL_TTL.EDIT=3600, SHARE=86400 |
| C49 | GET/PATCH/collage — 비인증 → 401 (코드 추적) | PASS(코드 추적) | auth 가드 최우선 + getAuthUser → null → jsonError(401). 라이브는 H1 이슈로 500 반환 중 |
| C50 | createSignedUrl — server-only + 요청자 JWT 클라이언트로 서명 | PASS | 코드 추적 — signed-url.ts: server-only 가드, supabase param은 요청자 createClient() 인스턴스 |
| C51 | collage 업로드 후 signed URL 응답 — 원시 경로 미노출 | PASS | 코드 추적 — collage/route.ts L93: serializeSubmission(updated)(원시 경로 제외) + collage_url(signed URL) |

---

## 라이브 엔드포인트 검증 결과

dev 서버(`http://localhost:3102`) 실행 상태에서 검증.

| 경로 | 메서드 | 인증 | 예상 | 실제 | 비고 |
|------|--------|------|------|------|------|
| `/api/challenges/today` | GET | 비인증 | 200 | PASS | `{"id":"e2bc4f62...","sentence":"고마운 하루","active_date":"2026-06-09"}` |
| `/api/submissions/[valid-uuid]` | GET | 비인증 | 401 | FAIL(500) | H1: .env.local 키명 불일치로 Supabase 초기화 실패. 코드 경로는 정상 |
| `/api/submissions/[valid-uuid]` | PATCH | 비인증 | 401 | FAIL(500) | H1 동일 |
| `/api/submissions/[valid-uuid]/collage` | POST | 비인증 | 401 | FAIL(500) | H1 동일 |
| `/api/submissions` | POST | 비인증 | 401 | FAIL(500) | H1 동일 (Day 3 기존 라우트도 영향) |

**참고**: `/api/challenges/today`는 Drizzle만 사용하고 Supabase Auth 불필요하여 200 정상 반환됨.

---

## 이슈 목록

### Critical (커밋 차단)

없음.

---

### High

#### H1: .env.local 구 키명 — Supabase Auth 초기화 실패로 비인증 라이브 검증 불가

**현상**: 이 worktree의 `.env.local`에 `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (구 키명)가 설정되어 있다. 코드에서는 Day 2 게이트 A 결정 (a)에 따라 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` (신규 키명)를 참조한다. 결과적으로 `createServerClient(url, undefined!)` 형태로 초기화되어 Supabase Auth에 의존하는 모든 엔드포인트에서 500이 반환된다.

**영향**: 라이브 엔드포인트 비인증 검증 불가. 코드 자체의 버그가 아니므로 로직 정확성은 코드 추적으로 확인됨.

**판정 근거**: `.env.local`은 gitignored라 자동 업데이트 없음. 사용자가 수동으로 키명을 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`로 변경해야 한다. Day 2 QA 당시에는 `.env.local.example`과 코드 일치가 확인됐으나, 이 worktree의 `.env.local`은 그 이전 상태로 남아 있다.

**조치**: 커밋 차단 사유 아님. 사용자가 `.env.local`을 `.env.local.example` 기준으로 업데이트하면 해결됨:
```
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<기존 ANON_KEY 값>
SUPABASE_SECRET_KEY=<기존 SERVICE_ROLE_KEY 값>
```

---

### Medium

#### M1: collage POST — Storage upsert + DB UPDATE 비원자성 (Day 3 §8.3-3과 동일 패턴)

**현상**: collage route.ts L64-88: Storage 업로드 성공 후 DB UPDATE 실패 시 고아 파일이 남는다. 실패 시 path 로깅으로 추적 가능하도록 처리됨.

**영향**: 같은 경로로 재업로드 시 덮어써지므로 파일 손상 없음. 단, 스토리지 사용량 누적 가능성 있음.

**판정 근거**: letters 업로드와 동일 패턴이며 Day 3 §8.3-3에 이미 기록된 리스크. 삭제 cleanup 잡 이관으로 충분.

**커밋 차단 여부**: 차단 아님.

---

#### M2: GET response — letter_pieces의 image_url 필드가 signed URL인지 null인지 클라이언트 구분 필요

**현상**: GET route L75에서 `image_url: await createSignedUrl(...)` — Storage 정책 거부 시 null이 반환된다. 응답 타입에 `image_url: string | null`이 명시되어 있지 않다. Phase 4.5 클라이언트 연결 시 null 처리 필요.

**영향**: 런타임 타입 불명확. 소유자 정상 경로에서는 null 반환이 없으므로 MVP에서 기능 영향 없음.

**커밋 차단 여부**: 차단 아님. Day 4.5 클라이언트 연결 시 처리 권장.

---

### Low

#### L1: server.ts — server-only 가드 없음 (Day 2 이관 유지)

Day 2 QA L1에서 이관된 이슈. `next/headers`(`cookies()`) 의존으로 실질 보호는 됨. Day 4에서 처리 결정 없음 → 이관 유지.

#### L2: PATCH — hidden submission을 소유자가 수정 시도 시 409 반환 (403 아님)

**현상**: PATCH route L113-115: `submission.status === 'hidden'` → 409 SUBMISSION_HIDDEN. 설계 §7.4에서 409는 "충돌" 코드다. hidden은 소유자라도 수정 불가한 상태 제약이라 409(상태 충돌)가 맞는 선택이나, 외부 문서에서 명시적으로 "hidden → 409"를 기술하지 않는다.

**영향**: 클라이언트가 에러 코드를 파싱해 UI를 제어할 때 명시적인 코드(`SUBMISSION_HIDDEN`)로 구분 가능하므로 실제 영향 없음.

**커밋 차단 여부**: 차단 아님.

---

## 인증/권한 검증 시나리오 정리 (코드 추적)

| 시나리오 | 예상 응답 | 코드 추적 결과 |
|----------|----------|--------------|
| 비인증 → GET /api/submissions/[id] | 401 | L19: getAuthUser(supabase) → null → jsonError(401) |
| 비인증 → PATCH /api/submissions/[id] | 401 | L95: getAuthUser() → null → jsonError(401) |
| 비인증 → POST /api/submissions/[id]/collage | 401 | L20: getAuthUser(supabase) → null → jsonError(401) |
| 잘못된 UUID → GET/PATCH/collage | 401→404 (auth 통과 후) | auth → submissionIdSchema.safeParse 실패 → jsonError(404) |
| 인증 + 타인 비공개 submission GET | 404 | L40-45: isOwner=false, isPublicCompleted=false → jsonError(404) |
| 인증 + 타인 공개완성 submission GET | 200, letter_pieces=[] | L61: isOwner=false → pieces=[] |
| 인증 + 타인 submission PATCH | 404 | L109-111: getOwnedSubmission → null → jsonError(404) |
| 인증 + 타인 submission collage POST | 404 | L34-37: getOwnedSubmission → null → jsonError(404) |
| 인증 + hidden submission PATCH | 409 SUBMISSION_HIDDEN | L113-115 |
| 인증 + hidden submission GET (소유자) | 200 | L40: isOwner=true → visibility 통과 |
| 인증 + completed submission collage POST | 409 SUBMISSION_NOT_DRAFT | L39-41: status!='draft' → 409 |
| 인증 + hidden submission collage POST | 409 SUBMISSION_NOT_DRAFT | L39-41: status!='draft' (hidden도 해당) → 409 |
| 인증 + 미완성 submission PATCH completed | 409 SUBMISSION_INCOMPLETE | L155: pieceCount 불일치 or collage null → 409 |
| 인증 + status='draft' PATCH | 400 VALIDATION_ERROR | zod: z.literal('completed') 불일치 → 400 |
| 인증 + 빈 바디 {} PATCH | 400 VALIDATION_ERROR | zod: refine(status||is_public 필요) → 400 |
| 인증 + PNG>2MB collage | 413 IMAGE_TOO_LARGE | validateCollageImage → 413 |
| 인증 + PNG 아닌 이미지 collage | 400 INVALID_IMAGE_TYPE | validateCollageImage → 400 |

> **주의**: 인증이 필요한 시나리오(401 제외 경로)는 모두 코드 추적 결과다. H1 이슈(env 키명 불일치)로 인해 라이브 검증 불가. 사용자 모바일 E2E로 위임.

---

## signed URL 보안 분석

| 항목 | 분석 결과 | 검증 방법 |
|------|----------|----------|
| letter-pieces signed URL — 소유자만 | createSignedUrl(supabase, 'letter-pieces', path, ttl): 요청자 JWT client로 서명 → Storage 정책 `letter_pieces_read` (foldername[1]=auth.uid()) 적용. 타인 경로 서명 시도 → 정책 거부 → null 반환 | 코드 추적 + 런타임 E2E 필요 |
| collages signed URL — 소유자+공개완성 | `collages_read` 정책: 본인이거나 completed+public 제출. GET route에서 비공개 타인 submission은 DB 레벨에서 404로 사전 차단 → 서명 시도 자체 없음 | 코드 추적 + 런타임 E2E 필요 |
| 원시 경로 미노출 | serialize.ts에서 collage_image_url 제외, letter_pieces 응답에 signed URL만 | 코드 추적 PASS |
| collages_read 정책 (storage.foldername(name))[2]::UUID | 서버가 경로를 UUID로 구성하므로 정상 업로드 경로에서 캐스팅 실패 없음. 악의적 조작은 Storage 정책 + DB 소유권 체크 이중 방어 | 코드 추적 + 런타임 E2E 필요 |

**런타임 E2E 필요 항목 요약**:
1. createSignedUrl이 타인 letter-pieces 경로에 대해 null을 반환하는지 (Storage 정책 강제 여부)
2. 타인 비공개 collage에 대한 signed URL이 null인지 (collages_read 정책 동작)
3. (storage.foldername(name))[2]::UUID 캐스팅이 실제 collage 접근 시 동작하는지

---

## 사용자 수동 테스트 체크리스트 (모바일 브라우저, iPhone 14 기준)

### 환경 설정 선행 작업 (필수)

- [ ] `.env.local`에서 `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`로 키명 변경 (값은 동일)
- [ ] `.env.local`에서 `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`로 키명 변경 (값은 동일)
- [ ] `pnpm dev` 재시작 후 `/api/challenges/today` 200 확인

### 비인증 401 확인 (필수)

- [ ] 비로그인 상태 → GET `/api/submissions/[valid-uuid]` → `{"error":"로그인이 필요합니다.","code":"UNAUTHORIZED"}` 401 반환 확인
- [ ] 비로그인 상태 → PATCH `/api/submissions/[valid-uuid]` `{"is_public":false}` → 401 반환 확인
- [ ] 비로그인 상태 → POST `/api/submissions/[valid-uuid]/collage` → 401 반환 확인

### 권한 검증 시나리오 (필수)

- [ ] (1) 타인 비공개 submission GET → 404 SUBMISSION_NOT_FOUND 반환 (존재 은폐)
- [ ] (2) 타인 공개완성 submission GET → 200, letter_pieces=[], collage_url 있음 (공개 콜라주 접근)
- [ ] (3) 본인 비공개 draft submission GET → 200, letter_pieces=signed URLs 포함
- [ ] (4) 미완성 submission PATCH `{"status":"completed"}` → 409 SUBMISSION_INCOMPLETE 반환
- [ ] (5) 콜라주 없는 submission PATCH `{"status":"completed"}` → 409 SUBMISSION_INCOMPLETE 반환
- [ ] (6) completed submission에 POST collage → 409 SUBMISSION_NOT_DRAFT 반환

### 정상 플로우 (필수)

- [ ] Google 로그인 완료 후 → POST /api/submissions으로 draft 생성 → 201 확인
- [ ] draft submission에 PNG≤2MB FormData POST `/collage` → 200 + collage_url(signed URL) 반환 확인
- [ ] Supabase Dashboard → collages 버킷 → `{user_id}/{submission_id}/collage.png` 파일 존재 확인
- [ ] 모든 글자 업로드 + 콜라주 업로드 완료 후 → PATCH `{"status":"completed"}` → 200, status='completed', completed_at 존재 확인
- [ ] completed submission → GET → letter_pieces 빈 배열 아님, collage_url signed URL 반환 확인
- [ ] completed submission PATCH `{"is_public":false}` → 200, is_public=false 확인

### signed URL 보안 E2E (필수)

- [ ] 본인 letter-pieces signed URL로 이미지 접근 → 정상 로드됨
- [ ] (Storage 정책 테스트) 타인 user_id 경로를 createSignedUrl로 시도 → null 반환됨 (Supabase Dashboard Storage 정책 테스트 탭 활용)
- [ ] 비공개 draft submission의 collage signed URL로 다른 계정에서 접근 → 404/403 반환 확인

### zod 검증

- [ ] POST collage에 PNG 아닌 파일(webp) 전송 → 400 INVALID_IMAGE_TYPE 확인
- [ ] POST collage에 2MB 초과 PNG 전송 → 413 IMAGE_TOO_LARGE 확인
- [ ] PATCH에 `{"status":"draft"}` 전송 → 400 VALIDATION_ERROR 확인
- [ ] PATCH에 빈 바디 `{}` 전송 → 400 VALIDATION_ERROR 확인
- [ ] PATCH에 `{"status":"hidden"}` 전송 → 400 VALIDATION_ERROR 확인

### collages 정책 런타임 검증 (E2E 위임)

- [ ] 타인 비공개 submission의 collage에 대한 signed URL이 null인지 확인
- [ ] 타인 공개완성 submission의 collage에 대한 signed URL이 유효한지 확인
- [ ] (storage.foldername(name))[2]::UUID 캐스팅이 실제 공개 콜라주 접근 시 동작하는지 확인

---

## Day 3 이월 처리 현황 최종 확인

| 이월 항목 | 처리 여부 | 근거 |
|-----------|----------|------|
| M1: getKSTDateString 공유화 | DONE | `src/lib/utils/date.ts` 신규 추출, today/route + submissions/route 모두 `@/lib/utils/date` import |
| M2: 409 SUBMISSION_EXISTS 타입 정합 | DONE | `SubmissionConflictBody = ApiErrorBody & { submission: Submission \| null }` 정의 + submissionConflict() 헬퍼 |
| L1: errors.ts server-only 가드 | DONE | `import 'server-only'` 추가 (L3) |
| L2: seed 날짜 범위 연장 | DONE | EXTRA_ROWS 2026-06-30까지, challenges total=36, 재실행 완료 |
| Day2-L1: server.ts server-only 가드 | NOT DONE | 이관 유지 — `next/headers` 의존으로 실질 보호됨. Day 5로 이관 |
| Day2-M1: login.tsx redirectTo → NEXT_PUBLIC_APP_URL | NOT DONE | 이관 유지 — 배포 전 필수. Day 5로 이관 |

---

## 중점 확인 항목 최종 판정

| 중점 항목 | 판정 | 근거 |
|-----------|------|------|
| signed URL 노출 범위 — createSignedUrl이 Storage 정책을 강제하는지 | E2E 확인 필요 | 코드 추적: 요청자 JWT client로 서명, 정책 거부 시 null 반환 설계. 실제 Storage 정책 동작은 런타임만 확인 가능 |
| 404 존재 은폐 일관성 (잘못된 형식 id 포함) | PASS | 3개 라우트 모두 auth 직후 submissionIdSchema.safeParse 실패 → 404 통일 |
| 검사 순서 401→404→409 | PASS | GET/PATCH/collage 모두 auth(401)→id(404)→소유권/가시성(404)→상태(409) 순서 |
| count == letters.length 완성도 판정 | PASS | Drizzle count()·letters.length 비교. type-check PASS로 타입 안전 확인. UNIQUE (submission_id, slot_index) 불변식으로 count=length면 모든 슬롯 충족 |
| 완성도-UPDATE 비원자(TOCTOU) | PASS (설계 인식) | 코드 주석 L158-160에 "삭제 API 없어 실위험 낮음" 명시. Medium으로 이관 |
| collages_read (foldername[2]::UUID) 런타임 동작 | E2E 확인 필요 | 서버가 UUID 기반으로 경로 구성하므로 정상 경로에서 캐스팅 실패 없음. 실제 DB 조인 동작은 런타임만 확인 가능 |

---

## 커밋 가능 여부

**커밋 가능** — Critical 0건, High 1건.

H1(`.env.local` 키명 불일치)은 코드 버그가 아닌 로컬 환경 설정 이슈다. 사용자가 `.env.local`을 `.env.local.example` 기준으로 업데이트하면 즉시 해결된다. 이 이슈는 PR에 포함되는 코드에 있는 문제가 아니므로 커밋을 차단하지 않는다.

툴체인(lint/type-check/test:run/build) 전항목 PASS, Day 3 이월 정리 4건 완료, 검사 순서·존재 은폐·상태 전이 로직이 설계 규약과 일치함을 코드 추적으로 확인했다.

인증 의존 경로의 실제 동작 검증(비인증 401, 타인 접근 404, 완성도 409, signed URL 보안)은 사용자 모바일 E2E로 위임한다. E2E 체크리스트의 "환경 설정 선행 작업" 항목을 완료한 후 진행할 것.

---

## 다음 액션

**커밋 전 사용자 처리**

1. **[H1]** `.env.local` 키명 업데이트: `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`
2. **[필수]** E2E 체크리스트 "환경 설정 선행 작업" 완료 후 비인증 401 라이브 확인

**Day 4.5 작업 시 처리 권장**

3. **[M2]** GET letter_pieces 응답 타입에 `image_url: string | null` 명시
4. **[E2E 이관]** signed URL 보안 3항목 런타임 확인 (createSignedUrl null 반환, collages_read 정책, foldername[2]::UUID 캐스팅)

**Day 5로 이관 유지**

5. **[Day2-L1]** `src/lib/supabase/server.ts` server-only 가드
6. **[Day2-M1]** `login.tsx` redirectTo → `NEXT_PUBLIC_APP_URL` (배포 전 필수)
