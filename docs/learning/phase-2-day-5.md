# Phase 2 Day 5 — RLS·Storage 권한 검증 (검증 + 마무리) 학습 노트

> 대상 작업(§9 Day 5 확정 결정): Day 1~4.5에서 만든 **보안 장치(RLS 정책 + Storage 정책)가 라이브 DB에 실제로 작동하는지**를 코드로 증명한다.
> 산출물: `scripts/verify-rls.ts`(36건 프로브 매트릭스 — Part 1 테이블 RLS 27건 + Part 2 Storage 크로스 유저 9건), `.env.local.example`·`next.config.ts` 정리, `docs/backend-design-plan.md` §6.3·§9 동기화.
> 참고: `docs/learning/phase-2-day-4.5.md`(직전 노트), `docs/reviews/phase2-day5-qa-review.md`(게이트 B 판정·Medium 처리), `docs/backend-design-plan.md` §3·§5·§8.4, 로드맵 #6(RLS)·#5(Storage).

---

## 이번 Day의 큰 그림 (먼저 읽기)

Day 1에서 RLS 정책을, Day 3에서 Storage 정책을 **만들었다**. 하지만 "만들었다"와 "작동한다"는 다른 말이다.
정책을 SQL로 써놓고 마이그레이션을 돌렸다고 해서, 그 정책이 정말 타인의 비공개 제출을 막는지는 **아무도 확인하지 않았다**.

그리고 여기 함정이 하나 있다. **앱을 아무리 클릭해도 테이블 RLS는 한 번도 실행되지 않는다.**

```
[앱이 DB를 만지는 경로]        Next.js Route Handler ──Drizzle 직결(postgres role)──▶ DB
                              → RLS "우회". 소유권은 코드(getOwnedSubmission)가 검증.
                              → 그래서 클릭만으로는 submissions_select 정책이 발동 안 함.

[앱이 Storage를 만지는 경로]   브라우저/서버 ──supabase 클라이언트(유저 JWT)──▶ Storage
                              → 버킷 정책(RLS)이 실제 발동.
```

이 비대칭이 이번 Day의 출발점이다. **DB는 "정책이 묻혀 있고", Storage는 "정책이 살아 있다."**
그래서 검증 방법이 둘로 갈린다:

```
Part 1 (테이블)   — SQL 시뮬레이션. SET LOCAL ROLE + JWT 클레임 주입으로
                    "유저인 척" 정책을 직접 두드린다. 전부 ROLLBACK → 라이브 무변경.
Part 2 (Storage)  — 진짜 JWT. 테스트 계정 A·B를 즉석 생성해 실제로 타인 파일 다운로드를
                    시도한다. fixture는 만들고 finally에서 정리.
```

이번 Day에 새로 등장하는 개념을 우선순위 순으로 본다.

1. **DB(RLS 우회) vs Storage(정책 발동)의 이원 방어** — 왜 같은 앱인데 검증이 둘로 갈리나
2. **RLS 시뮬레이션** — `SET LOCAL ROLE` + JWT 클레임 주입으로 `auth.uid()`를 흉내 내는 법
3. **savepoint 격리 + 트랜잭션 ROLLBACK** — 라이브 DB를 안 건드리고 검증하는 패턴
4. **GRANT 레이어 vs RLS 레이어** — 평가 순서, drizzle-kit 테이블에 GRANT를 명시하는 이유
5. **USING vs WITH CHECK** — UPDATE 정책의 두 단계, H2 회귀와 재할당 차단의 변별력
6. **검증의 거짓 양성 방어** — "차단됨"이 "정책이 막음"인지 "객체 부재"인지 구분하는 법
7. **env 로딩의 함정** — 검증 스크립트는 왜 앱과 똑같이 env를 읽어야 하나

---

## 1. DB vs Storage — 왜 검증이 둘로 갈리는가 (이원 방어)

### 왜 필요한가? — "같은 앱인데 보안이 두 군데서, 다른 방식으로 걸린다"

Typolog의 데이터는 두 곳에 산다.
- **테이블**(submissions, letter_pieces…): PostgreSQL 행
- **파일**(글자 조각 webp, 콜라주 png): Supabase Storage 객체

문제는 **이 둘에 접근하는 "신분"이 다르다**는 점이다.

```
                    어떤 권한으로 DB/Storage를 치는가?           RLS 적용?
─────────────────────────────────────────────────────────────────────
테이블(Drizzle 직결)   postgres role (앱의 DATABASE_URL)          ✗ 우회
Storage(supabase SDK)  유저 JWT (브라우저/서버 client)            ✓ 발동
```

