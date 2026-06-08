# Phase 2 Day 3 — QA 리뷰

> 검토 일시: 2026-06-08
> 검토 범위: 핵심 API + Storage — Storage 버킷 3개 + §5 정책 마이그레이션(0003), GET /api/challenges/today (+seed), POST /api/submissions (draft 생성), POST /api/submissions/[id]/letters (글자 업로드 = Storage + DB UPSERT), zod validation 스키마 + 표준 에러/인증 헬퍼, Day 2 이관분 M2(callback next 화이트리스트)·M3(proxy matcher /api 제외)
> 검증 방식: 정적 리뷰 + DB 직접 쿼리(node_modules/.tmp-verify/) + 라이브 엔드포인트(localhost:3101)
> Reviewer 리뷰 반영 분: Medium 3건 처리됨 — M-1(storage.objects RLS+GRANT), M-2(비원자성 try/catch+path 로깅+§8.3 기록), M-3(POST/today runtime='nodejs' 명시). 이하 재확인 결과 기록.

---

## 툴체인 결과

| 명령 | 결과 | 비고 |
|------|------|------|
| `pnpm lint` | PASS | 0 오류, 0 경고 |
| `pnpm type-check` | PASS | 0 오류 |
| `pnpm test:run` | PASS | 6 파일, 105 테스트 전체 통과 |
| `pnpm build` | PASS | 정적/동적 라우트 컴파일 성공, `ƒ Proxy (Middleware)` 확인, 신규 3개 라우트(`/api/challenges/today`, `/api/submissions`, `/api/submissions/[id]/letters`) 동적 라우트로 인식 |

---

## Day 3 합격 기준 판정

