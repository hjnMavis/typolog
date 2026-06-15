# Phase 2 Day 5 QA Review

> 검증 일자: 2026-06-15
> 검증자: QA Agent (독립 재검증)
> 대상 브랜치: worktree-phase2-day5-validation
> 선행 리뷰: Reviewer 1차 리뷰 통과 (Critical/High 0 기록됨)

---

## 검증 방식

- 정적 코드 리뷰 (scripts/verify-rls.ts, 마이그레이션 SQL, .env.local.example, next.config.ts)
- lint / type-check / test:run / build 실행 결과 기록
- 프로브 매트릭스 기대값을 migration SQL(source of truth)과 독립 대조
- GRANT 레이어 분리, 회귀 2종, 거짓 양성 방어 메커니즘 점검

---

## 1. 정적 분석 결과

| 명령어 | 결과 | 비고 |
|--------|------|------|
| `pnpm lint` | PASS | 경고 0건 |
| `pnpm type-check` | PASS | 오류 0건 |
| `pnpm test:run` | PASS | 9 파일 / 127 테스트 전통과 |
| `pnpm build` | PASS | 13개 라우트 정상 빌드 |

---

## 2. QA 체크포인트 표

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[P1-1] loadEnv 비밀 미노출** | PASS | 값 대신 Boolean presence만 출력. DATABASE_URL·키·JWT·비밀번호 미노출 확인 |
| **[P1-2] savepoint 격리 + 전체 ROLLBACK** | PASS | probe 함수가 savepoint 안에서 throw ROLLBACK → 행 격리. 트랜잭션 끝에 throw ROLLBACK → 라이브 DB 무변경 |
| **[P1-3] ROLLBACK 심볼 vs 에러 분리** | PASS | `e === ROLLBACK`이면 정상 롤백(outcome 유지), `e.code` 있으면 SQL 에러로 처리 — 알 수 없는 에러는 re-throw → fail-fast |
| **[P1-4] submissions SELECT 정책 대조** | PASS | B→A비공개(0행), B→A공개(1행), A→본인(1행), anon→공개(1행), anon→비공개(0행) ← migration §3.3과 1:1 일치 |
| **[P1-5] submissions INSERT WITH CHECK** | PASS | B가 user_id=A로 위조 → 42501 기대 ← WITH CHECK(user_id=auth.uid()) 검증 ✓ |
| **[P1-6] H2 회귀: hidden→completed 복원 차단** | PASS | USING에 `status != 'hidden'` → 행이 대상에서 제외(0행). WITH CHECK가 아닌 USING 차단임을 기대값 구분(rows:0 vs error:42501)으로 명시 |
| **[P1-7] hidden 설정 차단(WITH CHECK)** | PASS | A가 completed→hidden 시도 → WITH CHECK 위반 → 42501 기대 |
| **[P1-8] letter_pieces §8.4-② 재할당 차단** | PASS | 양성짝(무해한 변경 성공, ≥1행)이 먼저 실행되어 USING 통과를 전제로 분리. 재할당(submission_id 변경)은 WITH CHECK 위반 42501 기대 — 변별력 확보 |
| **[P1-9] GRANT 레이어 5종 검증** | PASS | submissions DELETE, reactions UPDATE, reports SELECT, challenges INSERT, profiles anon SELECT — 모두 42501(permission denied) 기대. migration GRANT 표와 1:1 대조 완료 |
| **[P2-1] 업로드 게이트 (거짓 양성 방어)** | PASS | upLetter/upPub/upPriv 중 하나라도 실패 시 다운로드 검증 스킵 + FAIL(false) 기록 → 객체 부재를 정책 차단으로 오판하지 않음 |
| **[P2-2] blocked actual에 status 코드 포함** | PASS | `blocked (403): ...` vs `blocked (404): ...` 형식으로 정책 차단과 객체 부재를 사후 구분 가능 |
| **[P2-3] Storage 경로 ↔ 정책 정합성** | PASS | letterPath=`{A}/{subPriv}/0.webp`: foldername()[1]=A ← letter-pieces 정책(uid 일치) ✓. collagePubPath=`{A}/{subPub}/collage.png`: foldername()[2]=subPub(completed,public) ← collages_read EXISTS 조건 ✓ |
| **[P2-4] 테스트 계정 생성·삭제 라이프사이클** | PASS | admin API로 즉석 생성 → in-process 랜덤 비밀번호 → finally에서 삭제(CASCADE). --keep 옵션으로 디버그 유지 가능 |
| **[P2-5] profiles trigger 단언** | PASS | 생성 직후 `count(*) WHERE id IN (A, B)` = 2 단언 → trigger 미반영 시 명확한 에러 발생 |
| **[E1] .env.local.example 서버/클라 분류** | PASS | NEXT_PUBLIC_*: 클라이언트 노출 표기. 접두사 없음: 서버 전용 경고 주석. 미참조 NEXT_PUBLIC_APP_URL 명시(Phase 3 용도 주석). 워크트리 복사 안내(Day 4.5 QA 실제 발생 사례 근거) |
| **[E2] next.config.ts turbopack.root** | PASS | import.meta.url 기반으로 프로젝트 루트를 현재 디렉토리로 고정 — 워크트리 중복 pnpm-workspace.yaml 경고 침묵. 무해한 변경 |
| **[E3] docs §6.3 A5 상태코드 200 고정 명시** | PASS | "200 고정 — UPSERT라 신규/교체를 구분하지 않는다. 클라이언트는 res.ok만 검사" 명시. 코드 무변경(문서만) |