`scripts/verify-rls.ts:4-9` 주석이 이걸 한 문장으로 정리한다:
> DB는 Drizzle 직결(postgres role)로 접근 → RLS를 "우회"하고 소유권은 코드(`getOwnedSubmission` 등)가 검증한다.
> 그래서 앱을 클릭하는 것만으로는 테이블 RLS 정책이 한 번도 실행되지 않는다.

이게 왜 중요하냐면 — **검증을 "앱을 클릭해서" 하면 테이블 RLS는 영원히 안 돌아본다.** 통과한 줄 알지만 실은 테스트조차 안 한 것이다.

### Typolog에서는?

`src/app/api/submissions/[id]/route.ts:33-46`가 이 "우회 경로의 방어"를 그대로 보여준다.

```ts
// DB는 Drizzle 직결(RLS 우회)이라 가시성을 코드로 판정한다 (§3.3과 동일 규칙).
const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
const isOwner = !!submission && submission.user_id === user.id;
const isPublicCompleted = !!submission && submission.status === 'completed' && submission.is_public === true;
if (!submission || (!isOwner && !isPublicCompleted)) {
  return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
}
```

여기서 `isOwner`/`isPublicCompleted` 분기는 사실 RLS의 `submissions_select` 정책(`0001_rls_policies_and_trigger.sql:54-67`)의 `USING` 절을 **TypeScript로 손으로 베껴 쓴 것**이다. RLS가 우회되니 같은 규칙을 코드가 다시 한다.

반대로 Storage는 `route.ts:48-57`에서 `createSignedUrl(supabase, 'collages', ...)`로 **요청자 JWT가 실린 server client**로 서명한다 — 여기선 진짜 Storage 정책(`0003_storage_buckets_and_policies.sql §5.2`)이 발동해서, 권한 없는 경로는 서명 자체가 null로 떨어진다(`route.ts:59-86`).

### 비유

아파트로 비유하면 —
- **테이블** = 관리사무소(앱 서버)가 마스터키(postgres role)로 모든 집을 연다. 각 집의 도어락(RLS)은 마스터키엔 안 걸린다. 그래서 "이 사람이 이 집 주인 맞나"를 관리사무소 직원(코드)이 장부 보고 직접 확인해야 한다.
- **Storage** = 각 입주민이 자기 카드키(JWT)로 직접 출입한다. 도어락(Storage 정책)이 카드키를 실제로 검사한다.

**핵심**: 같은 앱이어도 "마스터키로 여느냐, 개인 카드키로 여느냐"에 따라 도어락(RLS)이 작동할 수도, 무력화될 수도 있다. 그래서 검증도 두 갈래여야 한다.

---

## 2. RLS 시뮬레이션 — `auth.uid()`를 흉내 내기

### 왜 필요한가? — "정책이 묻혀 있으니 직접 깨워야 한다"

§1에서 본 대로 테이블 RLS는 앱 클릭으로 안 돌아간다. 그럼 어떻게 깨우나?
**일부러 "유저인 척" DB에 들어가서 정책을 직접 두드려야 한다.** Supabase의 `auth.uid()`가 어디서 값을 읽는지 알면 흉내 낼 수 있다.

`auth.uid()`는 마법이 아니다. 그냥 **현재 세션의 설정값(`request.jwt.claims`)에서 `sub`를 꺼내는 함수**다.
그래서 (1) 역할을 `authenticated`로 바꾸고 (2) 그 설정값에 가짜 `sub`를 넣으면, DB는 "아 이 사람이 그 유저구나" 하고 정책을 평가한다.

### Typolog에서는?

`scripts/verify-rls.ts:114-123`의 `probe` 함수 내부가 핵심이다.

```ts
await sp.unsafe(`SET LOCAL ROLE ${opts.role}`);          // ① 역할 전환 (authenticated/anon)
const claims = opts.sub ? JSON.stringify({ sub: opts.sub, role: opts.role }) : '';
await sp`SELECT set_config('request.jwt.claims', ${claims}, true)`;        // ② 신(新) 형식
await sp`SELECT set_config('request.jwt.claim.sub', ${opts.sub ?? ''}, true)`; // ③ 구(舊) 형식
```

세 줄을 뜯어보면:

