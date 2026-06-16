# Phase 3 Day 6 — 피드(A7 `GET /api/feed` + 무한 스크롤)

> 대상 작업: A7 피드 Route Handler(커서 페이지네이션) + 무한 스크롤 화면·카드
> 게이트 C(학습) 산출물. 코드는 수정하지 않고 개념만 정리한다.
> 선행 노트: `docs/learning/phase-2-day-4.5.md`(useInfiniteQuery·staleTime 선행), `docs/learning/phase-2-day-5.md`(RLS 우회·코드 가시성)

---

## 한 줄 요약

피드는 **"커서로 다음 페이지 위치를 들고 다니며, 한 번에 한 장씩 정확히 이어 붙이는"** 목록이다. 그 위치를 클라이언트에 숨겨(불투명 커서) 넘기고, 서버는 RLS 없이 직접 DB를 치므로 **가시성 필터를 코드가 직접 강제**하며, 항목당 추가 쿼리(N+1)를 피하려 **배치 집계 2쿼리**로 반응 수를 한 번에 계산한다.

---

## 이번 Day에서 배운 8개 개념 (우선순위 순)

1. Cursor(keyset) pagination — 왜 offset이 아닌가
2. 불투명 커서(opaque cursor) — base64url + zod 검증
3. timestamptz(μs) vs JS Date(ms) 정밀도 경계 (알려진 Low 제약)
4. N+1 회피 — 페이지 1쿼리 + 배치 집계 2쿼리
5. 항목별 signed URL + null 폴백
6. RLS 우회 아키텍처의 코드 레벨 가시성 필터
7. TanStack `useInfiniteQuery` — pageParam과 queryKey
8. IntersectionObserver 무한 스크롤 센티널

---

## 1. Cursor(keyset) pagination — 왜 offset이 아닌가

### 왜 필요한가? (offset의 문제)

피드를 "20개씩 끊어서" 보여주려면 "어디까지 봤는지"를 표현해야 한다. 가장 흔한 방법은 `LIMIT 20 OFFSET 40`(= 3페이지)이다. 하지만 offset에는 두 가지 결함이 있다.

- **건너뛴 행을 매번 다시 스캔한다.** `OFFSET 1000`은 DB가 1000개를 읽고 버린 뒤 다음 20개를 준다. 뒤로 갈수록 느려진다(O(offset)).
- **목록이 살아 움직이면 중복·누락이 생긴다.** 내가 1페이지를 보는 사이 누군가 새 콜라주를 맨 앞에 올리면, 2페이지(`OFFSET 20`)는 한 칸씩 밀려서 1페이지 마지막 항목을 **다시 보여주거나(중복)**, 반대로 삭제가 일어나면 **한 칸을 건너뛴다(누락)**. 피드는 끊임없이 새 제출이 들어오는 목록이라 이 문제가 정확히 발생한다.

비유: offset은 책을 읽을 때마다 "처음부터 40쪽 세고 41쪽부터"라고 말하는 것이다. 누가 앞에 한 쪽을 끼워 넣으면 41쪽이 다른 내용이 된다. **커서는 "내가 마지막으로 읽은 문장에 책갈피를 꽂아두고, 거기서부터"** 라고 말하는 것이다. 앞에서 무슨 일이 생겨도 책갈피 위치는 안 흔들린다.

### keyset = "마지막으로 본 행의 정렬 키"를 책갈피로 쓰는 것

커서 페이지네이션(=keyset pagination)은 "몇 개 건너뛸지"가 아니라 **"마지막으로 본 행의 정렬 키보다 뒤쪽"** 을 술어(WHERE)로 표현한다.

문제는 정렬 키가 유일하지 않을 때다. `created_at`만으로 정렬하면 같은 시각의 두 행 사이에 안정적인 순서가 없어, 그 경계에서 중복·누락이 난다. 그래서 **반드시 유일한 tie-breaker(여기선 `id`)를 정렬 키에 추가**해 전순서(total order)를 만든다.

### Typolog에서는?

`src/app/api/feed/route.ts:97`의 정렬:

```
.orderBy(desc(submissions.created_at), asc(submissions.id))
```

`created_at DESC`(최신이 위로) + `id ASC`(동시각이면 id 오름차순)로 **결정론적 전순서**를 만든다.

그리고 keyset 술어(`route.ts:67-75`):

```
(created_at < :cursorCreatedAt)
  OR (created_at = :cursorCreatedAt AND id > :cursorId)
```