---

## 3. 이슈 목록

### Critical — 0건

없음.

### High — 0건

없음.

### Medium

#### M-1: anon JWT 주입의 Supabase 내부 구현 의존성

- **위치**: scripts/verify-rls.ts, 109번째 줄 근처
- **내용**: anon 프로브는 `request.jwt.claims = ''` (빈 문자열)로 auth.uid()를 NULL로 만드는 방식을 사용한다. 스크립트 주석에 "Supabase auth.uid() 정의에 의존한다"라고 명시되어 있다. Supabase 최신 버전은 `nullif(current_setting('request.jwt.claim.sub', true), '')::uuid` 형식이므로 NULL이 되어 정상 동작한다. 하지만 구버전은 `''::jsonb` 파싱 에러가 먼저 발생해 anon 프로브가 의도치 않은 에러 코드로 실패할 수 있다.
- **실제 위험도**: 이 프로젝트는 Supabase 클라우드 인스턴스를 사용하므로 버전이 제어된다. 현 환경에서 실제 문제가 될 가능성은 낮다.
- **판정 근거**: 정책 자체의 허점이 아니라 검증 스크립트의 외부 의존성. 스크립트가 의존성을 주석으로 명시해 투명성을 확보함.
- **권장 조치**: 현재로서는 수용. 만약 anon 프로브가 예상치 못한 에러 코드로 실패한다면 클레임 형식을 `{"sub":"","role":"anon"}` 빈 sub 전략으로 보완 검토.

#### M-2: 허용 케이스 양성 테스트 부분 누락

- **위치**: scripts/verify-rls.ts, Part 1 전반
- **내용**: 보안 차단 케이스(음성)를 집중 검증하는 설계는 맞다. 그러나 일부 중요 허용 케이스가 없다. (a) profiles SELECT(authenticated 전체 허용) 성공 케이스 미검증, (b) submissions UPDATE(본인 성공) 미검증, (c) letter_pieces DELETE(본인 가능) 미검증. 차단 측 구현에 버그가 있어 허용도 막힌 경우(over-restrictive RLS)를 탐지하지 못할 수 있다.
- **판정 근거**: letter_pieces 재할당 프로브에는 "무해한 변경 성공" 양성짝이 올바르게 존재한다(§8.4-② 변별력). 이 패턴이 일부 케이스에는 적용되지 않음.
- **권장 조치**: 검증 Day라 코드 변경 최소화 원칙에 따라 현재 스크립트에 추가하지 않는다. Phase 3 Day 10(통합 검증) 때 보완 권장.