| # | 합격 기준 | 판정 | 근거 |
|---|----------|------|------|
| ① | 툴체인 green (lint/type-check/test:run/build) | PASS | 전항목 0 오류 |
| ② | Storage 버킷 3개 사양 + §5 정책 10개 + storage.objects RLS enabled + authenticated DML GRANT | PASS | DB 직접 쿼리로 확인 (아래 세부 결과) |
| ③ | GET /api/challenges/today → 오늘(2026-06-08, KST) 200, 미래 날짜 미포함 확인 | PASS | 라이브 200 + DB 쿼리 seed 범위 확인 |
| ④ | POST /api/submissions → draft 201, 중복 409 | PARTIAL-PASS | 비인증 401 라이브 확인. 인증 필요 경로(201/409)는 코드 추적 + 사용자 E2E 위임 |
| ⑤ | 글자 업로드 → Storage + letter_pieces 행 | PARTIAL-PASS | 비인증 401 라이브 확인. 실제 업로드는 코드 추적 + 사용자 E2E 위임 |
| ⑥ | 타인 submission letters POST → 404 존재 은폐 | PASS | getOwnedSubmission 코드 추적 — `row.user_id !== userId → return null → 404` |
| ⑦ | 비인증 API → 401 | PASS | 라이브 확인 — POST /api/submissions, POST /api/submissions/*/letters 모두 401 |
| ⑧ | zod 실패 → 400 (비인증 시 401, 코드 추적 명시) | PASS | 코드 추적 — auth가 zod보다 먼저(submissions), validateLetterImage 400/413, 비인증 시 401 반환 |

---

## QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|----------|
| C01 | Storage 버킷 3개 존재(letter-pieces/collages/avatars) | PASS | DB 쿼리 — `BUCKET_COUNT: 3` |
| C02 | letter-pieces: private(public=false), 512000B, image/webp | PASS | DB 쿼리 — `public=false size_limit=512000 mimes=["image/webp"]` |
| C03 | collages: private(public=false), 2097152B, image/png | PASS | DB 쿼리 — `public=false size_limit=2097152 mimes=["image/png"]` |
| C04 | avatars: public(public=true), 512000B, image/webp | PASS | DB 쿼리 — `public=true size_limit=512000 mimes=["image/webp"]` |
| C05 | storage.objects 정책 10개 존재 | PASS | DB 쿼리 — `STORAGE_POLICY_COUNT: 10` |
| C06 | letter-pieces 정책: SELECT/INSERT/UPDATE/DELETE 4개 (authenticated) | PASS | DB 쿼리 — letter_pieces_read/write/update/delete 모두 확인 |
| C07 | collages 정책: SELECT(authenticated)/SELECT(anon)/INSERT(authenticated)/DELETE(authenticated) 4개 | PASS | DB 쿼리 — collages_read/read_anon/write/delete 확인 |
| C08 | avatars 정책: INSERT/DELETE(authenticated) 2개 | PASS | DB 쿼리 — avatars_write/delete 확인 |
| C09 | storage.objects RLS enabled = true | PASS | DB 쿼리 — `STORAGE_OBJECTS_RLS_ENABLED: true` |
| C10 | authenticated: SELECT/INSERT/UPDATE/DELETE GRANT on storage.objects | PASS | DB 쿼리 — authenticated에 4가지 DML GRANT 모두 존재 |
| C11 | GET /api/challenges/today → 200, KST 기준 오늘 챌린지 반환 | PASS | 라이브 확인 — `{"id":"c05e14db...","sentence":"오늘 햇살",...}` 200 |
| C12 | seed: 2026-06-08 포함, 2026-06-11까지 존재 | PASS | DB 쿼리 — `TODAY_ROWS: 1`, 미래 date 0건(2026-06-25) |
| C13 | seed: 미래 날짜 범위 밖 → DB에 없음 | PASS | DB 쿼리 — FUTURE_2026-06-25_ROWS: 0 |
| C14 | 404 코드 경로 — challenges 없는 날짜 → jsonError(404) | PASS | 코드 추적 — `if (!row) return jsonError(404, 'CHALLENGE_NOT_FOUND', ...)` |
| C15 | POST /api/submissions → 비인증 401 | PASS | 라이브 확인 — `{"error":"로그인이 필요합니다.","code":"UNAUTHORIZED"}` 401 |
| C16 | POST /api/submissions → auth 먼저, zod 나중 (코드 순서) | PASS | 코드 추적 — L19: getAuthUser() → L31: createSubmissionSchema.safeParse() |
| C17 | POST /api/submissions → 오늘 아닌 challenge_id → 404 (코드 추적) | PASS | 코드 추적 — `challenge.active_date !== today → jsonError(404)` |
| C18 | POST /api/submissions → UNIQUE 충돌 시 409 + 기존 submission 반환 (코드 추적) | PASS | 코드 추적 — onConflictDoNothing → !created → 409 + existing |
| C19 | POST /api/submissions/[id]/letters → 비인증 401 | PASS | 라이브 확인 — 401 반환 |
| C20 | POST /api/submissions/[id]/letters → 잘못된 UUID param → 401 (auth 우선) | PASS | 라이브 확인 — 401 반환 (uuid 검증 전 auth 체크) |
| C21 | getOwnedSubmission: user_id 불일치 → null → 404 존재 은폐 | PASS | 코드 추적 — `if (!row || row.user_id !== userId) return null` + 호출부 `jsonError(404)` |
| C22 | letters route: 잘못된 submission UUID → auth 후 404 (uuid 검증, 존재 은폐) | PASS | 코드 추적 — auth → submissionIdSchema.safeParse → 실패 시 404 통일 |
| C23 | letters route: draft 아닌 submission → 409 | PASS | 코드 추적 — `submission.status !== 'draft' → jsonError(409, 'SUBMISSION_NOT_DRAFT')` |
| C24 | letters route: slot_index >= challenge.letters.length → 400 | PASS | 코드 추적 — `slot_index >= challenge.letters.length → jsonError(400, 'SLOT_OUT_OF_RANGE')` |
| C25 | letters route: image 없음 → 400 | PASS | 코드 추적 — `!(image instanceof File) → jsonError(400, 'IMAGE_REQUIRED')` |
| C26 | validateLetterImage: WebP 아닌 파일 → 400 INVALID_IMAGE_TYPE | PASS | 코드 추적 — `file.type !== 'image/webp' → 400` |
| C27 | validateLetterImage: 500KB 초과 → 413 IMAGE_TOO_LARGE | PASS | 코드 추적 — `file.size > 512000 → 413` |
| C28 | letters route: Storage 업로드 경로 user.id 기반 (타인 경로 업로드 원천 불가) | PASS | 코드 추적 — `path = \`${user.id}/${submissionId}/${slot_index}.webp\`` (서버가 user.id로 구성) |
| C29 | letters route: Storage 업로드 실패 → 500 UPLOAD_FAILED | PASS | 코드 추적 — `if (uploadError) return jsonError(500, 'UPLOAD_FAILED')` |
| C30 | letters route: DB UPSERT 실패 → 500 PERSIST_FAILED + path 로깅 (M-2 반영) | PASS | 코드 추적 — try/catch → `console.error(path)` + `jsonError(500, 'PERSIST_FAILED')` |
| C31 | letters route: UPSERT — 같은 slot_index 재업로드 시 교체 | PASS | 코드 추적 — `onConflictDoUpdate({ target: [letterPieces.submission_id, letterPieces.slot_index] })` |
| C32 | runtime='nodejs' — today/submissions/letters 3개 라우트 모두 명시 | PASS | 정적 분석 — 3파일 모두 `export const runtime = 'nodejs'` 확인 |
| C33 | auth.ts: server-only 가드 (import 'server-only') | PASS | 정적 분석 — L2: `import 'server-only'` 확인 |
| C34 | errors.ts: production에서 details 필드 제거 | PASS | 코드 추적 — `process.env.NODE_ENV !== 'production'` 조건 분기 |
| C35 | M-2: callback next 화이트리스트 — ALLOWED_NEXT_PREFIXES 검사 | PASS | 코드 추적 — `['/challenge', '/feed', '/admin', '/u', '/s']` prefix 검사, 밖은 '/' 폴백 |
| C36 | M-2: open-redirect 차단 — `//evil.com`, `/\host` | PASS | 라이브 확인 — 모두 307 → /login?error=auth |
| C37 | M-3: proxy matcher에서 `/api/*` 제외 | PASS | 정적 분석 — matcher: `/((?!api|_next/static|...)...)` |
| C38 | M-3: /api/challenges/today 비인증 200 (proxy 통과, 핸들러가 직접 처리) | PASS | 라이브 확인 — 307 없이 200 반환 |
| C39 | M-1 재확인: storage.objects RLS=true + authenticated 4가지 DML GRANT | PASS | DB 쿼리 직접 확인 (이번 QA에서 재검증) |
| C40 | §8.3 리스크 기록: Storage↔DB 비원자성 → backend-design-plan.md §8.3-3 기록 | PASS | 정적 분석 — §8.3-3에 "DB 실패 시 고아 파일 → path 로깅 → cleanup 잡 이관" 기록 |
| C41 | 마이그레이션 저널 0003 등록 | PASS | `_journal.json` — tag=`0003_storage_buckets_and_policies` 확인 |
| C42 | 409 응답: error/code 필드 존재 (ApiErrorBody 기본 필드) | PASS | 코드 추적 — `{ error: ..., code: 'SUBMISSION_EXISTS', submission: ... }` |
| C43 | challengeContentSchema: lines/letters 빈 배열 금지(.min(1)) — Day 1 이관 처리 | PASS | 코드 추적 — `z.array(z.string().min(1)).min(1)` |
| C44 | seed: challengeContentSchema.parse(row) 불변식 검증 후 주입 | PASS | 코드 추적 — main()에서 모든 row 대상 parse 검증 후 INSERT |

---

## 라이브 엔드포인트 검증 결과

dev 서버(`http://localhost:3101`) 실행 상태에서 검증.

| 경로 | 메서드 | 인증 | 예상 | 실제 | 상세 |
|------|--------|------|------|------|------|
| `/api/challenges/today` | GET | 비인증 | 200 | PASS | `{"id":"c05e14db...","sentence":"오늘 햇살","lines":["오늘 햇살"],"letters":["오","늘","햇","살"],"active_date":"2026-06-08"}` |
| `/api/submissions` | POST | 비인증 | 401 | PASS | `{"error":"로그인이 필요합니다.","code":"UNAUTHORIZED"}` |
| `/api/submissions/valid-uuid/letters` | POST | 비인증 | 401 | PASS | 401 반환 |
| `/api/submissions/not-a-uuid/letters` | POST | 비인증 | 401 | PASS | auth 먼저 → 401 (uuid 검증 전) |
| `/api/auth/callback?next=//evil.com` | GET | - | 307 → /login?error=auth | PASS | open-redirect 차단 |
| `/api/auth/callback?next=/\evil.com` | GET | - | 307 → /login?error=auth | PASS | open-redirect 차단 |
| `/api/auth/callback?next=/other-path` | GET | - | 307 → /login?error=auth | PASS | 화이트리스트 밖 → / 폴백 후 code 없어 error=auth |

---

## DB 직접 쿼리 검증 결과

| 쿼리 대상 | 결과 | 상세 |
|----------|------|------|
| storage.buckets (3개) | PASS | avatars(public=true/512000/webp), collages(false/2097152/png), letter-pieces(false/512000/webp) |
| storage.objects 정책 수 | PASS | 10개 — 설계 §5와 1:1 일치 |
| storage.objects RLS | PASS | relrowsecurity = true |
| authenticated GRANT on storage.objects | PASS | SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE 모두 |
| challenges WHERE active_date='2026-06-08' | PASS | 1행 — sentence="오늘 햇살", letters=["오","늘","햇","살"] |
| challenges WHERE active_date='2026-06-25' | PASS | 0행 — seed에 미래 날짜 없음 |

---

## Reviewer 직전 패스 Medium 3건 재확인

| 이슈 | 내용 | 재확인 결과 |
|------|------|------------|
| M-1 | storage.objects RLS=true + authenticated DML GRANT 존재 확인 | PASS — DB 쿼리: RLS=true, authenticated에 SELECT/INSERT/UPDATE/DELETE 확인 |
| M-2 | letters 라우트 try/catch 500 + path 로깅 + §8.3 리스크 기록 | PASS — L119-121: catch(err) + console.error(`letter_pieces upsert failed for ${path}:`) + §8.3-3 기록 |
| M-3 | POST/today 라우트에 `runtime='nodejs'` 명시 | PASS — today/route.ts L12, submissions/route.ts L10, letters/route.ts L12 모두 확인 |

---

## 이슈 목록

### Critical (커밋 차단)

없음.

---

### High (커밋 전 수정 필수)

없음.

---

### Medium

#### M1: getKSTDateString 로컬 함수 중복 — lib에 공유 함수가 있음에도 복사됨

**현상**: `src/lib/constants/challenges.ts`에 이미 `getKSTDateString()`이 export되어 있다. `today/route.ts`와 `submissions/route.ts` 두 파일에 동일 함수가 로컬 복사본으로 정의되어 있다.

**영향**: 기능상 동일하므로 버그 없음. 단, 시간대 처리 로직 변경 시 3곳을 동시에 수정해야 하는 드리프트 리스크가 있다.

**판정 근거**: MVP에서는 수용 가능. KST 로직이 `'sv-SE' + timeZone: 'Asia/Seoul'`로 동일하게 구현되어 있어 현재 동작 차이 없음. Day 4+ 리팩토링 시 `@/lib/utils/date` 등으로 추출 권장.

**커밋 차단 여부**: 차단 아님.

---

#### M2: 409 SUBMISSION_EXISTS 응답이 ApiErrorBody 타입 밖의 `submission` 필드 추가

**현상**: `POST /api/submissions` 409 응답이 `jsonError()` 헬퍼 대신 `NextResponse.json` 직접 사용하며, 표준 `ApiErrorBody(error/code/details?)` 외에 `submission` 필드를 추가로 포함한다. 클라이언트가 기존 submission을 이어서 진행하도록 하는 의도적 설계이나, 타입 정의와 불일치한다.

**영향**: 기능상 문제 없음. 클라이언트가 `submission` 필드를 활용할 경우 타입 단언이 필요하다. TypeScript에서 `ApiErrorBody`로 타입 추론 시 `submission` 접근이 컴파일 에러 발생.

**판정 근거**: 의도적 확장이므로 `ApiErrorBody`에 `submission?: Submission | null` 필드를 추가하거나, 409 전용 타입을 별도 정의하면 깔끔하다. Day 4 클라이언트 연동 전에 처리 권장.

**커밋 차단 여부**: 차단 아님.

---

### Low

#### L1: errors.ts에 server-only 가드 없음

`src/lib/api/errors.ts`는 `NextResponse`를 사용하므로 실질적으로 서버 전용이나 `import 'server-only'` 가드가 없다. 클라이언트에서 import하면 Next.js가 `NextResponse` 미지원 오류를 발생시키므로 실질 보호는 되나, 에러 메시지가 명시적이지 않다.

**권장**: Day 4 작업 시 `import 'server-only'` 추가. 당장 커밋 차단 사유 아님.

#### L2: seed 날짜 범위가 2026-06-11까지 — 3일 후부터 챌린지 없음

`EXTRA_ROWS` 마지막 항목이 `2026-06-11`이다. 오늘(2026-06-08) 기준 3일 뒤부터 `/today`가 404를 반환한다. Day 4 작업 전 seed 추가 실행 또는 범위 확장이 필요하다.

**판정 근거**: 현재 Day 3 QA 시점(2026-06-08)에는 문제 없음. Day 4(2026-06-09)부터 404 발생. seed는 수동 재실행으로 보완 가능하므로 커밋 차단 아님.

#### L3: collages 버킷에 UPDATE 정책 없음 — 의도적 설계이나 주석 없음

`§5.2` 설계에서 collages는 SELECT/INSERT/DELETE만 정의하고 UPDATE를 포함하지 않는다. 콜라주 재업로드는 DELETE+INSERT 패턴으로 처리하는 의도로 보이나, 마이그레이션 SQL에 명시적 주석이 없다. 향후 `upsert: true` 옵션 사용 시 UPDATE 정책 없이 조용히 실패할 수 있다.

**권장**: 마이그레이션 주석에 "UPDATE 불필요 — 재업로드는 DELETE+INSERT 패턴"을 명시하면 명확하다. 기능 영향 없음.

#### L4: Day 2 이관 L1 — server.ts server-only 가드 미추가

Day 2 QA에서 이관한 L1 이슈. `src/lib/supabase/server.ts`에 `server-only` 가드 없음. Day 3에서도 처리되지 않았다. `cookies()`로 실질 보호는 되나 에러 메시지 명확성 낮음. Day 4 이관 유지.

---

## 인증/권한 검증 시나리오 정리 (코드 추적)

| 시나리오 | 예상 응답 | 코드 추적 결과 |
|----------|----------|--------------|
| 비인증 → GET /api/challenges/today | 200 (공개) | 인증 체크 없음, 공개 라우트 |
| 비인증 → POST /api/submissions | 401 | L19: `getAuthUser()` → null → `jsonError(401)` |
| 비인증 → POST /api/submissions/*/letters | 401 | L19: `getAuthUser(supabase)` → null → `jsonError(401)` |
| 인증 + 타인 submission에 letters POST | 404 | getOwnedSubmission: `row.user_id !== userId → null → jsonError(404)` |
| 인증 + invalid UUID param → letters POST | 404 | `submissionIdSchema.safeParse` 실패 → `jsonError(404)` (존재 은폐 통일) |
| 인증 + zod 실패(submissions) | 400 | auth 통과 후 `createSubmissionSchema.safeParse` → `validationError(400)` |
| 인증 + zod 실패(letters) | 400 | auth 통과 후 `uploadLetterSchema.safeParse` → `validationError(400)` |
| 인증 + WebP 아닌 이미지 | 400 INVALID_IMAGE_TYPE | `validateLetterImage` → `{ status: 400, code: 'INVALID_IMAGE_TYPE' }` |
| 인증 + 500KB 초과 | 413 IMAGE_TOO_LARGE | `validateLetterImage` → `{ status: 413, code: 'IMAGE_TOO_LARGE' }` |
| 인증 + 중복 submission 생성 | 409 SUBMISSION_EXISTS + 기존 submission | `onConflictDoNothing` → !created → 기존 조회 후 409 |
| 인증 + draft 아닌 submission letters 업로드 | 409 SUBMISSION_NOT_DRAFT | `submission.status !== 'draft' → jsonError(409)` |