- **① `SET LOCAL ROLE`** — RLS 정책의 `TO authenticated` / `TO anon`을 발동시키는 스위치. `0001_..._trigger.sql:25`의 `TO authenticated`, `:45`의 `TO anon, authenticated`가 이 역할에 반응한다. `role`은 화이트리스트 상수(`'authenticated' | 'anon' | 'postgres'`)만 받아서 SQL 인젝션을 막는다(`verify-rls.ts:99`, `:116` 주석).
- **②③ JWT 클레임 주입** — `auth.uid()`가 읽을 값. Supabase 버전에 따라 구형(`request.jwt.claim.sub`)·신형(`request.jwt.claims->>'sub'`) 중 하나를 읽으므로 **둘 다** 넣는다(`:117-118` 주석). 이게 들어가면 `0001_..._trigger.sql:58`의 `user_id = (SELECT auth.uid())`가 우리가 준 가짜 유저 ID로 평가된다.
- **anon 처리** — `opts.sub`가 null이면 클레임을 빈 문자열로 둔다. Supabase `auth.uid()` 정의의 `nullif(current_setting(...), '')`가 빈 문자열을 NULL로 흡수해서, anon은 `auth.uid()`가 NULL이 된다(`:119-120` 주석).

실제 프로브 예시 — `verify-rls.ts:201-205`:
```ts
await probe(tx, {
  name: 'submissions: B는 A의 비공개 제출을 못 본다 (API 404의 DB 토대)',
  role: 'authenticated', sub: B, expect: { kind: 'rows', value: 0 },
  run: (sp) => selectCount(sp, 'submissions', 'id', sApriv),
});
```
"B인 척" 들어가서 A의 비공개 제출을 SELECT → **0행**이 나와야 통과. 이게 §1에서 본 API 404 응답의 **DB 차원 토대**다.

### 비유

연극 무대에 서기 전, 분장실에서 **의상(ROLE)을 갈아입고 신분증(JWT 클레임)을 주머니에 넣는 것**과 같다. 경비(RLS 정책)는 의상과 신분증만 보고 판단하지, 배우 본인이 누구인지는 모른다. 그래서 우리가 의상·신분증을 직접 쥐여주면 정책을 그대로 시험해볼 수 있다.

---

## 3. savepoint 격리 + 트랜잭션 ROLLBACK — 라이브를 안 건드리기

### 왜 필요한가? — "검증한다고 진짜 데이터를 망치면 안 된다"

검증 프로브 중엔 INSERT/UPDATE/DELETE도 있다(`verify-rls.ts:228-414`). 이걸 그냥 실행하면 **라이브 DB에 가짜 행이 쌓이거나, 멀쩡한 행이 바뀐다.** 또 프로브 A가 만든 변경이 프로브 B에 영향을 주면, 각 검증의 독립성도 깨진다.

해법은 두 겹의 되돌리기다.
- **바깥**: 전체를 하나의 트랜잭션으로 묶고 마지막에 통째로 ROLLBACK (`verify-rls.ts:175`의 `sql.begin`, `:416`의 `throw ROLLBACK`).
- **안쪽**: 프로브 하나하나를 savepoint로 감싸 즉시 롤백 → 프로브 간 격리.

### Typolog에서는?

`verify-rls.ts:108-135`의 `probe` 함수:

```ts
async function probe(sql, opts) {
  let outcome;
  try {
    await sql.savepoint(async (sp) => {       // 프로브 전용 savepoint
      await sp.unsafe(`SET LOCAL ROLE ${opts.role}`);  // SET LOCAL = savepoint 스코프
      // ...JWT 주입...
      outcome = await opts.run(sp);
      throw ROLLBACK;                          // ★ 프로브가 만든 변경을 되돌린다
    });
  } catch (e) {
    if (e === ROLLBACK) {
      // 정상: run()이 성공했고 우리가 일부러 롤백했다 — outcome 유지
    } else if (e && typeof e === 'object' && 'code' in e) {
      outcome = { errorCode: String((e as { code: unknown }).code) };  // SQL 에러
    } else {
      throw e;                                 // 알 수 없는 에러 → fail-fast
    }
  }
  // ...outcome을 expect와 대조...
}
```

여기서 가장 영리한 부분은 **`throw ROLLBACK` 센티넬과 진짜 에러를 구분하는 catch 블록**이다.

- `ROLLBACK`은 `Symbol('savepoint-rollback')`(`:97`) — 우리가 "성공했으니 되돌려라"는 신호로 일부러 던지는 값.
- `e === ROLLBACK`이면 → **run()이 성공했고 정상 롤백된 것.** outcome은 그대로 유지.
- `e.code`가 있으면 → **진짜 SQL 에러**(예: RLS WITH CHECK 위반의 `42501`). 이걸 outcome으로 기록.
- 둘 다 아니면 → 예상 못 한 버그이므로 **re-throw**해서 즉시 멈춘다(fail-fast).