#### M-3: avatars 버킷 검증 미포함

- **위치**: scripts/verify-rls.ts, Part 2
- **내용**: avatars 버킷은 Part 2 Storage 검증에 포함되지 않는다. avatars는 Public 버킷이므로 읽기 정책 대신 버킷 설정으로 처리한다. 본인 경로 쓰기/삭제 정책(`avatars_write`, `avatars_delete`)이 동작하는지 검증되지 않았다.
- **판정 근거**: MVP에서 아바타 업로드 기능은 미구현(§1.1 설계 포인트 "avatar_url 필드만 예약"). Phase 3에서 구현될 때 검증 추가가 자연스러운 시점.
- **권장 조치**: Phase 3 Day 9(마이페이지+프로필) 구현 시 검증 추가.

#### M-4: Supabase 에러 메시지에 경로(UUID) 포함 가능성

- **위치**: scripts/verify-rls.ts, downloadCheck 함수
- **내용**: `actual = blocked(${status}): ${error.message}` 형식으로 Supabase Storage 라이브러리 에러 메시지를 그대로 console에 출력한다. Supabase 라이브러리 버전에 따라 에러 메시지에 파일 경로(user_id UUID 포함)가 담길 가능성이 있다. 단, 이 UUID는 테스트 계정의 UUID이고 실제 민감한 secret(API 키, 비밀번호, DATABASE_URL)이 아니다. 스크립트 주석 "--keep: UUID는 출력하지 않음"과 미묘하게 불일치한다.
- **판정 근거**: 실제 노출 정보는 임시 테스트 계정의 UUID(실행 후 삭제)로 영향이 제한적이다. API 키·비밀번호 등 핵심 secret은 미노출.
- **권장 조치**: 수용. 만약 UUID 노출이 우려되면 downloadCheck에서 error.message를 status 코드만 남기도록 필터링 가능.

---

## 4. 독립 검증: 프로브 기대값 ↔ Migration SQL 정합성

### 4.1 submissions 정책 (0001_rls_policies_and_trigger.sql §3.3)

| 프로브 | 기대값 | Migration 근거 | 정합 |
|--------|--------|---------------|------|
| B→A 비공개 SELECT | 0행 | `USING(user_id=auth.uid() OR (status='completed' AND is_public=true))` — B는 둘 다 불만족 | ✓ |
| B→A 공개완성 SELECT | 1행 | 위 조건의 OR 우변 만족 | ✓ |
| anon→비공개 SELECT | 0행 | `submissions_select_anon`: `USING(status='completed' AND is_public=true)` — 불만족 | ✓ |
| B→A로 위조 INSERT | 42501 | `WITH CHECK(user_id=auth.uid())` — B≠A → 위반 | ✓ |
| hidden→completed (A) | 0행 | `USING(... AND status!='hidden')` — hidden 행은 대상에서 제외 | ✓ |
| completed→hidden (A) | 42501 | `WITH CHECK(... AND status!='hidden')` — 새 행의 hidden 위반 | ✓ |
| A도 DELETE | 42501 | GRANT에 DELETE 없음: `GRANT INSERT, UPDATE ON submissions TO authenticated` | ✓ |

### 4.2 letter_pieces 정책 (§3.4)

| 프로브 | 기대값 | Migration 근거 | 정합 |
|--------|--------|---------------|------|
| B→A 비공개 제출 글자조각 SELECT | 0행 | `USING(EXISTS(... s.user_id=auth.uid() OR (completed AND public)))` — 불만족 | ✓ |
| B→A 공개 제출 글자조각 SELECT | 1행 | EXISTS 조건의 public 브랜치 만족 | ✓ |
| B→A 제출에 INSERT | 42501 | `WITH CHECK(EXISTS(... s.user_id=auth.uid()))` — B≠A | ✓ |
| B의 조각 무해한 변경 | ≥1행 | USING 통과(s.user_id=B=auth.uid()) + WITH CHECK도 동일 조건 → 통과 | ✓ |
| B 조각→A 제출로 재할당 | 42501 | `WITH CHECK(EXISTS(... s.user_id=auth.uid()))` — 변경 후 s.user_id=A≠B | ✓ |

