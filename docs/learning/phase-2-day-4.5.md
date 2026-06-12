# Phase 2 Day 4.5 — 클라이언트↔서버 동기화 (TanStack Query 도입 + 제출 오케스트레이션) 학습 노트

> 대상 작업(§9 Day 4.5 확정 결정): Day 1~4에서 만든 백엔드 API(A1~A6)를 **실제로 호출**하는 프론트엔드 브리지를 깐다.
> Mock 데이터로 굴러가던 홈·수집·미리보기 화면이 이제 서버에서 데이터를 받아오고, "제출하기" 버튼이 A2→A5→A6→A4 체인을 실행해 draft를 completed로 굳힌다.
> 산출물: `src/app/providers.tsx`(QueryClientProvider), `src/hooks/use-today-challenge.ts`·`src/hooks/use-submission.ts`(쿼리·뮤테이션 훅), `src/lib/api-client.ts`(typed fetcher), `src/features/compose/submit-collage.ts`(제출 오케스트레이터), `src/lib/image/to-webp.ts`(브라우저 호환 인코딩), `src/types/api.ts`(공유 와이어 타입), `src/features/challenge/TodayChallengeGate.tsx`(쿼리 게이트), 마이그레이션 `0004`.
> 참고: `docs/learning/phase-2-day-4.md`("다음 Day(4.5)로 가는 다리"), `docs/backend-design-plan.md` §9 Day 4.5 표, `docs/architecture.md`, `docs/reviews/phase2-day4.5-qa-review.md`, 로드맵 #15(TanStack Query).

---

## 이번 Day의 큰 그림 (먼저 읽기)

Day 4까지는 **서버 쪽 출구**(A3 상세·A4 완성·A6 콜라주)를 다 만들었다. 하지만 화면은 여전히 mock 데이터로 돌아갔다 — 백엔드는 있지만 **아무도 그 문을 두드리지 않는 상태**였다.

Day 4.5는 그 문을 두드리는 **프론트엔드 브리지**를 깐다. 핵심은 두 가지다.

```
[조회 흐름]  화면 ──useQuery──▶ api-client ──fetch──▶ Route Handler ──▶ DB
                  ▲                                                      │
                  └────────────── 캐시(staleTime)로 자동 관리 ◀──────────┘

[제출 흐름]  "제출하기" 버튼 ──useMutation──▶ submitCollage 오케스트레이터
                  A2(draft) ─▶ A5(letters×N) ─▶ A6(collage) ─▶ A4(complete)
                  (전 단계 멱등 → 중간 실패 시 같은 버튼으로 처음부터 재시도)
                  성공 시 invalidateQueries(['submission', id]) 1회 → A3 재조회
```

이번 Day에서 새로 등장하는 개념을 우선순위 순으로 본다.

1. **두 상태 관리의 경계** — Zustand(로컬 draft) vs TanStack Query(서버 상태), 왜 나누는가
2. **QueryClientProvider 싱글턴 패턴** — `isServer` 분기와 전역 정책(staleTime 60s·4xx 재시도 금지)
3. **staleTime 설계** — 캐시 신선도와 signed URL 만료를 어떻게 맞물리게 하는가
4. **멱등 오케스트레이션** — 4단계 체인을 "처음부터 재시도해도 안전하게" 만드는 법
5. **브라우저 호환 canvas 인코딩** — Safari WebP 미지원과 JPEG 폴백
6. **타입 전용 공유 와이어 타입** — 서버/클라 경계에서 런타임 import 없이 타입만 공유

---

## 1. Zustand vs TanStack Query — 두 상태 관리의 경계

### 왜 필요한가? — "내 메모"와 "서버의 진실"은 성격이 다르니까

상태 관리 라이브러리를 하나로 통일하면 안 될까? 안 된다. **두 종류의 데이터는 근본적으로 성격이 다르기 때문**이다.