이 구분이 없으면, RLS가 막아서 난 에러인지, 코드 버그로 난 에러인지, 아니면 정상 롤백인지를 뭉뚱그려 "통과"로 오판할 수 있다. `SET LOCAL ROLE`과 `set_config(..., true)`의 세 번째 인자 `true`(= is_local)가 **트랜잭션/savepoint 스코프**라서, 롤백 시 역할·클레임도 자동 복원되는 점도 중요하다(`:115` 주석).

QA가 이 메커니즘을 P1-2·P1-3으로 따로 점검했다(`phase2-day5-qa-review.md:35-36`).

### 비유

화이트보드에 그림을 그리며 실험하는 것과 같다. 각 실험(프로브)을 **사진으로 찍어두고(savepoint)** 바로 지운다. 실험이 다 끝나면 화이트보드 전체를 **물티슈로 닦는다(트랜잭션 ROLLBACK)**. 옆 사람(라이브 DB)은 내가 뭘 그렸는지조차 모른다.

---

## 4. GRANT 레이어 vs RLS 레이어 — 두 관문의 평가 순서

### 왜 필요한가? — "RLS만 보면 절반을 놓친다"

많은 사람이 "RLS 정책 = DB 보안 전부"라고 오해한다. 아니다. PostgreSQL은 **두 개의 관문**을 순서대로 통과시킨다.

```
요청 ──▶ [관문 1: GRANT]  이 역할이 이 테이블에 이 동작(SELECT/INSERT/…)을 할 권한이 있나?
              │ 없으면 → 42501 (permission denied) — RLS는 보지도 않음
              ▼
         [관문 2: RLS]    이 역할이 이 "행"을 만질 수 있나? (USING/WITH CHECK)
              │ 막으면 → 0행 또는 42501
              ▼
         실행
```

**GRANT가 없으면 RLS 정책에 도달조차 못 한다.** 그리고 여기 Typolog 특유의 함정이 있다.

### Typolog에서는?

`0001_rls_policies_and_trigger.sql:197-217` (§3.7 주석)이 핵심을 짚는다:
> **drizzle-kit(postgres role)으로 생성한 테이블에는 Supabase 자동 GRANT가 적용되지 않는다.**

Supabase 대시보드로 테이블을 만들면 `anon`/`authenticated`에 GRANT가 자동으로 깔린다. 하지만 우리는 Drizzle로 마이그레이션을 생성하므로(하이브리드 방식, Day 1 노트), **GRANT를 직접 써줘야** 한다. 그래서 `:202-216`에서 정책 표면과 1:1로 정렬된 최소 권한만 명시한다:

```sql
GRANT SELECT ON submissions TO anon, authenticated;
GRANT INSERT, UPDATE ON submissions TO authenticated;   -- ★ DELETE는 일부러 없음
GRANT SELECT, INSERT, DELETE ON reactions TO authenticated;  -- ★ UPDATE 없음
GRANT INSERT ON reports TO authenticated;               -- ★ SELECT 없음 (관리자만)
```

검증은 이 "일부러 빠뜨린 권한"을 정조준한다. `verify-rls.ts:281-288`:
```ts
name: 'submissions: A도 DELETE 불가 (authenticated에 DELETE GRANT 없음)',
role: 'authenticated', sub: A, expect: { kind: 'error', code: '42501' },
run: async (sp) => { await sp`DELETE FROM submissions WHERE id=${sApriv}`; return { rows: 1 }; },
```
A는 **본인 제출인데도** DELETE가 막힌다 — RLS가 아니라 **GRANT 부재** 때문이다(`42501`). 같은 패턴으로 reactions UPDATE(`:350-357`), reports SELECT(`:360-367`), challenges INSERT(`:407-414`), profiles의 anon SELECT(`:386-393`)를 검증한다. QA가 이 5종을 P1-9로 묶어 GRANT 표와 1:1 대조했다(`phase2-day5-qa-review.md:42`, §4.3 표).

**RLS와 GRANT가 만드는 에러는 둘 다 `42501`이라 코드만 보면 똑같다.** 그래서 "이 차단은 GRANT 때문"이라는 의도를 프로브 `name`에 명시해두는 게 중요하다.

### 비유

콘서트장 입장으로 비유하면 —
- **GRANT** = 정문 티켓 검사. 티켓(권한) 자체가 없으면 정문에서 막힌다. 좌석(행)은 보지도 않는다.
- **RLS** = 좌석 안내원. 티켓은 있는데 "이 좌석은 당신 자리가 아닙니다"를 본다.

