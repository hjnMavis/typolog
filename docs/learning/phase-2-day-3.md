# Phase 2 Day 3 — 핵심 API + Storage(버킷·정책·업로드) + zod 검증 + 소유권 방어 학습 노트

> 대상 작업: zod 검증 스키마(client/server 공용) + 표준 에러 응답(ApiError) + Storage 버킷 3종·Storage RLS 정책 + 인증 헬퍼(getAuthUser/getOwnedSubmission) + `/api/challenges/today`·`/api/submissions`·`/api/submissions/[id]/letters` Route Handler + 챌린지 seed + M2(콜백 복귀경로 화이트리스트)·M3(proxy `/api` 제외)
> 산출물: `src/lib/validations/{challenge,submission,letter-piece}.ts`, `src/lib/api/{errors,auth}.ts`, `src/db/migrations/0003_storage_buckets_and_policies.sql`, `src/app/api/challenges/today/route.ts`, `src/app/api/submissions/route.ts`, `src/app/api/submissions/[id]/letters/route.ts`, `scripts/seed-challenges.ts`, `src/app/api/auth/callback/route.ts`(M2), `src/proxy.ts`(M3)
> 참고: `docs/backend-design-plan.md` §4·§5·§6·§7·§8, `docs/data-model.md`, 직전 노트 `docs/learning/phase-2-day-2.md`
>
> 개념별 섹션으로 나눴다. 순서는 "왜 검증이 따로 필요한가 → 에러는 어떻게 답하나 → Storage는 또 다른 보안 표면 → Drizzle 직결인데 RLS가 없다 → 그래서 소유권을 손으로 → 업로드 한 방의 모든 검사 → 외부 시스템 비원자성 → 마무리 정리(M2/M3)"이다.

---

## 이번 Day의 큰 그림 (먼저 읽기)

Day 1은 **DB에 자물쇠(RLS/GRANT)를 달았고**, Day 2는 **열쇠(JWT 세션)를 발급해 매 요청에 들고 다니게** 했다. Day 3는 그 열쇠를 들고 **실제로 일을 시키는 창구(API)**를 열었다. 그런데 창구를 열자마자 새로운 질문들이 쏟아진다.

- 들어온 데이터가 **형식이 맞나?**(zod)
- 거절할 땐 **어떤 모양으로** 답하나?(ApiError)
- 파일은 **어디에** 저장하고 **누가** 꺼낼 수 있나?(Storage 버킷 + Storage RLS)
- 그런데 우리가 DB를 치는 통로(Drizzle 직결)는 **RLS가 안 걸린다.** 그럼 "이게 정말 이 사람 것인가"는 누가 검사하나?(소유권 코드 검증)

한 문장으로: **"Day 3는 인증된 사용자라도 그가 보낸 데이터·접근하려는 리소스를 API 코드에서 한 번 더 검증하는 층을 세웠다. 인증(누구인가)과 검증(보낸 게/만지려는 게 올바른가)은 완전히 다른 일이다."**

이번 Day의 가장 중요한 한 가지 긴장 관계:

```
Day 1·2에서 만든 RLS  ──→  사용자 JWT로 DB를 칠 때 작동 (browser/server client)
                            │
                            ▼
        하지만 Day 3 API는 Drizzle 직결(postgres role)로 DB를 친다
                            │
                            ▼
        Drizzle 직결은 RLS를 우회한다 ──→ RLS가 자동으로 안 막아준다
                            │
                            ▼
        그래서 "이 행이 이 사용자 것인가"를 코드로 검증해야 한다 (getOwnedSubmission)
```

이 한 장을 머리에 박아두면 Day 3의 모든 코드가 "왜 이렇게 방어적인가"가 풀린다.

---

## 1. zod 검증 — 인증을 통과한 사용자도 "거짓말"을 보낼 수 있다

### 왜 필요한가? — 인증 ≠ 검증

Day 2의 OAuth는 "이 요청을 보낸 사람이 **누구인지**"를 보증한다. 하지만 그 사람이 **보내는 데이터**가 올바른지는 전혀 보증하지 않는다. 로그인한 사용자도 개발자 도구나 curl로 `slot_index: -5`, `width: "abc"`, 50MB짜리 파일, 닉네임에 10만 글자를 보낼 수 있다. 인증을 통과했다고 데이터를 믿으면 안 된다.

비유: 신분증 확인(인증)을 통과한 손님이라도, 주문서(데이터)에 "스테이크 -3인분"이라고 적으면 주방은 받으면 안 된다. **신원 확인과 주문서 검수는 별개의 일**이다.

zod는 그 "주문서 검수"를 **선언적 스키마**로 한다. `if`문을 수십 개 쓰는 대신, "이 모양이어야 한다"를 한 번 정의하면 검증 + 타입까지 같이 얻는다.

### isomorphic(client/server 공용) — 한 번 정의해 양쪽에서 쓴다

`src/lib/validations/`의 스키마는 **브라우저(입력 즉시 검증)와 서버(API 입구 검증) 양쪽에서 같은 모듈을 import**한다. 검증 규칙을 한 군데(single source)에 두면 "프런트에서는 통과했는데 서버에서 거절" 같은 규칙 불일치가 안 생긴다. 이런 "양쪽 환경에서 똑같이 도는 코드"를 isomorphic이라 부른다.

> 주의: isomorphic 모듈에는 **서버 전용 의존(`server-only`, DB, 노드 모듈)을 넣으면 안 된다.** zod만 의존하므로 브라우저 번들에 들어가도 안전하다. 반대로 `src/lib/api/auth.ts`는 DB·createClient를 import하므로 `import 'server-only'`가 붙어 있다 — 같은 "검증"이라도 한쪽은 공용, 한쪽은 서버 전용이다.

### Typolog에서는?

- **챌린지 식별자**(`challenge.ts:4`): `z.uuid()` — UUID 형식이 아니면 즉시 거절. `submission.ts:5`의 `submissionIdSchema`도 동일.
- **submission 생성 body**(`submission.ts:8-10`): `{ challenge_id }`만 받는다. **`user_id`를 body에서 받지 않는 게 핵심** — 사용자 id는 서버가 JWT에서 꺼내 지정한다(§5). body로 받으면 "타인 명의 생성"이 가능해진다.
- **글자 업로드 필드**(`letter-piece.ts:10-17`): FormData는 값이 **전부 문자열**로 도착하므로 `z.coerce.number()`로 숫자 변환한다. `slot_index`는 `.int().min(0)`, `width/height`는 `.int().positive()`.
- **character 한 글자 검증**(`letter-piece.ts:12-14`): `.refine((s) => [...s].length === 1)` — `[...s]`로 펼치는 이유는 이모지·결합 문자를 `s.length`(코드 유닛 수)가 아니라 **실제 글자 수**로 세기 위해서다. `"가".length`는 1이지만 `"👍".length`는 2다. 스프레드는 코드 포인트 단위로 센다.
- **챌린지 본문 불변식**(`challenge.ts:9-14`): seed에서 쓴다. `lines`·`letters`가 빈 배열이면 안 되므로 `.min(1)`(Day 1 QA 이관). `active_date`는 `YYYY-MM-DD` 정규식.

