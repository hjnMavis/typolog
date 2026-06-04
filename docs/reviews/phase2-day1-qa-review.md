# Phase 2 Day 1 — QA 리뷰

> 검토 일시: 2026-06-04
> 검토 범위: Supabase DB 기반 설정 (Drizzle 스키마 + 마이그레이션 + RLS 정책 + trigger)
> 검증 방식: 정적 분석 + 실제 DB 실행 (postgres.js, 트랜잭션 롤백 보장)
> Supabase CLI: 미설치 — 대시보드 Security Advisor는 사용자 E2E로 이관

---

## 툴체인 결과

| 명령 | 결과 | 비고 |
|------|------|------|
| `pnpm lint` | PASS | 0 오류, 0 경고 |
| `pnpm type-check` | PASS | 0 오류 |
| `pnpm test:run` | PASS | 6 파일, 105 테스트 전체 통과 |

---

## QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|----------|
| C01 | 6개 테이블 모두 public 스키마에 존재 | PASS | `pg_tables` 쿼리 |
| C02 | 6개 테이블 모두 RLS 활성화 | PASS | `pg_class.relrowsecurity` 확인 |
| C03 | 인덱스 5개 존재 (+ 부분 인덱스 포함) | PASS | `pg_indexes` 쿼리 (idx_challenges_active_date, idx_submissions_feed, idx_submissions_user, idx_letter_pieces_submission, idx_reactions_submission) |
| C04 | 부분 인덱스 WHERE 조건 정확성 | PASS | `status='completed' AND is_public=true` 확인 |
| C05 | RLS 정책 15개 모두 적용 | PASS | `pg_policies` 쿼리 15건 확인 |
| C06 | FK 제약 조건 8개 및 CASCADE 정확성 | PASS | `pg_constraint` 쿼리, auth.users→profiles CASCADE 포함 |
| C07 | CHECK 제약 조건 (submissions.status) | PASS | `submissions_status_check` ('draft','completed','hidden') |
| C08 | UNIQUE 제약 조건 4개 | PASS | challenges.active_date, submissions(user_id,challenge_id), letter_pieces(submission_id,slot_index), reactions(user_id,submission_id) |
| C09 | handle_new_user 함수 SECURITY DEFINER | PASS | `pg_proc.prosecdef=true` 확인 |
| C10 | handle_new_user SET search_path = '' | PASS | `pg_proc.proconfig=["search_path=\"\""]` 확인 |
| C11 | handle_new_user REVOKE EXECUTE | PASS | `pg_proc.proacl=["postgres=X/postgres"]` — postgres만 남음, PUBLIC/anon/authenticated 제거됨 |
| C12 | on_auth_user_created trigger 등록 | PASS | `information_schema.triggers`에서 AFTER INSERT ON users 확인 |
| C13 | trigger: OAuth name 메타데이터 → nickname 사용 | PASS | `raw_user_meta_data->>'name'` 정상 반영 |
| C14 | trigger: name 없을 때 user_XXXXXXXX fallback | PASS | `user_` + UUID 앞 8자리 정확 |
| C15 | trigger: 20자 초과 이름 클램프 | PASS | 25자 한글 → 20자 (LEFT 함수 문자 기준 동작 확인) |
| C16 | drizzle.config.ts schemaFilter: public 전용 | PASS | 정적 검토, auth 스키마 마이그레이션 대상 제외 |
| C17 | drizzle.config.ts prepare: false 미설정 | NOTE | drizzle.config.ts에는 prepare 설정 없음 (Drizzle Kit 전용) — runtime DB 클라이언트(src/db/index.ts)는 Day 2에 생성 예정이므로 현재 범위 내 이슈 없음 |
| C18 | .env.local.example 서버 전용 주석 포함 | PASS | DATABASE_URL·SUPABASE_SERVICE_ROLE_KEY에 "서버 전용 — NEXT_PUBLIC_ 절대 금지" 주석 있음 |
| C19 | anon/authenticated GRANT 누락 | PASS ✅ | §3.7 GRANT 블록 적용 확인 — information_schema.role_table_grants 재검증 (재검증 섹션 참조) |
| C20 | submissions hidden→completed 복원 허용 | PASS ✅ | USING에 status != 'hidden' 추가 후 0행 확인 — 차단 정상 동작 (재검증 섹션 참조) |

---

## RLS 시나리오 검증 결과

모든 시나리오는 `sql.begin(async (tx) => { ...; throw new Error('ROLLBACK') })` 패턴으로 트랜잭션 내에서 실행, 데이터 흔적 없음.