티켓이 없으면(GRANT 없음) 좌석 안내원(RLS)을 만날 일조차 없다.

---

## 5. USING vs WITH CHECK — UPDATE 정책의 두 단계

### 왜 필요한가? — "수정을 막는 방법이 사실 두 가지다"

UPDATE 정책에는 두 절이 있다. 헷갈리기 쉬운데, **시점**으로 나누면 명확하다.

| 절 | 언제 검사하나 | 무엇을 보나 | 위반 시 |
|----|-------------|-----------|--------|
| `USING` | UPDATE **전** | "이 행을 수정 대상으로 고를 수 있나" (기존 값) | 행이 **선택에서 제외** → 0행 |
| `WITH CHECK` | UPDATE **후** | "수정 결과가 정책에 맞나" (새 값) | **42501** 에러 |

즉 USING은 "건드릴 수 있는 행을 추리는 필터"이고, WITH CHECK는 "건드린 결과가 합법인지 검사하는 게이트"다. **막히는 증상도 다르다 — USING은 조용히 0행, WITH CHECK는 시끄럽게 42501.** 이 차이가 검증의 변별력을 만든다.

### Typolog에서는? — 두 회귀 사례

**회귀 ① H2: hidden→completed 복원 차단** (`0001_..._trigger.sql:77-89`)

```sql
CREATE POLICY "submissions_update" ON submissions FOR UPDATE TO authenticated
  USING      (user_id = (SELECT auth.uid()) AND status != 'hidden')
  WITH CHECK (user_id = (SELECT auth.uid()) AND status != 'hidden');
```

`USING`에 `status != 'hidden'`이 있으므로, **hidden 행은 애초에 UPDATE 대상으로 고를 수 없다.** 그래서 `verify-rls.ts:246-253`:
```ts
name: 'submissions[H2]: A의 hidden→completed 복원 차단 (USING status!=hidden → 0행)',
expect: { kind: 'rows', value: 0 },   // ★ 에러가 아니라 0행
run: async (sp) => { const r = await sp`UPDATE submissions SET status='completed' WHERE id=${sAhidden}`; return { rows: r.count }; },
```
hidden을 다시 살리려는 시도는 **0행**(USING이 행을 빼버림)으로 차단된다. 신고로 숨긴 제출을 작성자가 몰래 복원하는 걸 막는 게 목적이다.

반대로 **completed→hidden**(작성자가 스스로 hidden으로 바꾸기)은 USING은 통과한다(현재 status가 completed라 `!= 'hidden'` 만족). 하지만 **결과**가 hidden이라 WITH CHECK에서 걸린다 → `verify-rls.ts:254-261`은 `42501`을 기대한다. **같은 정책인데 USING(0행)과 WITH CHECK(42501)가 서로 다른 증상으로 갈리는 것**을 기대값으로 구분해 명시한 게 핵심이다(QA P1-6·P1-7).

**회귀 ② letter_pieces 재할당 차단** (`0001_..._trigger.sql:125-143`, §8.4-②)

letter_pieces의 UPDATE 정책은 `USING`과 `WITH CHECK` 둘 다 "조각이 속한 submission의 주인이 나인가"를 본다. 주석(`:126`)이 경고한다:
> WITH CHECK가 없으면 행을 타인 submission으로 재할당 가능.

공격 시나리오: B가 자기 조각의 `submission_id`를 A의 제출로 바꿔치기. USING은 통과한다(바꾸기 **전**엔 B 소유). 하지만 WITH CHECK는 바꾼 **후** 값(A 소유)을 보고 막는다.

여기서 검증의 백미인 **"양성 짝"**이 등장한다(`verify-rls.ts:321-339`):
```ts
// 양성 짝: B가 본인 조각의 무해한 변경은 성공해야 한다 (USING 통과 전제 고정)
name: 'letter_pieces: B는 본인 조각의 무해한 변경 가능 (USING 통과 전제)',
expect: { kind: 'rowsAtLeast', value: 1 },
run: async (sp) => { const r = await sp`UPDATE letter_pieces SET slot_index=9 WHERE id=${lpB}`; return { rows: r.count }; },
// ... 바로 다음 ...
name: 'letter_pieces[재할당]: B가 본인 조각을 A 제출로 재할당 차단 (WITH CHECK)',
expect: { kind: 'error', code: '42501' },
run: async (sp) => { await sp`UPDATE letter_pieces SET submission_id=${sApriv} WHERE id=${lpB}`; return { rows: 1 }; },
```

