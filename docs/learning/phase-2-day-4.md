# Phase 2 Day 4 — 제출 완성 API 3종 + Signed URL 학습 노트

> 대상 작업(§9 Day 4 확정 결정): A6 `POST /api/submissions/[id]/collage`(콜라주 업로드) + A4 `PATCH /api/submissions/[id]`(status/visibility 전이) + A3 `GET /api/submissions/[id]`(상세 + signed URL). Day 3의 소유권 코드 검증(`getOwnedSubmission`)·404 존재은폐·검사순서(401→404→409)·MIME+크기 검증 패턴을 그대로 재사용한다.
> 산출물: `src/lib/storage/signed-url.ts`, `src/app/api/submissions/[id]/route.ts`(GET/PATCH), `src/app/api/submissions/[id]/collage/route.ts`, `src/lib/validations/collage.ts`, `src/lib/api/serialize.ts`, 이월 정리(`src/lib/api/errors.ts` server-only + 409 타입 정합).
> 참고: `docs/backend-design-plan.md` §5.1/§5.2(Storage 정책)·§3.3/§3.4(RLS)·§7.4(에러/존재 은폐)·§9 Day 4 표·§10(개념 해설), `docs/data-model.md`, 직전 노트 `docs/learning/phase-2-day-3.md`(signed URL·status 전이·간접 소유권을 예고했음).

---

## 이번 Day의 큰 그림 (먼저 읽기)

Day 3는 **글자 조각을 모으는 입구**(draft 생성, 글자 업로드)를 열었다. Day 4는 그 draft를 **완성품으로 굳히고 꺼내 보는 출구** 세 개를 만든다.

```
[Day 3] draft 만들기 → 글자 N개 업로드 (letter_pieces 채움)
            │
            ▼
[Day 4 - A6] 콜라주 PNG 업로드 → submissions.collage_image_url 채움
            │
            ▼
[Day 4 - A4] draft → completed 전이 (완성 전제 검증 후 굳힘) + 공개 토글
            │
            ▼
[Day 4 - A3] 상세 조회 — DB에 저장된 "경로"를 읽기 시점에 signed URL로 변환해 내려줌
```

이번 Day에서 새로 등장하는 개념은 세 가지다. 이 세 가지가 서로 어떻게 맞물리는지 한 문장으로 요약하면:

**"private 버킷이라 경로만 DB에 저장하고(Day 3), 읽을 때 요청자 권한으로 signed URL을 만들어 내려주며(A3), draft를 completed로 굳히는 건 전제검증을 통과한 단일 조건부 UPDATE다(A4) — 그리고 이 세 라우트 모두 Day 3의 '코드 레벨 소유권 검증'을 공유한다."**

세 개념을 우선순위 순으로 본다:

1. **Signed URL** — private 버킷의 파일을 "어떻게 안전하게 보여주는가"
2. **상태 전이 = 조건부 UPDATE** — draft→completed를 "어떻게 안전하게 굳히는가"
3. **간접 소유권 재사용 + 2층 방어** — 세 라우트가 공유하는 방어 골격

---

## 1. Signed URL — private 버킷의 파일을 "기간 한정 입장권"으로 내준다

### 왜 필요한가? — URL을 영구 공개하면 안 되니까

Day 3에서 글자 조각·콜라주는 **private 버킷**(`letter-pieces`, `collages`)에 올라간다. private 버킷의 파일은 URL을 알아도 그냥은 못 본다 — 매 요청마다 권한 검사를 거친다. 그런데 `<img src="...">`에 넣으려면 결국 URL이 필요하다. 이 모순을 푸는 게 signed URL이다.

대안을 따져보면 왜 signed URL인지 분명해진다:

- **버킷을 public으로** → URL만 새면 누구나 영구히 본다. 남의 일상 사진(글자 조각)이 영구 노출. 탈락.
- **이미지를 base64로 JSON에 박아서 내려준다** → 응답이 거대해지고 캐싱 불가. 탈락.
- **signed URL** → "이 파일을 1시간 동안만 볼 수 있는 임시 티켓"을 만들어 준다. 시간이 지나면 티켓이 만료돼 더는 못 본다.

비유: 호텔 카드키. 프런트(서버)가 "302호, 오늘 자정까지" 카드키(signed URL)를 발급한다. 카드키 자체엔 권한 정보가 서명돼 있어서, 자정이 지나면 문이 안 열린다. 누가 카드키를 주워도 기간이 지나면 쓸모없다.