- **로컬 draft (Zustand)**: 사용자가 지금 만들고 있는 것. 아직 서버에 없다. 어느 슬롯을 채웠는지, 배경색은 뭔지, 크롭한 이미지는 어디 있는지. **이 데이터의 진실은 브라우저에 있다.** 새로고침해도 살아남아야 하니 `persist`로 localStorage·IndexedDB에 저장한다.
- **서버 상태 (TanStack Query)**: DB에 있는 진실. 오늘의 챌린지, 제출 완성 여부, 콜라주 signed URL. **이 데이터의 진실은 서버에 있다.** 내가 가진 건 서버의 "사본(캐시)"일 뿐이라 언젠가 낡는다(stale).

이 둘을 한 곳에 섞으면 "이 값은 신선한가? 다시 가져와야 하나?"를 직접 관리해야 한다 — 로딩 상태, 에러, 캐싱, 만료, 재요청을 전부 손으로 짜야 한다. TanStack Query는 **서버 상태에만** 이 일을 대신해준다.

비유: Zustand는 **내 책상 위 메모장**(내가 쓴 것, 내 것), TanStack Query는 **회사 공유 문서의 캐시본**(원본은 서버에 있고, 가끔 내려받아 보되 오래되면 다시 받는다).

### Typolog에서는? — draft는 Zustand, 진실은 서버

`CollagePreviewClient.tsx`가 두 세계의 경계를 한눈에 보여준다.

- **로컬 draft (Zustand)**: `useChallengeStore()`(`CollagePreviewClient.tsx:63`)에서 슬롯 상태를 읽는다. 실제 크롭 이미지 Blob은 IndexedDB에 있고 `getImageBlob(slot.imageKey)`(`:117`, `:253`)로 읽는다. 이게 "내가 만든 것".
- **서버 상태 (TanStack Query)**: `useTodayChallenge()`(`use-today-challenge.ts`), `useSubmissionDetail(submittedId)`(`use-submission.ts:20`)로 서버 데이터를 받는다. 이게 "서버의 진실".

가장 중요한 설계 결정은 **"submission id를 클라이언트에 영구 저장하지 않는다"**(`api-client.ts:61-63`)는 것이다. draft를 만든 뒤 그 id를 Zustand에 박아두고 싶어진다 — 하지만 그러지 않는다.

> 왜? DB의 `UNIQUE(user_id, challenge_id)` 제약이 "한 유저는 한 챌린지에 제출 하나"를 보장하므로, **제출 시점마다 `createOrGetSubmission(challengeId)`을 호출하면 항상 같은 submission을 얻는다**(201 신규 or 409 기존 재사용). id를 따로 저장할 이유가 없다. 저장하면 오히려 "저장된 id가 낡았는데 서버 상태와 어긋나면?" 같은 동기화 버그의 씨앗이 된다. **서버를 단일 진실 소스로 두고, id는 필요할 때마다 서버에 물어본다.** (`submittedId` 로컬 state는 제출 직후 완료 UI를 보여주기 위한 휘발성 값일 뿐, 영구 저장이 아니다.)

### 핵심 원리

- Zustand가 답하는 질문: "사용자가 지금까지 **뭘 만들었나**?" → 브라우저가 진실.
- TanStack Query가 답하는 질문: "서버에 **뭐가 저장돼 있나**?" → 서버가 진실, 캐시는 사본.
- 제출이란 결국 **Zustand의 로컬 draft를 서버 상태로 승격(promote)시키는 행위**다(`handleSubmit`, `CollagePreviewClient.tsx:244`). 승격에 성공하면 서버 상태(A3)를 다시 조회해 "진짜 저장됐음"을 확인한다(`:96`, `:463`).

---

## 2. QueryClientProvider 싱글턴 패턴 — `isServer` 분기

### 왜 필요한가? — 서버에서 캐시를 공유하면 사용자 데이터가 섞인다