이 술어의 방향이 정렬 방향과 **반드시 짝**이 맞아야 한다.
- `created_at DESC`로 내려가는 중이니 "다음"은 더 **오래된**(`<`) 행이다.
- 동시각(`created_at =`)일 때는 `id ASC`로 이미 본 것보다 **id가 더 큰**(`>`) 행이 다음이다.

방향을 한 군데라도 뒤집으면(예: 술어에서 `id <`) 같은 ms 묶음 안에서 행이 통째로 누락된다. 이게 keyset의 1급 함정이다. QA C-4에서 이 방향 정합성을 수동 추론으로 별도 검증했다(`docs/reviews/phase3-day6-qa-review.md` C-4).

### 부분 인덱스 `idx_submissions_feed`와의 정합

`src/db/schema.ts:63-65`:

```
index('idx_submissions_feed')
  .on(table.challenge_id, table.created_at.desc(), table.id)
  .where(sql`${table.status} = 'completed' AND ${table.is_public} = true`)
```

이 인덱스가 keyset 쿼리를 빠르게 만드는 핵심이다. 세 가지가 쿼리와 정확히 맞물린다.

- **인덱스 컬럼 순서 = 쿼리 조건 순서.** `(challenge_id, created_at DESC, id)` 순서는 "challenge_id로 먼저 좁히고 → created_at 내림차순 → id"로 쿼리의 WHERE/ORDER BY와 1:1로 대응한다. DB는 인덱스를 따라가며 정렬된 채로 바로 읽어, 별도 정렬(sort) 단계 없이 keyset 술어 지점으로 점프할 수 있다.
- **부분 인덱스(`WHERE status='completed' AND is_public=true`)** 는 인덱스 자체가 "보여줄 행"만 담는다. draft·hidden·비공개 행은 인덱스에 아예 없어서 인덱스가 작고 빠르다. 가시성 필터(§6)가 인덱스 술어와 같은 조건이라 인덱스가 그대로 쓰인다.
- 그래서 offset과 달리 **뒤 페이지로 가도 일정한 비용**으로 다음 20개를 찾는다.

### `limit + 1` 트릭 — "다음 페이지가 있는가"를 한 쿼리로

`route.ts:98`은 `limit`이 아니라 `limit + 1`개를 가져온다(`.limit(limit + 1)`). 21개가 오면 "21번째가 존재함 = 다음 페이지 있음"이고, 20개 이하면 끝이다(`route.ts:101` `hasMore = rawRows.length > limit`). 별도 `COUNT(*)` 쿼리 없이 다음 페이지 유무를 판정하는 표준 기법이다. 그리고 사용자에게는 `slice(0, limit)`으로 20개만 돌려준다(`route.ts:102`).

---

## 2. 불투명 커서(opaque cursor) — 내부 구조를 숨긴다

### 왜 필요한가?

§1의 책갈피(=`{created_at, id}`)를 클라이언트에 그냥 노출하면 두 가지가 나빠진다.

- **계약이 새어 나간다.** 클라이언트가 `created_at`·`id`를 직접 보면, 나중에 정렬 키를 바꾸거나(예: 좋아요 순) tie-breaker를 바꿀 때 클라이언트 코드까지 깨진다. 커서의 내부 구조는 **서버의 구현 디테일**이지 공개 API가 아니다.
- **클라이언트가 손대고 싶어진다.** "id만 살짝 바꿔서 다른 데이터 긁기" 같은 시도를 유도한다.

해법은 커서를 **불투명한 토큰**(의미 없는 문자열)으로 만드는 것이다. 클라이언트 입장에서는 "서버가 준 다음 페이지 표 한 장"일 뿐, 안에 뭐가 들었는지 모르고 알 필요도 없다.

### Typolog에서는?

`src/lib/validations/feed.ts:31-34` 인코딩:

```
const raw = `${createdAt.toISOString()}|${id}`;
return Buffer.from(raw, 'utf8').toString('base64url');
```

`{ISO 8601}|{UUID}`를 만들어 **base64url**로 인코딩한다. base64url을 고른 이유: `+`, `/`, `=`가 없어 URL 쿼리 파라미터(`?cursor=...`)에 그대로 실어도 인코딩이 깨지지 않는다(QA C-2에서 `+/=` 부재 검증).

구분자로 `|`를 쓴 건, ISO 타임스탬프에도 UUID에도 `|`가 절대 안 나오기 때문이다(`feed.ts:16-21` 주석). 그래서 디코드 시 **첫 번째 `|`** 만 기준으로 자르면 안전하다(`feed.ts:48` `indexOf('|')`).

