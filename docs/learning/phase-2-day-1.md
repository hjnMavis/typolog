# Phase 2 Day 1 — Supabase DB 기반 설정 학습 노트

> 대상 작업: Drizzle 스키마 6테이블 + 하이브리드 마이그레이션 + RLS 15정책 + GRANT + profiles trigger
> 산출물: `src/db/schema.ts`, `src/db/migrations/0001_rls_policies_and_trigger.sql`, `drizzle.config.ts`
> QA 리포트: `docs/reviews/phase2-day1-qa-review.md` (H1/H2 해결 완료)
>
> 이 노트는 한 번에 하나씩 읽도록 개념별 섹션으로 나눴다. 순서는 "DB를 만든다 → 권한의 문을 단다 → 자물쇠를 단다 → 자동화한다 → 연결한다" 흐름이다.

---

## 이번 Day의 큰 그림 (먼저 읽기)

오늘 한 일을 한 문장으로: **"우리 손으로 만든 6개 테이블이, 우리가 의도한 사람에게만, 의도한 동작만 허용하도록 DB 레벨에서 잠갔다."**

데이터가 보호되는 과정을 식당 입장으로 비유하면 이렇게 3겹이다.

```
요청자(anon / authenticated / service_role)
   │
   ├─ 1관문: GRANT         "이 역할이 이 테이블 문을 열 수는 있나?"  ← 없으면 permission denied
   │
   ├─ 2관문: RLS Policy     "이 행(row)을 이 사람이 볼/바꿀 수 있나?"  ← 없으면 0행 (조용히 막힘)
   │
   └─ trigger / 제약조건    "데이터 자체가 규칙에 맞나?"  ← CHECK, UNIQUE, FK
```

오늘 QA가 잡은 두 개의 큰 구멍(H1, H2)이 정확히 1관문(GRANT)과 2관문(RLS)에서 났다. 이 노트의 "자주 하는 실수"에서 1급 사례로 다룬다.

---

## 1. 하이브리드 마이그레이션 — 왜 두 가지 방식을 섞었나

### 왜 필요한가?

DB를 바꾸는 방법은 두 가지다.
- **대시보드에서 손으로**: Supabase 웹 콘솔에서 클릭으로 테이블 생성. 빠르지만 "누가 언제 무엇을 바꿨는지" 기록이 안 남고, 다른 환경(스테이징, 프로덕션)에 똑같이 재현할 수 없다.
- **마이그레이션 파일로**: 변경 내용을 SQL 파일로 코드 저장소에 남긴다. Git으로 추적되고, 새 DB에 순서대로 다시 적용하면 똑같은 상태가 만들어진다.

Typolog는 마이그레이션 파일 방식을 택했다(`docs/backend-design-plan.md §9` Day 1 확정 결정 (a)). 그런데 여기서 한 가지 갈림길이 더 있다.

### 핵심 원리 — generate vs generate --custom

Drizzle Kit은 마이그레이션 SQL을 만드는 방법이 두 가지다.

| 방식 | 명령 | 무엇을 하나 | Typolog에서 |
|------|------|------------|------------|
| 자동 diff | `drizzle-kit generate` | `schema.ts`(현재 원하는 상태)와 DB(현재 상태)를 비교해 차이를 SQL로 자동 생성 | 6개 테이블·인덱스·제약 (`0000_*.sql`) |
| 빈 커스텀 | `drizzle-kit generate --custom` | 빈 SQL 파일만 만들어줌. 사람이 직접 SQL을 채운다 | RLS·GRANT·trigger (`0001_rls_policies_and_trigger.sql`) |

**왜 RLS/trigger는 자동 생성이 안 되나?** Drizzle의 `schema.ts`는 "테이블이 어떻게 생겼나"는 표현하지만, "이 행을 누가 볼 수 있나(RLS)"나 "유저 가입 시 무슨 일이 일어나나(trigger)"는 표현 어휘가 없다(혹은 제한적이다). 그래서 이 둘은 사람이 SQL을 직접 쓴 뒤 `--custom` 빈 파일에 넣는다. 그게 "하이브리드"의 뜻이다 — **테이블은 자동, 정책/트리거는 수동, 적용은 하나로 통일**.

### Typolog에서는?