### 4.3 GRANT 레이어 (§3.7)

| 프로브 | 기대값 | Migration 근거 | 정합 |
|--------|--------|---------------|------|
| submissions DELETE | 42501 | `GRANT INSERT, UPDATE ON submissions TO authenticated` (DELETE 없음) | ✓ |
| reactions UPDATE | 42501 | `GRANT SELECT, INSERT, DELETE ON reactions TO authenticated` (UPDATE 없음) | ✓ |
| reports SELECT | 42501 | `GRANT INSERT ON reports TO authenticated` (SELECT 없음) | ✓ |
| challenges INSERT | 42501 | `GRANT SELECT ON challenges TO anon, authenticated` (INSERT 없음) | ✓ |
| profiles anon SELECT | 42501 | `GRANT SELECT, UPDATE ON profiles TO authenticated` (anon에 GRANT 없음) | ✓ |

### 4.4 Storage 정책 (0003_storage_buckets_and_policies.sql §5)

| 시나리오 | 기대값 | Migration 근거 | 정합 |
|---------|--------|---------------|------|
| A → 본인 letter-pieces 업로드 | success | `letter_pieces_write`: `WITH CHECK(... [1]=auth.uid()::TEXT)` — 경로 첫 폴더=A | ✓ |
| B → A letter-pieces 다운로드 차단 | blocked | `letter_pieces_read`: `USING(... [1]=auth.uid()::TEXT)` — [1]=A≠B | ✓ |
| anon → A letter-pieces 다운로드 차단 | blocked | `letter_pieces_read` `TO authenticated` 만 — anon 정책 없음 | ✓ |
| B → A 공개 collage 다운로드 | allowed | `collages_read`: `OR EXISTS(... completed AND public)` — subPub 조건 만족 | ✓ |
| anon → A 공개 collage 다운로드 | allowed | `collages_read_anon`: `USING(... EXISTS(completed AND public))` | ✓ |
| anon → A 비공개 collage 다운로드 차단 | blocked | `collages_read_anon` EXISTS 조건 — subPriv는 draft, not public → 불만족 | ✓ |
| B → A 비공개 collage 다운로드 차단 | blocked | `collages_read`: [1]=A≠B AND EXISTS(... draft, not public) 둘 다 불만족 | ✓ |

### 4.5 0004_letter_pieces_allow_jpeg.sql 반영 여부

```sql
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg']
WHERE id = 'letter-pieces';
```

- verify-rls.ts Part 2 업로드에는 `WEBP_1x1`(image/webp)를 사용한다. JPEG 폴백 경로 자체의 Storage 검증은 없다.
- **판정**: JPEG 폴백 검증은 클라이언트 E2E(iOS Safari 실기기 테스트)로 위임되어 있다(Day 5 확정 결정 (c)). 스크립트의 현재 범위에서는 MIME 허용 목록 변경만 마이그레이션으로 확인되면 충분. 정적 검증 완료.

---

## 5. 비노출 점검

| 대상 | 판정 | 근거 |
|------|------|------|
| DATABASE_URL | 미노출 ✓ | `Boolean(env.databaseUrl)` presence만 출력 |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 미노출 ✓ | presence boolean |
| SUPABASE_SECRET_KEY | 미노출 ✓ | presence boolean |
| 테스트 계정 비밀번호 | 미노출 ✓ | in-process 생성, `Pw-${randomUUID()}` 로그 출력 없음 |
| 테스트 계정 UUID | 사실상 미노출 ✓ | console 직접 출력 없음. Supabase 에러 메시지 경유 간접 노출 가능성은 M-4로 분류 |
| 테스트 계정 이메일 | 사실상 미노출 ✓ | 로그 직접 출력 없음. `@example.com` 도메인으로 실개인정보 아님. Supabase 에러 메시지 경유 가능성 있으나 실제 낮음 |