TanStack Query를 쓰려면 앱 전체를 `QueryClientProvider`로 감싸고, 그 안에 `QueryClient`(캐시 저장소) 하나를 넣어야 한다. 문제는 **이 QueryClient를 어디서·몇 개 만드느냐**다.

순진하게 모듈 최상단에 `const client = new QueryClient()`로 하나 만들면 Next.js 같은 SSR 환경에서 치명적이다. **서버는 여러 사용자의 요청을 같은 프로세스에서 처리**하므로, 캐시가 단 하나면 A 유저의 챌린지·제출 데이터가 B 유저 응답에 섞여 나갈 수 있다. 개인정보 유출이다.

반대로 브라우저에서는 매번 새로 만들면 안 된다 — 페이지가 리렌더될 때마다 캐시가 날아가 캐싱 자체가 무의미해진다.

이 모순을 푸는 게 TanStack Query **공식 advanced-ssr 가이드**의 `isServer` 분기 패턴이다.

### Typolog에서는? — `src/app/providers.tsx`

```typescript
function getQueryClient() {
  if (isServer) {
    // 서버: 요청마다 새로 만든다 (사용자 간 캐시 격리)
    return makeQueryClient();
  }
  // 브라우저: 모듈 싱글턴 재사용
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
```

- **서버**(`providers.tsx:32-35`): `isServer`면 항상 `makeQueryClient()`로 **새 인스턴스**. 요청 간 캐시가 절대 공유되지 않는다.
- **브라우저**(`:36-39`): `browserQueryClient ??= ...` — 처음 한 번만 만들고 이후 재사용하는 **모듈 싱글턴**. 주석(`:36-37`)이 짚듯 `useState`로 만들지 **않는** 이유는, suspense 경계가 없을 때 초기 렌더가 중단되면 만든 클라이언트가 버려질 수 있다는 공식 가이드의 NOTE 때문이다.

전역 기본 정책은 `makeQueryClient()`(`:10-27`)에 박혀 있다.

- **`staleTime: 60 * 1000`**(`:16`): 마운트 직후 즉시 리페치를 막는 공식 권장 기본값. (쿼리별 정책은 각 훅에서 덮어쓴다 — §3.)
- **4xx 재시도 금지**(`:18-23`): `error instanceof ApiError && status >= 400 && status < 500`이면 `retry` 즉시 `false`. 인증 실패(401)·존재하지 않음(404)·검증 실패(400)는 **몇 번을 다시 보내도 결과가 같으므로** 재시도가 무의미하고, 서버에 헛부하만 준다. 5xx·네트워크 오류만 최대 3회 재시도한다.

### 핵심 원리

- 서버는 격리(새 인스턴스), 브라우저는 재사용(싱글턴) — 이 비대칭이 SSR 안전성의 전부다.
- 전역 정책은 "합리적 기본값"을 한 곳에 모으고, 예외(쿼리별 staleTime)는 각 훅에서 명시적으로 덮어쓴다. **기본은 보수적으로, 예외는 명시적으로.**

---

## 3. staleTime 설계 — 캐시 신선도를 signed URL 만료와 맞춘다

### 왜 필요한가? — "낡은 캐시"가 "깨진 이미지"로 이어지면 안 되니까

`staleTime`은 "이 캐시 데이터를 **몇 ms 동안 신선하다고 믿을지**"다. 이 시간이 지나기 전에는 같은 쿼리를 재사용(네트워크 호출 없음)하고, 지난 뒤 재마운트·창 포커스 시 백그라운드 리페치한다.

여기서 Typolog만의 함정이 있다. 서버가 내려준 **콜라주·글자 조각 이미지는 signed URL**이고, 이 URL에는 **만료 시각(TTL)**이 있다(Day 4 개념). 만약 캐시 `staleTime`이 signed URL TTL보다 길면, **URL은 만료됐는데 캐시는 "아직 신선하다"고 믿어 재요청하지 않고** → 화면에 깨진 이미지가 뜬다.

### Typolog에서는? — TTL의 절반을 staleTime으로