- `drizzle.config.ts:15` — `schema: './src/db/schema.ts'` (자동 diff의 입력)
- `drizzle.config.ts:16` — `out: './src/db/migrations'` (마이그레이션 파일이 쌓이는 곳)
- `0001_rls_policies_and_trigger.sql:1` — 첫 줄 `-- Custom SQL migration file, put your code below! --` 이게 `--custom`으로 만든 빈 파일이라는 표식이다.

적용은 둘 다 `drizzle-kit migrate` 하나로 한다. Drizzle은 어떤 마이그레이션을 이미 적용했는지 `drizzle.__drizzle_migrations`라는 **저널(journal) 테이블**에 기록해둔다. 그래서 `migrate`를 두 번 실행해도 이미 적용된 파일은 건너뛰고 새 파일만 적용한다(멱등, idempotent).

비유: 마이그레이션 파일 = 요리 레시피 한 장 한 장. 저널 테이블 = "지금까지 몇 번 레시피까지 따라 했는지" 적어둔 체크리스트. 새 레시피만 이어서 만든다.

### `schemaFilter` — auth 스키마는 건드리지 마

`drizzle.config.ts:19` — `schemaFilter: ['public']`

Supabase DB에는 우리가 만든 `public` 스키마 외에 Supabase가 관리하는 `auth` 스키마(`auth.users` 등)가 있다. 만약 이걸 지정하지 않으면, Drizzle이 "어? `auth.users`는 `schema.ts`에 없네? 지워야겠다"고 판단해서 **Supabase 인증 시스템을 통째로 날리는 SQL을 생성**할 수 있다. `schemaFilter: ['public']`은 "너는 public만 관리해, auth는 Supabase 영역이야"라고 선을 긋는 안전장치다.

### 나중에 배울 것
- 마이그레이션 롤백(되돌리기) 전략 — Drizzle은 down 마이그레이션을 자동 생성하지 않는다.
- `prepare: false` (Day 1 결정 (c)): runtime DB 클라이언트(`src/db/index.ts`)를 만드는 Day 2에서 transaction pooler 대비로 설정. 지금은 config에 없음(QA C17 참고).

---

## 2. Drizzle 스키마 표현 — TypeScript로 테이블 그리기

### 왜 필요한가?

`CREATE TABLE` SQL을 직접 쓰면, 나중에 그 테이블을 코드에서 쿼리할 때 컬럼명·타입을 손으로 다시 적어야 한다. 오타가 나도 런타임에서야 터진다. Drizzle은 **테이블 정의를 TypeScript로 한 번만 쓰면, 그 정의에서 SQL도 만들고 타입도 뽑아준다**. 진실의 원천(source of truth)이 하나가 된다.

### Typolog에서는?

`src/db/schema.ts` 한 파일에 6개 테이블이 다 있다. 이 한 파일의 끝에서 타입까지 뽑는다.

```typescript
// src/db/schema.ts:137-138
export type Profile = typeof profiles.$inferSelect;   // SELECT 결과 타입
export type NewProfile = typeof profiles.$inferInsert; // INSERT 입력 타입
```

`$inferSelect`(조회 결과)와 `$inferInsert`(삽입 입력)가 다른 이유: `id`는 조회하면 있지만, 삽입할 땐 `defaultRandom()`이라 안 넣어도 된다. Drizzle이 이 차이를 타입에 반영한다. Day 2 이후 Route Handler에서 이 타입을 그대로 쓴다.

### 핵심 원리 — 알아둘 표현 5가지

1. **`check()` — 값의 범위 제약**
   `submissions.status`는 아무 문자열이나 들어오면 안 되고 셋 중 하나여야 한다.
   ```typescript
   // schema.ts:65
   check('submissions_status_check', sql`${table.status} IN ('draft', 'completed', 'hidden')`)
   ```
   DB가 직접 검사하므로, 코드가 실수로 `'deleted'`를 넣으려 하면 INSERT 자체가 거부된다.

2. **`unique()` — 중복 금지**
   ```typescript
   // schema.ts:66
   unique('submissions_user_challenge_unique').on(table.user_id, table.challenge_id)
   ```
   "한 사용자가 한 챌린지에 제출물 1개만". 두 컬럼을 묶은 복합 유니크다.