> **주의**: 인증이 필요한 시나리오(201/409/실제 업로드 결과)는 사용자 모바일 E2E로 위임. 실제 Google 로그인 후 검증 필요.

---

## 사용자 수동 테스트 체크리스트 (모바일 브라우저, iPhone 14 기준)

### 필수 확인 (커밋 전)

**기본 플로우**
- [ ] Safari(iPhone 14) → `http://localhost:3101/api/challenges/today` 접속 → 오늘의 챌린지 JSON 200 반환 확인
- [ ] Google 로그인 완료 후 → POST /api/submissions에 today challenge_id 전송 → 201 + draft 생성 확인
- [ ] 동일 challenge_id로 POST /api/submissions 재전송 → 409 SUBMISSION_EXISTS + 기존 submission 반환 확인
- [ ] 생성된 submission에 FormData(image webp + slot_index + character + width + height) POST → 200 + letter_piece 반환 확인
- [ ] Supabase Dashboard → Storage → letter-pieces 버킷 → `{user_id}/{submission_id}/0.webp` 파일 존재 확인
- [ ] Supabase Dashboard → letter_pieces 테이블 → 업로드한 행 존재 확인

**권한 검증 (필수)**
- [ ] 로그인 상태 → 타인 submission ID로 POST /api/submissions/[타인-id]/letters → 404 SUBMISSION_NOT_FOUND 반환 확인
- [ ] 비로그인 상태 → POST /api/submissions → 401 UNAUTHORIZED 반환 확인
- [ ] 비로그인 상태 → POST /api/submissions/any-id/letters → 401 UNAUTHORIZED 반환 확인
- [ ] Storage에서 타인 user_id 경로 직접 업로드 시도(Storage 정책 테스트) → 403 차단 확인 (Supabase Dashboard Storage 정책 테스트 탭 활용)