| 시나리오 | 결과 | 상세 |
|---------|------|------|
| S1: anon → challenges SELECT | PASS ✅ (재검증 완료) | GRANT 적용 후 permission denied 해소 — count() 0행 반환(데이터 없음), 에러 없음 |
| S2: anon → challenges INSERT 차단 | PASS | 42501 permission denied |
| S3: anon → draft submission 비노출 | PASS (GRANT 임시 부여 후) | 0행 반환 |
| S-anon: completed+public만 노출 | PASS | 공개완성 1행, 비공개완성 0행 |
| S4: A가 B의 draft SELECT → 0행 | PASS | RLS USING 정상 동작 |
| S5: A가 B의 submission UPDATE → 0행 | PASS | 조용한 차단 |
| S6: A가 user_id=B로 INSERT 차단 | PASS | 42501 WITH CHECK 위반 |
| S7: A가 자기 submission status=hidden UPDATE 차단 | PASS | 42501 WITH CHECK 위반 (status != 'hidden') |
| S8: authenticated → reports SELECT → 0행 | PASS | SELECT 정책 없음 = 차단 |
| S-trigger: auth.users INSERT + profiles 자동 생성 | PASS | trigger 정상 동작 |
| S-trigger: handle_new_user OAuth name | PASS | nickname='홍길동' |
| S-trigger: handle_new_user fallback | PASS | 'user_XXXXXXXX' |
| S-trigger: 20자 클램프 | PASS | 25자 한글 → 20자 정확 |
| S-extra: hidden→completed 복원 허용 여부 | PASS ✅ (재검증 완료) | USING status != 'hidden' 추가 후 0행 — 복원 차단 정상 동작 |
| S-extra: is_public 토글 (허용) | PASS | 1행 영향 (정상 동작) |

---

## 이슈 목록

### Critical (커밋 차단)

없음.

> C19 "GRANT 누락"은 아래 이유로 Critical이 아닌 High로 분류:
> 현재 runtime DB 클라이언트(`src/db/index.ts`)가 아직 없고, Drizzle은 `postgres` role로 직접 연결해 서버 쪽 쿼리를 실행한다. RLS는 supabase-js가 anon/authenticated role로 실행할 때 적용된다. Day 1 산출물은 마이그레이션만이며, 실제 클라이언트에서 supabase-js를 쓰는 시점은 Day 2이다. 다만 Day 2 시작 전에 반드시 수정해야 한다.

---

### High (Day 2 시작 전 수정 필수)

#### H1: anon/authenticated role에 테이블 GRANT 누락 ✅ 해결됨 (재검증 완료)

**현상**: Supabase에서 drizzle-kit migrate로 생성한 테이블은 `postgres` role owner로 생성된다. Supabase의 default ACL 중 `supabase_admin` role이 생성한 테이블에만 anon/authenticated에 SELECT/INSERT/UPDATE/DELETE가 자동 부여된다. `postgres` role owner 테이블에는 이 자동 부여가 적용되지 않아 REFERENCES/TRIGGER/TRUNCATE만 부여된 상태다.

**영향**: supabase-js Browser/Server Client가 anon 또는 authenticated role로 쿼리 시 `permission denied for table ...` 오류 발생. RLS 정책은 올바르게 작성되어 있으나 테이블 접근 자체가 차단된다.

**확인**: `pg_class.relacl` — anon/authenticated에 `Dxtm`만 있고 `r`(SELECT), `a`(INSERT), `w`(UPDATE), `d`(DELETE) 없음.

**수정 방법**: 마이그레이션 파일 `0001_rls_policies_and_trigger.sql`에 또는 별도 `0002_grant.sql`로 다음 추가:

```sql
GRANT SELECT ON challenges TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles, submissions, letter_pieces, reactions TO authenticated;
GRANT INSERT ON reports TO authenticated;
```

또는 Day 2 migration 파일에 포함할 수 있다. 단, challenges를 anon에게만 SELECT 허용하고 authenticated에게는 RLS로만 제어하도록 세밀하게 설정하는 것이 권장된다.

**판정 근거**: supabase-js가 anon/authenticated role로 동작하는 Supabase PostgREST 아키텍처에서 GRANT는 RLS와 별개의 독립적 접근 제어 레이어다. GRANT 없으면 RLS 이전에 차단된다.

---

#### H2: submissions — hidden 상태 복원 가능 (RLS WITH CHECK 설계 갭) ✅ 해결됨 (재검증 완료)