3. **부분 인덱스 `.where()` — 조건부 색인**
   ```typescript
   // schema.ts:67-69
   index('idx_submissions_feed')
     .on(table.challenge_id, table.created_at.desc(), table.id)
     .where(sql`${table.status} = 'completed' AND ${table.is_public} = true`)
   ```
   피드는 항상 "완성 + 공개"만 보여준다. draft·hidden 행까지 색인에 넣으면 색인이 쓸데없이 커진다. `.where()`로 **조건에 맞는 행만 색인**에 담는다(설계 §10.8). 책 뒤 색인에서, 자주 찾는 항목만 추려 만든 미니 색인이라고 보면 된다.

4. **`created_at.desc()` — 정렬 방향까지 색인에 박기**
   피드는 최신순(`created_at DESC`)으로 본다. 색인을 만들 때부터 내림차순으로 만들어두면, DB가 조회 시 따로 정렬할 필요 없이 색인 순서대로 읽으면 된다.

5. **`authUsers` FK + `schemaFilter`의 짝**
   ```typescript
   // schema.ts:1, 20-22
   import { authUsers } from 'drizzle-orm/supabase';
   id: uuid('id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' })
   ```
   `profiles.id`는 Supabase의 `auth.users.id`를 그대로 참조한다(1:1 관계). `drizzle-orm/supabase`가 제공하는 `authUsers`로 auth 테이블을 "읽기 참조"만 한다. 그리고 §1에서 본 `schemaFilter: ['public']` 덕분에 Drizzle은 이걸 **참조만 하고 마이그레이션 대상으로는 삼지 않는다**. 이 둘은 한 세트다.

### 자주 하는 실수
- **인덱스 중복** (QA M2, Day 2 이관): `active_date`에 `unique()`를 걸면 PostgreSQL이 자동으로 유니크 인덱스를 만든다. 그런데 `schema.ts:42`에서 `idx_challenges_active_date`를 또 만들었다. 같은 컬럼에 같은 종류 인덱스가 둘 = 저장공간·쓰기 비용 낭비. UNIQUE 제약이 이미 인덱스 역할을 한다는 걸 몰라서 생긴 중복이다.

### 나중에 배울 것
- Drizzle Relations API (`relations()`)로 조인을 타입 안전하게 표현하기 — Day 4 피드 쿼리에서.

---

## 3. GRANT vs RLS — 보안의 2단 관문 (실전: QA H1)

### 왜 필요한가? — 둘은 "다른 문"이다

가장 헷갈리는 지점이다. **GRANT와 RLS는 같은 보안의 두 단계가 아니라, 순서가 있는 별개의 문**이다.

```
요청  →  [GRANT 검사]  →  [RLS 검사]  →  데이터
         "테이블에        "이 행을
          접근할 권한이     볼 권한이
          있나?"           있나?"
```

- **GRANT**: 테이블 단위. "이 역할(anon/authenticated)이 이 테이블에 SELECT/INSERT/... 할 수 있나?" — PostgreSQL의 기본 권한 시스템.
- **RLS**: 행(row) 단위. "이 테이블 안에서, 어떤 행을 볼/바꿀 수 있나?" — 정책(Policy)으로 제어.

순서가 핵심이다. **GRANT가 없으면 RLS 정책에 도달조차 못 한다.** 아무리 RLS 정책을 완벽하게 짜도, GRANT가 없으면 `permission denied for table ...` 에러로 그 앞에서 막힌다.

비유: GRANT = 건물 1층 정문 출입증. RLS = 각 방의 도어락. 정문 출입증이 없으면, 방 도어락이 아무리 정교해도 건물 안에 들어가지도 못한다.

### 실전 사례 — QA H1 (1급 실수)

오늘 실제로 이 문제가 터졌다.

**무슨 일이 있었나**: Supabase 대시보드에서 테이블을 만들면 Supabase가 친절하게 `anon`/`authenticated`에게 자동으로 GRANT를 걸어준다. 그런데 우리는 **drizzle-kit으로 테이블을 만들었다.** drizzle-kit은 `postgres` role로 DB에 직접 붙어서 테이블을 만든다. 이 경로에는 **Supabase의 자동 GRANT가 적용되지 않는다.** 결과적으로 `anon`/`authenticated`에겐 `REFERENCES`/`TRIGGER`/`TRUNCATE` 같은 무관한 권한만 남고, 정작 필요한 `SELECT`/`INSERT`/`UPDATE`/`DELETE`가 없었다.