왜 무해한 변경(slot_index만 바꾸기)을 **일부러 먼저 성공시키나?** — 그게 성공해야 "B는 이 조각을 UPDATE할 수 있다(USING 통과)"가 고정된다. 그 전제 위에서 재할당이 42501로 막히면, 그 차단이 **"USING이 행을 빼서(0행)"가 아니라 순수하게 "WITH CHECK 효과"임**이 분리 보증된다(`:322-323` 주석, QA P1-8). 양성 짝이 없으면, 사실 USING 단계에서 막힌 건데 WITH CHECK가 막은 줄 착각할 수 있다.

### 비유

편집 권한으로 비유하면 —
- **USING** = "이 문서를 수정 목록에 띄울 수 있나" (안 띄우면 아예 안 보임 = 0행)
- **WITH CHECK** = "수정한 내용을 저장 버튼 누를 때 검사" (규칙 위반이면 저장 거부 = 42501)

같은 "수정 금지"라도 USING은 문서를 안 보여주고, WITH CHECK는 보여주되 저장을 거부한다.

---

## 6. 검증의 거짓 양성(false positive) 방어

### 왜 필요한가? — "'차단됨'이 곧 '정책이 막았다'는 아니다"

보안 검증에서 가장 위험한 착각: **"접근이 안 됐으니 정책이 잘 막은 거겠지."**
아니다. 접근이 안 되는 이유는 여러 가지다 — 정책이 막았을 수도, 아예 **파일이 없었을 수도**, 권한이 너무 빡세서 정상 유저까지 막혔을 수도 있다. 이걸 구분하지 못하면 **"통과"가 거짓말이 된다.**

거짓 양성에는 두 방향이 있다:
- **(a) 차단됐는데 사실은 객체 부재** → 정책이 안 막아도 통과로 보임 (under-test)
- **(b) 너무 빡세게 막아서 정상 동작까지 차단** → over-restrictive RLS (정상 유저가 불편)

### Typolog에서는?

**(a) 업로드 게이트 — "객체 부재"를 "정책 차단"으로 오판 방지** (`verify-rls.ts:469-484`)

Part 2의 "타인이 비공개 콜라주 다운로드 차단" 검증은 **파일이 실제로 존재할 때만** 의미가 있다. 파일 자체가 없으면, 정책이 막은 게 아니라 그냥 404 — 정책을 안 막아도 "차단됨"으로 통과해버린다.

```ts
// 업로드가 fixture의 전제다. 하나라도 실패하면 다운로드 차단 케이스가
// "정책 차단"이 아니라 "객체 부재"로 통과(거짓 양성)될 수 있으므로 다운로드를 스킵한다 (M-4).
if (upLetter.error || upPub.error || upPriv.error) {
  record('Part2', 'Storage 다운로드 검증', 'executed', 'skipped (fixture 업로드 실패)', false);
} else {
  // ...다운로드 검증들...
}
```
업로드 fixture가 하나라도 실패하면 다운로드 검증을 **통째로 스킵하고 FAIL로 기록**한다. "검증을 안 한 것"을 "통과"로 위장하지 않는다(QA P2-1).

**status 코드 기록 — 403 vs 404 식별** (`verify-rls.ts:496-514`의 `downloadCheck`)

차단 케이스는 actual에 HTTP status를 남긴다:
```ts
const status = (error as { status?: number } | null)?.status;
actual = status ? `blocked (${status})` : 'blocked';
```
`403`이면 **정책 차단**(권한 없음), `404`면 **객체 부재**. 둘을 사후에 사람이 식별할 수 있게 증거를 남긴다(QA P2-2). 단, `error.message`는 출력하지 않는다 — 버전에 따라 경로(UUID)가 담길 수 있어서(`:505-506` 주석, QA M-4 처리).

**(b) allow/deny 짝 — over-restrictive 탐지** (`verify-rls.ts:270-278`, `:301-309`, `:394-399`)

차단(deny)만 검증하면, "정책이 너무 빡세서 정상 유저까지 막는" 버그를 못 잡는다. 그래서 메인 세션에서 QA M-2를 즉시 반영해 **허용(allow) 양성 프로브 3개**를 추가했다(`phase2-day5-qa-review.md:291`):
```ts
name: 'submissions: A는 본인 제출 수정 가능 (허용 경로)',           // :271-278
name: 'letter_pieces: A는 본인 글자조각 삭제 가능 (허용 경로)',     // :302-309
name: 'profiles: authenticated는 프로필 조회 가능 (허용 경로)',     // :395-399
```
"막아야 할 건 막고(deny), 허용해야 할 건 허용한다(allow)"를 짝으로 검증해야 **양방향**이 보증된다.