### `safeParse` vs `parse` — 어디서 무엇을 쓰나

| 메서드 | 실패 시 | 어디서 쓰나 |
|--------|---------|------------|
| `parse()` | **throw** | seed 스크립트(`seed-challenges.ts:51`) — 실패하면 주입 자체를 중단해야 하므로 던지는 게 맞다 |
| `safeParse()` | `{ success, error }` 반환 | API 핸들러 전부 — throw로 500을 내는 대신 **400 에러 응답**으로 정중히 거절해야 하므로 |

API에서 `parse`를 쓰면 검증 실패가 처리 안 된 예외가 되어 500(서버 잘못)이 난다. 잘못된 입력은 사용자 잘못이니 400이어야 한다. 그래서 핸들러는 전부 `safeParse` + `validationError`(§2)로 처리한다.

### DB 제약과의 2중 방어선

zod는 **API 입구**에서 막고, Day 1의 DB CHECK 제약(`status IN (...)`)·`LEFT(...,20)` 닉네임 클램프는 **최후의 보루**에서 막는다. zod를 우회하는 경로(직접 SQL, 버그)가 있어도 DB가 마지막에 거른다. 두 층은 중복이 아니라 **다층 방어(defense in depth)**다.

### 자주 하는 실수

- **FormData를 zod 없이 그냥 `Number(form.get(...))`로 변환**: `Number("")`는 `0`, `Number("abc")`는 `NaN`인데 둘 다 조용히 통과해 버린다. `z.coerce.number().int().positive()`는 이런 값을 명확히 거절한다.
- **body에서 `user_id`를 받아 그대로 신뢰**: 사용자가 타인 id를 넣어 보내면 명의 도용. **소유 식별자는 절대 클라이언트 입력에서 받지 않고 JWT에서 꺼낸다**(§5).
- **`s.length === 1`로 한 글자 검증**: 이모지·일부 한글 조합에서 깨진다. `[...s].length === 1`로 코드 포인트 단위로 센다.
- **isomorphic 검증 모듈에 서버 전용 코드를 섞음**: DB·`server-only`를 검증 스키마 파일에 넣으면 브라우저 번들 빌드가 깨진다. 순수 zod만 둔다.

### 나중에 배울 것

- zod의 `transform`으로 검증과 동시에 형 변환(예: 문자열 날짜 → Date), `z.discriminatedUnion`으로 여러 모양 분기. Day 4 상세 응답 스키마에서 유용해진다.

---

## 2. 표준 에러 응답(ApiError) + 403 vs 404 — 거절에도 규약이 필요하다

### 왜 필요한가? — 거절 방식이 제각각이면 클라이언트가 분기 지옥

API가 거절할 때마다 응답 모양이 다르면(어떤 건 문자열, 어떤 건 `{message}`, 어떤 건 `{error}`), 클라이언트는 매번 다르게 파싱해야 한다. **모든 에러를 한 모양으로 통일**하면, 클라이언트는 `{ error, code }` 하나만 알면 된다. `error`는 사람이 읽을 메시지, `code`는 프로그램이 분기할 키다.

### Typolog에서는?

`src/lib/api/errors.ts`가 두 함수를 제공한다:

```typescript
// errors.ts:13-24 — 모든 에러를 { error, code } 한 모양으로
export function jsonError(status, code, message, details?) {
  const body = { error: message, code };
  if (details !== undefined && process.env.NODE_ENV !== 'production') {
    body.details = details;   // ← 상세는 개발 모드에서만 노출
  }
  return NextResponse.json(body, { status });
}
```

- **`details`를 프로덕션에서 빼는 이유**(`errors.ts:20`): zod issue 같은 상세에는 내부 필드명·구조가 드러난다. 개발 땐 디버깅에 유용하지만, 프로덕션에선 공격자에게 힌트를 주는 정보 노출이다. 그래서 `NODE_ENV !== 'production'`일 때만 담는다.
- **`validationError`**(`errors.ts:27-29`): zod 실패를 항상 400 + `VALIDATION_ERROR` + `error.issues`로 통일. `issues`는 zod v3/v4 양쪽에서 안정적인 표면이라 버전이 바뀌어도 깨지지 않는다.

### 상태 코드 규약 (§7.4)

| 코드 | 의미 | Typolog 예시 |
|------|------|-------------|
| 400 | 입력 형식이 틀림 | zod 실패, JSON 파싱 실패, slot 범위 초과 |
| 401 | 미인증(로그인 안 함) | `getAuthUser`가 null |
| 403 | 인증은 됐으나 권한 없음 | **Typolog는 비공개 리소스에 쓰지 않음(아래 참고)** |
| 404 | 리소스 없음 | 챌린지 없음, **타인 소유 submission도 404** |
| 409 | 충돌(이미 존재/상태 불가) | 중복 submission, draft 아닌데 업로드 |
| 413 | 파일이 너무 큼 | 이미지 500KB 초과 |

### 핵심: 403이 아니라 404로 "존재 은폐"

직관적으로는 "남의 submission을 만지려 하면 403(권한 없음)"이 맞아 보인다. 하지만 Typolog는 **타인 소유·미존재를 똑같이 404**로 답한다(`auth.ts:25-26`, `letters/route.ts:32-36`). 왜냐하면:

- **403을 주면** "이 id의 리소스는 존재하지만 네 게 아니다"라는 사실이 새어 나간다. 공격자는 id를 바꿔가며 403/404를 구분해 **어떤 리소스가 존재하는지 목록을 캐낼 수 있다**(enumeration 공격).
- **404로 통일하면** "있는지 없는지조차 알려주지 않는다." 남의 것이든 진짜 없든 똑같이 "찾을 수 없음"이라 정보가 안 샌다.