| 쿼리 키 | staleTime | 이유 |
|---------|-----------|------|
| `['challenge', 'today']` | **5분** (`use-today-challenge.ts:15`) | 하루 단위로 바뀌는 데이터라 길게. `refetchOnWindowFocus`(기본 on)가 KST 자정 전환 직후 재방문을 커버 |
| `['submission', id]` | **30분** (`use-submission.ts:25`) | signed URL TTL(`SIGNED_URL_TTL.EDIT` = **1시간**)의 **절반** |

핵심은 30분 = 1시간의 절반이라는 정합이다(`use-submission.ts:18-19` 주석). 캐시가 stale로 바뀐 뒤(30분 경과) 재마운트·포커스가 일어나면, **아직 URL이 만료되지 않은(30분 더 남은) 시점에** 새 signed URL을 재발급받는다. "절반"이라는 안전 마진 덕에 사용자가 깨진 이미지를 볼 틈이 없다.

`['challenge', 'today']` 쿼리는 홈·수집(`/challenge/[id]`)·미리보기 화면이 **같은 키를 공유**한다(`use-today-challenge.ts:8-10`). 별도 `GET /api/challenges/[id]`가 없으므로(§6.1), 화면 간 이동 시 재요청 없이 캐시를 재사용하고, URL의 id가 오늘 챌린지와 다르면 홈으로 보낸다(§4의 `TodayChallengeGate`).

### 핵심 원리

- staleTime은 그냥 성능 숫자가 아니라 **"캐시가 가리키는 자원(signed URL)의 수명과 맞춰야 하는 제약"**이다.
- 규칙: **staleTime ≤ 자원 TTL** (Typolog은 안전하게 절반). 캐시가 신선하다고 믿는 동안 그 캐시가 들고 있는 URL이 살아 있어야 한다.

---

## 4. 멱등 오케스트레이션 — 4단계 제출 체인

### 왜 필요한가? — "중간에 실패하면?"에 답해야 하니까

"제출하기" 한 번에 네 개의 API가 순서대로 호출된다.

```
A2 create-or-get(draft) → A5 letters×N(글자 N개 업로드) → A6 collage(콜라주) → A4 complete(완성 전이)
```

문제는 **이 중 어디서든 실패할 수 있다**는 것이다. 5번째 글자 업로드 중 네트워크가 끊기면? 만약 단계마다 "한 번만 실행되는" 설계라면, 재시도할 때 "어디까지 됐더라?"를 추적하는 복잡한 상태 머신이 필요하다.

**해법은 모든 단계를 멱등(idempotent)하게 만드는 것**이다. 멱등이란 "같은 요청을 여러 번 보내도 결과가 한 번 보낸 것과 같다"는 성질. 모든 단계가 멱등이면 **재시도 전략이 단순해진다 — 그냥 처음부터 다시 실행하면 된다.**

비유: 엘리베이터 버튼. 이미 눌린 층을 다시 눌러도 한 번 누른 것과 같다(멱등). "내가 아까 눌렀나?" 헷갈려도 그냥 다시 누르면 안전하다.

### Typolog에서는? — `src/features/compose/submit-collage.ts`

`submitCollage(deps, opts)`(`:66-106`)가 오케스트레이터다. 각 단계의 멱등성:

| 단계 | 함수 | 멱등 메커니즘 |
|------|------|--------------|
| A2 draft | `createOrGetSubmission` | DB `UNIQUE(user_id, challenge_id)` → 이미 있으면 **409 SUBMISSION_EXISTS에 기존 submission 동봉**, `api-client.ts:71-73`에서 그걸 꺼내 그대로 반환 (create-or-get) |
| A5 letters | `uploadLetter` | Storage `upsert:true` + DB UPSERT → 같은 슬롯 재업로드는 교체 |
| A6 collage | `uploadCollage` | 콜라주 upsert |
| A4 complete | `updateSubmission` | 이미 completed면 서버가 **재전이 없이 현재 상태 반환**(`api-client.ts:137-138`) |