**증상**: Day 2에서 supabase-js가 anon/authenticated로 쿼리하면 `permission denied for table challenges`. RLS 정책은 멀쩡한데 그 앞 관문에서 차단.

**고친 방법** (`0001_rls_policies_and_trigger.sql:202-216`, §3.7 GRANT 블록):
```sql
GRANT SELECT ON challenges TO anon, authenticated;
GRANT SELECT ON submissions TO anon, authenticated;
GRANT INSERT, UPDATE ON submissions TO authenticated;
GRANT SELECT, UPDATE ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON letter_pieces TO authenticated;
GRANT SELECT, INSERT, DELETE ON reactions TO authenticated;
GRANT INSERT ON reports TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
```

**원칙**: RLS 정책 요약표가 허용하는 동작과 **1:1로 정렬된 최소 권한만** 부여한다. 예를 들어 `reactions`에는 UPDATE 정책이 없으므로 GRANT에도 UPDATE를 주지 않는다. `profiles`/`submissions`에는 DELETE 정책이 없으므로 DELETE GRANT도 없다. (설계 §3.7·§8.4-⑦)

### 자주 하는 실수
- **"RLS 짰으니 끝"이라고 착각**: GRANT를 안 줘서 정책에 도달도 못 하는 경우. → permission denied. (= QA H1)
- **반대로 GRANT만 주고 RLS 정책을 안 만든 경우**: RLS가 켜진 테이블은 정책이 없으면 **모든 행을 0행 처리**(fail-closed)한다. GRANT는 있어도 막힌다. 두 관문을 다 통과시켜야 한다.
- **GRANT를 과하게 줌**: `GRANT ALL`을 anon에게 주는 것 같은 실수. 정책 표면과 GRANT 표면이 어긋나면, RLS를 깜빡 잘못 짠 순간 곧장 구멍이 된다. 최소 권한 원칙이 방어선 하나를 더 만든다.

### 나중에 배울 것
- §8.5의 "Data API(REST) 비노출" 결정 — Day 2 적용. GRANT/RLS와 별개로, REST 경로 자체를 닫아 공격 표면을 한 겹 더 줄이는 defense in depth.

---

## 4. RLS — USING vs WITH CHECK 비대칭 (실전: QA H2)

### 왜 필요한가?

RLS 정책에는 조건을 거는 자리가 두 개 있다. 이름이 비슷해서 같은 거라 생각하기 쉽지만 **검사하는 시점과 대상이 다르다.** 이 차이를 모르면 오늘 H2 같은 구멍이 난다.

| 자리 | 검사 대상 | 적용 작업 | 한 문장 |
|------|----------|----------|---------|
| `USING (조건)` | **기존 행** (변경 전 상태) | SELECT / UPDATE / DELETE | "이 행을 작업 대상으로 **고를** 수 있나?" |
| `WITH CHECK (조건)` | **새 행** (변경 후 상태) | INSERT / UPDATE | "이 결과를 **저장**해도 되나?" |

UPDATE는 둘 다 거친다: 먼저 `USING`으로 "바꿀 행을 고르고", 바꾼 뒤 `WITH CHECK`로 "결과가 규칙에 맞는지" 검사한다.

비유: `USING` = "이 서랍을 열 수 있나?" / `WITH CHECK` = "이 물건을 서랍에 넣어도 되나?". 둘 다 통과해야 UPDATE가 성립한다.

### 실전 사례 — QA H2 (1급 실수)

**규칙 의도** (설계 §3.3): 사용자는 자기 제출물을 수정할 수 있지만, 관리자가 `hidden`(숨김 처리)한 콘텐츠를 사용자가 다시 `completed`로 되돌리는 것은 막아야 한다.

**처음 작성 (구멍 있음)**: `WITH CHECK`에만 `status != 'hidden'`을 걸었다.
```sql
WITH CHECK (user_id = (SELECT auth.uid()) AND status != 'hidden')
```
이건 "새 행의 status가 hidden이면 안 된다"는 뜻이다. 즉, 사용자가 자기 글을 `hidden`**으로** 바꾸는 건 막힌다. ✅