비유: 옆집 우편함을 열어보려는 사람에게 "이건 남의 거예요"(403)라고 하면 그 집에 우편함이 있다는 걸 확인시켜 준다. "그런 우편함 없는데요"(404)라고 하면 존재 여부조차 모른다. **"타인" 기준에서는 404가 더 안전하다.**

> 형식이 잘못된 id조차 404로 통일한다(`letters/route.ts:27-28`). UUID가 아닌 값으로 "이건 형식 오류네"(400)라고 답하면, 거꾸로 "유효한 UUID는 다르게 반응한다"는 신호가 된다. 일관되게 404로 덮는다.

### 검사 순서: 401 → 404 → 409

순서가 중요하다(`letters/route.ts`의 흐름):

```
1. 미인증?           → 401 (어떤 리소스 정보도 노출하지 않고 가장 먼저 차단)
2. 없음/타인 소유?    → 404 (존재 은폐)
3. 상태가 안 맞음?    → 409 (예: draft가 아닌데 글자 업로드)
```

순서를 거꾸로 하면 정보가 샌다. 예컨대 소유권(404)을 보기 **전에** 상태(409)를 검사하면, "이 submission은 completed 상태다"라는 사실이 타인에게 새어 나간다. **소유권 확인이 상태 확인보다 먼저**여야 "남의 것"에 대해 아무것도 안 알려준다.

### 자주 하는 실수

- **타인 리소스에 403**: 위 enumeration 노출. "타인" 기준에서는 404로 존재를 숨긴다. (단, "내 것인데 지금은 못 함"은 409가 맞다 — 예: draft 아님.)
- **검사 순서를 401→409→404로**: 상태 메시지가 소유권 확인 전에 새면 정보 노출. **401→404→409** 순서를 지킨다.
- **`details`를 프로덕션에서도 응답에 포함**: 내부 구조 노출. 개발 모드 가드를 둔다.

### 나중에 배울 것

- 에러 `code`를 enum/상수로 모아 클라이언트와 공유하면 분기 안정성이 올라간다. Day 4 클라이언트 동기화에서 `code` 기반 처리(예: `SUBMISSION_EXISTS`면 기존 이어가기)를 본격적으로 쓴다.

---

## 3. Supabase Storage — DB와 또 다른 보안 표면(버킷 + Storage RLS)

### 왜 필요한가? — 이미지는 DB 행이 아니라 파일이다

글자 사진은 텍스트가 아니라 바이너리 파일이다. DB 테이블에 넣기엔 무겁고 부적합하다. Storage는 **파일 전용 서버**다. 그런데 핵심은: **Storage도 DB와 똑같이 RLS로 보호되지만, 정책을 거는 대상이 다르다.** DB RLS는 `submissions` 같은 우리 테이블에 걸지만, Storage RLS는 **`storage.objects`라는 Supabase 내장 테이블**에 건다.

비유: DB RLS가 "각 사무실 문(우리 테이블 행)"에 잠금장치라면, Storage RLS는 "창고의 각 사물함(storage.objects)"에 거는 잠금장치다. 둘 다 RLS지만 잠그는 대상이 다르다.

### 버킷 = 최상위 폴더, public/private이 1차 관문

`0003_storage_buckets_and_policies.sql:7-12`가 버킷 3개를 만든다:

| 버킷 | public | 크기 제한 | MIME | 용도 |
|------|--------|----------|------|------|
| `letter-pieces` | false(private) | 500KB | `image/webp` | 글자 조각 — 본인만 |
| `collages` | false(private) | 2MB | `image/png` | 완성 콜라주 — 본인 + 공개분 |
| `avatars` | true(public) | 500KB | `image/webp` | 프로필 — 누구나 읽기 |

`file_size_limit`·`allowed_mime_types`를 **버킷 자체에** 박아두면, 정책 이전에 Storage가 1차로 거른다(서버 zod 검증 + 버킷 제한 = 또 하나의 2중 방어).

> `storage` 스키마는 Drizzle의 `schemaFilter(public)` 밖이라 drizzle-kit이 자동 생성하지 못한다. 그래서 **커스텀 SQL 마이그레이션**(`generate --custom`)으로만 만든다(파일 주석 §4). Day 1에서 배운 하이브리드 마이그레이션의 연장이다.

### 경로로 소유권을 표현한다 — `(storage.foldername(name))[1]`

Storage엔 "행"이 없으니, **파일 경로(폴더 구조)로 소유권을 인코딩**한다. Typolog의 경로 규약:

```
letter-pieces/{user_id}/{submission_id}/{slot_index}.webp
              └─ [1] ─┘ └──── [2] ────┘
collages/{user_id}/{submission_id}.png
```

정책은 `storage.foldername(name)`으로 경로를 폴더 배열로 쪼개고, **첫 폴더([1])가 `auth.uid()`와 같은지** 검사한다(`0003_...sql:24-27`):

```sql
USING (
  bucket_id = 'letter-pieces'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
)
```

"파일 경로의 첫 폴더가 곧 소유자 id"이므로, 내 폴더(`{내id}/...`) 밑의 파일만 읽고 쓸 수 있다. `(SELECT auth.uid())`로 감싸는 건 Day 1에서 배운 **행마다 재평가 방지 캐시**와 같은 이유다.

### collages — 조건부 공개 + 비인증 공개 두 정책

`letter-pieces`는 단순(본인만)이지만, `collages`는 **공개 완성작은 남도 본다**가 핵심이라 정책이 더 복잡하다(`0003_...sql:65-95`):

- `collages_read`(authenticated): 본인 폴더이거나, **두 번째 폴더([2]=submission_id)에 해당하는 submission이 `status='completed' AND is_public=true`이면** 읽기 허용. 즉 정책이 **우리 `submissions` 테이블을 EXISTS로 조인**해 공개 여부를 판단한다.
- `collages_read_anon`(anon): **비로그인 사용자**도 공개 완성작은 읽게 허용. `/s/[id]` 공유 페이지가 로그인 없이 콜라주를 보여줘야 하기 때문(§5.2). `TO anon` 역할이 핵심.

이게 "Storage RLS가 DB 테이블과 연동된다"는 강력한 증거다. 파일 접근 권한이 **다른 테이블의 상태(is_public)**에 따라 동적으로 바뀐다.

### avatars — public 버킷이라 읽기 정책이 없다

`avatars`는 public이라 **읽기 정책 자체가 없다**(`0003_...sql:118-136`엔 write/delete만 있음). public 버킷은 URL만 알면 누구나 읽으므로 SELECT 정책이 불필요하고, 본인만 쓰고 지우도록 INSERT/DELETE만 건다. "프로필 사진은 공개라도 남이 내 걸 덮어쓰면 안 된다"는 요구의 정확한 표현이다.