여기에 **멱등 단축(short-circuit)** 두 가지가 더해진다.

- **완성된 제출 단축**(`submit-collage.ts:75-79`): A2 결과가 이미 `status === "completed"`면 (재진입 후 다시 제출 등) 업로드는 어차피 409로 막히므로 진행하지 않고 현재 상태를 바로 돌려준다.
- **순서 보장**(`:100`): A6(콜라주 업로드) 성공 후에만 A4(완성)를 호출한다. A4의 completed 전이 전제가 `collage_image_url != null`이기 때문(Day 4 §2). 순서가 어긋나면 서버가 거부한다.

화면에서의 재시도 UX(`CollagePreviewClient.tsx:90-91`, `:441-449`): 제출 실패 시 에러 메시지를 띄우고, **같은 "제출하기" 버튼**을 다시 누르면 `handleSubmit`이 처음부터 재실행된다. 전 단계가 멱등이라 이미 끝난 단계는 빠르게 통과하고 실패 지점부터 이어진다.

### 단일 mutation과 invalidate 1회

이 4단계 체인 전체가 **하나의 `useMutation`**(`use-submission.ts:40-59`)이다. 왜 단계마다 별도 mutation으로 쪼개지 않을까? **체인이 "전부 성공해야 의미 있는 하나의 작업"**이기 때문이다. 그래서 캐시 무효화도 마지막에 한 번만 한다.

```typescript
onSuccess: (submission) => {
  void queryClient.invalidateQueries({ queryKey: ['submission', submission.id] });
}
```

`invalidateQueries(['submission', id])`(`:56`)를 1회 호출하면 → `useSubmissionDetail`(A3) 쿼리가 stale로 표시되고 → 자동 재조회되어 → **완성된 상태 + 콜라주 signed URL**을 받아온다. 화면(`CollagePreviewClient.tsx:463-470`)은 이 재조회된 `submittedDetail.collage_url`로 "진짜 서버에 저장됐음"을 이미지로 확인시킨다.

### 테스트 가능성 — deps 주입

`submitCollage`는 네 개의 단계 함수를 **`deps` 인자로 주입**받는다(`submit-collage.ts:35-56`, `66`). 실제 배선(real fetch·canvas)은 `use-submission.ts:46-53`이 담당한다. 왜 이렇게 했나? **네트워크·Canvas 없이 순차 실행·실패 전파·멱등 단축을 단위 테스트하기 위함**이다(`tests/unit/submit-collage.test.ts`, QA C10~C14). 의존성을 함수 인자로 빼면 테스트에서 가짜(mock) 함수를 꽂아 "5번째에서 throw하면 6번째가 안 불리는가"를 검증할 수 있다.

### 핵심 원리

- **멱등성 = 단순한 재시도의 전제.** 모든 단계가 멱등이면 "처음부터 다시"가 가장 단순하고 안전한 복구 전략이 된다.
- 논리적으로 하나인 작업은 하나의 mutation으로, 무효화는 마지막 1회. 부분 성공 상태를 캐시에 남기지 않는다.
- 의존성 주입(deps)은 "네트워크 없이 흐름만 테스트"를 가능하게 하는 구조적 장치다.

---

## 5. 브라우저 호환 canvas 인코딩 — Safari WebP 미지원과 JPEG 폴백

### 왜 필요한가? — `toBlob('image/webp')`이 Safari에서 조용히 거짓말을 하니까

글자 조각은 용량 절약을 위해 **WebP**로 업로드하고 싶다. Phase 1 크롭 파이프라인은 PNG를 저장하므로, 업로드 직전에 `canvas.toBlob(callback, 'image/webp', quality)`로 변환한다.