### 디코드는 반드시 검증한다 (신뢰 경계)

커서는 클라이언트에서 돌아오는 값이라 **신뢰할 수 없는 입력**이다. base64url을 풀었다고 끝이 아니라, 풀린 내용이 진짜 `{ISO}|{UUID}` 모양인지 zod로 재검증한다(`feed.ts:25-28, 56-59`):

```
const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
});
```

검증 실패면 `decodeFeedCursor`가 throw하고, 라우트가 `400 INVALID_CURSOR`로 받아낸다(`route.ts:43-46`). QA C-6에서 손상 케이스 7종(쓰레기값, 구분자 없음, 잘못된 날짜·UUID, 빈 문자열, 좌/우 비어있음)이 모두 throw하는 것을 단위 테스트로 확인했다.

비유: 불투명 커서는 **놀이공원 재입장 도장**이다. 손님은 도장 무늬가 무슨 뜻인지 모르고(불투명), 직원은 입구에서 도장이 위조인지 확인한다(zod 검증). 손님이 도장을 그려 와도 통과 못 한다.

---

## 3. timestamptz(μs) vs JS Date(ms) 정밀도 경계 — 알려진 Low 제약

### 무엇이 어긋나는가?

이번 Day에서 **알면서도 MVP에서는 고치지 않기로 한** 제약이다. 이해의 핵심은 "두 층의 시간 정밀도가 다르다"는 것이다.

- **Postgres `timestamptz`** 는 **마이크로초(μs, 100만분의 1초)** 까지 저장한다.
- 그런데 드라이버 **postgres.js는 이걸 JS `Date`로 읽는다.** JS `Date`는 **밀리초(ms, 1000분의 1초)** 까지만 표현한다. → μs 자리가 **잘려나간다(절삭)**.
- 커서도 `Date.toISOString()`으로 만들어지니 ms 정밀도만 담긴다(§2).

### 왜 경계에서 한 행이 누락될 수 있나

같은 챌린지에서 두 제출의 `created_at`이 **같은 ms이지만 다른 μs**라고 하자. 예: `T+000001μs`와 `T+000999μs`(둘 다 ms로는 `T+000ms`). 이 둘이 정확히 페이지 경계(마지막 항목)에 걸리면:

- 커서는 `T+000ms`로 인코딩된다.
- keyset 술어로 `T+000999μs` 행을 평가하면:
  - `created_at < T+000ms` → **FALSE**(999μs는 0ms보다 뒤)
  - `created_at = T+000ms` → **FALSE**(실제 DB 값은 000999μs ≠ 000000μs)
  - → 두 조건 다 거짓 → **이 행이 다음 페이지에서 누락**된다.

`route.ts:62-66` 주석과 QA L-1(`docs/reviews/phase3-day6-qa-review.md`)에 이 시나리오가 그대로 문서화돼 있다.

### 왜 MVP에서 미수정인가 / 근본 해결은?

- **트리거 조건이 극히 좁다.** "같은 1ms 안에 서로 다른 두 명이 각자 완성·공개"하고, "그 두 행이 하필 페이지 경계(20번째와 21번째)에 위치"해야 한다. MVP 예상 완성·공개량은 하루 ~17건(베타 1개월 ~500건) 수준이라 1ms 충돌 확률은 무시 가능.
- **증상이 비파괴적이다.** 항목 1개가 그 회차에 스킵될 뿐, 데이터 손실·보안 문제가 아니고 새로고침으로 첫 페이지를 다시 받으면 보인다.
- **근본 해결책도 명확하다.** 커서에 ms ISO 대신 **epoch microseconds(정수)** 를 실어 DB와 정밀도를 맞추면 절삭이 사라진다. 다만 postgres.js가 Date로 읽는 한 쿼리 쪽도 μs 비교가 되도록 캐스팅이 필요해, MVP에서는 의도적으로 미룬다.

비유: 초시계를 1/1000초까지만 읽는 사람(JS Date)이 1/100만초까지 재는 결승선 카메라(Postgres)의 결과를 베껴 적으면, 같은 1/1000초에 들어온 두 주자의 순서가 사라진다. 평소엔 그 1/1000초에 둘이 동시에 들어올 일이 거의 없어서 문제 없지만, **알고 적어두는 것과 모르고 당하는 것은 다르다.**

---

## 4. N+1 회피 — 페이지 1쿼리 + 배치 집계 2쿼리