### Typolog에서는? — 경로는 DB, URL은 읽기 시점에

핵심 설계는 **"DB에는 버킷 내 경로만 저장하고, signed URL은 절대 저장하지 않는다"** 이다. Day 3에서 `submissions.collage_image_url`·`letter_pieces.image_url`에 들어가는 값은 `{user_id}/{submission_id}/collage.png` 같은 **상대 경로**지 URL이 아니다(`signed-url.ts:1-2`의 주석). URL을 DB에 저장하면 만료된 순간 깨진 링크가 되고, TTL을 못 바꾸기 때문이다.

헬퍼는 `src/lib/storage/signed-url.ts` 한 곳에 모았다:

- `SIGNED_URL_TTL`(`signed-url.ts:11-16`): `EDIT = 1h`(본인 편집·미리보기), `SHARE = 24h`(비인증 공유 페이지, Phase 3). TTL을 프리셋 상수로 묶어 "본인 편집은 짧게, 공유는 길게"를 한 곳에서 관리한다.
- `createSignedUrl(supabase, bucket, path, ttl)`(`signed-url.ts:21-30`): `supabase.storage.from(bucket).createSignedUrl(path, ttl)`을 감싸고, 실패하면 `null`을 돌려준다.

실제 사용처:
- A3 GET에서 콜라주: `route.ts:49-56` — `collage_image_url`이 있으면 `SIGNED_URL_TTL.EDIT`(1h)로 서명.
- A3 GET에서 글자 조각: `route.ts:75-80` — **본인일 때만** 각 조각 경로를 1h로 서명.
- A6 업로드 직후: `collage/route.ts:91` — 업로드한 콜라주를 바로 미리보기할 수 있게 1h signed URL을 응답에 동봉.

### 핵심 원리 — "누구의 권한으로 서명하느냐"가 보안의 전부

가장 중요한 한 줄은 `signed-url.ts:18-19`의 주석이다:

> 요청자 JWT가 실린 server client로 서명한다 → Storage 정책(§5)이 그대로 적용된다. 권한 없는 경로(예: 타인 letter-pieces)는 정책이 거부하므로 null을 돌려준다 — URL이 새지 않는다.

작동 단계:

1. A3 GET은 `createClient()`로 **요청자의 JWT가 실린** server client를 만든다(`route.ts:18`). 그리고 **같은 client**로 signed URL을 만든다(`route.ts:50-55`).
2. `createSignedUrl`을 호출하면 Supabase는 그 path에 대해 **storage.objects의 RLS 정책(§5)**을 평가한다.
3. 요청자가 그 path를 읽을 권한이 있으면(본인이거나, collages의 경우 공개 완성물이면) 서명된 URL을 돌려준다.
4. 권한이 없으면(예: 남의 `letter-pieces` 경로) 정책이 거부 → `error` → 우리 헬퍼가 `null` 반환(`signed-url.ts:28`).

즉 **signed URL을 만드는 행위 자체가 한 번 더 권한 검사를 통과**한다. "서버가 만들어 주니까 무조건 나오겠지"가 아니다. 무권한 경로면 URL이 아예 안 생기므로 **URL이 샐 수가 없다.** 이게 §5의 collages 정책에 anon(비인증)용 `collages_read_anon`까지 있는 이유로 자연스럽게 이어진다 — 같은 path라도 "누가 서명하느냐"에 따라 결과가 달라진다.

A3 GET이 글자 조각을 본인에게만 내려주는 코드(`route.ts:61-83`)도 이 원리의 응용이다. `isOwner`가 아니면 `pieces = []`로 아예 비운다. 설령 외부 뷰어에게 서명을 시도해도 `letter-pieces` 정책(§5.1, owner-only)이 거부해 `null`이 나오겠지만, **응답에서 글자 조각 자체를 제외**해 경로·메타데이터 노출조차 막는다(`route.ts:58-60` 주석). "정책이 막아주니까"에 더해 "응답에 아예 안 담는다"로 한 겹 더 친다.

### 자주 하는 실수