**그런데 무엇이 뚫렸나**: `hidden` 행을 `completed`로 되돌리면? 새 행의 status는 `'completed'`라서 `status != 'hidden'`을 **만족한다.** `WITH CHECK`를 통과한다. 그리고 `USING`에는 hidden 행을 막는 조건이 없으니 그 hidden 행이 작업 대상으로 선택된다. → **복원 성공. 모더레이션 정책 위반.** QA가 실제 DB에서 `UPDATE ... 1행 영향`으로 재현했다.

**고친 방법** (`0001_rls_policies_and_trigger.sql:79-89`): `USING`에도 `status != 'hidden'`을 추가.
```sql
CREATE POLICY "submissions_update"
  ON submissions FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND status != 'hidden'        -- ← 핵심: hidden 행을 아예 "고를" 수 없게
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status != 'hidden'        -- hidden "으로" 바꾸는 것도 차단
  );
```

이제 두 방향이 다 막힌다:
- `WITH CHECK`의 `status != 'hidden'` → hidden **으로** 전환 차단 (예: draft→hidden 시도 = 42501 에러)
- `USING`의 `status != 'hidden'` → hidden **에서** 복원 차단 (hidden 행이 대상으로 선택조차 안 됨 = 0행)

결과적으로 hidden 행은 소유자도 어떤 컬럼도 수정 불가(fail-closed). 관리자(service_role)는 RLS를 우회하므로 hidden 설정·해제가 가능하다. (설계 §3.3 "핵심 판단")

### 또 하나의 비대칭 사례 — letter_pieces_update

`0001_..._trigger.sql:127-143`에도 같은 교훈이 있다. UPDATE에 `WITH CHECK`가 없으면, 사용자가 글자 조각의 `submission_id`를 **타인의 submission으로 재할당**할 수 있다. `USING`은 "내 것을 고르는지"만 보고, 바꾼 결과까지는 안 보기 때문이다. 그래서 `USING`과 `WITH CHECK` 둘 다에 소유권 검사를 넣었다(설계 §8.4-②).

### 자주 하는 실수 (요약)
- **`WITH CHECK`만 걸고 끝**: 변경 후 상태만 검사해서, "특정 상태에서 빠져나오는" 동작(hidden→completed)을 못 막는다. = QA H2.
- **UPDATE에 `WITH CHECK` 생략**: 소유자가 자기 행을 남에게 넘기는 재할당이 가능해진다. = letter_pieces 케이스.
- **UPDATE 정책만 만들고 SELECT 정책 누락**: RLS UPDATE는 대상 행을 먼저 SELECT한다. SELECT 정책이 없으면 update가 에러 없이 조용히 0행 처리된다(설계 §8.4-①). submissions·letter_pieces·profiles 모두 SELECT 정책이 함께 있다.

### 나중에 배울 것
- "정책 없는 SELECT = 차단"의 활용: `reports`에는 SELECT 정책을 일부러 안 만들어서 일반 사용자 조회를 막았다(`0001_..._trigger.sql:188`, 관리자만 service_role로 조회). 정책의 부재 자체가 보안 설계가 된다.

---

## 5. `(SELECT auth.uid())` 래핑 — 행마다 재평가를 막는 캐시

### 왜 필요한가?

RLS 정책의 조건은 **테이블의 모든 행에 대해** 평가된다. 만약 `auth.uid()`를 그냥 쓰면(`user_id = auth.uid()`), PostgreSQL이 이걸 행마다 다시 호출할 수 있다. 행이 10만 개면 함수가 10만 번 불린다.

`(SELECT auth.uid())`처럼 서브쿼리로 감싸면, PostgreSQL의 옵티마이저가 "이 값은 쿼리 내내 안 변하네"라고 인식해서 **한 번만 평가하고 캐시(initPlan)**한다. 대형 테이블에서 100배까지 성능 차이가 난다고 알려져 있다(설계 §8.4-⑥, supabase 베스트 프랙티스 스킬).