함정: **Safari(iOS 포함)는 canvas의 WebP "인코딩"을 지원하지 않는다.** 그런데 에러를 던지지 않고, **조용히 PNG로 폴백**한다. 즉 `'image/webp'`를 요청했는데 결과 Blob의 `.type`은 `'image/png'`다. 이걸 모르고 업로드하면 — 서버 MIME 검증(`LETTER_IMAGE_MIMES`)이 PNG를 거부해 400 에러가 나거나, 버킷 `allowed_mime_types`에 막힌다. iOS 사용자만 제출이 안 되는 버그가 된다.

### Typolog에서는? — `src/lib/image/to-webp.ts`

`toLetterUploadImage(source)`(`:46-83`)가 **결과 Blob의 타입을 직접 검사**해 폴백한다.

```typescript
const blob = await canvasToBlob(canvas, candidate.type, quality)
if (blob.type !== candidate.type) {
  // 이 포맷의 인코더 미지원(toBlob이 PNG로 폴백) → 다음 포맷으로
  break
}
```

후보 포맷은 순서가 있다(`:25-29`).

1. **`image/webp`** (qualities 0.9→0.8→0.65→0.5): 선호 포맷. Chrome·Android에서 동작.
2. **`image/jpeg`** (0.85→0.75→0.6→0.45): Safari 폴백. JPEG 인코딩은 **모든 브라우저가 지원**하고 사진 압축 효율도 충분하다.

두 겹의 루프가 동시에 두 문제를 푼다.

- **바깥 루프(포맷)**: WebP 결과 타입이 `'image/webp'`가 아니면(= PNG로 폴백됨 = Safari) `break`해서 JPEG로 넘어간다(`:64-67`).
- **안쪽 루프(품질)**: 결과가 500KB(`LETTER_IMAGE_MAX_BYTES`)를 넘으면 품질을 한 단계 낮춰 재시도(`:69-72`). 사진이 커도 규격 안에 맞춘다.

어느 포맷도 못 만들면, 어느 인코더라도 지원됐는지(`anyEncoderSupported`)로 에러 메시지를 구분한다(`:75-79`) — "너무 커서 못 맞춤" vs "이 브라우저에서 변환 불가".

이 클라이언트 변경은 **서버·인프라 3곳과 함께 가야** 완성된다(옵션 A 일괄 결정).

- **서버 검증**(`letter-piece.ts:5`): `LETTER_IMAGE_MIMES = ['image/webp', 'image/jpeg']` — JPEG 허용.
- **버킷 MIME**(마이그레이션 `0004_letter_pieces_allow_jpeg.sql`): `letter-pieces` 버킷 `allowed_mime_types`에 `image/jpeg` 추가. 코드 검증과 **반드시 일치**해야 한다(`letter-piece.ts:3-4` 주석).
- **라우트 확장자 분기**(`api-client.ts:102`): JPEG면 `.jpg`, 아니면 `.webp`로 파일명 생성.

### 핵심 원리

- 브라우저 API는 "지원하지 않으면 에러"가 아니라 **"조용히 다른 동작으로 폴백"**할 수 있다. 결과를 **요청한 것과 같은지 검증**하는 방어가 필요하다.
- 클라이언트 포맷 변경은 서버 검증·버킷 정책·경로 생성까지 **end-to-end로 동기화**해야 한다. 한 곳만 바꾸면 다른 곳에서 막힌다.

---

## 6. 타입 전용 공유 와이어 타입 — `src/types/api.ts`

### 왜 필요한가? — 서버와 클라가 같은 응답 형태를 두 번 정의하면 어긋난다

API 응답의 모양(예: submission이 어떤 필드를 갖는지)을 서버 라우트와 클라이언트 fetcher가 **각자 따로 타입 정의**하면, 한쪽을 고칠 때 다른 쪽이 누락돼 런타임에 깨진다. 단일 소스(single source of truth)가 필요하다.

하지만 그냥 서버 모듈을 클라이언트가 import하면 안 된다 — 서버 전용 모듈(`@/lib/api/*`)에는 `server-only` 가드와 DB·secret 의존이 있어 클라이언트 번들에 들어가면 빌드가 깨지거나 비밀이 샌다.

