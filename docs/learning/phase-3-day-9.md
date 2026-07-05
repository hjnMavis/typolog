# Phase 3 Day 9 — 마이페이지·프로필: 공개 토글(S4) + 닉네임 수정(S3) + `/my` + 하단 탭

> 대상 작업: 내 완성 콜라주 갤러리(`/my`) + 공개/비공개 토글(S4 `updateSubmissionVisibility`) + 닉네임 수정(S3 `updateProfile`) + 하단 탭 네비게이션(client island) + 로그아웃/피드카드→`/s` 동선(#63).
> 게이트 C(학습) 산출물. 코드는 수정하지 않고 개념만 정리한다.
> 선행 노트: `docs/learning/phase-3-day-7.md`(낙관적 업데이트·throw vs `{ok,code}`·RLS 우회 소유권·존재 은폐 토대), `docs/learning/phase-3-day-8.md`(단일 가시성 소스 `getSharedSubmission`·anon 서명·존재 은폐 404), `docs/learning/fix-logout-draft-leak.md`(로그아웃 캐시 무효화)

---

## 한 줄 요약

Day 9는 **"내가 만든 콜라주를 모아 보고, 창문의 블라인드(공개/비공개)를 직접 올리고 내리며, 내 명패(닉네임)를 고치는"** 일이다. 핵심은 ① 같은 토글이 **`/my` 목록에는 '값 변화'로, `feed` 목록에는 '멤버십 변화'로** 서로 다르게 작용한다는 것을 알아채 캐시를 다르게 다루고(setQueryData 정정 vs invalidate), ② Day 8이 **읽던** `is_public`을 Day 9가 **쓰면서** 추가 코드 없이 `/s`·OG가 즉시 연동되며, ③ 실패 전달 방식(throw vs `{ok,code}`)을 새 액션 2개에 목적별로 갈라 쓰고, ④ **누구 권한으로 서명하느냐**(본인 JWT)로 비공개 콜라주까지 내가 보게 하는 것이다.

---

## 이번 Day에서 배운 8개 개념 (우선순위 순)

1. **낙관적 업데이트의 두 갈래 — 값 정정 vs 멤버십 변화** — 같은 토글인데 `/my`는 setQueryData, `feed`는 invalidate. 판단 기준은 "목록의 구성원 자격이 바뀌나, 이미 든 구성원의 값만 바뀌나"
2. **`is_public`의 쓰기 쪽 — 단일 가시성 소스와의 즉시 연동** — Day 8이 읽던 컬럼을 Day 9가 쓴다 → 비공개 토글 즉시 `/s`·OG 404(추가 코드 0)
3. **TOCTOU 방어 조건부 UPDATE** — read 시점 검사 후 최종 UPDATE의 WHERE에서 소유권·상태 재확인(0행 → NOT_FOUND)
4. **throw vs `{ok,code}`의 실전 적용** — S4=throw(롤백만) / S3=구조화 반환(Sheet가 사유별 메시지). 같은 Day에 판단 기준을 두 액션에 적용
5. **본인 서명 경로 vs anon 서명 경로** — `/api/me/submissions`는 본인 JWT로 서명해 비공개 콜라주도 보인다(Day 8 anon 공개분과 대비)
6. **유니코드 범주 기반 입력 정제** — zod `transform().pipe()`로 정제 후 길이 검증, `\p{Cc}`·`\p{Cf}`(zero-width·RTL 스푸핑) 제거
7. **allowlist 기반 노출 제어 — 하단 탭 client island** — `usePathname`으로 표시 3경로만 허용(나머지 기본 숨김), root layout에 island 1개
8. **존재 은폐의 경계** — 타인 자원엔 NOT_FOUND 통일, 단 본인 자원 상태(hidden/not-completed) 통지는 은폐 위반 아님 + production throw 마스킹이 경계를 한 번 더 닫음

> Day 7·8이 남긴 자산 위에 거의 그대로 올라선다: **낙관적 업데이트 3단**(onMutate/onError/onSuccess), **순수 캐시 함수**(reaction-cache → visibility-cache), **throw vs `{ok,code}`** 판단 기준, **RLS 우회 소유권 강제**, **단일 가시성 소스**. Day 9의 새로움은 이 자산들을 **"쓰기(mutation)"** 로 뒤집고, 특히 "같은 변경이 목록마다 다른 의미를 갖는다"는 한 단계 깊은 캐시 감각을 요구한다는 점이다.

---

## 1. 낙관적 업데이트의 두 갈래 — 값 정정 vs 멤버십 변화

### 왜 필요한가? (좋아요는 invalidate 안 했는데, 공개 토글은 왜 하나)

Day 7에서 좋아요 토글은 `onSuccess`에서 **단일 항목 권위값만 정정**하고 `['feed']` invalidate는 **의도적으로 뺐다**(무한 쿼리 전체 재fetch → signed URL 재서명·스크롤 점프가 너무 비쌈). 그런데 Day 9의 공개/비공개 토글은 `onSuccess`에서 `invalidateQueries({ queryKey: ['feed'] })`를 **한다**(`use-toggle-visibility.ts:49`). 겉보기엔 모순이다 — 둘 다 "토글"인데 왜 하나는 invalidate하고 하나는 안 하나?

답은 **"이 변경이 목록에 무엇을 하는가"** 가 다르기 때문이다.

- **좋아요**: 카드는 피드에 **계속 남아 있고**, `reaction_count` 숫자만 바뀐다 → **값(value) 변화**
- **공개/비공개**: 비공개로 바꾸면 그 카드가 피드에서 **사라지고**, 공개로 바꾸면 **새로 나타난다** → **멤버십(membership) 변화**

피드는 "공개 완성작만" 담는 목록이라, `is_public`을 끄는 순간 그 항목은 목록의 **구성원 자격**을 잃는다. 이건 단일 항목 정정으로 표현할 수 없다 — 목록에서 빠지거나 끼어드는 **집합의 변화**라, 목록을 다시 계산(refetch)해야 정확하다. 그래서 invalidate가 옳다.

### 판단 기준 한 줄

> **"이 변경이 어떤 목록의 '구성원 자격'을 바꾸나, 아니면 이미 든 구성원의 '값'만 바꾸나?"**
> - 값만 바뀜(항목은 목록에 그대로 남음) → 그 목록은 **setQueryData로 단일 항목 정정** (좋아요, `/my` 배지)
> - 구성원 자격이 바뀜(등장/소멸) → 그 목록은 **invalidate로 재계산** (피드)

### Typolog에서는? (한 토글이 두 목록에 다르게 작용한다)

가장 중요한 통찰: **같은 토글 한 번이 두 목록에 서로 다른 종류의 변화를 일으킨다.**

- **`/my` 목록(`['my','submissions']`)**: 이 목록은 "내 완성작 전부(공개+비공개)"라, 공개↔비공개를 바꿔도 항목은 **그대로 남고 배지만 바뀐다** → **값 변화** → `setSubmissionVisibility`로 단일 항목 정정(`use-toggle-visibility.ts:41-48`)
- **`feed` 목록(`['feed']`)**: 이 목록은 "공개 완성작만"이라, 같은 토글이 **멤버십 변화** → `invalidateQueries({ queryKey: ['feed'] })`(`use-toggle-visibility.ts:49`)

그래서 `onSuccess` 한 곳에서 **둘을 동시에** 한다 — `/my`엔 정정, `feed`엔 무효화. 하나의 mutation이 캐시 두 개를 성격에 맞게 다르게 다루는 것이다.

낙관 갱신(`onMutate`)·정정(`onSuccess`)은 **순수 함수** `setSubmissionVisibility`(`visibility-cache.ts:9-26`)가 담당한다. Day 7 `reaction-cache.ts`와 같은 철학이되 더 단순하다 — `/my` 캐시는 피드의 `pages[].items[]` 2겹 중첩과 달리 **평탄한 `items[]`**라, 대상 1개의 `is_public`만 바꾸고 나머지는 원본 참조를 보존한다(`visibility-cache.ts:15` 목록에 없으면 `data` 그대로 반환, `20-23` 대상만 spread). 단위 테스트가 이 참조 보존을 `toBe`로 검증한다(`visibility-cache.test.ts:55-96`: 비대상 항목은 `toBe`, 대상은 `not.toBe`, 목록에 없는 id는 입력과 `toBe`).

낙관과 정정이 **같은 함수**인 이유도 짚고 넘어가자(`visibility-cache.ts:7-8` 주석): 좋아요는 낙관값이 "±1 추정"이라 서버 권위값과 다를 수 있어 reconcile가 필요했지만, 공개 토글은 낙관도 정정도 **"is_public을 특정 값으로 세팅"** 이라 한 함수로 충분하다.

### 비유

가게 진열대가 두 개 있다. **내 창고 목록(`/my`)** 은 팔든 안 팔든 내 물건 전부를 적어두고 "판매중/보관중" 딱지만 바꾼다(값 변화 → 딱지만 고침). **매장 진열대(feed)** 는 "판매중"만 올려두는 곳이라, 딱지를 "보관중"으로 바꾸면 그 물건을 **진열대에서 빼야** 한다(멤버십 변화 → 진열대를 다시 정리). 같은 딱지 조작이 창고 장부에선 글자 수정, 매장 진열대에선 물건 이동인 셈이다.

### 자주 하는 실수

- **좋아요 규칙("invalidate 안 함")을 공개 토글에 그대로 복사.** 비공개로 바꿔도 피드에 남아서 사라진 항목이 계속 보인다. **멤버십이 바뀌는 목록은 invalidate**해야 한다.
- **반대로 `/my`까지 invalidate.** `/my`는 값만 바뀌는데 통째로 재fetch하면 signed URL 재서명·불필요한 왕복이 생긴다. `/my`는 단일 항목 정정으로 충분하다.
- **낙관 갱신 시 대상 아닌 항목까지 새 객체로.** 참조가 바뀌어 안 바뀐 카드까지 리렌더. 대상만 spread, 나머지는 원본 반환(`visibility-cache.ts:15,23`).

---

## 2. `is_public`의 쓰기 쪽 — 단일 가시성 소스와의 즉시 연동

### 왜 필요한가? (Day 8이 깔아둔 "단일 진실"을 Day 9가 건드린다)

Day 8의 `getSharedSubmission`은 `status='completed' AND is_public=true`를 **읽어서** `/s`·OG·generateMetadata가 같은 판정을 보게 하는 **단일 가시성 소스**였다. Day 9의 S4는 바로 그 `is_public` 컬럼을 **쓰는** 쪽이다.

여기서 나오는 자산 효과: **가시성 판정이 이미 한 컬럼에 모여 있으니, 그 컬럼을 토글하기만 하면 공유 쪽은 추가 코드 0으로 즉시 연동된다.** 비공개로 토글 → 다음 `/s/[id]` 요청부터 `getSharedSubmission`이 `is_public=true` WHERE에 걸려 `null` → 404. 공개로 토글 → 즉시 다시 보임. S4는 `submissions.is_public`만 UPDATE할 뿐(`submissions.ts:64-75`), `/s`나 OG를 건드리는 코드가 한 줄도 없다.

만약 가시성이 여러 곳에 흩어져 있었다면(예: 공유용 별도 플래그, 피드용 별도 플래그), 토글이 그것들을 **전부 동기화**해야 했을 것이고 한 곳을 빠뜨리면 "피드엔 사라졌는데 공유 링크론 여전히 보이는" 누수가 났을 것이다. 단일 소스라 그 위험 자체가 없다.

### Typolog에서는?

- **읽기(Day 8)**: `getSharedSubmission`의 WHERE가 `is_public=true`(단일 소스)
- **쓰기(Day 9)**: S4가 `.set({ is_public: isPublic })`(`submissions.ts:66`) — 같은 컬럼
- **제품 결정 #60 (B)**: "완성 = 확정(재편집 불가), **공개여부만** 토글." 그래서 S4는 `is_public` 외의 어떤 필드도 바꾸지 않고(콜라주 이미지·문장 불변), 완성작만 대상으로 한다. QA §3.6이 이 불변을 확인한다.

### 비유

집 현관에 **조명 스위치가 딱 하나**(is_public) 있고, 거실등·현관등·정원등(피드·`/s`·OG)이 전부 그 한 스위치에 물려 있다. 스위치를 내리면 세 등이 **동시에** 꺼진다 — 각 등마다 따로 끄러 다닐 필요가 없다. 스위치가 여러 개였다면 하나 깜빡 잊고 안 끄면 정원등만 켜진 채 남았을 것이다.

### 자주 하는 실수

- **토글이 `is_public` 외의 상태(완성 취소, 콜라주 교체)까지 건드리게 확장.** #60 (B) 결정은 "완성=확정"이다. 토글은 가시성만.
- **가시성을 목적별로 분산 저장.** 공유용·피드용 플래그를 따로 두면 토글마다 전부 동기화해야 하고 누락 시 누수. 단일 컬럼을 여러 소비자가 읽게 한다.

---

## 3. TOCTOU 방어 조건부 UPDATE — 읽고 검사한 뒤, 쓸 때 다시 검사한다

### 왜 필요한가? (읽은 순간과 쓰는 순간 사이에 세상이 바뀔 수 있다)

S4는 UPDATE 전에 여러 검사를 한다: 소유권(`getOwnedSubmission`), hidden 아님, completed 맞음(`submissions.ts:51-60`). 순진하게 생각하면 "검사 통과했으니 이제 UPDATE하면 끝"이다. 하지만 **검사(read)와 UPDATE(write) 사이에는 시간 틈이 있다.** 그 틈에 같은 제출의 상태가 다른 요청으로 바뀔 수 있다(예: 동시에 hidden 처리). 검사 시점엔 completed였는데 UPDATE 시점엔 hidden이 된 상태라면, 검사만 믿고 무조건 UPDATE하면 **hidden 제출을 공개로 되살리는** 사고가 난다. 이게 **TOCTOU(Time-Of-Check to Time-Of-Use)** 경합이다.

방어법은 **검사 조건을 UPDATE의 WHERE에 다시 심는 것**이다. 최종 UPDATE가 `id + user_id + status='completed' + status≠'hidden'`을 WHERE로 걸면(`submissions.ts:67-73`), 그 사이 상태가 바뀐 행은 WHERE에 안 걸려 **0행 매칭**이 된다. 0행이면 `NOT_FOUND`를 던져(`submissions.ts:77-79`) 조용히 실패한다. 즉 "쓰는 바로 그 순간"의 DB 상태로 한 번 더 검증하는 것이다.

### Typolog에서는?

읽기 시점 검사(`submissions.ts:51-60`)와 쓰기 시점 WHERE(`submissions.ts:67-73`)가 **대칭**을 이룬다:

- 읽기: `getOwnedSubmission`(소유권) → `status==='hidden'`이면 HIDDEN → `status!=='completed'`이면 NOT_COMPLETED
- 쓰기: `WHERE id=? AND user_id=? AND status='completed' AND status≠'hidden'` → 0행이면 NOT_FOUND

이 패턴은 Day 4의 A4 PATCH(상태 전이)와 **같은 틀**이다("조건부 UPDATE는 UPSERT가 아니다"). RLS §3.3(hidden은 소유자도 수정 불가, fail-closed)과도 정합한다. QA P6가 이 WHERE의 소유권 재확인을 확인한다.

주의할 점(솔직한 한계): read-check와 UPDATE는 **하나의 트랜잭션으로 묶이지 않아** 완전한 원자성은 아니다. 하지만 WHERE에 조건을 심은 덕에 **"잘못된 상태로 쓰는 것"만은 확실히 막는다** — 최악의 경우는 "경합으로 0행 → NOT_FOUND"라는 안전한 실패다.

### 비유

경비원이 "이 사람 출입증 유효함"을 확인(check)하고 문으로 걸어가는 사이(time gap), 그 출입증이 정지될 수 있다. 그래서 **문을 여는 판독기(WHERE)가 그 순간 다시 출입증을 찍게** 한다 — 확인과 개문 사이에 정지됐으면 판독기가 거부(0행)한다. "아까 확인했으니 무조건 열어줘"는 위험하다.

### 자주 하는 실수

- **읽기 검사만 믿고 UPDATE를 무조건 실행.** 검사~쓰기 틈의 상태 변경을 놓쳐 hidden을 공개로 되살릴 수 있다. WHERE에 조건 재확인.
- **0행 결과를 "성공"으로 착각.** `.returning()`이 빈 배열이면 아무것도 안 바뀐 것이다 — `if (!updated) throw NOT_FOUND`로 실패 처리(`submissions.ts:77-79`).
- **경합 실패에 세부 사유를 노출.** 읽기 땐 HIDDEN/NOT_COMPLETED로 구분했어도, 쓰기 경합의 0행은 **NOT_FOUND로 통일**한다(어떤 상태로 바뀌었는지 알려줄 필요 없음).

---

## 4. throw vs `{ok,code}`의 실전 적용 — 같은 Day, 두 액션, 다른 선택

### 왜 필요한가? (Day 7의 판단 기준을 새 액션 2개에 실제로 적용)

Day 7에서 배운 규칙: **Next.js는 production에서 Server Action이 throw한 에러 메시지를 마스킹**한다. 그래서 실패 사유별로 다른 UI가 필요하면 throw로는 안 되고 `{ok,code}`를 **데이터로** 반환해야 한다. Day 9는 이 판단 기준을 **새로 만든 액션 두 개에 서로 다르게** 적용한 좋은 사례다.

판단 기준(Day 7 §6 재사용): **"실패 사유에 따라 클라이언트가 다른 행동을 해야 하나?"**

- **S4 `updateSubmissionVisibility` → throw** (`submissions.ts:41,47,53,57,59,78`): 토글 실패 시 클라이언트가 할 일은 **낙관값 롤백뿐**이다(`use-toggle-visibility.ts:36-40` onError). NOT_FOUND든 HIDDEN이든 UI 행동은 "배지 되돌리기" 하나라, 사유별 메시지가 필요 없다 → throw로 충분(마스킹돼도 무방).
- **S3 `updateProfile` → `{ok,code}` 반환** (`profile.ts:15-17,27,34`): 프로필 Sheet는 실패 사유별로 다른 메시지를 보여야 한다 — "로그인이 필요해요"(UNAUTHENTICATED) vs "닉네임을 다시 확인해 주세요"(INVALID). throw하면 production에서 두 사유가 같은 일반 메시지로 뭉개져 Sheet가 구분 못 한다 → `{ok:false, code}`로 반환.

### Typolog에서는?

Sheet가 그 코드를 메시지로 매핑한다(`ProfileEditSheet.tsx:26-33` `serverErrorMessage`) — union 타입 `'UNAUTHENTICATED' | 'INVALID'`이라 `switch`에서 하나라도 빠뜨리면 TypeScript가 잡는다. 그리고 Day 7 신고 다이얼로그처럼 **두 종류 실패를 분리**한다(`ProfileEditSheet.tsx:50-55`): `update.data && !update.data.ok`(서버가 정상 반환한 `ok:false`)와 `update.isError`(네트워크/진짜 throw)를 다른 메시지로. 또 입력 형식 오류(클라 zod)를 서버 오류보다 **먼저** 노출한다(`ProfileEditSheet.tsx:57` `validationMessage ?? serverError`).

### 비유

S4는 초인종이다 — 안 열리면 "안 되네" 하고 돌아서면 그만(롤백). 이유를 세세히 물을 필요가 없다. S3는 관공서 민원 창구다 — "서류 미비(INVALID)"인지 "신분 미확인(UNAUTHENTICATED)"인지 **사유가 적힌 반송장**을 받아야 다음에 무엇을 고칠지 안다. 반송 사유를 "그냥 반려"로 뭉개면(throw 마스킹) 민원인이 뭘 고쳐야 할지 모른다.

### 자주 하는 실수

- **S3까지 throw로 통일.** 로컬 dev에선 메시지가 보여 "잘 되네" 싶지만, **production 배포 후 닉네임 오류와 세션 만료가 같은 메시지**로 뭉개진다. 사유별 분기가 필요하면 `{ok,code}`.
- **S4까지 `{ok,code}`로 통일.** 롤백만 하면 되는 토글을 반환객체로 만들면 `onError` 자동 롤백을 못 쓰고 호출부가 매번 `if (!result.ok)`로 분기해야 해 번거롭다. 목적에 맞게 가른다.

---

## 5. 본인 서명 경로 vs anon 서명 경로 — 누구 권한으로 서명하느냐

### 왜 필요한가? (같은 콜라주인데 마이페이지에선 비공개도 보여야 한다)

Day 8에서 공유 페이지는 **anon(비인증)** 권한으로 서명해 **공개 완성 콜라주만** 보이게 했다(최소 권한). 그런데 마이페이지는 정반대다 — **본인**은 자기 **비공개** 콜라주도 봐야 한다. "아직 비공개로 둔 내 작품"을 갤러리에서 못 보면 토글할 대상을 볼 수가 없다.

핵심은 Day 8 §3에서 배운 감각의 확장이다: **"같은 파일이라도 누구 권한으로 signed URL을 서명하느냐에 따라 보이는 범위가 다르다."** collages는 private 버킷이고, Storage 정책이 "본인 것 + 공개 완성작"을 읽게 한다. `/api/me/submissions`는 **본인 JWT가 실린 server client**로 서명하므로(`route.ts:22-23,68-73`), Storage 정책이 "본인 소유" 조항을 발동시켜 **비공개 콜라주까지 서명**된다. 반면 Day 8 공유는 쿠키에 JWT가 없는 anon이라 "공개 완성작"만 서명됐다.

### Typolog에서는?

`/api/me/submissions`(`route.ts`)의 대비 포인트:

- **인증 필수**(`route.ts:24-25`): 미인증은 리소스 정보 노출 없이 401 (QA P3). 공유 페이지가 비인증도 허용한 것과 정반대.
- **본인 것만 필터**(`route.ts:45`): `WHERE user_id=? AND status='completed'` — `user.id`는 JWT `getClaims().sub`에서 온 서버값이라 클라 조작 불가(QA P4). draft·hidden은 갤러리에서 제외.
- **본인 client로 서명**(`route.ts:68-73`): 같은 `supabase`(본인 JWT)로 `createSignedUrl`, TTL은 `EDIT`(1h, 본인 편집용) — 공유의 `SHARE`(24h)와 다름.
- **`user_reacted` 불필요**(`route.ts:56` 주석): 본인 목록이라 "내가 좋아요 눌렀나"는 의미 없음. 반응 수만 배치 1쿼리로 집계(N+1 회피, `route.ts:57-64`).

즉 피드(A7, 공개 전용)·공유(anon, 공개 전용)와 달리, `/api/me/submissions`는 **"본인 인증 + 본인 필터 + 본인 서명"** 3박자로 비공개까지 안전하게 본다.

### 비유

같은 금고(private 버킷)라도, **직원 본인 카드(본인 JWT)** 로 열면 자기 개인 서랍(비공개)까지 열리고, **방문객 카드(anon)** 로 열면 공용 전시함(공개)만 열린다. 카드 소유자가 곧 열람 범위를 정한다. 마이페이지는 본인 카드로 여는 창구다.

### 자주 하는 실수

- **마이페이지 서명을 admin(service key) client로.** 편하지만 정책을 우회해 **남의 비공개 콜라주까지** 서명될 수 있다. 반드시 본인 JWT client로 서명해 정책이 소유권을 강제하게 한다(Day 4 "admin 서명 금지").
- **`/api/me/submissions`를 공개 GET처럼 취급.** 인증 안 걸면 남의 비공개 목록이 샌다 — 반드시 401 게이트(`route.ts:24-25`).
- **본인 목록에 `user_reacted`·공개 가시성 술어를 그대로 복붙.** 본인 것이라 불필요하거나(전자) 비공개를 걸러버려(후자) 정작 보여야 할 걸 못 본다.

---

## 6. 유니코드 범주 기반 입력 정제 — 보이지 않는 문자를 잘라낸다

### 왜 필요한가? (닉네임 `"<<<"`는 왜 거부되어야 하나)

닉네임은 화면·피드·공유 카드에 그대로 노출되는 사용자 입력이다. 여기엔 두 부류의 위험 문자가 섞여 들어올 수 있다:

1. **꺾쇠 `<`, `>`**: HTML 태그처럼 보이는 문자. React가 이스케이프하지만, 애초에 닉네임에 넣을 이유가 없다.
2. **보이지 않는 유니코드**: **zero-width space**(폭 0 공백), **zero-width joiner/non-joiner**, **RTL override**(글자 방향을 뒤집어 스푸핑) 같은 문자. 눈엔 안 보이는데 "닉네임이 있는 것처럼" 길이를 채우거나, 화면 표시를 조작한다.

순진하게 `min(2).max(20)`만 검사하면, `zero-width space` 2개짜리 "닉네임"이 **길이 2로 통과**해 화면엔 빈 이름이 뜬다. 또는 `"<<<"`가 3자로 통과한다. 그래서 **먼저 정제한 뒤 길이를 재야** 한다.

여기서 유니코드 **범주(category)** 가 등장한다. 문자를 하나하나 나열하는 대신, `\p{Cc}`(Control, 제어문자)·`\p{Cf}`(Format, zero-width·RTL 등 서식 문자)라는 **범주 전체**를 정규식으로 지운다 — 미래에 새로운 zero-width 문자가 생겨도 범주에 속하면 자동으로 걸린다.

### Typolog에서는?

`updateProfileSchema`(`validations/profile.ts:11-21`)가 `transform().pipe()` **체인**으로 "정제 먼저, 검증 나중"을 강제한다:

```ts
z.string()
  .transform((s) => s.trim().replace(/[\p{Cc}\p{Cf}<>]/gu, ''))  // ① 정제
  .pipe(z.string().min(2, ...).max(20, ...))                       // ② 정제된 값의 길이 검증
```

순서가 핵심이다. `transform`이 먼저 `trim` + `\p{Cc}\p{Cf}<>` 제거를 하고, `pipe`가 **정제된 문자열**의 길이를 검사한다(`u` 플래그가 유니코드 범주 인식). 그래서 `"<<<"`는 정제 후 빈 문자열 → `min(2)` 위반으로 거부된다(`validations/profile.ts:9-10` 주석). 만약 검증을 먼저 하고 정제를 나중에 했다면 `"<<<"`가 길이 3으로 통과했을 것이다.

이 스키마는 **클라·서버가 공유**한다(`validations/profile.ts:4` 주석): Sheet가 같은 스키마로 즉시 피드백(`ProfileEditSheet.tsx:43-46`)하고, S3가 권위 검증(`profile.ts:25`)한다 — Day 3에서 배운 "isomorphic 검증"의 재현. 단위 테스트 17건이 경계를 못박는다(`tests/unit/profile-validation.test.ts`: `"<<<"`→빈문자열→실패, zero-width·RTL 제거 후 통과, trim, 2/20자 경계 등 — QA §1 표).

정제된 값으로 **"변경 없음"** 도 판단한다(`ProfileEditSheet.tsx:47` `parsed.data.nickname === currentNickname`) — 앞뒤 공백만 추가한 "가짜 변경"으로 저장 버튼이 켜지지 않게.

### 비유

입국 심사에서 **투명 잉크로 쓴 글자(zero-width)** 나 거꾸로 인쇄된 글자(RTL override)를 지운 뒤에 이름 길이를 재는 것이다. 안 지우고 재면 "빈 여권인데 글자가 있는 척"하는 위조를 통과시킨다. 개별 위조 수법을 하나씩 막는 대신 "보이지 않는 서식 문자 범주 전체"를 지우면 새로운 수법도 함께 막힌다.

### 자주 하는 실수

- **길이 검증을 먼저, 정제를 나중에.** `"<<<"`·zero-width가 길이만 채우고 통과한다. `transform().pipe()`로 **정제 → 검증** 순서 고정.
- **개별 문자를 일일이 나열해서 제거.** 새 zero-width 문자가 추가되면 뚫린다. `\p{Cc}\p{Cf}` **범주**로 잡고 `u` 플래그를 꼭 붙인다.
- **클라에서만 정제하고 서버 재검증 생략.** Server Action 인자는 외부 입력이다(Day 7 §1) — S3가 같은 스키마로 다시 검증한다(`profile.ts:25`).

---

## 7. allowlist 기반 노출 제어 — 하단 탭 client island

### 왜 필요한가? (탭은 "어디서 보일지"를 정해야 한다)

하단 탭 네비(홈·피드·마이)는 앱 대부분에서 보이지만, **어떤 화면에선 숨겨야** 한다 — 글자 수집·미리보기(풀스크린 집중), 로그인, 공유 페이지(비인증), admin. "어디서 보일지"를 정하는 방법은 두 가지다:

- **denylist(숨길 곳 나열)**: "수집·미리보기·로그인·공유·admin에선 숨김, 나머지 표시"
- **allowlist(보일 곳 나열)**: "홈·피드·마이에서만 표시, 나머지 숨김"

Day 9는 **allowlist**를 택했다(`BottomTabNav.tsx:22-29` `shouldShowTabs`). 이유는 **누락 안전성**이다. 나중에 새 라우트(예: `/settings`)를 추가할 때, denylist라면 개발자가 "여기도 숨겨야 하나?"를 매번 기억해 목록에 넣어야 하고 잊으면 **원치 않게 탭이 노출**된다. allowlist라면 새 라우트는 **기본이 "숨김"** 이라, 명시적으로 허용하지 않는 한 안 보인다 — 실수의 방향이 "안전한 쪽(숨김)"으로 기운다.

### client island이란?

root layout(`app/layout.tsx`)은 서버 컴포넌트다. 그 안에 탭 하나를 넣는데, 탭은 현재 경로를 알아야(`usePathname`) 표시 여부와 강조를 정하므로 **클라이언트**여야 한다. 그래서 서버 셸(layout) 안에 **작은 클라이언트 조각(island) 하나**만 심는다 — 페이지 전체를 클라이언트로 만들지 않고, `'use client'` 섬 하나(`BottomTabNav.tsx:1`)만 물에 띄우는 것이다. 이게 "islands architecture"의 축소판이다.

### Typolog에서는?

- `shouldShowTabs`(`BottomTabNav.tsx:22-29`): `pathname === '/' || startsWith('/feed') || pathname === '/my' || startsWith('/my/')` — 명시적 3영역만 `true`. 이외는 `false` → `return null`(`BottomTabNav.tsx:33`)로 셸 밖에 둔다.
- root layout에 island 1개(`app/layout.tsx`에 `<BottomTabNav />` 삽입). 모든 페이지가 이 하나를 공유(QA §2 layout 수정).
- 강조: `usePathname`으로 현재 탭에 `aria-current="page"`(`BottomTabNav.tsx:47`) — 접근성 + 시각 강조.
- QA P16/P17이 "홈·피드·마이에서만 표시, `/challenge/*`·`/s/*`·`/login`·`/admin/*`에선 미표시"를 확인.

### 비유

건물 안내판을 "여기선 안내판 치우세요(denylist)"가 아니라 **"로비·카페·라운지에만 안내판 설치(allowlist)"** 로 관리하는 것이다. 새 방을 만들면 기본은 "안내판 없음"이라, 깜빡해도 엉뚱한 곳(비상계단·기계실)에 안내판이 붙지 않는다. 치울 곳을 나열하는 방식은 새 방마다 "여기도 치워야 하나"를 기억해야 한다.

### 자주 하는 실수

- **denylist로 숨길 경로 나열.** 라우트가 늘 때마다 "여기도 숨겨야 하나"를 기억해야 하고 잊으면 노출. **allowlist는 기본이 숨김**이라 안전.
- **layout에 탭을 서버 컴포넌트로 넣으려 함.** `usePathname`은 클라 훅이라 서버에선 못 쓴다. 탭만 `'use client'` island로 분리.
- **여러 layout에 탭을 중복 배치.** root에 island 1개면 충분. 중복하면 이중 렌더·불일치 위험.

---

## 8. 존재 은폐의 경계 — 무엇을 숨기고, 무엇은 알려도 되나

### 왜 필요한가? (모든 걸 NOT_FOUND로 뭉개면 본인이 답답하다)

Day 8에서 배운 **존재 은폐**: 타인의 비공개·미존재·draft를 전부 동일한 404로 뭉개 enumeration을 막는다. Day 9 S4도 이걸 지킨다 — 타인 소유든 미존재든 `getOwnedSubmission`이 똑같이 `null`을 반환해(`submissions.ts:50-54` 주석) **NOT_FOUND로 통일**(QA §3.1). 타인 제출 id를 추측해도 "있는지 없는지" 구분이 안 된다.

그런데 여기서 미묘한 경계 질문이 생긴다: S4는 hidden이면 `HIDDEN`, 미완성이면 `NOT_COMPLETED`를 던진다(`submissions.ts:55-59`) — **사유를 구분해서** 알려준다. 이건 Day 8의 "사유 미구분" 원칙과 모순 아닌가?

답은 **"누구의 자원인가"** 로 갈린다:

- **타인 자원**: 존재 자체를 숨겨야 한다(enumeration 방어) → NOT_FOUND로 통일
- **본인 자원**: 본인은 자기 것의 상태를 **알 권리**가 있다 → "이건 숨긴 제출이라 토글 못 해요(HIDDEN)", "아직 미완성이에요(NOT_COMPLETED)"를 알려줘도 정보 누수가 아니다. 어차피 본인 것이므로 "존재"를 숨길 이유가 없다.

즉 **존재 은폐는 "타인 자원의 존재"를 숨기는 것**이지, "본인 자원의 상태"까지 숨기는 게 아니다. `getOwnedSubmission`이 소유권 게이트를 먼저 통과시키므로(`submissions.ts:51`), HIDDEN/NOT_COMPLETED 분기에 도달했다는 건 **이미 본인 것으로 확인됐다**는 뜻이다.

### production throw 마스킹이 경계를 한 번 더 닫는다

여기에 안전판이 하나 더 있다(Day 9 Reviewer 확인 포인트). S4는 실패를 **throw**로 전달하는데(§4), Next.js가 production에서 throw 메시지를 마스킹한다. 그래서 `HIDDEN`·`NOT_COMPLETED`·`NOT_FOUND` 문자열은 **애초에 클라이언트까지 도달하지 않는다** — 클라는 "에러 났음"만 알고 낙관값을 롤백할 뿐이다(`use-toggle-visibility.ts:36-40`). 사유 코드는 서버 로그·개발 환경에서만 의미를 갖는다. 즉 "본인에겐 알려도 되지만, 그마저도 UI로는 안 새는" 이중 경계다.

### Typolog에서는?

- 타인/미존재 → NOT_FOUND 통일(`submissions.ts:52-54`, QA §3.1)
- 본인 hidden → HIDDEN(`submissions.ts:55-57`, QA P9), 본인 미완성 → NOT_COMPLETED(`submissions.ts:58-60`, QA P8)
- 이 모든 코드는 throw → production 마스킹 → 클라는 롤백만(`use-toggle-visibility.ts` onError)
- 대비: S3 `updateProfile`은 본인 자원(자기 프로필)이라 사유(INVALID/UNAUTHENTICATED)를 `{ok,code}`로 **드러낸다** — 본인 자원이므로 은폐 대상이 아니고, Sheet가 사유별 안내를 해야 하니까

### 비유

호텔에서 **남의 방(타인 자원)** 은 "그런 손님 없습니다"로 통일(존재 은폐)하지만, **내 방(본인 자원)** 프런트에선 "고객님 방은 지금 청소 중(HIDDEN)이라 못 들어가세요"라고 사유를 알려줘도 된다 — 내 방의 상태를 나에게 숨길 이유는 없으니까. 다만 그 안내조차 로비 스피커(UI)로 방송하진 않고 프런트에서만 조용히(throw 마스킹) 전한다.

### 자주 하는 실수

- **타인 자원에도 사유별 에러(HIDDEN/삭제됨)를 노출.** enumeration으로 "누가 뭘 숨겼는지" 목록이 만들어진다. 타인 자원은 NOT_FOUND 통일.
- **본인 자원까지 NOT_FOUND로 뭉갬.** 본인이 "왜 토글이 안 되지?"를 알 방법이 없어 답답하다. 소유권 통과 후엔 상태를 구분해도 된다(단, 마스킹 여부는 별개 층위).
- **throw 마스킹을 믿고 민감 정보를 메시지에 담음.** 마스킹은 **일반 클라이언트 UI**에서만 유효하다 — 서버 로그엔 남으므로 메시지에 개인정보를 넣지 않는다.

---

## 디버깅 노트 — "관찰 타이밍"과 "조용한 누락"

Day 9 E2E·시드 과정에서 나온, "버그처럼 보였지만 버그가 아니었던" 두 사례. 둘 다 **증상과 원인을 분리하는** 감각을 길러준다.

### ① `.env.local` 탭 들여쓰기를 조용히 삼킨 시드 스크립트

증상: **dev 서버는 DB에 잘 붙는데, 시드 스크립트(`scripts/seed-challenges.ts`)만 `DATABASE_URL`을 못 읽었다.** 같은 파일을 읽는데 왜 한쪽만?

원인: Node의 `process.loadEnvFile`/`parseEnv`는 **탭으로 들여쓰기된 키를 조용히 누락**한다(공백 들여쓰기는 OK). Next(dotenv) 로더는 더 관대해 흡수한다. 그래서 `.env.local`의 어떤 줄이 탭으로 들여써져 있으면 dev 서버(Next 로더)는 읽고, 시드 스크립트(Node parseEnv)는 그 줄만 빼먹은 것이다.

해결: 시드 스크립트에 **정규화 로더**(`seed-challenges.ts:23-38` `loadEnvLocal`)를 두어, BOM·CR 제거 후 **각 줄 앞 공백/탭을 트림**하고 `parseEnv`에 넘긴다(`seed-challenges.ts:30-34`). 이미 설정된 값(셸 export)은 덮어쓰지 않는다.

배울 점: **"같은 입력, 다른 파서, 다른 관용도."** 한 로더에서 되던 게 다른 로더에서 안 되면, 파일이 아니라 **파서의 관용 범위 차이**를 의심한다. 그리고 진단은 **`.env.local` 값을 읽지 않고**(보안) **합성 파일 재현**으로 한다 — 탭 들여쓰기 줄이 든 가짜 env를 만들어 두 로더에 먹여 차이를 재현하면, 비밀 값을 한 번도 안 보고 원인을 특정할 수 있다.

### ② "저장 후 Sheet가 안 닫힌다"는 착시

증상: 프로필 저장을 눌렀는데 Sheet(하단 시트)가 **바로 안 닫히는** 것처럼 보였다.

원인: 라이브 Supabase DB **왕복(~2초)** 중에 화면을 관찰한 것이다. `setOpen(false)`는 mutation `onSuccess` **콜백 안**에 있으므로(`ProfileEditSheet.tsx:71-78`), 비동기 UPDATE가 끝난 **뒤에야** 실행된다. 즉 왕복 지연만큼 닫힘이 늦는 건 **정상 설계**다("저장 중…" 표시가 그 사이 뜬다, `ProfileEditSheet.tsx:124`).

배울 점: **"관찰 타이밍 vs 실제 버그."** 비동기 완료를 기준으로 UI를 바꾸는 코드는, 네트워크가 느리면 "반응이 늦다"처럼 보인다. 코드가 "언제 상태를 바꾸는가"(onSuccess 이후)를 확인하면 지연이 정상인지 버그인지 갈린다. Day 10 성능 점검에서 이 구분이 특히 중요하다 — 느린 것과 고장 난 것은 다르다.

---

## 자주 하는 실수 모음

| 실수 | 무슨 일이 벌어지나 | 올바른 방법 |
|------|-------------------|------------|
| **좋아요 규칙(invalidate 안 함)을 공개 토글에 복사** | 비공개로 바꿔도 피드에 남아 사라진 항목이 계속 보임 | 멤버십이 바뀌는 목록(feed)은 invalidate |
| **`/my`까지 invalidate** | 값만 바뀌는데 전체 재fetch·signed URL 재서명 | `/my`는 setQueryData 단일 정정 |
| **낙관 갱신 시 비대상 항목까지 새 객체** | 안 바뀐 카드까지 리렌더 | 대상만 spread, 나머지 원본 참조(`visibility-cache.ts:15,23`) |
| **가시성을 목적별 플래그로 분산** | 토글마다 전부 동기화·누락 시 누수 | 단일 컬럼 `is_public`을 여러 소비자가 읽음 |
| **읽기 검사만 믿고 무조건 UPDATE** | 검사~쓰기 틈의 상태 변경으로 hidden을 공개로 되살림 | WHERE에 소유권·상태 재확인(0행→NOT_FOUND) |
| **0행 결과를 성공으로 처리** | 아무것도 안 바뀐 걸 성공으로 오인 | `if (!updated) throw NOT_FOUND` |
| **사유별 메시지가 필요한 S3까지 throw** | production에서 사유가 일반 메시지로 뭉개짐 | `{ok,code}` 반환(마스킹 회피) |
| **롤백만 하면 되는 S4까지 `{ok,code}`** | onError 자동 롤백 못 씀·호출부 분기 번거로움 | throw(클라는 롤백만) |
| **마이페이지 서명을 admin client로** | 정책 우회해 남의 비공개까지 서명 | 본인 JWT client로 서명 |
| **`/api/me/submissions`에 인증 게이트 누락** | 남의 비공개 목록 누수 | 401 게이트(`route.ts:24-25`) |
| **길이 검증 먼저, 정제 나중** | `"<<<"`·zero-width가 길이만 채워 통과 | `transform().pipe()`로 정제→검증 순서 |
| **위험 문자를 개별 나열** | 새 zero-width 문자에 뚫림 | `\p{Cc}\p{Cf}` 범주 + `u` 플래그 |
| **탭 네비를 denylist로 숨김** | 새 라우트 추가 시 깜빡하면 노출 | allowlist(기본 숨김) |
| **layout에 탭을 서버 컴포넌트로** | `usePathname` 서버 사용 불가 | 탭만 `'use client'` island |
| **타인 자원에 사유별 에러 노출** | enumeration으로 비공개 목록 유추 | 타인은 NOT_FOUND 통일 |
| **본인 자원까지 NOT_FOUND로 뭉갬** | 본인이 왜 안 되는지 모름 | 소유권 통과 후엔 상태 구분(HIDDEN/NOT_COMPLETED) |
| **한 파서에서 되던 env를 다른 파서에 그대로** | 탭 들여쓰기를 조용히 누락(시드만 실패) | 정규화 로더(줄앞 트림 후 parseEnv) |
| **네트워크 지연을 UI 버그로 오인** | "Sheet 안 닫힘"처럼 착시 | onSuccess 이후 상태 변경인지 확인(정상 지연) |

---

## Day 10(통합 검증)으로 가는 다리

Day 10은 **전체 플로우·크로스 유저·성능**을 통합 점검한다. Day 9가 만든 조각들이 여기서 처음으로 **두 사용자·전체 순환**이라는 실전 조건에 놓인다.

### ① 크로스 유저 가시성 매트릭스 — Day 9의 서명 경로가 여기서 검증된다

Day 9는 "본인 서명(비공개 포함)"과 Day 8의 "anon 서명(공개만)"을 갈랐다. Day 10에서 **사용자 A가 비공개로 토글 → 사용자 B의 피드·공유에서 사라지는가**를 실제 두 계정으로 확인한다. 선행으로 잡아둘 개념: **가시성 매트릭스**(공개/비공개 × 본인/타인/anon)를 한 표로 정리해, 각 칸의 기대 결과(보임/NOT_FOUND/서명됨/안 됨)를 미리 못박는 것. Day 9의 `/api/me/submissions`(본인 비공개 보임)·`getSharedSubmission`(anon 공개만)·S4(토글)가 이 매트릭스의 칸들을 채운다.

### ② 무효화의 전파 범위 — 어떤 mutation이 어떤 쿼리 키를 건드리나

Day 9에서 S4 성공은 `['feed']`를, S3 성공도 `['feed']`를 invalidate했다(닉네임이 피드에 박혀 있으니). Day 10 전에 잡아둘 개념: **invalidation map**(어떤 쓰기가 어떤 읽기 캐시를 무효화하나)을 한 장으로 그리는 것. 크로스 유저에선 "A의 토글이 B 화면에 언제 반영되나"가 곧 "B가 언제 다시 fetch하나(staleTime·invalidate)"의 문제다 — A의 invalidate는 A 브라우저 캐시만 비우고, B는 자기 staleTime이 지나거나 재진입할 때 갱신된다는 **캐시의 사용자 국소성**을 이해해야 한다.

### ③ 성능 — invalidate의 비용과 N+1 회피가 실측 대상이 된다

Day 9의 `['feed']` invalidate는 정확성을 주지만 **무한 쿼리 전체 재fetch + 항목별 signed URL 재서명** 비용이 있다(Day 7이 좋아요에서 피한 바로 그 비용). Day 10 성능 점검에서 이 비용이 실측 대상이 된다 — 토글 후 피드가 몇 번 재서명하는가, `/api/me/submissions`의 반응 배치 쿼리(`route.ts:57-64`)가 N+1을 실제로 막는가. 선행 개념: **"정확성과 비용의 트레이드오프를 어디서 감수했나"** 를 기능별로 정리(좋아요=비용 회피, 공개 토글=정확성 우선)해두면 성능 회귀를 빠르게 진단한다.

### ④ 전체 순환 동선 — 하단 탭이 잇는 루프

Day 9의 하단 탭(만들기·피드·마이)과 #63(피드카드→`/s`)·#51(제출 후 피드)이 **만들기→수집→미리보기→제출→피드/공유→마이(토글·프로필)→다시 만들기**의 순환을 완성했다. Day 10은 이 순환을 끊김 없이 도는지(막다른 길·되돌아가기)를 전 구간 E2E로 확인한다. 선행: 각 화면의 진입·이탈 경로를 그래프로 그려 고립된 노드가 없는지 점검.

비유: Day 9까지가 방마다 가구(기능)를 놓고 스위치(토글)를 단 일이라면, Day 10은 **집에 두 사람이 같이 살면서 실제로 동선대로 걸어보고, 물 내려가는 속도(성능)를 재는** 준공 검사다.

---

## 핵심 한 장 요약

- **낙관적 업데이트의 두 갈래**: 같은 공개 토글이 `/my`엔 **값 변화**(setQueryData 정정), `feed`엔 **멤버십 변화**(`['feed']` invalidate). 판단 기준 = "구성원 자격이 바뀌나, 든 구성원의 값만 바뀌나". 순수 함수 `setSubmissionVisibility`가 평탄 `items[]`에서 대상 1개만 갱신·나머지 참조 보존.
- **`is_public` 쓰기 쪽**: Day 8이 읽던 단일 소스를 Day 9가 쓴다 → 비공개 토글 즉시 `/s`·OG 404(추가 코드 0). #60 (B) 완성=확정, 공개여부만.
- **TOCTOU 조건부 UPDATE**: read 시점 검사(NOT_FOUND/HIDDEN/NOT_COMPLETED) 후 최종 UPDATE WHERE에 소유권+completed+non-hidden 재확인(0행→NOT_FOUND). A4와 동일 패턴, RLS §3.3 정합.
- **throw vs `{ok,code}`**: S4=throw(클라는 롤백만) / S3=구조화 반환(Sheet가 사유별 메시지). production throw 마스킹 때문에 사유 분기가 필요하면 반환객체.
- **본인 서명 vs anon 서명**: `/api/me/submissions`는 본인 JWT server client로 서명 → 비공개 콜라주도 보임(Day 8 anon 공개분 대비). 인증 필수·본인 필터·`user_reacted` 불필요.
- **유니코드 정제**: `transform().pipe()`로 정제 먼저(`\p{Cc}\p{Cf}<>` 제거) → 길이 검증 나중. `"<<<"`→빈문자열→min 위반. 클라·서버 공유 스키마.
- **allowlist 탭 island**: `usePathname`으로 3경로만 허용(기본 숨김 — 누락 안전), root layout에 `'use client'` island 1개.
- **존재 은폐의 경계**: 타인 자원=NOT_FOUND 통일, 본인 자원 상태(HIDDEN/NOT_COMPLETED) 통지는 위반 아님 + production throw 마스킹이 UI 노출을 한 번 더 차단.

---

## 참고

- 코드: `src/hooks/use-toggle-visibility.ts`(두 갈래 캐시: `/my` 정정 + `feed` invalidate), `src/features/profile/visibility-cache.ts`(순수 함수·참조 보존), `src/lib/actions/submissions.ts`(S4 TOCTOU 조건부 UPDATE·존재 은폐 경계), `src/lib/actions/profile.ts`(S3 `{ok,code}` 반환), `src/lib/validations/profile.ts`(`transform().pipe()` 유니코드 정제), `src/app/api/me/submissions/route.ts`(본인 서명 경로·N+1 회피), `src/features/nav/BottomTabNav.tsx`(allowlist island), `src/features/profile/ProfileEditSheet.tsx`(사유별 메시지·onSuccess setOpen), `src/hooks/use-update-profile.ts`(닉네임 변경 후 `['feed']` invalidate), `scripts/seed-challenges.ts`(env 정규화 로더)
- 테스트: `tests/unit/visibility-cache.test.ts`(8건, `toBe` 참조 동일성), `tests/unit/profile-validation.test.ts`(17건, 정제·경계)
- 설계: `docs/backend-design-plan.md` §3.1(submissions)·§3.3(hidden 수정 불가 RLS)·§6.2(S3/S4)·§7.4(존재 은폐)·§9 Day 9
- QA: `docs/reviews/phase3-day9-qa-review.md`(P1~P29 체크포인트, §3 권한 시나리오, §6 수동 모바일 체크리스트)
- 선행 노트: `docs/learning/phase-3-day-7.md`(낙관적 업데이트 3단·throw vs `{ok,code}`·RLS 우회 소유권·onSettled 미사용의 이유), `docs/learning/phase-3-day-8.md`(단일 가시성 소스·anon 서명·존재 은폐 404), `docs/learning/fix-logout-draft-leak.md`(로그아웃 캐시 무효화·서버/클라 상태 경계)
</content>
</invoke>