---

## 6. 변경 파일 별 점검

### scripts/verify-rls.ts (신규)

- 역할: RLS/Storage 권한 검증 단일 스크립트
- 설계 완성도: Part1(SQL 시뮬레이션 24개 프로브) + Part2(Storage 크로스 유저 최대 8건)로 핵심 검증 커버
- 에러 처리: fail-fast(unknown 에러 re-throw), 부분 스킵(Part2 로그인 실패 시 Part1 결과 보존), 정리(finally 이중 보호)
- 보안: 비밀 미노출 원칙 준수. 중대 secret(API 키, DB URL, 비밀번호) 완전 미노출 확인
- 커버리지 갭: avatars 버킷, 일부 허용 케이스 — Medium 수준, 현재 범위 적합

### .env.local.example (수정)

- NEXT_PUBLIC_*/서버 전용 분류 주석 정확
- DATABASE_URL 사용처(scripts/verify-rls.ts 포함) 정확히 나열
- NEXT_PUBLIC_APP_URL 미참조 현황과 Phase 3 예정 명시
- 워크트리 복사 안내(Day 4.5 QA 실제 발생 근거) 적합
- PostHog/Sentry 주석 처리 항목 일관성 유지

### next.config.ts (수정)

- `import.meta.url` + `path.dirname(fileURLToPath(...))` 패턴으로 현재 디렉토리 정확히 취득
- `turbopack: { root: projectRoot }` 설정 — 워크트리 중복 workspace 경고 침묵
- 프로덕션 빌드 성공으로 부작용 없음 확인 ✓

### docs/backend-design-plan.md (§6.3 A5, §9 Day 5 표)

- A5 상태코드 200 고정 명시: "UPSERT라 신규 생성/교체를 구분하지 않는다. 클라이언트는 res.ok만 검사한다." — 코드와 일치
- Day 5 확정 결정 표: (a)~(e) 5항목, 구현물과 일치
  - (a) 검증법 병행 → verify-rls.ts 구현 ✓
  - (b) 테스트 계정 즉석 생성·삭제 → 구현 ✓
  - (c) M1(200 고정 문서화), turbopack.root → 구현 ✓
  - (d) 발견 결함만 수선(U3 조건부) — 현재 Critical/High 0이므로 U3 불필요
  - (e) 작업 단위 U1/U2/U3(조건부) → 범위 일치

---

## 7. 사용자 모바일 수동 테스트 체크리스트

> 아래는 QA 에이전트가 정적으로 검증할 수 없는 런타임 시나리오다.
> verify-rls.ts 실행 결과(전통과) + 아래 수동 검증이 모두 완료되어야 게이트 B 통과다.

### 7-A. verify-rls.ts 실행 (로컬 터미널)

```bash
pnpm dlx tsx scripts/verify-rls.ts
```

- [ ] 환경 변수 presence가 모두 true로 출력됨
- [ ] profiles trigger 단언 통과 (A·B 프로필 2/2건 존재)
- [ ] Part 1: 24건 전통과
- [ ] Part 2: 8건 전통과 (업로드 게이트 통과 전제)
- [ ] 테스트 계정 A·B 자동 삭제 확인
- [ ] 최종: "모든 RLS·Storage 권한 검증 통과" 출력

### 7-B. 타인 비공개 접근 차단 (브라우저, iPhone 14 기준)

- [ ] 사용자 A로 로그인 → 콜라주 제출(비공개)
- [ ] 사용자 B로 다른 기기/시크릿 창에서 A의 제출 URL 직접 입력 → 404 확인
- [ ] Storage 직접 URL(letter-pieces 경로)을 복사해 B 세션에서 접근 → 403 또는 접근 불가 확인

### 7-C. 비로그인 접근 차단

- [ ] 비로그인 상태로 `/challenge/*`, `/feed/today` 접근 → `/login`으로 redirect 확인
- [ ] 비로그인 상태로 공개 제출 공유 URL(`/s/[id]`) 접근 → 정상 표시 확인