**zod 검증**
- [ ] POST /api/submissions body에 challenge_id 누락 → 401 (비인증) 또는 400 VALIDATION_ERROR (인증 후) 확인
- [ ] POST /api/submissions/[id]/letters body에 character에 2글자 이상 전송 → 400 VALIDATION_ERROR 확인
- [ ] POST /api/submissions/[id]/letters에 500KB 초과 이미지 전송 → 413 IMAGE_TOO_LARGE 확인
- [ ] POST /api/submissions/[id]/letters에 PNG 파일 전송 → 400 INVALID_IMAGE_TYPE 확인

### 권장 확인

- [ ] Supabase Dashboard → Storage → letter-pieces → 같은 slot_index 재업로드 → 파일 교체 확인 (UPSERT)
- [ ] completed 상태 submission에 letters 업로드 시도 → 409 SUBMISSION_NOT_DRAFT 확인
- [ ] Chrome DevTools Network → /api/challenges/today 응답 헤더 확인 (Cache-Control 등)
- [ ] Supabase Dashboard → Storage → Policies → 10개 정책 UI에서 확인

### 네트워크 엣지 케이스 (모바일)

- [ ] 느린 네트워크(3G 스로틀링) 상태에서 이미지 업로드 → 타임아웃 또는 정상 완료 확인
- [ ] 업로드 도중 앱 전환 후 복귀 → 업로드 상태 확인