비유: 입장객 수천 명에게 매번 "오늘 날짜가 뭐죠?"를 묻는 대신(bare `auth.uid()`), 입구에 날짜 한 번 적어두고 모두가 그걸 참조하는 것(`(SELECT auth.uid())`).

### Typolog에서는?

`0001_rls_policies_and_trigger.sql`의 **모든 정책**이 이 패턴을 쓴다. 예:
- `:34` `USING ((SELECT auth.uid()) = id)` (profiles_update)
- `:58` `user_id = (SELECT auth.uid())` (submissions_select)
- `:194` `WITH CHECK (reporter_id = (SELECT auth.uid()))` (reports_insert)

### 자주 하는 실수
- bare `auth.uid()`를 그대로 사용 → 기능은 똑같이 동작해서 테스트에선 안 보이지만, 데이터가 쌓일수록 피드/조회가 느려진다. "동작하니까 괜찮다"가 함정. 처음부터 래핑하는 습관을 들인다.

### 나중에 배울 것
- `auth.role()` 대신 정책에 `TO authenticated`/`TO anon`로 역할을 직접 지정하는 이유(설계 §8.4 마지막 노트) — 역할 지정도 같은 성능·명확성 논리다.

---

## 6. SECURITY DEFINER trigger 3종 세트 — 자동화와 그 위험

### 왜 필요한가?

사용자가 OAuth로 가입하면 Supabase가 `auth.users`에 행을 만든다. 그런데 우리 앱은 닉네임·아바타를 담는 `public.profiles`가 따로 필요하다. **가입할 때마다 자동으로 profiles 행을 만들어주는 장치**가 trigger다. 사용자가 코드를 안 거치고 어떤 경로로 가입해도 profiles가 빠짐없이 생긴다.

### 핵심 원리 — trigger가 도는 흐름

```
사용자 OAuth 가입
  → auth.users에 INSERT 발생
    → on_auth_user_created 트리거가 감지 (AFTER INSERT)
      → handle_new_user() 함수 실행
        → public.profiles에 자동 INSERT (id, nickname)
```

`0001_rls_policies_and_trigger.sql:224-250`에 함수와 트리거가 있다.

### 왜 "3종 세트"인가 — SECURITY DEFINER의 함정과 방어

문제는 이 함수가 `SECURITY DEFINER`라는 점이다. 보통 함수는 **호출한 사람의 권한**으로 돈다(SECURITY INVOKER). 하지만 trigger가 profiles에 INSERT하려면 RLS를 우회할 권한이 필요하다(profiles의 INSERT는 정책상 trigger만 허용). 그래서 **함수를 정의한 사람(소유자)의 권한**으로 도는 `SECURITY DEFINER`를 쓴다.

`SECURITY DEFINER`는 강력해서 위험하다. 그래서 3개의 안전장치를 같이 건다(설계 §1.1·§8.4-③):

1. **`SET search_path = ''`** (`:240`)
   `search_path`는 "스키마 이름을 안 붙였을 때 어디서 찾을지" 순서다. 공격자가 search_path를 조작해 `public.profiles` 대신 자기가 만든 가짜 테이블을 가리키게 하는 **search_path 하이재킹**이 가능하다. `''`로 비우면 모든 객체를 `public.profiles`처럼 **풀네임으로만** 찾게 강제된다. 함수 본문이 `public.profiles`로 정규화된 것도 이 때문이다.

2. **`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`** (`:244`)
   public 스키마 함수는 기본적으로 PUBLIC에 EXECUTE가 부여된다. 즉 anon/authenticated가 이 강력한 함수를 **직접 호출**할 수 있게 된다(공개 API화). 이 함수는 trigger만 부르면 되므로, 일반 역할의 EXECUTE를 회수해 공개 표면을 닫는다.

3. **닉네임 `LEFT(..., 20)` 클램프** (`:230-236`)
   ```sql
   LEFT(COALESCE(NEW.raw_user_meta_data->>'name', 'user_' || LEFT(NEW.id::TEXT, 8)), 20)
   ```
   - OAuth가 준 이름이 있으면 그걸, 없으면 `user_` + UUID 앞 8자리를 닉네임으로.
   - `LEFT(..., 20)`로 20자에서 자른다. validation 규칙(닉네임 2~20자, 설계 §7.2)과 정합. 누가 200자짜리 이름으로 가입해도 DB가 깨지지 않는다. (QA C15: 한글 25자 → 20자 정상 클램프 확인)