### 7-D. iOS Safari JPEG 폴백 E2E (Day 4.5 잔여 리스크, 실기기)

- [ ] iPhone Safari에서 글자 사진 촬영 또는 갤러리 선택
- [ ] 업로드 성공 (canvas가 JPEG로 폴백하는 경우 포함)
- [ ] 콜라주 완성 → 제출 성공

### 7-E. 에러 엣지 케이스 점검 (발견 결함 수선 전제)

- [ ] 세션 만료 후 API 호출 → 401 → 로그인 페이지 redirect (또는 에러 메시지)
- [ ] 2MB 초과 콜라주 업로드 → 413 에러 메시지 표시
- [ ] 오늘 챌린지 없을 때 홈 진입 → CHALLENGE_NOT_FOUND 에러 처리

---

## 8. 커버되지 않는 영역 (런타임 의존)

| 영역 | 이유 | 위임 |
|------|------|------|
| 실제 RLS 정책 DB 적용 여부 | migration이 실행되었는지 정적 확인 불가 | verify-rls.ts 실행 |
| Storage 버킷 실제 존재 | 0003 migration 적용 여부 | verify-rls.ts Part 2 (업로드 실패로 감지) |
| iOS JPEG 폴백 동작 | 브라우저 canvas API, 실기기 필요 | 수동 E2E 7-D |
| JWT 세션 만료 동작 | 시간 경과 필요 | 수동 E2E 7-E |
| 실제 Google OAuth 로그인 | 외부 서비스 | 수동 E2E 7-C |

---

## 9. 커밋 가능 여부

**조건부 가능**

정적 분석(lint, type-check, test:run, build) 전통과 + 코드 리뷰 이슈 Critical/High 0건이므로 **코드 품질 측면에서는 커밋 가능하다.**

단, 아래 런타임 조건이 충족되어야 게이트 B가 완전히 통과된다:

1. **verify-rls.ts 전통과**: `pnpm dlx tsx scripts/verify-rls.ts` 실행 결과 0 FAIL — 테이블 RLS + Storage 버킷 정책이 라이브 DB에 실제로 적용되어 있는지 확인. 이 검증 없이는 마이그레이션이 적용되지 않은 상태를 탐지하지 못한다.
2. **사용자 수동 E2E(7-B, 7-C) 완료**: 타인 비공개 접근 차단, 비로그인 redirect 실기기 확인.

이 두 조건을 모두 충족한 후에만 **완전한 게이트 B 통과**로 커밋·PR을 진행한다.

---

## 10. 이슈 요약

| 등급 | 건수 | 내용 |
|------|------|------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 4 | M-1(anon JWT 의존성), M-2(허용 케이스 부분 누락), M-3(avatars 미검증), M-4(에러 메시지 UUID 간접 노출 가능성) |

---

## 11. 메인 세션 후속 — Medium 처리 (2026-06-15)

QA 리뷰 수령 후 메인 세션에서 Medium 4건을 아래와 같이 처리했다. 처리 후 `lint`·`type-check`·`test:run(127)` 재통과 확인.

| 이슈 | 처리 | 내용 |
|------|------|------|
| **M-2** 허용 케이스 부분 누락 | **해소(반영)** | QA는 Phase 3 Day 10 이관 권고였으나 비용이 작아 즉시 반영. 양성 프로브 3개 추가 — (a) `profiles: authenticated 조회 가능`, (b) `submissions: A는 본인 제출 수정 가능`, (c) `letter_pieces: A는 본인 글자조각 삭제 가능`. over-restrictive RLS(과도 차단)도 탐지 가능해짐 |
| **M-4** 에러 메시지 UUID 노출 가능성 | **해소(반영)** | `downloadCheck`에서 `error.message` 출력 제거, **HTTP status만** 남김. 403(정책 차단) vs 404(객체 부재) 식별(Reviewer M-5의 목적)은 status가 그대로 제공하므로 진단 가치 유지하며 경로/UUID 노출 가능성 제거 |
| **M-1** anon JWT 주입 의존성 | **수용(이관)** | QA 권고대로 수용. 시뮬레이션의 외부 의존성(통제된 Supabase 클라우드라 현 환경 안전, 주석으로 명시). anon 프로브가 예상 외 에러 코드로 실패하면 `{"sub":""}` 빈 sub 전략으로 보완 검토 |
| **M-3** avatars 버킷 미검증 | **수용(이관)** | MVP에서 아바타 업로드 미구현(avatar_url 필드만 예약). **Phase 3 Day 9(마이페이지+프로필)** 구현 시 검증 추가 |