**현상**: `submissions_update` 정책의 WITH CHECK: `user_id = (SELECT auth.uid()) AND status != 'hidden'`. 이 조건은 **새 row의 status가 hidden이 아니어야 한다**는 의미다. 따라서 현재 status가 `hidden`인 행을 `completed`로 변경하면 WITH CHECK를 통과한다.

**검증 결과**: 실제 DB에서 hidden → completed UPDATE 시 1행 영향 확인 (차단되지 않음).

**설계 의도**: `docs/backend-design-plan.md §3.3` — "status='hidden'으로의 전환은 서비스 키(Admin Client)만 가능". 또한 "사용자가 hidden된 자기 제출을 completed로 되돌리는 것도 차단" 명시.

**수정 방법**: WITH CHECK를 다음과 같이 변경:

```sql
-- 현재 (이슈)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND status != 'hidden'
);

-- 수정안: USING에 hidden 행 차단 추가
CREATE POLICY "submissions_update"
  ON submissions FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND status != 'hidden'    -- hidden 행 자체를 UPDATE 대상에서 제외
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status != 'hidden'
  );
```

USING에 `AND status != 'hidden'`을 추가하면 hidden 행은 UPDATE 대상 행으로 선택되지 않으므로 복원 자체가 불가능해진다.

**판정 근거**: 관리자가 hidden으로 처리한 콘텐츠를 일반 사용자가 복원할 수 있는 것은 콘텐츠 모더레이션 정책 위반이다.

---

### Medium (Day 2 이내 수정 권장)

#### M1: .env.local.example 키 네이밍이 §8.5 결정과 불일치 — Day 2 이관 확정 (사용자 승인)

**현상**: `docs/backend-design-plan.md §8.5` 결정에서 키 명을 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`로 정리하기로 결정했다. 그런데 현재 `.env.local.example`은 `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`로 되어 있다.

**영향**: Day 2 클라이언트 구현 시 코드와 env 변수명이 불일치하면 별도 수정 작업 발생.

**판정 근거**: §8.5 "Day 2에 동시 변경(따로 하면 drift)"이라고 명시되어 있으므로, Day 2 시작 시 반드시 함께 처리해야 함. Day 1 산출물 범위이기도 하므로 이번 PR에서 처리하는 것이 깔끔하다.

---

#### M2: challenges 인덱스 중복 (active_date) — Day 2 이관 확정 (사용자 승인)

**현상**: `challenges.active_date`에 UNIQUE 제약으로 인한 인덱스(`challenges_active_date_unique`)와 `idx_challenges_active_date` 인덱스가 모두 존재한다. 두 인덱스 모두 btree(active_date)이므로 동일한 역할을 한다.

**영향**: 쿼리 최적화에는 지장이 없으나 불필요한 인덱스가 1개 존재하여 INSERT/UPDATE 시 인덱스 관리 오버헤드가 소폭 증가한다.

**수정 방법**: `schema.ts`에서 `index('idx_challenges_active_date').on(table.active_date)` 제거. UNIQUE 제약 인덱스가 이미 동일한 역할을 수행한다.

**판정 근거**: 기능적으로 큰 문제는 없으나 인덱스 중복은 불필요한 저장공간 낭비이고 설계 의도가 불명확해질 수 있다.

---

### Low (참고 사항)

#### L1: reactions.type — CHECK 제약 없음

현재 `reactions.type`은 `DEFAULT 'like'`만 있고 `CHECK (type IN ('like'))` 제약이 없다. MVP에서 'like'만 사용한다면 이상한 type 값이 들어올 수 있다. MVP 범위 내에서는 수용 가능하나, 추후 type 확장 시 마이그레이션이 필요하다.

#### L2: reports — 중복 신고 제한 없음

설계 의도에 따라 중복 신고 허용(UNIQUE 없음). 같은 사용자가 같은 submission을 여러 번 신고 가능하다. MVP에서는 수동 처리이므로 수용 가능.

#### L3: Storage 버킷 미생성

Day 1 범위 외이지만, Storage 버킷 3개(letter-pieces, collages, avatars)는 Day 3에서 생성 예정. 현재 미생성 상태는 정상.

---

## §8.4 보안 규칙 준수 확인

| 규칙 | 내용 | 결과 |
|------|------|------|
| §8.4-① | UPDATE 정책 테이블에 SELECT 정책도 존재 | PASS (submissions, letter_pieces, profiles 모두 SELECT 정책 있음) |
| §8.4-② | UPDATE 정책에 USING + WITH CHECK 둘 다 | PASS (profiles_update, submissions_update, letter_pieces_update 모두 WITH CHECK 있음) |
| §8.4-③ | SECURITY DEFINER + search_path + REVOKE EXECUTE | PASS (proconfig=["search_path=\"\""], proacl=postgres만) |
| §8.4-⑤ | auth 결정에 user_metadata 금지 | PASS (인가 로직에 raw_user_meta_data 미사용, nickname 기본값 생성에만 사용) |
| §8.4-⑥ | (SELECT auth.uid()) 래핑 | PASS (모든 정책 USING/WITH CHECK에서 확인) |

---

## 사용자 수동 테스트 체크리스트 (Supabase 대시보드)

Day 1 산출물은 DB 레이어이므로, Supabase 대시보드에서 다음 항목을 직접 확인한다.

### 필수 확인 (커밋 전)

- [ ] **Table Editor** → 6개 테이블 모두 보임: profiles, challenges, submissions, letter_pieces, reactions, reports
- [ ] **Database → Tables** → 각 테이블 RLS 켜짐(방패 아이콘) 확인
- [ ] **Database → Policies** → 15개 정책 목록 확인
  - challenges: 1개 (SELECT — anon, authenticated)
  - profiles: 2개 (SELECT, UPDATE — authenticated)
  - submissions: 4개 (SELECT×2, INSERT, UPDATE)
  - letter_pieces: 4개 (SELECT, INSERT, UPDATE, DELETE)
  - reactions: 3개 (SELECT, INSERT, DELETE)
  - reports: 1개 (INSERT)
- [ ] **Database → Functions** → `handle_new_user` 함수 존재, SECURITY DEFINER 표시 확인
- [ ] **Database → Triggers** → `on_auth_user_created` 트리거 존재, AFTER INSERT ON auth.users 확인
- [ ] **Database → Indexes** → 5개 커스텀 인덱스 확인 (idx_challenges_active_date, idx_submissions_feed, idx_submissions_user, idx_letter_pieces_submission, idx_reactions_submission)
- [ ] **Logs → Edge Function Logs** → 마이그레이션 실행 시 오류 없었는지 확인

### 권장 확인 (H1 수정 후)

- [ ] **Dashboard → SQL Editor** → `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') AND privilege_type = 'SELECT' ORDER BY table_name;` 실행 → challenges에 anon SELECT, 나머지 테이블에 authenticated SELECT 있음 확인
- [ ] **Security Advisor** → 경고 항목 확인 (supabase CLI 미설치로 대시보드에서 수동 확인)