### 왜 필요한가? (N+1 문제)

각 피드 카드는 "반응 수(reaction_count)"와 "내가 눌렀는지(user_reacted)"를 보여줘야 한다. 순진하게 짜면 이렇게 된다.

```
const page = 제출 20개 조회;                 // 1쿼리
for (const sub of page) {
  sub.count = 반응 수 조회(sub.id);          // 20쿼리
  sub.reacted = 내가 눌렀는지 조회(sub.id);  // 20쿼리
}
```

20개짜리 페이지에 쿼리가 **1 + 40 = 41번** 나간다. 항목 수 N에 비례해 쿼리가 늘어나는 이 패턴을 **N+1 문제**라 한다. 네트워크 왕복이 누적돼 응답이 급격히 느려지고 DB도 혹사당한다.

### Typolog에서는? — IN 절로 한 방에 모아 집계

`route.ts:114-133`은 페이지의 **id 배열**(`pageIds`)을 만들어 두 쿼리로 끝낸다(`Promise.all`로 병렬).

- **Q2(개수):** `WHERE submission_id IN (pageIds) GROUP BY submission_id` + `count()` — 페이지 전체의 반응 수를 한 번에 집계.
- **Q3(내 반응):** `WHERE user_id = 나 AND submission_id IN (pageIds)` — 내가 누른 submission_id 목록만 한 번에.

즉 페이지 쿼리 1 + 집계 2 = **항상 3쿼리**(항목 수와 무관). N+1이 "1 + 2N"이었던 것을 상수로 눌렀다(QA R-1).

집계 결과는 메모리에서 **Map/Set으로 변환**해 O(1)로 합친다(`route.ts:135-139`). 없는 항목은 `?? 0`(`route.ts:167`)으로 기본값을 줘서, 반응이 0건인 제출도 정상 처리된다.

### 빈 페이지 조기 반환 함정

`pageRows.length === 0`이면 위 집계 단계에 들어가기 전에 즉시 `{items:[], next_cursor:null}`을 반환한다(`route.ts:104-107`). 이유: Drizzle에서 `inArray([])`(빈 배열 IN)은 유효한 SQL을 만들지 못해 깨진다. 빈 경우를 먼저 걸러야 한다(QA C-8).

비유: 20명에게 각각 전화 거는 대신(N+1), "이 20명 명단(IN 절)에 해당하는 반응 전부 줘"라고 **한 번에 주문서를 넣는 것**(배치)이다.

---

## 5. 항목별 signed URL + null 폴백

### 왜 필요한가?