> 게이트 B 최종 판정은 사용자의 **verify-rls.ts 런타임 실행(0 FAIL)** + **E2E 체크리스트 완료** 후 이 문서에 추가 기록한다.

---

## 12. 게이트 B 최종 판정 (메인 세션 기록, 2026-06-15)

**게이트 B 통과 확정.**

### 런타임 검증 — `scripts/verify-rls.ts` (사용자 직접 실행)

- **결과: 총 36건 / 통과 36 / 실패 0 ✅** — Part 1 테이블 RLS 매트릭스 27건 + Part 2 Storage 크로스 유저 9건.
- 시뮬레이션은 전부 ROLLBACK, 테스트 계정 A·B는 자동 삭제 → **라이브 데이터 무변경**. 모든 정책이 정확히 작동 = 마이그레이션 **0001·0003·0004 라이브 적용 실증**.
- 검증된 핵심: B는 A 비공개 제출 0행(API 404의 DB 토대) · 회귀 H2(hidden→completed 복원 차단) · 회귀 §8.4-②(letter_pieces 타인 재할당 차단) · GRANT 레이어 차단 · 허용 양성 5종(over-restrictive 아님) · Storage 타인/anon 차단(400)·공개 허용.
- **환경 이슈 1건(코드 결함 아님)**: 워크트리 `.env.local`의 `DATABASE_URL` 라인 들여쓰기로 Node 내장 `process.loadEnvFile`가 키를 못 읽음 → 스크립트 env 로더를 앱과 동일한 `@next/env loadEnvConfig`로 교체해 해소(앞 공백·따옴표 견고). worktree·main `.env.local` 동기화 완료.

### 사용자 E2E (GitHub issue #39 — 닫힘)

- **완료**: 0(사전조건)·1(RLS 36/36)·2-1·2-2(전체 플로우·재제출 멱등)·4-1·4-2(권한 차단·비로그인 redirect)·**5-1(세션 만료 → /login, 쿠키 삭제 테스트)**·**5-2(by-design: `/challenge/<없는-id>`는 오늘 챌린지 존재 시 홈 redirect — 코드상 전체페이지 404 없음 확인)**·6-1(turbopack 경고 사라짐)·6-2·7-1(콘솔 0건).
- **보류(사용자 결정 2026-06-15)**: **3-1 iOS 실기기 JPEG 폴백** — 실기기 없음, 단위 테스트(C16~C20)·정적 리뷰로 갈음. **잔여 리스크**: 실기기 Safari `toBlob` JPEG 폴백·`.jpg` 업로드 미실증 → **배포 전 실기기 확인으로 이월**(Day 4.5 #34 5-1과 동일, 추적: #40 참고 섹션). 5-1·5-3 중 5-3(collage 413)은 선택 보류.

### 종합

- 정적 게이트: `lint`·`type-check`·`test:run`(127)·`build` 통과.
- Reviewer: Critical/High **0**. QA: Critical/High **0**, Medium 4 → M-2·M-4 **해소**, M-1·M-3 Phase 3 이관(#40).

**판정: 게이트 B 통과 (2026-06-15)** → 게이트 C(학습 노트 `docs/learning/phase-2-day-5.md`) 진행 → 통과 시 U1·U2 커밋·PR(`day5-kickoff.md`·`.env.local` 제외, AI 서명 없음).