### 자주 하는 실수

- **DB RLS만 걸고 Storage 정책을 빠뜨림**: 테이블은 막았는데 이미지 파일은 무방비. **`storage.objects`는 별도 정책 표면**이라 따로 걸어야 한다. 이걸 잊으면 남의 글자 사진이 URL로 새어 나간다.
- **UPSERT(글자 교체)인데 INSERT 정책만 검**: 같은 슬롯을 다시 올리면 Storage엔 UPDATE가 일어난다. INSERT만 허용하면 **교체 시 권한 거부**가 난다. 그래서 `letter_pieces_write`(INSERT) + `letter_pieces_update`(UPDATE)를 **둘 다** 만들었다(`0003_...sql:31-47`, §8.4-④). (collages는 매번 새 파일이라 UPDATE 정책이 없다 — 요구가 다르면 정책도 다르다.)
- **버킷에만 의존하고 경로 정책을 안 검**: public/private은 "이 버킷을 누구나 보냐"만 정한다. private 버킷이어도 **경로별 소유권 정책이 없으면** 인증된 모든 사용자가 서로의 파일을 본다. 버킷 설정 ≠ 행(경로) 단위 정책.
- **`auth.uid()`를 `::TEXT` 캐스팅 안 함**: `auth.uid()`는 UUID, 폴더명은 TEXT다. 타입이 안 맞으면 비교가 실패하거나 에러난다. `(SELECT auth.uid())::TEXT`로 맞춘다.

### 나중에 배울 것