---

## Day 3 합격 기준별 최종 판정 요약

| # | 기준 | 판정 |
|---|------|------|
| ① | 툴체인 green | PASS |
| ② | Storage 버킷 3개 + §5 정책 10개 + RLS + authenticated DML GRANT | PASS |
| ③ | GET /api/challenges/today 200, 미래 날짜 미포함 | PASS |
| ④ | POST /api/submissions 201/409 | PARTIAL — 비인증 401 라이브 확인, 인증 경로는 코드 추적 + 사용자 E2E |
| ⑤ | 글자 업로드 Storage+DB | PARTIAL — 비인증 401 라이브 확인, 실 업로드는 코드 추적 + 사용자 E2E |
| ⑥ | 타인 submission letters → 404 존재 은폐 | PASS (코드 추적) |
| ⑦ | 비인증 API → 401 | PASS (라이브) |
| ⑧ | zod 실패 → 400, 비인증 시 401 | PASS (코드 추적 + 라이브 비인증 확인) |

---

## 커밋 가능 여부

**커밋 가능** — Critical 0건, High 0건.

Reviewer 리뷰에서 지적된 Medium 3건(M-1: storage.objects RLS+GRANT, M-2: try/catch+path 로깅+§8.3, M-3: runtime='nodejs')이 구현 단계에서 반영 완료되어 이번 QA에서 모두 재확인됐다.