- **signed URL을 DB에 저장한다**: 만료되면 깨진 링크가 되고 TTL 변경이 불가능하다. DB엔 경로만, URL은 읽기 시점에. (`signed-url.ts:1-2`가 명시적으로 경고)
- **admin client(service_role)로 서명한다**: admin은 RLS를 우회하므로 **권한이 없는 path도 서명돼 버린다** — 남의 사진 URL이 새는 보안 사고. 반드시 **요청자 JWT가 실린 server client**로 서명해야 정책이 작동한다. Day 3 노트의 "Drizzle 직결은 RLS 우회" 함정과 같은 결의 실수다.
- **TTL을 무한정 길게**: signed URL은 발급 후에는 권한이 바뀌어도 만료 전까지 유효하다. 사용자가 제출을 비공개로 돌려도 이미 발급된 24h URL은 그동안 살아있다. 그래서 본인 편집용은 1h로 짧게 둔다.
- **null 처리를 빼먹는다**: `createSignedUrl`은 권한·존재 문제로 `null`을 돌려줄 수 있다. 응답 타입이 `string | null`인 이유다. 프런트는 `null`이면 placeholder를 보여줘야 한다.

### 나중에 배울 것

- **변환(transform) 옵션**: signed URL 생성 시 리사이즈·포맷 변환 파라미터를 붙일 수 있다(피드 썸네일 최적화). Phase 3 피드에서 다룬다.
- **공유 페이지의 24h(`SHARE`) + anon 정책 경로**: `/s/[id]` 비인증 공유는 Phase 3. 이때 `collages_read_anon`(§5.2)가 실전 발동한다.
- **batch 서명**(`createSignedUrls`, 복수형): 피드처럼 여러 콜라주를 한 번에 서명할 때. 지금은 단건만 쓴다.

---

## 2. 상태 전이 = 조건부 UPDATE (UPSERT가 아니다)

### 왜 필요한가? — "완성"은 아무 때나 눌러선 안 되는 단방향 문이다

submission의 status는 `draft → completed`로만 가야 한다. 거꾸로(`completed → draft`) 가거나, 아무 슬롯도 안 채운 빈 draft를 completed로 만들면 **피드에 빈 콜라주가 뜬다.** "완성" 버튼은 전제조건을 다 만족했을 때만, 한 방향으로만 열리는 문이어야 한다.

여기서 흔한 오해 하나를 짚는다. Day 3에서 글자 업로드는 **UPSERT**(있으면 UPDATE, 없으면 INSERT)였다(§10.7). 그래서 "상태 변경도 UPSERT 아닌가?" 싶지만 **아니다.** UPSERT는 "행이 있든 없든 원하는 최종 상태로 만든다"는 멱등적 덮어쓰기다. 상태 **전이**는 "현재 상태가 X일 때만 Y로 바꾼다"는 조건부 동작이라 성격이 다르다. 그래서 A4는 **전제검증 + WHERE 가드를 건 단일 UPDATE**로 처리한다(§9 Day4-(e): "status 전이는 UPSERT가 아니라 조건부 UPDATE").

### Typolog에서는? — 3중 차단

A4 PATCH(`route.ts:93-187`)는 completed 전이를 세 겹으로 막는다.

**1) zod 스키마에서 역전·hidden을 원천 차단** (`validations/submission.ts:18-25`):

```typescript
status: z.literal('completed').optional(),
```

`z.literal('completed')`라서 `status: 'draft'`(역전)나 `status: 'hidden'`(서비스 키 전용)은 **API 입구에서 400으로 거절**된다. 라우트 코드는 "completed 전이"만 고민하면 된다. 역전 금지가 타입 레벨에서 보장되는 셈이다.

**2) 완성 전제 검증** (`route.ts:140-163`):

draft→completed일 때만, 두 가지를 확인한다.
- 챌린지 글자 수를 읽고(`route.ts:141-145`),
- `letter_pieces` 개수를 센다(`route.ts:151-154`),
- `pieceCount !== challenge.letters.length || collage_image_url === null`이면 409 `SUBMISSION_INCOMPLETE`(`route.ts:155-157`).

**3) 조건부 UPDATE의 WHERE 가드** (`route.ts:170-181`):

```typescript
.where(and(
  eq(submissions.id, submissionId),
  eq(submissions.user_id, user.id),     // 소유권 재확인
  ne(submissions.status, 'hidden'),     // hidden은 손 못 댐
))
```

0행이 갱신되면(`!updated`) 그 사이 소유권/상태가 바뀐 경합 → 404(`route.ts:182-184`). 이미 검사한 소유권을 WHERE에 한 번 더 거는 이유는 **TOCTOU**(검사 시점과 사용 시점 사이의 틈) 방어 + RLS 정합이다.

### 핵심 원리 — `count == length`로 완성을 판정해도 되는 이유