### 비유

자물쇠를 테스트하는데 — 문을 당겨보니 안 열린다. "자물쇠 잘 잠겼네!"라고 결론 내리면 안 된다. **열쇠를 꽂아서 열리는 것도 확인**해야(allow 짝) 자물쇠가 진짜인지 안다. 그리고 애초에 **문 뒤에 방이 있는지**(객체 부재)도 확인해야, "안 열림"이 자물쇠 덕인지 빈 벽 덕인지 안다.

---

## 7. env 로딩의 함정 — "앱과 똑같이 읽어야 한다"

### 왜 필요한가? — "검증 스크립트가 앱과 다르게 env를 읽으면, 검증 환경 자체가 틀어진다"

이 Day의 실제 사고였다(게이트 B 기록, `phase2-day5-qa-review.md:309`). 워크트리 `.env.local`의 `DATABASE_URL` 줄이 **공백으로 들여쓰여 있었다.** 그런데:

- **Node 내장 `process.loadEnvFile`** — 키 앞 공백을 안 깎는다. `  DATABASE_URL=...`을 키가 `"  DATABASE_URL"`인 줄로 보고 **놓친다.** → 스크립트가 "env 누락"으로 죽음.
- **`@next/env`의 `loadEnvConfig`**(dotenv 기반, 앱이 쓰는 그것) — 앞 공백·따옴표를 견고하게 처리하고, `.env`/`.env.local`을 앱과 똑같이 병합한다. → 정상 로드.

**검증 스크립트가 앱과 다른 로더를 쓰면, 앱은 멀쩡한데 검증만 깨진다(또는 그 반대).** 그러면 검증이 "앱의 현실"을 반영하지 못한다.

### Typolog에서는?

`verify-rls.ts:48-58`의 `loadEnv`:
```ts
// 앱과 동일한 로더(@next/env loadEnvConfig)로 .env*를 읽는다.
// Node 내장 process.loadEnvFile은 키 앞 공백을 안 깎아 들여쓴 줄을 놓치지만,
// dotenv 기반인 이 로더는 앞 공백·따옴표를 견고하게 처리하고 앱과 같게 병합한다.
const req = createRequire(import.meta.url);
const nextEnvPath = req.resolve('@next/env', { paths: [path.dirname(req.resolve('next/package.json'))] });
const { loadEnvConfig } = req(nextEnvPath) as { loadEnvConfig: (dir: string, dev?: boolean) => unknown };
loadEnvConfig(process.cwd(), true);
```
pnpm에서 `@next/env`가 최상위로 호이스트되지 않으므로 `next` 패키지 경유로 resolve하는 디테일도 있다(`:52` 주석).

그리고 **로드한 값은 절대 출력하지 않는다** — presence boolean만(`:66-71`):
```ts
console.log('환경 변수 presence:', { DATABASE_URL: Boolean(env.databaseUrl), ... });
```
DATABASE_URL·키·JWT·비밀번호는 `true`/`false`로만 보인다. 비밀번호는 in-process 랜덤 생성(`:521-522`)하고 어디에도 안 찍는다(QA §5 비노출 점검).

### 비유

요리 레시피(앱)와 그걸 검증하는 식약처 검사관(스크립트)이 **다른 저울로 소금량을 잰다면**, 검사 결과는 의미가 없다. 검사관은 요리사와 **똑같은 저울(같은 env 로더)**을 써야 "이 레시피가 실제로 짠지"를 안다.

---

## 자주 하는 실수

1. **"앱을 클릭해서 RLS를 테스트했다"** — Typolog의 테이블 접근은 Drizzle 직결(RLS 우회)이라 클릭으론 정책이 **절대** 발동 안 한다. SQL 시뮬레이션이 필요한 이유(§1). 우회 경로의 방어는 코드(`getOwnedSubmission`)가 한다는 걸 잊으면 보안 구멍이 생긴다.

2. **"차단됐으니 정책이 잘 막은 것"** — 객체가 없어서 404일 수도, 권한이 너무 빡세서 정상 유저까지 막힌 것일 수도 있다. 업로드 게이트(§6-a)와 allow/deny 짝(§6-b) 없이는 거짓 양성을 못 거른다.