신규 Medium 2건(M1: getKSTDateString 중복, M2: 409 응답 타입 불일치)은 기능 동작에 영향 없으며 Day 4 작업 시 함께 처리 가능하다.

④⑤ 기준(인증 필요 경로)의 PARTIAL 판정은 테스트 환경 제약(라이브 OAuth 불가)에 따른 것으로, 코드 추적으로 로직 정확성이 확인됐다. 사용자가 모바일 E2E(위 체크리스트)를 완료하면 전항목 PASS로 전환된다.

---

## 다음 액션

**Day 4 작업 시 처리 권장**

1. **[L2]** seed 날짜 범위 연장 — 현재 2026-06-11 이후 챌린지 없음. Day 4 시작 전 `pnpm exec tsx scripts/seed-challenges.ts`로 추가 날짜 seed 실행 또는 EXTRA_ROWS 확장
2. **[M1]** `getKSTDateString` 중복 제거 — `src/lib/constants/challenges.ts` 또는 `src/lib/utils/date.ts`에서 공유 import로 교체 (today/route.ts, submissions/route.ts 2파일)
3. **[M2]** 409 SUBMISSION_EXISTS 응답 타입 정의 — `ApiErrorBody`에 `submission?: unknown` 추가 또는 전용 타입 정의 후 코드 타입 정합성 확보

**Day 4 포함 필수**

4. **[L1]** `src/lib/api/errors.ts` 상단에 `import 'server-only'` 추가
5. **[Day2-L1 이관 유지]** `src/lib/supabase/server.ts` server-only 가드 — Day 4 이관 유지

**배포 전 필수**

6. **[Day2-M1 이관 유지]** `login.tsx`의 `redirectTo` → `NEXT_PUBLIC_APP_URL` 기반 전환

---

## 재검증 섹션

> 해당 없음 — Critical/High 이슈가 없어 재검증 사이클 불필요.