"슬롯이 다 찼나?"를 `letter_pieces 개수 == challenge.letters.length`로 판정한다(`route.ts:155`). 단순 개수 비교인데 어떻게 "정확히 모든 슬롯이 하나씩 채워졌다"를 보장할까? 두 개의 불변식이 받쳐주기 때문이다(`route.ts:149-150` 주석):

1. **slot_index 범위 검증**: Day 3 업로드 시 `slot_index`가 `[0, letters.length)` 안으로 검증된다. 범위 밖 인덱스가 못 들어온다.
2. **UNIQUE 제약**: `(submission_id, slot_index)`가 UNIQUE라 같은 슬롯에 두 행이 못 생긴다.

이 둘이 있으면 "개수가 letters.length와 같다"는 곧 "0번부터 length-1번까지 각 슬롯이 정확히 한 번씩 채워졌다"와 동치다. 비둘기집 원리다 — length개의 칸에 length개의 서로 다른(UNIQUE) 값이 범위 안(range check)에 들어왔으면 빈 칸이 없다.

멱등성도 챙긴다. 이미 completed인데 `status:'completed'`를 또 보내면 `submission.status === 'draft'` 조건(`route.ts:140`)이 false라 재전이하지 않는다 → `completed_at` 보존(`route.ts:138-139` 주석). 바꿀 게 없으면 현재 상태를 그대로 반환(`route.ts:166-168`).

### 자주 하는 실수

- **완성 전이에 UPSERT를 쓴다**: UPSERT는 "현재 상태가 무엇이든 덮어쓴다"라 역전·전제 무시가 생긴다. 전이는 현재 상태를 WHERE/코드로 검사하는 조건부 UPDATE여야 한다.
- **역전 금지를 라우트 if문으로만 막는다**: zod `z.literal('completed')`로 입구에서 막으면 라우트가 단순해지고 누락 위험이 준다. 타입과 런타임 검증을 한 번에 얻는다.
- **전제검증과 UPDATE가 원자적이라고 가정**: 현재 코드는 완성도 검증(`route.ts:155`)과 UPDATE의 WHERE(`route.ts:174-180`)가 **분리**돼 비원자적이다(`route.ts:158-160` 주석이 Reviewer Medium으로 명시). letter_pieces 삭제 API가 아직 없고 단일 세션이라 실위험은 낮지만, **삭제 API 도입 시 완성도 조건을 WHERE 서브쿼리로 합치거나 단일 트랜잭션으로 원자화해야 한다.** 지금 코드의 한계를 정확히 아는 게 중요하다.
- **draft에서 is_public을 토글하면 바로 공개된다고 오해**: `is_public`은 draft에서도 토글되지만(`route.ts:133-135`), 공개 정책(§5.2·피드 쿼리)이 `completed AND public`만 노출하므로 draft 토글은 **실노출 효과가 없다**(상태 보관용, `route.ts:131-132` 주석).

### 나중에 배울 것

- **상태 머신(state machine) 라이브러리**: 상태가 늘면(예: `under_review`) 전이 규칙을 표로 선언하는 패턴이 깔끔하다. 지금은 2-상태라 if로 충분.
- **트랜잭션으로 전이 원자화**: 위 Reviewer Medium을 해소할 때 Drizzle `db.transaction(...)`을 배운다.
- **`hidden` 전이(신고·관리자)**: hidden은 서비스 키 전용이고 코드+RLS로 막혀 있다(§3.3 fail-closed). 관리자 흐름은 후속 Phase.

---

## 3. 간접 소유권 재사용 + 2층 방어 — 세 라우트가 공유하는 골격

### 왜 필요한가? — DB(Drizzle)는 RLS를 우회하니까

Day 3 노트의 핵심 긴장을 다시 떠올리자: **우리 API는 Drizzle 직결(postgres role)로 DB를 친다 → RLS가 자동으로 안 막아준다 → 그래서 소유권을 코드로 검증해야 한다.** Day 4의 세 라우트도 전부 DB를 Drizzle로 친다. 그러니 같은 방어가 필요하고, **Day 3에서 만든 헬퍼를 그대로 재사용**한다(§9 Day4-(b)).

### Typolog에서는? — getOwnedSubmission 한 함수를 3곳이 공유

`src/lib/api/auth.ts`의 두 헬퍼(Day 3 산출물)가 Day 4에서 재사용된다:

- `getAuthUser(supabase?)`(`auth.ts:16-22`): `getClaims()`로 JWT를 검증해 `sub`(사용자 id)를 꺼낸다. **supabase client를 인자로 주입**할 수 있는 게 포인트 — A3 GET·A6는 "인증에 쓴 그 client로 곧바로 서명/업로드"하려고 같은 client를 넘긴다(`route.ts:18-19`, `collage/route.ts:19-21`).
- `getOwnedSubmission(submissionId, userId)`(`auth.ts:26-37`): 행을 읽고 `row.user_id !== userId`면 `null`. **타인 소유와 미존재를 똑같이 null로** 돌려줘 호출부가 둘 다 404로 처리하게 한다.

이 `getOwnedSubmission`을 A4 PATCH(`route.ts:108`)와 A6 collage(`collage/route.ts:34`)가 그대로 쓴다. A3 GET은 "타인의 공개 완성물도 보여줘야" 해서 직접 `db.select`로 읽되 가시성을 코드로 판정한다(`route.ts:34-45`) — 본인=모든 상태 / 타인=공개 완성만 / 그 외=404.

### 핵심 원리 — 코드 소유권 + Storage 정책의 2층 방어

Drizzle은 RLS를 우회하지만, **Storage는 다르다.** A6 업로드는 사용자 JWT가 실린 server client로 `supabase.storage.from('collages').upload(...)`를 호출하므로(`collage/route.ts:64-66`), storage.objects의 정책(§5.2)이 **한 번 더** 검사한다. 그래서 방어가 두 겹이다(`collage/route.ts:60-61` 주석):

1. **코드 레벨**: path를 서버가 `${user.id}/${submissionId}/collage.png`로 **직접 구성**(`collage/route.ts:62`) → 클라이언트가 타인 경로를 끼워넣을 여지가 없다.
2. **Storage 정책 레벨**: 설령 조작해도 `collages_write` 정책(§5.2, 경로 첫 폴더 == `auth.uid()`)이 거부한다.

비유: 사물함에 짐을 넣을 때, 직원이 "당신 번호 사물함"으로 직접 안내(코드)하고, 그 사물함 자물쇠도 당신 지문으로만 열린다(Storage 정책). 둘 중 하나가 뚫려도 다른 하나가 막는다.

### 404 존재 은폐(§7.4)와 검사 순서(401 → 404 → 409)

Day 3에서 잡은 두 원칙이 Day 4 세 라우트에서 일관되게 반복된다.

**검사 순서**: 항상 `인증(401) → 존재·소유권(404) → 상태 충돌(409)` 순이다. A4 PATCH가 교과서적이다:
- 미인증 → 401(`route.ts:96-98`)
- id 형식 오류·미존재·타인 소유 → 404(`route.ts:102-103`, `route.ts:109-111`)
- hidden이라 수정 불가 → 409(`route.ts:113-115`)

순서가 중요한 이유: 인증을 먼저 막아야 "리소스가 존재하는지"조차 비인증자에게 안 새고, 존재/소유권을 상태보다 먼저 봐야 "남의 리소스가 어떤 상태인지"가 안 샌다.

**존재 은폐**: 타인 소유든 미존재든 **똑같이 404**로 답한다. 403("권한 없음")으로 답하면 "그 리소스는 존재하긴 한다"는 정보가 샌다. id 형식 오류조차 404로 통일한다(`route.ts:27-28`, `collage/route.ts:28-29`) — UUID가 아니란 사실도 흘리지 않는다. `jsonError`(§7.4, `errors.ts:18-29`)가 이 규약을 강제한다.

### 부수 산출물 — server-only 가드 + 응답 단일 투영

- **`import 'server-only'`**(`signed-url.ts:4`, `auth.ts:2`, `errors.ts:3`): DB·Storage SDK·NextResponse는 서버 전용이다. 이 가드가 붙은 모듈을 클라이언트 컴포넌트가 실수로 import하면 **빌드 타임에 실패**한다. 시크릿·서버 로직이 브라우저 번들로 새는 걸 컴파일 단계에서 차단한다.
- **`serializeSubmission`**(`serialize.ts:16-26`): GET·PATCH·collage **세 응답이 이 한 함수를 공유**한다. "응답에 무엇을 노출하는가"를 한 곳에서 관리 → 버킷 내 원시 경로(`collage_image_url`)는 의도적으로 제외(`serialize.ts:4`), 읽기는 signed URL로만. 노출 필드가 코드 곳곳에 흩어지면 어딘가에서 민감 필드를 흘리기 쉬운데, 단일 투영은 이를 막는다.
- **409 전용 타입 정합**(이월 정리): `submissionConflict`(`errors.ts:43-50`)가 표준 에러(`error/code`)에 도메인 페이로드(기존 submission)를 더한 `SubmissionConflictBody`(`errors.ts:39-41`)를 쓴다. 일반 에러와 구분되는 전용 빌더다.