- **Signed URL**(로드맵 #7): private 버킷 파일을 한시적으로 공개하는 토큰 URL. Day 4에서 `image_url`(버킷 내 경로)을 signed URL로 변환해 `<img>`에 띄운다. 지금은 경로만 저장해 뒀다(`letters/route.ts:98` 주석).

---

## 4. GRANT vs RLS, 그리고 Drizzle 직결의 함정 — RLS가 "안 걸리는" 통로

### 왜 다시 GRANT vs RLS인가? — Storage에도 똑같이 적용된다

Day 1에서 배운 핵심: **GRANT와 RLS는 별개의 2단 관문**이다. GRANT는 "이 역할이 이 테이블에 손댈 수 있나"(1차 문), RLS는 "그 안에서 어떤 행을 다루나"(2차 문). GRANT가 없으면 RLS 정책을 아무리 잘 짜도 애초에 테이블에 도달조차 못 한다.

Day 3에서 이게 **`storage.objects`에도 똑같이 적용**된다. Supabase는 `storage.objects`에 authenticated/anon 역할의 GRANT를 기본 제공하므로 우리는 정책만 얹으면 된다. 하지만 자가 호스팅이나 커스텀 role을 쓰면 GRANT부터 확인해야 한다. "정책은 멀쩡한데 권한 거부"가 나면 십중팔구 GRANT 누락이다.

### 진짜 함정: Drizzle 직결은 RLS를 우회한다

여기가 Day 3의 가장 중요한 함정이다. Typolog API는 DB를 **두 가지 다른 통로**로 친다:

| 통로 | 무엇 | 역할(role) | RLS |
|------|------|-----------|-----|
| Supabase client(browser/server) | 사용자 JWT 기반 | authenticated | **적용 O** |
| **Drizzle 직결**(`src/db/index.ts`) | postgres 커넥션 | postgres(또는 직결 role) | **우회(안 걸림)** |

Day 3의 모든 Route Handler는 조회·쓰기에 **Drizzle 직결**(`db.select`, `db.insert`)을 쓴다(`today/route.ts`, `submissions/route.ts`, `letters/route.ts`). Drizzle은 일반 postgres 커넥션이라 **JWT를 모르고, `auth.uid()`도 없다.** 따라서 Day 1·2에 공들여 만든 RLS가 **이 통로에서는 작동하지 않는다.**

비유: RLS는 "직원 출입증을 찍어야 열리는 문"이다. 그런데 Drizzle 직결은 **마스터키를 가진 건물 관리인 통로**다. 출입증 검문(RLS)을 거치지 않고 모든 방에 들어간다. 편하지만, "이 방이 누구 것인지"를 **관리인이 스스로 확인**하지 않으면 아무 방이나 들어가는 사고가 난다.

### 왜 굳이 RLS를 우회하는 Drizzle을 쓰나?

- **타입 안전 + 복잡 쿼리**: Drizzle은 스키마 기반 타입 추론·조인·UPSERT가 강력하다.
- **성능·제어**: 커넥션 풀, 트랜잭션을 직접 다룬다.
- 대신 **소유권 검증 책임을 코드로 떠안는다**(§5). "편의를 얻는 대신 안전장치를 손으로 단다"는 거래다.

### 자주 하는 실수 (이번 Day의 1급 함정)

- **Drizzle 직결인데 RLS를 믿고 소유권 검증을 빠뜨림**: "Day 1에 RLS 다 걸었으니 안전하겠지"는 **치명적 오해**다. Drizzle 통로엔 RLS가 안 걸린다. `db.select().from(submissions).where(eq(id, ...))`만 쓰면 **남의 submission도 그대로 조회된다.** 반드시 `where`에 사용자 id 조건을 넣거나 `getOwnedSubmission`으로 검증한다(§5).
- **GRANT 없는 정책**: 정책(RLS)만 만들고 GRANT를 안 주면 "권한 거부"가 난다. 정책이 아무리 맞아도 1차 문(GRANT)이 닫혀 있으면 소용없다. Storage는 Supabase가 GRANT를 깔아주지만, 우리 테이블·커스텀 role에선 직접 챙긴다.
- **"잘 되니까 맞겠지"로 admin/직결을 무분별 사용**: RLS 우회 통로는 "잘 되는 것처럼" 보이지만, 그게 바로 위험 신호다. 막혔어야 할 접근이 안 막힌 것일 수 있다.

### 나중에 배울 것

- RLS를 적용하는 Drizzle 사용법(트랜잭션 안에서 `SET LOCAL request.jwt.claims`로 `auth.uid()` 주입)도 있다. Typolog는 MVP에서 "직결 + 코드 검증"을 택했다. 트래픽·복잡도가 커지면 재검토할 주제.

---

## 5. 소유권을 코드로 검증하기 — getAuthUser + getOwnedSubmission

### 왜 필요한가? — RLS가 없는 통로의 안전망

§4에서 봤듯 Drizzle 직결엔 RLS가 없다. 그래서 "누구인가"(getAuthUser)와 "이게 그의 것인가"(getOwnedSubmission)를 **API 코드가 직접** 확인한다. 이게 Day 3 인증 헬퍼 두 개의 존재 이유다.

### getAuthUser — JWT에서 사용자 id(sub) 꺼내기

`auth.ts:16-22`:

```typescript
export async function getAuthUser(supabase?) {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.auth.getClaims();   // ← getSession 아님!
  const sub = data?.claims?.sub;
  if (error || typeof sub !== 'string') return null;
  return { id: sub };
}
```

- **`getClaims()`를 쓴다**(Day 2 §5 복습): 서버에서는 `getSession()`을 신뢰하면 안 된다. `getSession`은 쿠키를 **읽기만** 해서 위조 가능. `getClaims()`는 JWT **서명을 검증**한다. 인가 판단의 근거는 검증된 claims여야 한다.
- **`claims.sub`가 사용자 id**다. 이 값을 Drizzle `where`에 넣어 소유권을 건다. Day 2 §5의 "나중에 배울 것"에서 예고한 그 `sub`다.
- **supabase 클라이언트를 인자로 주입 가능**(`auth.ts:14-16`): 글자 업로드처럼 **Storage 업로드와 인증이 같은 사용자 JWT 클라이언트를 공유**해야 할 때, 하나를 만들어 양쪽에 넘긴다(`letters/route.ts:18-19`). 클라이언트를 두 번 만들지 않는 작은 최적화.

### getOwnedSubmission — "있고, 내 것"을 한 번에

`auth.ts:26-37`:

```typescript
export async function getOwnedSubmission(submissionId, userId) {
  const [row] = await db.select().from(submissions)
    .where(eq(submissions.id, submissionId)).limit(1);
  if (!row || row.user_id !== userId) return null;   // ← 미존재·타인 모두 null
  return row;
}
```

핵심은 마지막 줄: **미존재(`!row`)와 타인 소유(`row.user_id !== userId`)를 똑같이 `null`로** 반환한다. 호출부는 `null`이면 무조건 404를 낸다(§2의 존재 은폐). "없음"과 "남의 것"을 호출부가 구분하지 못하게 하는 게 설계 의도다.

비유: Drizzle은 모든 사물함을 여는 마스터키(§4). 그래서 사물함을 연 **뒤에** "이 사물함 주인 이름표가 내 이름인가?"를 사람이 눈으로 확인한다. 이름이 다르면 "이 사물함은 없는 셈 칩니다"(null→404)라고 처리한다.

### 흐름으로 보기 (letters/route.ts)

```
1. createClient() → getAuthUser(supabase)   → 없으면 401          (auth.ts)
2. submissionIdSchema.safeParse(id)          → 형식 틀리면 404      (zod)
3. getOwnedSubmission(id, user.id)           → 없음/타인이면 404    (소유권 코드 검증)
4. submission.status !== 'draft'             → draft 아니면 409
5. challenge.letters.length로 slot 상한      → 초과면 400
6. validateLetterImage(image)                → MIME/크기 위반 400/413
7. Storage 업로드 + DB UPSERT
```

401→404→409 순서(§2)가 코드에 그대로 박혀 있다.

### 자주 하는 실수

- **`getOwnedSubmission` 없이 `db.select().where(eq(id))`만으로 조회**: 남의 submission이 그대로 나온다. RLS 우회 통로에선 **반드시 user_id 조건/검증을 코드로** 넣는다. (대안: `where(and(eq(id), eq(user_id)))`로 쿼리 자체에 소유 조건을 박는 방법도 안전하다.)
- **`getSession()`으로 user id를 얻음**: 위조 가능. 서버에서는 `getClaims()`.
- **미존재와 타인 소유를 다르게 처리**(하나는 404, 하나는 403): §2의 enumeration 노출. 둘 다 null→404로 통일.

### 나중에 배울 것

- `letter_pieces`·`reactions` 등 다른 리소스의 소유권은 **부모 submission을 거쳐** 간접 검증한다(글자는 submission 소유면 글자도 소유). Day 4 상세 조회·콜라주 업로드에서 이 패턴이 반복된다.

---

## 6. 파일 업로드 검증 + UPSERT 두 종류 — onConflictDoNothing vs onConflictDoUpdate

### 왜 필요한가? — FormData는 JSON이 아니다

파일을 보낼 땐 JSON이 아니라 `multipart/form-data`(FormData)를 쓴다. 파일(바이너리)과 텍스트 필드를 한 요청에 섞어 보낼 수 있기 때문이다. 그래서 `request.json()`이 아니라 `request.formData()`로 받고, 값들이 전부 문자열·File로 도착한다(§1의 coerce 이유).

### 파일 검증 — MVP는 MIME + 크기까지만

`letter-piece.ts:25-33`의 `validateLetterImage`:

```typescript
if (file.type !== 'image/webp') return { status: 400, code: 'INVALID_IMAGE_TYPE', ... };
if (file.size > 500*1024)       return { status: 413, code: 'IMAGE_TOO_LARGE', ... };
return null;
```

- **400(타입) vs 413(크기)**: 타입 위반은 "잘못된 형식"(400), 크기 초과는 전용 코드 **413 Payload Too Large**다. 클라이언트가 "압축해서 다시"인지 "webp로 변환"인지 구분할 수 있게 코드를 나눴다.
- **`image instanceof File` 체크**(`letters/route.ts:77`): FormData에서 `get('image')`는 파일일 수도, 문자열일 수도, null일 수도 있다. File이 아니면 "이미지 필수"(400).

> **MVP에서 의도적으로 뺀 것**(`letter-piece.ts:23-24` 주석, 게이트 A Day3-(f)): `file.type`은 클라이언트가 보내는 **자기 신고값**이라 위조 가능하다. 진짜 webp인지 확인하려면 **magic byte**(파일 앞 바이트 시그니처) 검사가 필요하지만 MVP에선 제외했다. 서버측 EXIF strip·이미지 디코딩 유효성도 제외(클라이언트가 Canvas로 EXIF 제거 — Phase 1 #13). 이건 "지금 안 한다"를 **명시적으로 기록한 리스크**다. 모른 채 빠뜨린 것과 알고 미룬 것은 다르다.

### UPSERT 두 종류 — 목적이 정반대

이번 Day에 `onConflict`가 **두 가지 정반대 의도**로 등장한다. 이걸 구분하는 게 핵심이다.

| | `onConflictDoNothing` | `onConflictDoUpdate` |
|---|---|---|
| 의미 | 충돌하면 **아무것도 안 함**(기존 유지) | 충돌하면 **기존 행을 갱신**(교체) |
| 의도 | **중복 생성 방지** | **값 교체** |
| Typolog | submission 생성(`submissions/route.ts:53`) | 글자 슬롯 교체(`letters/route.ts:114`) |

**submission 생성 — onConflictDoNothing**(`submissions/route.ts:50-67`):

```typescript
const [created] = await db.insert(submissions)
  .values({ user_id: user.id, challenge_id, status: 'draft' })
  .onConflictDoNothing({ target: [submissions.user_id, submissions.challenge_id] })
  .returning();

if (!created) {  // 충돌(이미 존재) → returning이 비어 있음 → 409 + 기존 제출 동봉
  const [existing] = await db.select()...;
  return NextResponse.json({ code: 'SUBMISSION_EXISTS', submission: existing }, { status: 409 });
}
```

"한 사용자는 한 챌린지에 하나의 submission"이 불변식(UNIQUE)이다. 동시에 두 번 눌러도 **DB의 UNIQUE 제약이 경합을 원자적으로** 처리하고, `onConflictDoNothing`이 두 번째를 조용히 무시한다. 충돌이면 `returning`이 비므로 그걸로 "이미 있음"을 감지해 409 + 기존 제출을 함께 돌려준다(클라이언트가 이어서 진행).

**글자 슬롯 교체 — onConflictDoUpdate**(`letters/route.ts:104-118`):

```typescript
.onConflictDoUpdate({
  target: [letterPieces.submission_id, letterPieces.slot_index],
  set: { character, image_url: path, width, height },
})
```

같은 슬롯(`submission_id + slot_index`)에 다시 올리면 **기존 글자를 새 값으로 교체**한다. 사용자가 5번 슬롯 사진이 마음에 안 들어 다시 찍으면, 새 행을 만드는 게 아니라 **그 슬롯을 덮어쓴다.** Storage도 같은 path에 `upsert: true`로 덮어쓴다(`letters/route.ts:92`) — DB와 Storage가 같은 "교체" 의미로 맞춰져 있다.

### 왜 애플리케이션 `SELECT` 후 `INSERT`가 아니라 UPSERT인가?

"먼저 조회해서 있으면 update, 없으면 insert"는 **경쟁 조건(race condition)**이 있다. 두 요청이 동시에 "없네"를 보고 둘 다 insert하면 중복이 생긴다. UPSERT(`onConflict`)는 **DB가 UNIQUE 제약으로 원자적으로** 처리해 이 틈을 없앤다. "확인하고 행동" 사이의 빈틈을 DB에 맡기는 패턴이다.

### 자주 하는 실수

- **두 UPSERT의 의도를 혼동**: 슬롯 교체에 `DoNothing`을 쓰면 다시 찍어도 안 바뀐다. 중복 방지에 `DoUpdate`를 쓰면 의미 없는 갱신이 돈다. **"중복을 막고 싶나(DoNothing), 값을 바꾸고 싶나(DoUpdate)"**를 먼저 정한다.
- **UPSERT 대신 `SELECT → INSERT`**: 동시 요청에서 중복 발생. UNIQUE + onConflict로 원자화한다.
- **`file.type`만 믿고 진짜 검증으로 착각**: 자기 신고값이라 위조 가능. MVP라 허용했지만 "검증했다"고 오해하면 안 된다. magic byte는 미룬 리스크.
- **slot 상한 검증 누락**: `slot_index`가 챌린지 글자 수를 넘어도 막지 않으면 엉뚱한 슬롯이 생긴다. `challenge.letters.length`로 상한을 검사한다(`letters/route.ts:71-73`).

### 나중에 배울 것

- 콜라주 업로드(Day 4)는 submission의 `status`를 `draft → completed`로 **전이**시킨다. 그때 "모든 슬롯이 찼는가"를 검증하는 비즈니스 규칙이 더해진다. status 전이는 UPSERT가 아니라 조건부 UPDATE다.

---

## 7. 외부 시스템 + DB 쓰기의 비원자성 — 고아 파일과 try/catch 로깅

### 왜 문제인가? — Storage와 DB는 한 트랜잭션이 아니다

글자 업로드는 **두 시스템**에 쓴다: ① Supabase Storage(파일) ② 우리 DB(letter_pieces 행). 그런데 이 둘은 **하나의 트랜잭션이 아니다.** Storage는 외부 HTTP API, DB는 별도 커넥션이다. 그래서 "Storage엔 올라갔는데 DB 쓰기는 실패"하는 **중간 상태**가 가능하다. 이때 Storage엔 어떤 DB 행도 가리키지 않는 **고아 파일(orphan)**이 남는다.

비유: 창고에 짐(파일)은 넣었는데 장부(DB)에 기록을 못 했다. 짐은 있는데 아무도 그 짐을 못 찾는 상태 — 고아 파일.

### Typolog의 대응 — 완벽한 롤백 대신 "안전한 부분 실패 + 로깅"

`letters/route.ts:88-122`:

```typescript
const path = `${user.id}/${submissionId}/${slot_index}.webp`;  // 서버가 path 구성
const { error: uploadError } = await supabase.storage
  .from('letter-pieces').upload(path, bytes, { contentType: 'image/webp', upsert: true });
if (uploadError) return jsonError(500, 'UPLOAD_FAILED', ...);   // Storage 실패 → 즉시 중단

try {
  [piece] = await db.insert(letterPieces).values({ ... image_url: path ... })
    .onConflictDoUpdate({ ... }).returning();
} catch (err) {
  console.error(`letter_pieces upsert failed for ${path}:`, err);  // 고아 추적용 로깅
  return jsonError(500, 'PERSIST_FAILED', ...);
}
```

설계 결정(§8.3-3):

1. **Storage 먼저, DB 나중**: Storage 실패면 DB를 안 건드리고 끝(부분 상태 없음). DB 실패면 Storage엔 파일이 남지만(고아), **같은 path라 다음 재시도가 `upsert:true`로 덮어쓴다** — 손상이 누적되지 않는다. 경로가 결정적(`user_id/submission_id/slot.webp`)이라 가능한 안전장치다.
2. **DB 쓰기를 try/catch로 감싸 path를 로깅**: 나중에 cleanup(고아 청소)할 때 추적할 수 있게. path엔 UUID만 있고 시크릿이 없어 로그에 남겨도 안전하다.
3. **완벽한 분산 트랜잭션은 MVP 과잉**: 보상 트랜잭션(Storage 롤백)·2단계 커밋은 복잡하다. "결정적 경로 + 덮어쓰기 + 로깅"으로 실용적 안전을 확보하고, 정밀 정리는 나중으로 미룬다(기록된 리스크).

### 경로를 서버가 구성하는 또 다른 이유 — 이중 방어

`path`를 **서버가 `user.id`로 만든다**(`letters/route.ts:88`). 클라이언트가 path를 보내지 않으므로 **타인 경로 업로드가 원천 불가**하다. 설령 누가 조작해도 Storage 정책(§3, `(storage.foldername(name))[1] = auth.uid()`)이 한 번 더 막는다. **서버 path 구성(1차) + Storage RLS(2차) = 이중 방어**다. 두 층이 같은 규약(첫 폴더 = user_id)으로 정렬돼 있다는 게 핵심.

### 자주 하는 실수

- **DB 쓰기를 try/catch 없이 두고 고아 파일을 방치**: 실패가 조용히 묻혀 추적 불가. 최소한 path를 로깅한다.
- **DB 먼저 쓰고 Storage 나중**: DB엔 행이 있는데 파일이 없는 더 나쁜 고아(깨진 `<img>`)가 생긴다. **파일 먼저, 행 나중**이 일반적으로 안전하다(행이 가리키는 파일이 항상 존재하도록).
- **path를 클라이언트가 보내게 함**: 타인 경로 조작 위험. 서버가 user.id로 구성한다.
- **로그에 시크릿·원본 이미지 데이터를 찍음**: path(UUID)만 찍는다. 바이너리·토큰을 로그에 남기지 않는다.

### 나중에 배울 것

- 진짜 분산 트랜잭션이 필요해지면 **outbox 패턴**·**보상 트랜잭션**·**주기적 고아 청소 작업(cron)**을 도입한다. Phase 5 운영 단계 주제.

---

## 8. 마무리 정리 — M2(복귀 경로 화이트리스트) + M3(proxy `/api` 제외) + seed

### 8.1 M2 — open-redirect 방어를 넘어 "알려진 내부 경로만"

Day 2에서 콜백의 `next`를 `/`로 시작 + `//`·`/\` 아님으로 검증했다(open-redirect 방어). Day 3 M2는 여기서 **한 단계 더** 좁힌다(`callback/route.ts:7-19`):

```typescript
const ALLOWED_NEXT_PREFIXES = ['/challenge', '/feed', '/admin', '/u', '/s'];

function sanitizeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  const path = raw.split(/[?#]/)[0];   // 쿼리·해시 떼고 경로만
  if (path === '/') return raw;
  const allowed = ALLOWED_NEXT_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
  return allowed ? raw : '/';
}
```

왜 더 좁히나? open-redirect 방어(외부 도메인 차단)만으로는 **내부의 이상한 경로**를 못 막는다:

- `next=/login` → 로그인 후 다시 `/login`으로 보내면 **무한 루프** 위험.
- `next=/api/...` → 콜백 후 비페이지(API)로 복귀시키면 깨진 동작.

화이트리스트(`/challenge`, `/feed`, `/admin`, `/u`, `/s`)는 **실제 사용자가 복귀할 만한 페이지 경로만** 허용하고, 나머지는 안전한 `/`로 폴백한다. "내부 경로면 다 OK"가 아니라 "알려진 좋은 경로만 OK"라는 한 단계 더 엄격한 화이트리스트다.

비유: Day 2가 "우리 건물 안 주소만 받는다"였다면, M2는 "그중에서도 **손님이 갈 법한 층(고객 라운지·객실)**만 받고, 기계실(`/api`)·회전문(`/login`)으로는 안 보낸다"이다.

### 8.2 M3 — proxy matcher에서 `/api` 제외

Day 2 QA에서 이관된 항목. proxy matcher가 `/api/*`까지 잡아서 **API 요청마다 불필요한 세션 갱신**이 한 번씩 돌았다(성능 미세 손해). Day 3에서 matcher에 `api`를 negative lookahead에 추가해 제외했다(`proxy.ts:34-36`):

```
'/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|...)$).*)'
            └── 추가됨
```

왜 안전한가? **API는 자체 인증(`getAuthUser`)으로 401을 책임진다**(`proxy.ts:6-7` 주석). proxy의 역할은 "페이지 redirect"뿐이고, API는 redirect가 아니라 401 JSON을 줘야 한다(브라우저 페이지 이동이 아니므로). 책임이 분리되니 proxy가 `/api`를 건드릴 이유가 없다. 제외하면 중복 세션 갱신이 사라진다.

> 단, `/api/auth/callback`은 예외적으로 **세션 쿠키를 직접 굽는다**(Day 2 §4). 이건 proxy의 세션 갱신과 무관하게 핸들러가 `exchangeCodeForSession`으로 처리하므로, matcher 제외와 충돌하지 않는다.

### 8.3 seed — 마이그레이션과 데이터를 분리한다

`scripts/seed-challenges.ts`는 챌린지 데이터를 **수동 1회 주입**하는 스크립트다(게이트 A Day3-(d)). 핵심 결정:

- **데이터는 마이그레이션 lineage 밖에 둔다**(`seed-challenges.ts:1-2` 주석): 마이그레이션 안에 `INSERT`를 넣으면 **모든 환경(테스트·CI 포함)에 강제 주입**된다. 스키마(구조)와 데이터(내용)는 수명주기가 다르므로 분리한다. 스키마는 마이그레이션, 데이터는 별도 seed.
- **불변식을 zod로 사전 검증**(`seed-challenges.ts:50-52`): 주입 전에 `challengeContentSchema.parse`로 `sentence = lines.join(' ')`, `letters = lines.flatMap(parseSentence)` 불변식과 빈 배열 금지를 확인. 깨진 데이터가 DB에 들어가는 걸 입구에서 막는다.
- **active_date UNIQUE 기준 UPSERT로 idempotent**(`seed-challenges.ts:65-75`): 재실행해도 같은 날짜는 최신 lines로 갱신될 뿐 중복 안 생긴다. `excluded.sentence`는 "방금 INSERT 시도한 값"을 가리키는 PostgreSQL 키워드다.
- **`prepare: false`**(`seed-challenges.ts:60`): Day 1에서 배운 Supabase 풀러 호환 옵션. 직결 스크립트에서도 동일하게 지킨다.

### 자주 하는 실수

- **마이그레이션에 데이터 INSERT를 넣음**: 모든 환경에 강제 주입돼 테스트가 오염되거나 환경별 데이터가 엉킨다. 데이터는 seed로 분리.
- **M2에서 "내부 경로면 OK"로 끝냄**: `/login`·`/api`가 통과해 루프·깨짐. **알려진 페이지 경로 화이트리스트**까지 좁힌다.
- **proxy가 `/api`까지 redirect하게 둠**: API가 페이지 redirect를 받으면 클라이언트가 JSON 대신 HTML을 받아 깨진다. API는 401 JSON, proxy는 페이지 redirect — 책임 분리.

### 나중에 배울 것

- "로그인 후 원래 가려던 보호 페이지로 복귀": proxy가 redirect할 때 `?next=원래경로`를 붙이고, M2의 화이트리스트가 그걸 받아 복귀시키는 완성형 UX. Day 4+에서 연결.

---

## 다음 Day(Day 4) 전에 알면 좋은 선행 개념

Day 4는 **콜라주 업로드 + status 전이(draft→completed) + 상세 조회 + Zustand↔서버 동기화 + TanStack Query**다. Day 3에서 깐 기반이 거기서 "사용자에게 보이는 흐름"으로 완성된다.

1. **Signed URL — 저장한 path를 화면에 띄우기** (로드맵 #7)
   - Day 3는 `image_url`에 **버킷 내 경로**만 저장했다(`letters/route.ts:98`). private 버킷이라 경로만으론 `<img>`에 못 띄운다.
   - Day 4 상세 조회는 `createSignedUrl(path, 만료초)`로 **기간 한정 URL**을 만들어 내려준다. "왜 public URL이 아니라 signed URL인가 = 비공개 파일이라서"가 출발점.

2. **status 전이는 UPSERT가 아니라 조건부 UPDATE**
   - 콜라주 완성은 `draft → completed`로 status를 바꾸는 **상태 전이**다. UPSERT(중복/교체)와 다르다.
   - "모든 슬롯이 찼는가", "이미 completed인데 또 완성 요청인가"(409) 같은 **전이 조건**을 검증한다. §6의 상태 검사(`status !== 'draft'`) 감각을 확장한다.

3. **getOwnedSubmission 패턴의 재사용 + 간접 소유권**
   - Day 4 상세 조회·콜라주 업로드도 **소유권 코드 검증**(§5)을 그대로 쓴다. Drizzle 직결이라 RLS가 없다는 사실은 변하지 않는다.
   - 글자(letter_pieces)는 **부모 submission을 통해 간접 소유** — submission이 내 것이면 그 글자도 내 것. 이 간접 검증 패턴이 Day 4에서 반복된다.

4. **TanStack Query — Day 3 API를 클라이언트가 "잘" 소비하기** (로드맵 #15)
   - Day 3가 만든 GET/POST를 클라이언트가 `useQuery`/`useMutation`으로 호출한다. 로딩·에러·캐싱·재시도를 라이브러리가 대신한다.
   - §2의 `{ error, code }` 표준 응답이 여기서 빛난다 — `code`로 분기(예: `SUBMISSION_EXISTS`면 기존 이어가기)하기 좋게 통일해 둔 덕분.

5. **Zustand(클라이언트 상태) ↔ 서버 상태 경계** (로드맵 #14·#15)
   - Phase 1의 Zustand는 "진행 중 로컬 draft"(슬롯 이미지 Object URL)를 들고 있다. Day 4는 이걸 **서버 submission/letter_pieces와 동기화**한다.
   - "무엇이 로컬 임시 상태(Zustand)이고 무엇이 서버 진실(TanStack Query)인가"를 가르는 게 동기화 설계의 핵심. 둘을 섞으면 "서버엔 저장됐는데 화면은 옛날 것" 같은 불일치가 난다.

---

## 한 줄 정리 모음 (복습용)

- **zod 검증**: 인증(누구인가) ≠ 검증(보낸 게 올바른가). 인증된 사용자도 거짓 데이터를 보낼 수 있다. 검증 스키마는 client/server 공용(isomorphic) — 서버 전용 코드 섞지 말 것. API는 `safeParse`(400 거절), seed는 `parse`(중단).
- **소유 식별자(user_id)는 body에서 받지 않는다**: JWT(`claims.sub`)에서 꺼내 서버가 지정. body로 받으면 명의 도용.
- **표준 에러 `{ error, code }`**: error=사람용, code=프로그램용. `details`는 개발 모드에서만(정보 노출 방지).
- **403 아니라 404**: 타인 소유·미존재를 똑같이 404로 **존재 은폐**(enumeration 차단). 검사 순서 **401→404→409**.
- **Storage는 별도 보안 표면**: 정책을 `storage.objects`에 건다. 경로 첫 폴더(`(storage.foldername(name))[1]`) = user_id로 소유권 표현. UPSERT엔 INSERT+UPDATE 정책 **둘 다** 필요. collages는 `submissions` 테이블을 EXISTS로 조인해 조건부 공개.
- **GRANT vs RLS는 2단 관문**(Storage에도 동일). GRANT 없으면 정책에 도달 못 함.
- **Drizzle 직결은 RLS를 우회한다**: Day 3 1급 함정. RLS 믿고 소유권 검증 빠뜨리면 남의 데이터가 샌다. `getOwnedSubmission`으로 **코드로** 검증.
- **getAuthUser는 getClaims()**: 서버 인증은 검증하는 getClaims. getSession(읽기만, 위조 가능) 금지.
- **UPSERT 두 종류**: `onConflictDoNothing`=중복 방지(submission 생성), `onConflictDoUpdate`=값 교체(글자 슬롯). 의도를 먼저 정한다.
- **파일 검증 MVP**: MIME(자기 신고값) + 크기(413)까지만. magic-byte·EXIF strip은 **기록된 미룬 리스크**.
- **Storage+DB 비원자성**: 한 트랜잭션 아님 → 고아 파일 가능. 파일 먼저·행 나중 + try/catch로 path 로깅. 서버 path 구성(1차) + Storage 정책(2차) = 이중 방어.
- **M2**: 복귀 경로를 open-redirect 방어 + **알려진 페이지 경로 화이트리스트**까지 좁힘(`/login`·`/api` 폴백).
- **M3**: proxy matcher에서 `/api` 제외(API는 자체 401 책임). 중복 세션 갱신 제거.
- **seed**: 데이터는 마이그레이션 lineage 밖. zod로 불변식 사전 검증, active_date UNIQUE UPSERT로 idempotent.
</content>
</invoke>