### Typolog에서는? — 런타임 import 없는 타입만의 파일

`src/types/api.ts`는 **순수 타입 선언만** 담는다(`:1-5` 주석). 런타임 코드가 없으므로 `server-only` 가드 없이 서버·클라 양쪽이 안전하게 공유한다. `api-client.ts`(`:7-15`)와 서버 라우트가 같은 `ApiSubmission`·`ApiSubmissionDetail` 등을 import한다.

두 가지 중요한 디테일.

- **날짜는 `string`**(`:4-5`, `:16-18`): 서버의 `Date`는 `NextResponse.json()`을 거치며 ISO 문자열이 된다. 클라이언트가 받는 타입은 `Date`가 아니라 `string`이어야 정확하다. 와이어(wire) 타입은 **JSON 직렬화 이후의 형태**를 반영한다.
- **`image_url: string | null`**(`:32-38`): Day 4 QA M2 해소. signed URL 생성이 Storage 정책 거부·오류로 실패하면 `null`일 수 있다. 타입에 `| null`을 명시해 **클라이언트가 null일 때 글자 텍스트 폴백을 보여주도록 강제**한다(`CollagePreviewClient.tsx:360-382`의 폴백 분기). 타입이 거짓말하지 않게 하는 것.

### 핵심 원리

- 타입 전용 파일은 "런타임 의존 없는 계약서". 서버/클라 경계를 넘나들어도 안전하다.
- 와이어 타입은 **직렬화 이후의 현실**(Date→string, 실패 가능 필드→`| null`)을 그대로 반영해야 타입이 실제 데이터와 일치한다.

---

## 자주 하는 실수

1. **submission id를 Zustand에 저장한다.** "제출했으니 id를 기억하자"는 자연스러운 충동이지만, 서버 상태를 클라이언트에 복제하면 동기화 버그가 생긴다. Typolog은 매번 `createOrGetSubmission`으로 서버에 묻는다(§1).
2. **QueryClient를 모듈 최상단에 하나 만든다.** SSR에서 사용자 간 캐시가 섞여 개인정보가 샌다. 반드시 `isServer` 분기로 서버는 새로, 브라우저는 싱글턴으로(§2).
3. **staleTime을 자원 수명과 무관하게 길게 잡는다.** signed URL이 만료됐는데 캐시는 신선하다고 믿어 깨진 이미지가 뜬다. staleTime ≤ TTL(절반 권장)을 지킨다(§3).
4. **4xx도 재시도한다.** 401·404·400은 다시 보내도 결과가 같다. 헛부하만 늘고 사용자 대기만 길어진다. 4xx는 즉시 실패(§2).
5. **`toBlob('image/webp')`의 결과 타입을 안 믿고 그냥 업로드한다.** Safari에서 조용히 PNG로 폴백된 걸 모르고 보내면 서버가 거부한다. 결과 `.type`을 반드시 검사(§5).
6. **제출 체인을 단계마다 별도 mutation으로 쪼개고 매번 invalidate한다.** 부분 성공 상태가 캐시에 남는다. 논리적으로 하나인 작업은 하나의 mutation, invalidate는 마지막 1회(§4).
7. **클라이언트 포맷만 JPEG로 바꾸고 서버·버킷을 안 바꾼다.** 코드 검증·버킷 MIME·확장자 분기 중 하나라도 빠지면 그 지점에서 막힌다(§5).
8. **에러 처리에서 `ApiError`의 `code`를 안 보고 메시지만 쓴다.** `CHALLENGE_NOT_FOUND`(`TodayChallengeGate.tsx:44`)처럼 code로 분기해야 "오늘 챌린지 없음"과 "네트워크 오류"를 다른 UI로 보여줄 수 있다.

---

## 나중에 배울 것 (지금은 몰라도 됨)