### 자주 하는 실수

- **GET/PATCH/collage마다 소유권 검증을 따로 짠다**: 한 군데서 가드를 빠뜨리면 구멍이 난다. `getOwnedSubmission` 공통 헬퍼로 묶어 누락을 원천 차단한다(§9 Day3-(b)).
- **타인 리소스에 403을 준다**: 존재가 샌다. 비공개 리소스는 404로 은폐.
- **Storage 업로드와 DB 쓰기가 원자적이라 가정**: 둘은 다른 시스템이라 비원자적이다(§8.3-3). DB 실패 시 고아 파일이 남을 수 있으나, 같은 path 재업로드(`upsert: true`, `collage/route.ts:66`)로 덮어써지므로 손상은 없다. 실패 시 cleanup 추적용으로 path를 로깅한다(`collage/route.ts:73·82`, path엔 UUID만 있어 시크릿 아님).
- **server-only를 안 붙이고 헬퍼를 만든다**: 클라이언트가 무심코 import해도 빌드가 통과해 버려, 런타임에야 터지거나 최악엔 서버 로직이 번들로 샌다.

### 나중에 배울 것

- **트랜잭션 + Storage cleanup 잡**: DB·Storage 비원자성을 더 견고히 다루는 패턴(보상 트랜잭션, 주기적 고아 파일 청소).
- **rate limiting**: 업로드 API 남용 방어. MVP 범위 밖.
- **magic-byte/EXIF strip 서버 검증**: 현재 MVP는 MIME+크기까지만(`collage.ts:1-2`). 디코딩 유효성·서버측 EXIF 제거는 이관됨.

---

## 다음 Day(4.5)로 가는 다리 — 클라이언트 연결

Day 4.5는 지금 만든 백엔드 3종을 **클라이언트와 잇는다**: Zustand ↔ 서버 동기화 + TanStack Query(§9 Day4-(a)). Day 4가 깐 토대가 그대로 4.5의 입력이 된다.

- **Zustand(클라이언트 상태) vs TanStack Query(서버 상태)의 경계**: Day 4까지 Zustand는 "진행 중인 draft"(크롭 중인 슬롯·배경색)를 들고 있었다(로컬·localStorage). Day 4 API가 내려주는 것(`GET /submissions/[id]`의 submission·signed URL)은 **서버 상태**다. 4.5의 핵심 질문은 "어디까지 Zustand(로컬 draft), 어디부터 TanStack(서버 데이터)인가"의 선 긋기다. 로드맵 #15의 비교표가 출발점이다.
- **signed URL의 만료를 누가 관리하나**: A3가 내려주는 1h signed URL은 만료된다. TanStack Query의 `staleTime`/자동 리페치가 "만료 전에 다시 받아오기"를 자연스럽게 해결한다 — signed URL TTL과 query staleTime을 어떻게 맞출지가 4.5의 실전 포인트다.
- **A4 PATCH는 `useMutation`의 첫 대상**: 완성 전이·공개 토글은 mutation이다. 성공 후 `invalidateQueries(['submission', id])`로 A3 GET 캐시를 갱신하는 흐름이 4.5에서 등장한다. Optimistic Update(로드맵 #16, Phase 3)의 예고편이기도 하다.
- **A6 업로드 → A4 완성의 순서 의존**: 콜라주 업로드(A6)가 끝나야 완성 전이(A4)의 전제(`collage_image_url != null`)가 충족된다. 클라이언트에서 "업로드 mutation 성공 → 완성 mutation"으로 잇는 순차 흐름을 4.5에서 구현한다.

**선행 개념 체크**: 4.5에 들어가기 전에 (1) Zustand persist(로드맵 #14), (2) Route Handler vs Server Action(#3, Day 3에서 익힘), (3) 이 노트의 signed URL TTL·status 전이 — 이 셋이 머리에 있어야 "왜 서버 상태는 TanStack에 맡기고 로컬 draft만 Zustand에 두는가"가 풀린다.