### H2 수정 후 확인

- [ ] **SQL Editor** → 위 H2 수정 쿼리 실행 후, hidden 상태 행에 대한 UPDATE가 차단되는지 테스트

---

## 커밋 가능 여부

**커밋 가능** ✅

H1(GRANT 누락), H2(hidden 복원 가능) 두 개의 High 이슈가 수정·재검증 완료됐다.

- **H1 RESOLVED**: `0001_rls_policies_and_trigger.sql`에 §3.7 GRANT 블록 추가 및 DB 재적용 완료. information_schema.role_table_grants 실제 DB 검증에서 명세와 1:1 일치 확인. 과잉 권한(anon INSERT/UPDATE/DELETE, profiles/submissions authenticated DELETE) 0건.
- **H2 RESOLVED**: `submissions_update` 정책 USING에 `AND status != 'hidden'` 추가 후 DB 재적용 완료. hidden 행 → completed UPDATE 시 0행 확인. S7(draft→hidden) 차단(42501) 및 is_public 정상 토글(1행) 회귀 없음 확인.
- **M1, M2**: 사용자 승인으로 Day 2 이관 확정. Day 1 커밋 차단 사유 아님.

Critical 0건, High 0건. 커밋 및 PR 진행 가능.

---

## 다음 액션 (구현 Agent)

1. **[필수 - H1]** `0001_rls_policies_and_trigger.sql` 또는 새 마이그레이션 파일에 GRANT 추가 후 DB 적용:
   ```sql
   GRANT SELECT ON challenges TO anon, authenticated;
   GRANT SELECT, INSERT, UPDATE, DELETE ON profiles, submissions, letter_pieces, reactions TO authenticated;
   GRANT INSERT ON reports TO authenticated;
   ```

2. **[필수 - H2]** `submissions_update` 정책 USING에 `AND status != 'hidden'` 추가:
   ```sql
   DROP POLICY "submissions_update" ON submissions;
   CREATE POLICY "submissions_update"
     ON submissions FOR UPDATE
     TO authenticated
     USING (
       user_id = (SELECT auth.uid())
       AND status != 'hidden'
     )
     WITH CHECK (
       user_id = (SELECT auth.uid())
       AND status != 'hidden'
     );
   ```