콜라주는 `collages` 버킷(private)에 있다. URL만으로는 못 본다. 피드에서 남의 공개 콜라주를 보여주려면 **만료 시간이 붙은 임시 입장권(signed URL)** 으로 바꿔야 한다(로드맵 #7, Signed URL 개념).

### Typolog에서는?

`route.ts:142-148`은 페이지의 각 콜라주 경로를 `createSignedUrl(supabase, 'collages', path, SIGNED_URL_TTL.EDIT)`로 변환한다. TTL은 1시간(`SIGNED_URL_TTL.EDIT = 3600`, `src/lib/storage/signed-url.ts:13`). 여기서도 N개를 `Promise.all`로 병렬 서명한다.

핵심 패턴 두 가지:

- **요청자 JWT가 실린 server client로 서명** → Storage 정책(RLS)이 그대로 적용된다. 권한 없는 경로면 정책이 거부해 `null`을 돌려준다(`signed-url.ts:18-29`). 단, 피드 쿼리 자체가 `completed + public` 행만 뽑으므로 서명 대상은 모두 공개 허용 대상이다(QA S-8).
- **실패 시 null 폴백.** 서명이 실패하거나 `collage_image_url`이 비어 있으면 `null`을 담는다(`route.ts:144-146`, `Promise.resolve(null)`). 와이어 타입도 `collage_url: string | null`로 null 가능성을 **타입 수준에서 명시**한다(`src/types/api.ts:92`).

### 카드 쪽 폴백

`src/features/feed/FeedCard.tsx:22-40`은 `collage_url`이 있으면 `<img>`, 없으면(`null`) **닉네임 이니셜**을 큰 글자로 보여준다. 이미지가 깨진 빈 카드 대신 의미 있는 폴백을 주는 것이다(QA F-9). 아바타도 같은 패턴(`avatar_url` null → 이니셜 원, `FeedCard.tsx:49-62`, QA F-10).

> 참고: `next/image` 대신 `<img>`를 쓰는 건 `next.config`에 Supabase 도메인 `remotePatterns`를 안 넣었기 때문(`FeedCard.tsx:23` 주석). signed URL은 매번 토큰이 바뀌어 최적화 캐시 이득도 작다.

### staleTime 60s와 TTL 1h의 관계

signed URL은 1시간 뒤 만료된다. 만약 캐시(staleTime)가 1시간보다 길면, 캐시에 남은 만료된 URL로 이미지가 깨진다. 그래서 피드 staleTime은 60초로, TTL 3600초보다 **훨씬 짧게** 둔다(§7). Day 4.5에서 submission staleTime을 TTL의 절반(30분)으로 잡은 것과 같은 원리다(`docs/learning/phase-2-day-4.5.md` §3).

---

## 6. RLS 우회 아키텍처의 코드 레벨 가시성 필터

### 왜 코드가 필터를 강제해야 하나

Typolog의 DB 접근은 **Drizzle 직결**(postgres role)이다. 이 경로는 **RLS를 우회**한다(Day 3·Day 5의 1급 함정). 즉 `submissions` 테이블의 "본인 것 + 공개 것만 SELECT" RLS 정책이 **이 쿼리에는 적용되지 않는다.** Drizzle로 그냥 `select`하면 draft·hidden·비공개·남의 것까지 전부 나온다.

그래서 **앱 코드가 RLS가 했어야 할 가시성 필터를 직접 강제**하는 것이 1차 방어선이다(`docs/learning/phase-2-day-5.md`: DB는 코드 방어, Storage는 정책 방어의 이원 구조).

### Typolog에서는?

`route.ts:53-57`의 `baseFilter`가 세 가지를 코드로 못 박는다.

```
and(
  eq(submissions.challenge_id, challengeId),   // S-3: 다른 챌린지 차단
  eq(submissions.status, 'completed'),         // S-1: draft·hidden 차단
  eq(submissions.is_public, true),             // S-2: 비공개 차단
)
```

이 세 조건은 **§1의 부분 인덱스 `idx_submissions_feed`의 WHERE 절과 똑같다.** 그래서 가시성을 지키는 동시에 인덱스가 그대로 적중한다(가시성 = 성능이 한 조건으로 묶임).

추가로 `user_reacted`는 `WHERE user_id = user.id`로 **본인 반응만** 반영해(`route.ts:127-131`, S-4), 남의 반응 여부가 새지 않게 한다. `status`는 WHERE가 `'completed'`로 고정했으니 응답 조립 시 `status: 'completed' as const`로 단언한다(`route.ts:156`).

### 자주 하는 실수: "RLS가 있으니 코드 필터는 생략해도 되겠지"

이게 가장 위험한 오해다. **RLS 정책은 분명히 존재하고 Day 5에서 작동을 실증했지만**(`scripts/verify-rls.ts`), 그건 **유저 JWT로 DB를 칠 때만** 발동한다. 피드 라우트는 Drizzle 직결이라 그 정책을 절대 거치지 않는다. RLS는 "심층 방어(2차)"로 남겨두되, **1차 방어선은 코드 필터**라는 걸 잊으면 비공개 콜라주가 피드에 그대로 노출된다. QA가 S-1~S-3을 코드 줄 번호까지 짚어 검증한 이유다.

비유: RLS는 각 방의 스마트 잠금(Day 1 비유)이지만, 직원용 마스터키(postgres role)로 들어오면 안 열린다. 마스터키로 다니는 직원(피드 라우트)은 **스스로 "이 방은 손님께 보여드려도 되는 방인가"를 매번 확인**해야 한다.

---

## 7. TanStack `useInfiniteQuery` — pageParam과 queryKey

### 왜 `useQuery`가 아니라 `useInfiniteQuery`인가

무한 스크롤은 "같은 쿼리키 아래 여러 페이지가 누적되는" 특수 형태다. `useInfiniteQuery`는 페이지들을 `data.pages` 배열로 쌓아주고, "다음 페이지 파라미터를 어디서 얻을지"를 선언적으로 처리해준다.

### queryKey에 cursor를 넣지 않는 이유 (핵심 함정)

`src/hooks/use-feed.ts:13`:

```
queryKey: ['feed', challengeId ?? ''] as const,
```

커서가 queryKey에 **없다.** 초보자가 가장 많이 하는 실수가 `queryKey: ['feed', challengeId, cursor]`처럼 커서를 키에 넣는 것이다. 그러면:

- 커서가 바뀔 때마다 **별개의 캐시 엔트리**가 생겨 페이지가 누적되지 않고 매번 처음부터 다시 가져온다.
- `useInfiniteQuery`의 페이지 누적 모델이 깨진다.

올바른 모델은: **queryKey는 "이 무한 목록의 정체성"(어느 챌린지의 피드인가)만** 담고, 커서는 **`pageParam`이라는 별도 통로**로 흐른다(`use-feed.ts:14-15`). queryFn이 `({ pageParam }) => fetchFeed(challengeId, pageParam)`로 받아 쓴다. 같은 키 아래 page 0, 1, 2…가 누적된다(QA F-1).

### getNextPageParam의 정지 조건

`use-feed.ts:19-20`:

```
getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
```

- 서버가 `next_cursor` 문자열을 주면 → 그게 다음 `pageParam`이 된다.
- 서버가 `next_cursor: null`(마지막 페이지)을 주면 → `?? undefined` → **`undefined` 반환 = "더 없음"** → TanStack이 `hasNextPage`를 `false`로 설정한다(QA F-2).

여기서 **`null`을 그대로 반환하면 안 된다.** TanStack은 정지 신호로 `undefined`를 기대하므로 `null`은 "유효한 다음 파라미터"로 오해될 수 있다. `?? undefined` 변환이 그래서 필요하다.

`initialPageParam: undefined`(`use-feed.ts:18`)는 첫 페이지엔 커서가 없다는 뜻이고, `fetchFeed`는 `if (cursor)` 가드로 빈/undefined 커서를 아예 안 보낸다(`src/lib/api-client.ts:140`).

### enabled — 의존 체인

`enabled: !!challengeId`(`use-feed.ts:16`). 피드는 "오늘의 챌린지 id"가 있어야 시작할 수 있다. `FeedClient`는 `useTodayChallenge()` → `challenge.id` → `useFeed(challenge.id)`의 **2단 의존 체인**으로, challengeId가 확정되기 전엔 피드 쿼리가 발사되지 않는다(`src/features/feed/FeedClient.tsx:31-50`, QA F-5).

### staleTime 60s

§5에서 본 대로 signed URL TTL(1h)보다 훨씬 짧은 60초(`use-feed.ts:17`). providers 전역 기본값과 같지만 "피드는 이 값이 중요하다"는 의도를 드러내려 명시했다(Day 4.5 §3 연결).

---

## 8. IntersectionObserver 무한 스크롤 센티널

### 왜 스크롤 이벤트가 아니라 IntersectionObserver인가

"바닥 근처에 오면 다음 페이지를 불러온다"를 `onScroll`로 구현하면, 스크롤할 때마다 수십~수백 번 콜백이 터지고 매번 위치 계산을 해야 해서 성능이 나쁘다. **IntersectionObserver**는 "특정 요소(센티널)가 화면에 들어왔는가"를 브라우저가 효율적으로 감시하다가, 들어온 순간에만 콜백을 한 번 호출한다.

비유: 스크롤 이벤트는 1초에 수백 번 "지금 바닥이야?"라고 묻는 것이고, IntersectionObserver는 바닥에 **센서를 한 개 깔아두고** 누가 밟으면 그때 한 번 알림을 받는 것이다.

### Typolog에서는?

`src/hooks/use-intersection-observer.ts`가 재사용 가능한 훅으로, `src/features/feed/FeedClient.tsx:157`의 빈 `<div ref={sentinelRef}>`(센티널)가 목록 맨 아래에 깔린다. 이 div가 뷰포트에 들어오면 `fetchNextPage()`가 호출된다. `rootMargin: '200px'`(`use-intersection-observer.ts:26`)로 바닥에 닿기 200px 전에 미리 트리거해, 모바일 네트워크 지연을 흡수하고 스크롤이 끊기지 않게 한다.

### 세 가지 안정화 장치

1. **enabled 가드(이중 트리거 방어):** `FeedClient.tsx:53`
   ```
   const shouldObserve = hasNextPage && !isFetchingNextPage;
   ```
   다음 페이지가 있고(`hasNextPage`) **현재 로딩 중이 아닐 때만**(`!isFetchingNextPage`) 관찰한다. 이 가드가 없으면 센티널이 화면에 머무는 동안 `fetchNextPage`가 연달아 여러 번 발사돼 같은 페이지를 중복 요청한다. 훅 내부에서 `if (!enabled) return`(`use-intersection-observer.ts:15`)으로 관찰 자체를 끊는다(QA F-3).

2. **useCallback으로 콜백 안정화(observer 재등록 방지):** `FeedClient.tsx:54-56`
   ```
   const handleIntersect = useCallback(() => { void fetchNextPage(); }, [fetchNextPage]);
   ```
   훅의 `useEffect` 의존성이 `[enabled, onIntersect]`(`use-intersection-observer.ts:34`)라, 콜백이 매 렌더마다 새 함수면 effect가 재실행돼 observer가 계속 disconnect/observe를 반복한다. `useCallback`으로 참조를 고정하고, TanStack의 `fetchNextPage`도 안정적 참조라 의존성이 안 흔들린다(QA F-4).

3. **cleanup:** effect의 반환에서 `observer.disconnect()`(`use-intersection-observer.ts:31-33`). 언마운트나 의존성 변경 시 옛 observer를 반드시 정리해 누수·중복 관찰을 막는다.

### 페이지 평탄화

화면 렌더 직전 `data.pages.flatMap((page) => page.items)`로 누적된 모든 페이지를 한 배열로 펼친다(`FeedClient.tsx:129`). `useInfiniteQuery`는 페이지를 분리 보관하므로, 렌더링 시 평탄화는 우리 몫이다. `key={item.submission.id}`로 안정 키를 준다(`FeedClient.tsx:152`).

---

## 자주 하는 실수 모음

| 실수 | 무슨 일이 벌어지나 | 올바른 방법 |
|------|-------------------|------------|
| **offset 페이지네이션을 살아있는 피드에 사용** | 새 제출이 들어오면 페이지 경계에서 중복·누락 | keyset(커서) + 유일 tie-breaker(`id`) |
| **정렬 키에 tie-breaker 누락** (`created_at`만) | 동시각 행 사이 순서 불안정 → 경계 누락 | `created_at DESC, id ASC` 전순서 |
| **keyset 술어 방향을 정렬과 안 맞춤** | 같은 ms 묶음이 통째로 누락 | DESC ↔ `<`, tie-breaker ASC ↔ `>` 짝 맞추기 |
| **μs 정밀도 무시** | 같은 ms·다른 μs 행이 경계에서 1개 누락(Low) | (근본) 커서에 epoch microseconds. MVP는 인지 후 수용 |
| **커서를 queryKey에 넣음** | 페이지 누적 안 됨, 매번 재요청 | queryKey엔 정체성만, 커서는 pageParam |
| **getNextPageParam에서 null 그대로 반환** | "끝"이 인식 안 됨 | `next_cursor ?? undefined` |
| **RLS만 믿고 코드 필터 생략** | Drizzle 직결은 RLS 우회 → 비공개 노출 | `status/is_public/challenge_id`를 코드로 강제 |
| **항목마다 반응 수 조회(N+1)** | 1+2N 쿼리, 느림 | `IN` + `GROUP BY` 배치 2쿼리 |
| **`inArray([])` 호출** | 빈 배열 IN으로 쿼리 깨짐 | 빈 페이지 조기 반환 |
| **불투명 커서를 검증 없이 신뢰** | 손상·위조 입력으로 에러/오동작 | base64url 디코드 후 zod 재검증 → 400 |
| **IntersectionObserver enabled 가드 없음** | 중복 fetchNextPage 폭주 | `hasNextPage && !isFetchingNextPage` |
| **콜백을 useCallback으로 안 감쌈** | observer가 매 렌더 재등록 | `useCallback([fetchNextPage])` + cleanup |
| **signed URL을 staleTime보다 짧게 보지 않음** | 캐시에 남은 만료 URL로 이미지 깨짐 | staleTime(60s) ≪ TTL(1h) |

---

## Day 7로 가는 다리 — 반응 toggle + Optimistic Update

### 이번 Day에 "계약"을 확정해 둔 것

Day 6 카드의 하트는 **표시 전용**이다(클릭 이벤트 없음, `FeedCard.tsx:14` 주석, QA F-11). 그런데도 서버는 `reaction_count`와 `user_reacted`를 **정식으로 계산해 내려준다**(§4). 이게 Day 7의 토대다.

- 와이어 타입 `ApiFeedItem.reaction_count: number` / `user_reacted: boolean`이 이미 확정됐다(`src/types/api.ts:93-94`).
- 즉 Day 7에서 토글을 붙일 때 **새 필드를 만들 필요가 없다.** 캐시 안에 이미 두 값이 들어 있으니, 하트를 누르면 그 두 값만 바꾸면 된다.

### Optimistic Update의 선행 개념

Day 7의 "♡ 클릭 → 즉시 ♥로 바뀌고 +1"은 **낙관적 업데이트**다(로드맵 #16). 서버 응답을 기다리지 않고 UI를 먼저 바꾼 뒤, 실패하면 되돌린다. 그 구현은 이번 Day의 두 가지에 직접 기댄다.

1. **무한 쿼리 캐시 구조를 알아야 한다.** 피드 캐시는 `data.pages[].items[]`의 중첩 구조다(§7). 토글 시 `queryClient.setQueryData(['feed', challengeId], ...)`로 그 중첩 안에서 **해당 submission 1개의 `reaction_count`/`user_reacted`만** 갱신해야 한다. 이번 Day에 queryKey를 `['feed', challengeId]`로 고정(커서 미포함)해 둔 덕에, 토글이 가리킬 캐시 키가 명확하다.

2. **롤백용 백업.** `onMutate`에서 현재 캐시를 백업하고 낙관적으로 수정 → `onError`면 백업으로 되돌린다(로드맵 #16 예시). UNIQUE(user_id, submission_id) 제약이 토글의 멱등성을 받쳐준다.

### Day 7에서 추가로 마주칠 것 (미리보기)

- **Route Handler vs Server Action 선택.** 로드맵 #3은 단순 mutation(좋아요 토글)을 Server Action 후보로 본다. 어느 쪽이든 토글은 "INSERT or DELETE"의 멱등 토글이 된다.
- **invalidate vs setQueryData.** 낙관적 즉시 반영은 `setQueryData`, 최종 정합은 성공 후 선택적 invalidate(Day 4.5에서 익힌 패턴).

비유: 이번 Day는 하트 모양과 숫자를 **그릴 줄 아는 도화지**를 깔아 둔 것이고, Day 7은 그 도화지에 **누르면 즉시 색이 칠해지는 버튼**을 붙이는 일이다. 색칠 위치(캐시 경로)와 칠할 값(두 필드)을 이미 정해 뒀기에 Day 7이 가벼워진다.

---

## 핵심 한 장 요약

- 피드는 **keyset 커서 + 유일 tie-breaker(`created_at DESC, id ASC`)** 로 살아있는 목록을 중복·누락 없이 이어 붙인다. 부분 인덱스 `idx_submissions_feed`가 가시성 필터와 같은 조건이라 그대로 적중한다.
- 커서는 **base64url 불투명 토큰**으로 내부 구조를 숨기고, 돌아온 값은 **zod로 재검증**한다.
- **μs vs ms 정밀도** 차이로 경계에서 1개 누락 가능성은 알려진 Low — 인지 후 MVP 수용.
- **N+1을 IN+GROUP BY 배치 2쿼리**로 누르고, 콜라주는 **항목별 signed URL(1h)+null 폴백**.
- DB는 Drizzle 직결로 RLS를 우회하므로 **코드가 가시성을 1차로 강제**한다.
- 클라이언트는 **`useInfiniteQuery`(커서는 pageParam, queryKey 미포함)** + **IntersectionObserver 센티널(enabled 가드·useCallback·cleanup)** 로 무한 스크롤을 만든다.
- 서버가 미리 확정한 `reaction_count`/`user_reacted` 계약이 **Day 7 optimistic 토글의 발판**이다.

---

## 참고

- 코드: `src/app/api/feed/route.ts`, `src/lib/validations/feed.ts`, `src/lib/api-client.ts`(`fetchFeed`), `src/hooks/use-feed.ts`, `src/hooks/use-intersection-observer.ts`, `src/features/feed/FeedClient.tsx`, `src/features/feed/FeedCard.tsx`, `src/types/api.ts`, `src/db/schema.ts`(`idx_submissions_feed`), `src/lib/storage/signed-url.ts`
- 설계: `docs/backend-design-plan.md` §6.3(A7)·§9 "Day 6 확정 결정"·§10.5(cursor)·§10.8(부분 인덱스)
- QA: `docs/reviews/phase3-day6-qa-review.md` (L-1 μs 정밀도, C-4 keyset 방향, F-1~F-4 무한 스크롤)
- 선행 노트: `docs/learning/phase-2-day-4.5.md`(useInfiniteQuery·staleTime), `docs/learning/phase-2-day-5.md`(RLS 우회·코드 가시성)