### 자주 하는 실수
- **`SECURITY DEFINER`에 `SET search_path`를 안 검**: 가장 흔하고 위험한 실수. Supabase Security Advisor가 경고로 잡는다.
- **`REVOKE EXECUTE` 누락**: 함수가 anon/authenticated에게 호출 가능한 채로 남는다. (오늘 QA 재검증에서, Day 1 산출물이 아닌 프로젝트 셋업 시 설치된 `rls_auto_enable` 함수가 이 상태여서 Advisor WARN이 떴고, 일회성으로 REVOKE 처리했다 — QA 재검증 섹션.)
- **인가 판단에 `raw_user_meta_data` 사용**: `raw_user_meta_data`는 **사용자가 수정 가능**하다. 우리는 닉네임 기본값 생성에만 썼지(데이터), 권한 판단(인가)에는 안 썼다(설계 §8.4-⑤). 만약 "이 메타데이터에 admin=true면 관리자"처럼 인가에 쓰면 누구나 관리자가 될 수 있다. 인가는 `app_metadata`로.

### 나중에 배울 것
- Day 2 작업: trigger가 실제로 도는지 확인(2-9). OAuth 로그인 → auth.users INSERT → profiles 자동 생성 플로우를 E2E로 본다.

---

## 7. Session pooler(5432) 연결 — DATABASE_URL과 % 인코딩 함정

### 왜 필요한가?

drizzle-kit이 DB에 붙으려면 접속 주소(DATABASE_URL)가 필요하다. Supabase는 DB 연결을 위해 **pooler(연결 풀러)**를 제공한다. 매 요청마다 새 연결을 여는 대신, 미리 열어둔 연결을 재사용해 부하를 줄인다.

| 포트 | 이름 | 용도 |
|------|------|------|
| 5432 | Session pooler | 세션 단위 연결. 마이그레이션·서버 장기 연결에 적합 |
| 6543 | Transaction pooler | 트랜잭션 단위. 서버리스(Vercel) 다수 짧은 연결에 적합 |

Day 1은 **5432(Session pooler)**로 확정(설계 §9 결정 (c)). Vercel 배포 시 6543 전환을 대비해 `prepare: false`도 Day 2에 함께 둘 예정.

### DATABASE_URL 구조

```
postgresql://[user]:[password]@[host]:5432/[database]
              └─ 여기 비밀번호가 들어간다
```

`drizzle.config.ts:4`의 `process.loadEnvFile('.env.local')`로 이 값을 읽는다. (Node v20.12+ 내장 기능. dotenv 패키지 없이 처리 — 결정 (a).) 없으면 `:8`에서 명확한 에러를 던진다.

### 실전 함정 — % 가 든 비밀번호 (오늘 실제 디버깅)

오늘 인증 실패를 한참 디버깅했는데, 원인은 **비밀번호에 `%` 문자가 들어 있던 것**이었다.

DATABASE_URL은 URL이다. URL에서 `%`, `@`, `:`, `/`, `#` 같은 문자는 **특수한 의미**를 가진다. 특히 `%`는 "퍼센트 인코딩의 시작" 신호다. 비밀번호가 `pa%ss`인데 그대로 URL에 넣으면, 파서가 `%ss`를 인코딩된 문자로 해석하려다 깨진다. 인증이 실패하는데 비밀번호는 "맞는 것 같아서" 원인 찾기가 어렵다.

**해결**: 비밀번호의 특수문자를 **퍼센트 인코딩(URL 인코딩)**한다.

| 문자 | 인코딩 |
|------|--------|
| `%` | `%25` |
| `@` | `%40` |
| `:` | `%3A` |
| `/` | `%2F` |
| `#` | `%23` |

예: 비밀번호 `pa%ss@1` → URL에는 `pa%25ss%401`로 넣는다.

비유: URL은 문장이고 `%`·`@`는 문장부호다. 비밀번호에 문장부호와 똑같이 생긴 글자가 있으면, 따옴표(인코딩)로 감싸 "이건 부호가 아니라 글자야"라고 알려줘야 한다.