3. **[Day 2 이관 - M2]** (사용자 승인) `src/db/schema.ts`에서 `index('idx_challenges_active_date')` 제거

4. **[Day 2 이관 - M1]** (사용자 승인) env 변수명을 §8.5 결정대로 정리 (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`)

---

## 재검증 (수정 반영 후)

> 재검증 일시: 2026-06-04
> 검증 대상: H1(GRANT 누락) 수정분, H2(hidden 복원 허용) 수정분
> 검증 방법: 실제 DB 실행 (postgres.js, 트랜잭션 롤백 보장) + 정적 분석

### 재검증 표

| 항목 | 검증 내용 | 결과 | 상세 |
|------|---------|------|------|
| (a)-1 GRANT 명세 일치 | information_schema.role_table_grants: challenges(anon SELECT, authenticated SELECT), submissions(anon SELECT, authenticated SELECT+INSERT+UPDATE), profiles(authenticated SELECT+UPDATE), letter_pieces(authenticated SELECT+INSERT+UPDATE+DELETE), reactions(authenticated SELECT+INSERT+DELETE), reports(authenticated INSERT), service_role ALL | PASS | 명세와 정확히 일치. 불필요한 REFERENCES/TRIGGER/TRUNCATE는 시스템 자동 부여분으로 과잉 권한 아님 |
| (a)-2 과잉 권한 검사 | anon에 INSERT/UPDATE/DELETE 없어야 함 | PASS | 0건 확인 |
| (a)-3 과잉 권한 검사 | profiles/submissions에 authenticated DELETE 없어야 함 | PASS | 0건 확인 |
| (b) S1 재실행 | anon role로 challenges SELECT — permission denied 없어야 함 | PASS | set_config('role','anon') 후 SELECT count(*) 0행 반환, 에러 없음 |
| (c) H2 재현 시도 | authenticated로 hidden 행 → completed UPDATE → 0행이어야 함 | PASS | 0행 확인 — USING의 status != 'hidden' 조건이 hidden 행을 UPDATE 대상에서 제외함 |
| (d) S7 재확인 | authenticated로 draft 행 → hidden UPDATE → 차단되어야 함 | PASS | 42501 (new row violates row-level security policy) — WITH CHECK의 status != 'hidden' 조건 정상 동작 |
| (e) is_public 토글 회귀 | authenticated로 completed+public 행 → is_public=false → 1행이어야 함 | PASS | 1행 확인 — 정상 허용, 회귀 없음 |
| (f) 0001 SQL ↔ 설계 문서 §3.3/§3.7 일치 | submissions_update USING/WITH CHECK의 status != 'hidden', §3.7 GRANT 블록 SQL | PASS | 정적 분석 — 0001 SQL의 §3.7 블록과 backend-design-plan.md §3.7 SQL 1:1 일치. §3.3 submissions_update 코멘트 및 USING 조건 일치 |

### H1 / H2 최종 판정

| 이슈 | 판정 | 근거 |
|------|------|------|
| H1: GRANT 누락 | RESOLVED | §3.7 GRANT 블록 적용, (a)-(b) 실 DB 검증 통과 |
| H2: hidden 복원 허용 | RESOLVED | USING status != 'hidden' 추가, (c)-(e) 실 DB 검증 통과 |

### 사용자 E2E 중 환경 정비 (마이그레이션 외 일회성 적용)

- **Security Advisor WARN 2건** ("Public/Signed-In Users Can Execute SECURITY DEFINER Function") 원인 확인: Day 1 산출물이 아닌 **`public.rls_auto_enable`** (프로젝트 셋업 시 설치된 RLS 자동 활성화 이벤트 트리거 함수, `ensure_rls`에 연결)가 기본 ACL 상태였음.
- `handle_new_user`는 무관 (REVOKE 적용 상태 재확인).
- 처리: 사용자 승인 하에 `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated` 일회성 직접 적용 (2026-06-04). 적용 후 anon/authenticated EXECUTE = false, `ensure_rls` 이벤트 트리거 활성(O) 유지 확인.
- 마이그레이션에 넣지 않은 이유: 이 함수는 우리 마이그레이션 lineage가 만든 객체가 아니므로 (신규 DB 재현 시 존재 보장 없음) 프로젝트 레벨 일회성 정비로 분류.