3. **USING과 WITH CHECK 혼동** — "수정 막기"를 한 가지로 뭉뚱그리면, hidden 복원이 0행으로 막히는 것(USING)과 hidden 설정이 42501로 막히는 것(WITH CHECK)을 구분 못 한다(§5). 검증 기대값을 `rows:0` vs `error:42501`로 명시하는 게 핵심.

4. **"RLS만 있으면 보안 끝"** — GRANT가 없으면 RLS는 보지도 않고 42501이다(§4). drizzle-kit 테이블엔 Supabase 자동 GRANT가 안 깔리니 직접 명시해야 한다. RLS와 GRANT 에러가 둘 다 42501이라 의도를 주석/이름에 남겨야 한다.

5. **검증 스크립트를 라이브에 그냥 실행** — savepoint 격리 + 트랜잭션 ROLLBACK(§3) 없이 INSERT/DELETE 프로브를 돌리면 라이브 데이터가 오염된다. `throw ROLLBACK` 센티넬과 진짜 에러를 구분 못 하면, 정상 롤백을 실패로 오판한다.

6. **env를 아무 로더로나 읽기** — 앱과 다른 로더(`process.loadEnvFile`)를 쓰면 들여쓴 키를 놓쳐서 "앱은 되는데 검증만 깨지는" 유령 버그가 난다(§7). 비밀 값을 실수로 console에 찍는 것도 단골 사고 — presence boolean만 출력하는 습관.

---

## 나중에 배울 것 (Phase 3로 가는 다리)

이번 Day에 **의도적으로 남긴 검증 공백**이 곧 Phase 3의 입구다(QA Medium → #40 이관).

- **avatars 정책 검증 (#40 C / QA M-3)** — avatars는 Public 버킷이라 읽기는 버킷 설정으로 열려 있고, 쓰기/삭제만 본인 경로 정책(`0003_..._policies.sql:121-136`)이 건다. MVP는 아바타 업로드 미구현(avatar_url 필드만 예약)이라 검증을 미뤘다. **Phase 3 Day 9(마이페이지+프로필)**에서 업로드를 만들 때, §2의 시뮬레이션·§6의 allow/deny 짝 패턴을 그대로 avatars에 적용하면 된다.

- **Storage cleanup (#40 D)** — Storage와 DB는 한 트랜잭션이 아니다(Day 3 노트의 "고아 파일"). 제출 삭제·교체 시 객체를 정리하는 로직이 들어오면, 그 정리가 **권한 안에서만** 일어나는지(타인 파일을 못 지우는지) 다시 검증해야 한다. 이번 Day의 finally 정리(`verify-rls.ts:485-490`)가 admin(service role)으로 정책을 우회해 청소하는 패턴이 참고가 된다.

- **Optimistic Update (로드맵 #16)** — Day 4.5에서 TanStack Query를 깔았고(직전 노트), Phase 3 피드의 좋아요는 서버 응답을 안 기다리고 UI를 먼저 바꾼다. 이때 **낙관적으로 바꾼 결과가 RLS를 통과할지**를 클라이언트가 미리 알 수 없다는 긴장이 생긴다 — 서버가 거부하면(예: reactions WITH CHECK 위반) `onError`로 롤백해야 한다. 이번 Day에 검증한 `reactions_insert`의 `WITH CHECK(user_id=auth.uid())`(`0001_..._trigger.sql:171-174`)가 그 거부의 근거다.

- **letter_pieces 삭제 API의 원자성** — `route.ts:161-163` 주석이 남긴 숙제. 현재 완성도 검증(슬롯 수·콜라주)과 조건부 UPDATE가 비원자라, 삭제 API가 생기면 TOCTOU 경합이 가능하다. 완성도 조건을 WHERE 서브쿼리로 합치거나 단일 트랜잭션으로 원자화하는 게 다음 과제(Reviewer Medium).

---

## 한 줄 정리

> Day 5는 **"만든 보안이 진짜 작동하는가"를 코드로 증명한 날**이다. 핵심 통찰은 **DB와 Storage가 다른 신분으로 접근돼서 검증도 둘로 갈린다**는 것 — 테이블 RLS는 묻혀 있어 SQL 시뮬레이션(SET ROLE + JWT 주입)으로 깨워야 하고, Storage 정책은 살아 있어 진짜 JWT로 두드려야 한다. 그 위에 **savepoint 격리·USING/WITH CHECK 변별·GRANT 관문·거짓 양성 방어·앱과 동일한 env 로딩**이 검증을 "통과로 위장되지 않게" 떠받친다. 결과: 36/36 통과로 마이그레이션 0001·0003·0004의 라이브 적용을 실증했다.