- **Optimistic Update**(로드맵 #16, Phase 3): 좋아요·공개토글처럼 즉각 반응이 필요한 mutation에서 서버 응답 전에 캐시를 먼저 바꾸고 실패 시 롤백. Day 4.5의 제출은 진행 단계를 보여주는 무거운 작업이라 optimistic을 쓰지 않았다 — QA 리뷰도 Phase 3 이관으로 분류.
- **`useInfiniteQuery`**(Phase 3 피드): 커서 기반 무한 스크롤. `['feed', cursor]` 키로 피드를 페이지 단위로 이어 붙인다.
- **Storage cleanup 잡**(Phase 3): JPEG↔WebP 포맷 교체 시 남는 고아 파일 정리(QA M2). MVP에서는 DB가 최신 경로를 가리켜 화면 손상이 없으므로 미룬다.
- **devtools 번들 분리**(QA M3): `@tanstack/react-query-devtools`의 production 번들 포함 최적화. v5가 자체 no-op 처리하므로 현재는 그대로 둠.

---

## 다음 Day(Day 5)로 가는 다리

Day 4.5는 **"프론트가 백엔드를 실제로 호출하기 시작한" 첫 Day**다. 이제 흐름이 끝까지 이어졌으니, Day 5는 그 흐름을 **검증하고 단단히** 한다(RLS 검증·전체 E2E·에러 처리·env 정리). 미리 알아두면 좋은 선행 개념.

1. **RLS가 "실제로" 막는지 검증** (로드맵 #6). Day 4.5에서 본인 데이터만 흐른다고 *가정*했다. Day 5는 다른 유저로 남의 submission에 접근할 때 진짜 막히는지, signed URL이 무권한 경로엔 `null`로 새지 않는지(§6의 `image_url: string | null`이 실제로 발동하는지)를 **검증**한다. RLS의 `(SELECT auth.uid())` ↔ JWT ↔ server client 연결을 복습할 것.
2. **에러 경로의 끝단 처리**. `ApiError`의 `code`별 UI 분기(§자주 하는 실수 8)를 전 화면에서 점검한다. 특히 401(세션 만료)·413(콜라주 2MB 초과)·CHALLENGE_NOT_FOUND가 사용자에게 올바른 메시지로 보이는지.
3. **Safari iOS 실기기 WebP/JPEG 폴백 실증** (QA 잔여 리스크). §5의 폴백 경로는 단위 테스트·정적 리뷰로만 검증됐고, `vitest-canvas-mock`은 항상 WebP를 반환해 폴백 분기가 실행되지 않았다. Day 5 또는 배포 전 실기기 확인이 필요하다.
4. **env 정리**. QA 검증 중 이 워크트리의 `.env.local`이 stale해 보호 라우트가 500을 냈다(QA 리포트 정정 메모). Day 5의 env 정리는 이런 워크트리 간 환경변수 누락을 막는 작업 — 어떤 키가 어디(NEXT_PUBLIC vs server-only)에 필요한지 정리한다.
5. **전체 E2E 흐름의 멱등·재시도 재확인**. §4의 멱등 오케스트레이션이 실제 네트워크 단절·재제출 시나리오에서도 안전한지 끝-끝으로 돌려본다(QA E2E 2-1 재제출 멱등 항목 연장).

---

## 한 줄 요약 (전체)

**Day 4.5는 로컬 draft(Zustand)를 서버 상태(TanStack Query)로 승격시키는 브리지다 — `isServer` 싱글턴으로 캐시를 안전하게 관리하고, staleTime을 signed URL TTL의 절반으로 맞춰 깨진 이미지를 막으며, 멱등한 4단계 체인을 단일 mutation으로 묶어 "처음부터 재시도"가 안전하게 만들고, Safari WebP 미지원은 결과 타입 검사로 JPEG 폴백하며, 서버/클라는 런타임 import 없는 와이어 타입으로 같은 계약을 공유한다.**