### 자주 하는 실수
- **비밀번호 특수문자를 raw로 넣음** → 인증 실패. 에러 메시지가 "password authentication failed"라 비밀번호 자체를 의심하게 되어 더 헤맨다. (오늘 사례)
- **`.env.local`을 Git에 커밋**: DATABASE_URL에는 DB 비밀번호가 통째로 들어 있다. 절대 커밋 금지. (이 파일은 시크릿이라 읽지도 않는다.)
- **`NEXT_PUBLIC_` 접두어 실수**: DATABASE_URL·SECRET 키에 `NEXT_PUBLIC_`을 붙이면 클라이언트 번들에 노출된다. 서버 전용 값엔 절대 금지(`.env.local.example`에 경고 주석 있음, QA C18).

### 나중에 배울 것
- Day 2: runtime DB 클라이언트(`src/db/index.ts`) 생성 + Vercel 배포 시 transaction pooler(6543) 전환과 `prepare: false`의 관계.

---

## 다음 Day(Day 2) 전에 알면 좋은 선행 개념

Day 2는 **Supabase 클라이언트 3종 + Auth(Google OAuth) + middleware**다. 오늘 만든 RLS/GRANT가 거기서 "실제로 적용되는" 순간이 온다.

1. **세 클라이언트가 다른 "역할"로 DB를 친다** (설계 §10.10)
   - Browser/Server Client → `anon` 또는 `authenticated` 역할 → **오늘 만든 GRANT + RLS가 적용된다.**
   - Admin Client(service_role) → **RLS를 우회한다.** 그래서 service_role에 `GRANT ALL`을 줬다(`0001:216`). 절대 클라이언트에 노출 금지.
   - 오늘 H1(GRANT)을 고친 이유가 바로 이것: Day 2에 supabase-js가 anon/authenticated로 붙는 순간 GRANT가 없으면 즉시 permission denied.

2. **DB 접근은 두 길** (architecture.md, 설계 §10.3)
   - Auth/Storage → supabase-js (RLS·GRANT 경로)
   - 일반 DB 쿼리 → Drizzle 직결(postgres role) — 이건 RLS를 우회하므로 API 코드에서 소유권을 직접 검증한다(방어적 프로그래밍).

3. **JWT와 쿠키 세션** (설계 §10.9)
   - OAuth 성공 → Supabase가 JWT 발급 → HTTP-only 쿠키 저장 → 이후 요청에 자동 동봉.
   - 이 JWT 안의 user_id가 RLS의 `auth.uid()`로 흘러온다. 오늘 정책의 `(SELECT auth.uid())`가 Day 2에 실제 값을 받기 시작한다.

4. **middleware의 역할**: 모든 요청에서 세션을 확인하고 비로그인 시 `/login`으로 보낸다. RLS는 "마지막 방어선"이고 middleware는 "현관 안내"다 — 둘 다 필요하다.

5. **§8.5 보안 결정 2건 적용**(Day 2): Data API(REST) 비노출 + env 키 네이밍 정리(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY`). QA M1이 이 항목을 Day 2로 이관했다.

---

## 한 줄 정리 모음 (복습용)

- **하이브리드 마이그레이션**: 테이블은 `generate`(자동 diff), RLS/trigger는 `generate --custom`(수동 SQL), 적용은 `migrate` 하나로. 저널 테이블이 적용 이력을 추적한다.
- **GRANT vs RLS**: GRANT(테이블 출입증)를 통과해야 RLS(행 도어락)에 도달한다. drizzle-kit으로 만든 테이블엔 Supabase 자동 GRANT가 없다 → 수동 GRANT 필수(H1).
- **USING vs WITH CHECK**: USING=기존 행 선택, WITH CHECK=새 행 저장. hidden 복원을 막으려면 USING에도 조건이 필요하다(H2).
- **`(SELECT auth.uid())`**: 행마다 재평가 대신 1회 캐시. 대형 테이블 성능.
- **SECURITY DEFINER 3종 세트**: `SET search_path=''` + `REVOKE EXECUTE` + 입력 클램프(`LEFT(...,20)`).
- **DATABASE_URL**: 비밀번호의 `%`·`@` 등은 퍼센트 인코딩(`%`→`%25`). Session pooler는 5432.
