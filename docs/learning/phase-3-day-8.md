# Phase 3 Day 8 — 비인증 공유: `/s/[id]` + OG 이미지 + Web Share

> 대상 작업: 비로그인 방문자에게 콜라주를 보여주는 공유 페이지(`/s/[id]`) + 동적 OG 이미지(`/api/og/[id]`) + Web Share/클립보드 공유 + "나도 만들기" CTA + #51 제출 후 피드 동선.
> 게이트 C(학습) 산출물. 코드는 수정하지 않고 개념만 정리한다.
> 선행 노트: `docs/learning/phase-3-day-7.md`(Server Action·존재 은폐 토대), `docs/learning/fix-logout-draft-leak.md`(클라 상태 사용자 경계), `docs/learning/phase-2-day-4.md`(Signed URL·TTL 프리셋), `docs/learning/phase-2-day-3.md`(404 존재 은폐·검사 순서)

---

## 한 줄 요약

Day 8은 **"로그인하지 않은 사람도 링크 하나로 콜라주를 볼 수 있게 만들되, 공개된 완성작만 정확히 그만큼만 새어 나가게"** 하는 일이다. 핵심은 ① 가시성 판정을 **단 한 곳**(`getSharedSubmission`)에 모아 페이지와 OG 이미지가 같은 진실을 보게 하고, ② 한글을 못 그리는 OG 이미지 엔진의 한계를 **콜라주는 이미지로·한글은 메타태그로** 나눠 우회하고, ③ 비인증 방문자를 **anon 권한**으로 최소 노출시키는 것이다.

---

## 이번 Day에서 배운 8개 개념 (우선순위 순)

1. **비인증 공유 라우트 + 존재 은폐(404)** — 미존재·비공개·draft·잘못된 id를 전부 같은 404로
2. **단일 가시성 소스** — `getSharedSubmission` 하나를 페이지·OG가 공유 (불일치 원천 차단)
3. **anon 서명 경로** — 비인증 방문자는 anon role → 공개 콜라주만 서명 (최소 권한)
4. **`next/og` `ImageResponse`(Satori)** — 동적 OG 이미지 + 한글 미지원(두부) 함정과 우회
5. **data-URI 임베드** — 만료되는 signed URL을 결과물에 안 남기기 + Cache-Control
6. **React `cache()`** — 같은 요청 안에서 generateMetadata·본문이 같은 조회를 1회로
7. **OG 메타데이터** — generateMetadata, metadataBase, og:image 절대 URL, noindex
8. **`useSyncExternalStore`** — hydration-safe한 Web Share 지원 감지 + 클립보드 폴백

> Day 7이 남긴 자산 위에 그대로 올라선다: **존재 은폐(404)** 규칙(타인 리소스는 403이 아니라 404)과 **server-only 경계** 감각이 이번 Day의 뼈대다. Day 7과 다른 점은, 이번엔 **로그인하지 않은 방문자/크롤러**가 주인공이라는 것 — 인증된 사용자만 다루던 세계에서 "아무나"를 다루는 세계로 넓어진다.

---

## 1. 비인증 공유 라우트 + 존재 은폐 — "막혔다"는 사실조차 숨긴다

### 왜 필요한가? (공유는 "아무나" 보는 화면이다)

지금까지 Typolog의 모든 화면은 **로그인한 사람**만 봤다(`proxy.ts`가 비로그인을 `/login`으로 보냄). 그런데 공유는 본질이 다르다 — 카톡으로 링크를 받은 **로그인 안 한 친구**, X의 **링크 크롤러**가 봐야 한다. 그래서 `/s/[id]`와 `/api/og/[id]`는 proxy에서 **공개 경계**로 빠져 있다(인증 없이 통과).

문제는 "공개"라고 해서 **아무 제출이나** 보여선 안 된다는 것이다. 비공개로 저장한 콜라주, 아직 완성 안 한 draft, 남이 숨긴(hidden) 제출은 링크를 알아도 보이면 안 된다. 여기서 핵심 질문이 생긴다: **막혔을 때 어떻게 응답하나?**

순진한 답은 "비공개면 403 Forbidden"이다. 하지만 403은 **"이 id에 무언가는 있는데 네가 못 본다"**는 정보를 흘린다. 공격자가 id를 하나씩 넣어보며 403(존재함)과 404(없음)를 구분하면, **누가 무엇을 비공개로 올렸는지 목록을 만들 수 있다**(enumeration). 그래서 Day 3부터의 규칙은 **존재 은폐**다: 미존재·비공개·draft·hidden·잘못된 UUID를 **전부 동일한 404**로 응답한다. "그런 건 없다"고만 말한다.

### Typolog에서는?

`getSharedSubmission`이 `status='completed' AND is_public=true`가 아닌 모든 경우에 `null`을 돌려준다(`get-shared-submission.ts:50-59`). 호출부는 이 `null`을 전부 404로 변환한다:

- 페이지: `if (!shared) notFound()` (`s/[id]/page.tsx:65-67`) → `not-found.tsx`가 안내 화면 렌더
- OG: `if (!shared) return new Response('Not found', { status: 404 })` (`api/og/[id]/route.tsx:23-25`)

잘못된 형식의 id조차 미존재와 똑같이 처리한다 — `submissionIdSchema.safeParse(id)`가 실패하면 DB를 치지도 않고 `null`(`get-shared-submission.ts:34-35`). 그리고 `not-found.tsx`는 "삭제됐거나, 비공개이거나, 존재하지 않는" 셋을 **한 문장으로 뭉뚱그린다**(`not-found.tsx:12-14`) — 어떤 사유로 막혔는지 구분해 알려주지 않는 것이 존재 은폐의 마무리다.

### 비유

호텔 프런트에 "503호 김씨 계신가요?"라고 물었을 때, **빈 방이든 / 투숙 중이지만 비공개 요청한 손님이든 / 아예 없는 호수든** 똑같이 "그런 분 안 계십니다"라고만 답하는 것이다. "투숙 중이지만 안 알려드려요"라고 하면 그 사람이 거기 있다는 사실이 새어 나간다.

### #60을 잡아낸 이야기 (존재 은폐의 부수 효과)

이번 E2E에서 공유 기능이 뜻밖에 **제출 lifecycle 버그(#60)** 를 잡아냈다. 공유 링크를 열었더니 콜라주가 안 보이고 404가 떴는데 — 분명 "제출 완료"로 보였던 제출이었다. 404가 말해준 진실은 **"이 제출은 서버 상태가 `completed`+`public`이 아니다"**였다. 즉 화면에선 완료처럼 보였지만 서버 DB에는 완성 전이가 제대로 안 박힌 제출이 있었던 것이다.

여기서 배울 점: **존재 은폐는 보안 장치이면서 동시에 "서버 진실의 리트머스 시험지"** 다. `getSharedSubmission`은 화면 상태가 아니라 **DB의 실제 status/is_public**만 보고 판정하므로, 클라이언트가 뭐라고 믿든 "서버가 보기에 이 제출이 정말 공개 완성작인가"를 거짓 없이 드러낸다. 공유가 404를 띄웠다는 것 자체가 "제출 lifecycle 어딘가가 새고 있다"는 신호였다.

### 자주 하는 실수

- **비공개 리소스에 403을 돌려줌.** "권한 없음"을 친절히 알려주는 게 맞아 보이지만, 존재 자체를 노출해 enumeration을 허용한다. 비공개·미존재는 똑같이 404.
- **사유별로 다른 404 메시지.** "비공개입니다" vs "삭제되었습니다"로 구분하면 다시 정보가 샌다. `not-found.tsx`처럼 한 문장으로 묶는다.

---

## 2. 단일 가시성 소스 — 페이지와 OG가 같은 진실을 본다

### 왜 필요한가? (두 입구가 따로 판정하면 한쪽이 샌다)

공유 한 건을 보여주는 데는 **두 개의 진입점**이 있다: 사람이 보는 페이지(`/s/[id]`)와 크롤러가 가져가는 OG 이미지(`/api/og/[id]`). 만약 두 곳이 **각자** 가시성을 판정하면(페이지는 "is_public 체크", OG는 "status 체크"처럼), 미묘하게 어긋날 수 있다. 그러면 **페이지는 404인데 OG 이미지는 멀쩡히 콜라주를 그려서** 카톡 미리보기에 비공개 콜라주가 노출되는 사고가 난다. "한쪽은 막히고 한쪽은 새는" 불일치다.

해법은 **가시성 판정을 함수 하나에 모으는 것**이다. 페이지도 OG도 같은 `getSharedSubmission`만 호출하고, 그 함수가 `null`이면 둘 다 똑같이 404다. 판정 로직이 한 곳이라 **어긋날 수가 없다**.

### Typolog에서는?

`src/lib/share/get-shared-submission.ts` 하나가 "무엇을 공개 대상으로 볼지"의 **유일한 권위**다(`get-shared-submission.ts:2-3` 주석). 가시성 술어(`completed` + `is_public`)가 SQL WHERE에 직접 박혀 있고(`get-shared-submission.ts:50-56`), 페이지(`page.tsx:24, 62`)와 OG(`route.tsx:20`)와 generateMetadata(`page.tsx:24`)가 **전부 이 함수만** 부른다. 셋 중 어디서 봐도 같은 답이 나온다.

여기에 Day 3·5의 **1급 함정**이 다시 등장한다: DB는 Drizzle 직결이라 **RLS를 우회**한다. 그래서 RLS가 했어야 할 "공개 완성작만"을 **코드(WHERE 절)가 직접 강제**한다(`get-shared-submission.ts:26-28` 주석). RLS를 믿고 WHERE를 빼면 비공개·draft까지 다 새어 나온다.

### 비유

극장 입구가 정문(페이지)과 후문(OG)으로 두 개인데, 검표원을 각 문에 따로 두면 한 명이 졸 수 있다. 대신 **티켓 판독기 한 대**를 두고 두 문이 같은 판독기에 카드를 대게 하면, 판독기가 거절하는 손님은 어느 문으로도 못 들어온다.

### 자주 하는 실수

- **페이지와 OG에서 가시성 조건을 각자 복붙.** 한쪽만 고치면 둘이 어긋난다. 판정은 한 함수에.
- **RLS가 막아줄 거라 믿고 WHERE 가시성 술어 생략.** Drizzle 직결은 RLS 우회 — 코드가 막아야 한다.

---

## 3. anon 서명 경로 — 비인증 방문자는 딱 공개분만

### 왜 필요한가? (콜라주는 private 버킷에 있다)

콜라주 이미지는 `collages` private 버킷에 있다(로드맵 #5). private 버킷 파일은 URL만으론 못 열고, **signed URL**(기간 한정 입장권, 로드맵 #7)이 있어야 한다. 그런데 비인증 방문자에게 이 서명을 어떻게 발급할까? 가장 위험한 답은 "service key(전권 관리 키)로 서명해버리기"다 — 그러면 **어떤 콜라주든** 서명이 나가서, 비공개 콜라주도 링크만 알면 보이게 된다.

올바른 답은 **요청자의 권한 그대로 서명하는 것**이다. `getSharedSubmission`은 쿠키 인식 `createClient()`(`server.ts`)로 서명한다(`get-shared-submission.ts:64-67`). 비인증 방문자/크롤러는 쿠키에 JWT가 없으므로 Supabase에서 **anon role**이 된다. 그러면 Storage 정책 `collages_read_anon`(§5.2)이 작동해 **공개 완성 콜라주만** 서명을 허용한다. 비공개 콜라주를 서명하려 하면 정책이 거부해 `null`이 떨어지고, 화면은 닉네임 이니셜 폴백을 보여준다.

즉 **service key 미사용 = 최소 권한(least privilege)**. 비인증 방문자에게 필요한 정확히 그만큼의 권한(공개 완성 콜라주 읽기)만 준다.

### Typolog에서는?

```ts
// get-shared-submission.ts:64-67
const supabase = await createClient();              // 쿠키 인식 → 비인증이면 anon role
const collage_url = row.collage_image_url
  ? await createSignedUrl(supabase, 'collages', row.collage_image_url, SIGNED_URL_TTL.SHARE)
  : null;                                            // 서명 실패 시 null → 폴백
```

TTL은 `SIGNED_URL_TTL.SHARE` = **24시간**(`signed-url.ts:15`). 본인 편집용 `EDIT`(1h)보다 길다 — 공유 링크는 카톡방에 한참 떠 있다가 열릴 수 있으니, 너무 짧으면 친구가 열었을 때 이미 만료돼 깨진 이미지가 된다.

여기에 **이중 방어**가 걸려 있다: WHERE 절의 가시성 술어(§2, 코드 1차 방어)와 Storage anon 정책(§3, DB/Storage 2차 방어). 둘 중 하나가 뚫려도 다른 하나가 막는다.

### 비유

도서관에서 일반 방문증(anon)으로는 **공개 열람실 책**만 빌릴 수 있게 하는 것이다. 사서장 마스터키(service key)를 빌려주면 서고의 비공개 자료까지 다 나가버린다. 방문자에겐 방문증만 쥐여주고, 정책(열람실 규정)이 알아서 공개분만 내준다.

### 자주 하는 실수

- **service key(admin client)로 서명.** 편하지만 정책을 우회해 비공개 콜라주까지 서명이 나간다. 공유 서명은 절대 admin client로 하지 않는다(Day 4 노트의 "admin 서명 금지").
- **TTL을 너무 짧게.** 공유 링크는 지연 열람이 흔하다 — `EDIT`(1h)가 아니라 `SHARE`(24h)를 쓴다.
- **서명 실패를 에러로 처리.** `null`을 정상 폴백 경로로 다뤄야 한다(이니셜 표시). 정책 거부는 "예상된 결과"다.

---

## 4. `next/og` `ImageResponse`(Satori) — 한글을 못 그리는 엔진의 우회

### 왜 필요한가? (링크 미리보기는 이미지가 필요하다)

카톡·X·슬랙에 링크를 붙이면 뜨는 **썸네일 카드**(OG 미리보기)에는 이미지가 필요하다(`og:image`). 제출마다 콜라주가 다르니 이 이미지는 **요청 시점에 동적으로** 만들어야 한다. `next/og`의 `ImageResponse`가 이걸 해준다 — JSX를 주면 **Satori**라는 엔진이 그걸 1200×630 PNG로 렌더한다(`route.tsx:49-121`).

그런데 Satori에는 결정적 함정이 있다: **기본 폰트가 한글을 못 그린다.** Satori는 시스템 폰트가 아니라 번들된 라틴 폰트만 알아서, 한글 글리프가 전부 **두부(□□□, 빈 네모)** 로 나온다. Typolog의 문장("같은 하늘 다른 시선" 같은)은 전부 한글이라 정통으로 막힌다.

해결책은 한글 폰트를 fetch해 Satori에 먹이는 것… 이지만, 이번 Day의 결정(게이트 A 결정 2)은 더 영리하다: **이미지엔 한글을 아예 안 그린다.**

### 우회 전략: 역할을 나눈다

- **OG 이미지** = 콜라주(글자 사진들) + 라틴 "Typolog" 브랜딩만 그린다(`route.tsx:97-109`). 콜라주 자체가 이미 "문장의 시각화"라 한글 텍스트가 없어도 충분하다.
- **한글 문장·닉네임** = OG **메타태그**(`og:title`, `og:description`)에 싣는다(`page.tsx:40-46`). 카톡/X가 이 텍스트를 **자기 네이티브 폰트로** 카드 제목·설명에 렌더하므로 한글이 정상으로 나온다.

즉 "이미지로 그려야 하는 것"과 "플랫폼이 그려주는 것"을 나눠서, Satori가 못 하는 한글 렌더링을 **플랫폼에 떠넘긴 것**이다. 폰트 로딩 비용도 0이 된다.

### Typolog에서는?

`route.tsx:14-17` 주석이 이 결정을 명시한다. 이미지는 콜라주 + "Typolog" 글자만(`route.tsx:108`), 한글 문장은 `page.tsx`의 `openGraph.title: shared.sentence`(`page.tsx:41`)로 간다. 콜라주가 없으면(서명 실패) "T" 한 글자 브랜드 폴백을 그린다(`route.tsx:78-94`) — 닉네임 이니셜 대신 브랜드 글자를 쓰는 FeedCard 폴백 철학과 같다.

`runtime = 'nodejs'`(`route.tsx:6`)인 이유: Satori와 Drizzle 조회가 모두 Node 전용이라 엣지 런타임 추론을 막아야 한다.

### 비유

해외 택배 송장에 한글 주소를 손글씨로 쓰면 현지 분류기가 못 읽는다(두부). 대신 **그림(콜라주)은 상자에 붙이고, 한글 주소는 송장의 "비고란"(메타태그)에 적어** 현지 직원(카톡/X)이 자기 글씨로 옮겨 적게 하는 것이다.

### 자주 하는 실수

- **Satori에 한글 텍스트를 그냥 넣고 로컬에서 잘 나온다고 안심.** 로컬 폰트가 우연히 먹혔을 뿐, 배포 환경(Satori 번들 폰트)에선 전부 두부가 된다. 이미지엔 라틴만, 한글은 메타태그로.
- **`runtime` 미지정.** Drizzle/Satori가 엣지로 추론되면 빌드/런타임 에러. `nodejs` 명시.

---

## 5. data-URI 임베드 — 만료되는 URL을 결과물에 안 남긴다

### 왜 필요한가? (signed URL을 이미지에 박으면 24시간 뒤 깨진다)

OG 이미지에 콜라주를 넣는 가장 쉬운 방법은 `<img src={signedUrl} />`로 Satori가 그 URL을 fetch하게 하는 것이다. 하지만 두 가지 문제가 있다:

1. **만료**: signed URL은 24시간 후 만료된다(§3). 그런데 OG 이미지 응답은 CDN에 **하루 캐시**된다(`route.tsx:118`). 캐시된 PNG 안에 박힌 URL이 만료되면? Satori가 다시 그릴 땐 깨진 이미지가 된다. (PNG는 이미 픽셀로 구워졌으니 실제론 안 깨지지만, 재생성 시점에 문제.)
2. **결정론·노출**: Satori가 원격 URL을 fetch하는 동작은 네트워크에 의존해 불안정하고, 무엇보다 **만료되는 signed URL의 흔적**을 렌더 파이프라인에 남긴다.

해법은 **콜라주 바이트를 미리 fetch해서 data-URI(`data:image/png;base64,...`)로 이미지 안에 직접 박는 것**이다(`route.tsx:27-47`). 이렇게 하면 PNG가 자기 안에 픽셀을 **완결적으로** 담아서, signed URL 만료와 **무관**해진다. URL이 결과물에 안 남으니 캐시도 길게 걸 수 있다.

### Typolog에서는?

```ts
// route.tsx:30-47 (요약)
const res = await fetch(shared.collage_url);          // signed URL로 바이트만 가져옴
const buf = Buffer.from(await res.arrayBuffer());
const contentType = rawType.startsWith('image/') ? rawType : 'image/png';  // 화이트리스트
if (buf.byteLength <= 4 * 1024 * 1024) {              // 4MB 상한 (base64 헤드룸 포함)
  collageDataUri = `data:${contentType};base64,${buf.toString('base64')}`;
}
```

방어가 두 겹 더 있다(Reviewer 지적): content-type을 `image/*` **화이트리스트**로 강제(아니면 png 폴백)하고, 크기를 **4MB 상한**으로 묶는다 — `next/og`의 메모리 사용을 예측 가능하게 만들고 비정상 응답을 "T" 폴백으로 흘리기 위해서다. fetch 실패 시 `catch`로 `null` → 브랜드 폴백(`route.tsx:44-46`).

**Cache-Control**이 이 전략을 완성한다(`route.tsx:118`):
```
public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800
```
- `max-age=3600`: 브라우저는 1시간 캐시
- `s-maxage=86400`: CDN은 하루 캐시
- `stale-while-revalidate=604800`: 그 뒤 일주일간은 낡은 이미지를 즉시 주면서 백그라운드로 갱신

콜라주를 바이트로 구워 넣었으니 24h signed URL 만료와 무관 → 이렇게 길게 캐시해도 안전하다.

### 비유

손님에게 "이 그림은 저쪽 갤러리 가서 보세요(signed URL)"라고 임시 관람권을 주는 대신, **그림을 사진으로 찍어 엽서(data-URI)에 인쇄해서 손에 쥐여주는 것**이다. 갤러리 관람권이 만료돼도 엽서 속 그림은 그대로 남는다.

### 자주 하는 실수

- **OG 이미지에 signed URL을 직접 박음.** 만료·재서명 문제가 생기고 URL이 결과물에 남는다. 바이트를 data-URI로 임베드한다.
- **외부에서 가져온 바이트를 크기·타입 검증 없이 사용.** content-type 화이트리스트 + 크기 상한으로 메모리·악성 응답을 방어한다.
- **data-URI를 박았는데 Cache-Control을 안 검.** 매 요청마다 재렌더하면 비싸다. 결과물이 자기완결적이니 길게 캐시한다.

---

## 6. React `cache()` — 한 요청 안에서 같은 조회를 1회로

### 왜 필요한가? (페이지 한 번 여는 데 같은 함수가 두 번 불린다)

`/s/[id]` 페이지가 렌더될 때, Next.js는 같은 요청에서 `getSharedSubmission(id)`를 **두 번** 부른다:

1. `generateMetadata`가 OG 메타태그(제목·설명)를 만들려고 한 번(`page.tsx:24`)
2. 페이지 본문(`SharePage`)이 콜라주를 그리려고 한 번(`page.tsx:62`)

순진하게 두면 **같은 id로 DB를 두 번 조회**하고, **콜라주 서명도 두 번** 한다. 같은 요청에서 결과가 똑같을 게 뻔한데 두 번 일하는 낭비다.

React의 `cache()`가 이걸 막는다 — 함수를 `cache()`로 감싸면 **같은 요청 안에서 같은 인자**로 부른 호출은 **첫 결과를 메모이즈**해서 재사용한다(요청 단위 메모이제이션). 같은 id면 두 번째 호출은 DB·서명을 안 하고 캐시된 값을 즉시 돌려준다.

### Typolog에서는?

```ts
// get-shared-submission.ts:32
export const getSharedSubmission = cache(async (id: string) => { ... });
```

`cache()`로 감싸서, generateMetadata와 본문이 같은 id로 불러도 **DB 조회 1회·서명 1회**로 줄인다(`get-shared-submission.ts:30-31` 주석). 주의할 점: 이 메모이제이션은 **요청 단위**다 — 다른 방문자의 다른 요청까지 캐시를 공유하진 않는다(그건 §5의 Cache-Control이 담당하는 다른 층위). `cache()`는 "한 요청 안의 중복 제거", Cache-Control은 "요청 간 CDN 캐시"로 역할이 다르다.

### 비유

식당에서 한 테이블(한 요청)이 같은 메뉴를 두 사람이 시키면, 주방이 한 번 만들어 나눠 내는 것이다(요청 내 중복 제거). 다른 테이블(다른 요청)에는 새로 만든다. 미리 대량으로 만들어 창고에 쌓아두는 것(CDN 캐시)과는 다른 종류의 절약이다.

### 자주 하는 실수

- **`cache()`를 "전역 캐시"로 오해.** 요청 단위다 — 사용자 A의 결과를 B가 받지 않는다. 다행히 그래서 가시성 누수도 없다.
- **`cache()`를 안 쓰고 generateMetadata와 본문에서 따로 조회.** 같은 요청에서 DB·서명을 두 번 한다(특히 서명은 Storage 왕복이라 아깝다).

---

## 7. OG 메타데이터 — 절대 URL과 noindex의 디테일

### 왜 필요한가? (크롤러는 origin을 모른다)

generateMetadata가 만드는 `openGraph`/`twitter` 메타태그는 크롤러용 설명서다(`page.tsx:36-53`). 여기서 두 가지 디테일이 중요하다:

**① og:image는 절대 URL이어야 한다.** 크롤러는 페이지를 받아 `og:image`를 보고 **별도 요청으로** 이미지를 가져간다. 이때 `/api/og/123` 같은 상대 경로만 주면 크롤러는 어느 도메인의 것인지 모른다. 그래서 `metadataBase: new URL(APP_URL)`을 설정하면(`page.tsx:37`) Next.js가 상대 경로를 **절대 URL로 자동 변환**한다. `APP_URL`은 `NEXT_PUBLIC_APP_URL` 환경변수에서 온다(`page.tsx:11`).

**② 비공개·미존재면 noindex + og:image 미포함.** `getSharedSubmission`이 `null`이면 generateMetadata는 `{ title: 'Typolog', robots: { index: false, follow: false } }`만 돌려준다(`page.tsx:27-29`) — **og:image를 아예 안 넣고** 검색엔진 색인도 막는다. 존재 은폐(§1)를 메타태그 층위에서도 지키는 것이다. 비공개 제출의 미리보기가 크롤러에 노출되거나 검색에 잡히면 안 되니까.

### Typolog에서는?

- `metadataBase`(`page.tsx:37`) + 상대 경로 `ogImage = '/api/og/...'`(`page.tsx:33`) → 자동 절대화
- `openGraph.url: '/s/${id}'`, `type: 'article'`, `images: [{ url, width: 1200, height: 630 }]`(`page.tsx:43-45`)
- `twitter.card: 'summary_large_image'`(`page.tsx:48`) — 큰 이미지 카드
- 닉네임 설명: `${shared.nickname}님이 완성한 글자 콜라주 · Typolog`(`page.tsx:34`)
- null일 때 noindex(`page.tsx:27-29`)

### 비유

og:image 절대 URL은 명함에 "회사 건물(이미지)은 여기서 세 번째 골목"이라고 쓰는 대신 **전체 주소(절대 URL)** 를 적는 것이다. 명함을 받은 사람(크롤러)이 내 동네를 모르기 때문이다. noindex는 비공개 행사를 "검색에 올리지 마세요" 표시하는 것.

### 자주 하는 실수

- **og:image를 상대 경로로 두고 metadataBase 미설정.** 크롤러가 이미지를 못 찾아 미리보기가 빈다.
- **null(비공개)일 때도 og:image를 포함.** 비공개 콜라주 미리보기가 새거나 검색에 색인된다. null이면 og:image 빼고 noindex.

---

## 8. `useSyncExternalStore` — hydration-safe한 Web Share 감지 + 폴백

### 왜 필요한가? (서버는 navigator를 모른다)

모바일에서 "공유하기"를 누르면 OS 공유 시트(카톡·메시지·...)가 뜨는 게 Web Share API(`navigator.share`)다. 그런데 이건 **모바일 일부 브라우저에만** 있다 — 데스크톱 크롬엔 없다. 그래서 "지원하면 네이티브 공유 버튼을, 아니면 링크 복사만" 보여야 한다.

문제는 **이걸 어떻게 감지하느냐**다. 서버 렌더링(SSR) 시점엔 `navigator`가 없다(브라우저 객체). 순진하게 `useEffect`에서 `setState`로 감지하면, **초기 클라 렌더와 서버 렌더가 다른 HTML**을 만들어 **hydration mismatch** 경고가 난다(서버는 "버튼 없음", 클라는 잠깐 "버튼 없음"이었다가 effect 후 "버튼 있음"으로 깜빡).

`useSyncExternalStore`가 이걸 깔끔히 푼다 — **서버 스냅샷**과 **클라이언트 스냅샷**을 따로 줄 수 있어서, hydration 동안엔 둘이 일치하게 만들 수 있다.

### Typolog에서는?

```ts
// ShareActions.tsx:11-18
const noopSubscribe = () => () => {}                  // 구독 안 함 (지원 여부는 안 바뀜)
function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',  // 클라 스냅샷
    () => false,                                       // 서버 스냅샷: 항상 false
  )
}
```

- **서버 스냅샷 = `false`**: SSR과 초기 hydration에선 "지원 안 함"으로 시작 → 서버 HTML과 일치 → mismatch 없음
- **클라 스냅샷**: 마운트 후 실제 `navigator.share` 존재 여부로 갱신
- `noopSubscribe`: `navigator.share` 지원 여부는 런타임 중 안 바뀌므로 구독은 no-op (`ShareActions.tsx:8-10` 주석)

이렇게 effect 안 `setState` 없이 hydration-safe하게 지원 여부를 읽는다. 지원하면 "공유하기" 버튼을 추가로 보여주고(`ShareActions.tsx:50-54`), 안 하면 "링크 복사"만 보여준다(항상 표시).

### 클립보드 폴백 + 인라인 피드백

링크 복사는 `navigator.clipboard.writeText`로 하고(`ShareActions.tsx:30`), 성공하면 버튼 라벨이 **"✓ 복사됨!"으로 2초간** 바뀐다(`ShareActions.tsx:31-32, 62`). 토스트 같은 별도 UI 없이 **인라인 피드백**(게이트 A 결정). 접근성을 위해 `aria-live="polite"` 영역으로 스크린리더에도 "링크가 복사되었습니다"를 알린다(`ShareActions.tsx:67-69`).

에러 처리가 **조용한 무시**인 점이 핵심이다:
- 클립보드 거부(권한·비보안 컨텍스트): clipboard API는 https/localhost에서만 동작 → `catch`로 조용히 무시(`ShareActions.tsx:33-35`)
- 네이티브 공유 취소: 사용자가 공유 시트를 닫으면 `AbortError` → 조용히 무시(폴백 복사 안 함)(`ShareActions.tsx:41-43`)

"나도 만들기" CTA는 `/`로 보내고(`ShareActions.tsx:72-74`), proxy가 비로그인은 `/login`으로·로그인은 오늘 챌린지로 자동 분기한다.

### 비유

`useSyncExternalStore`의 서버 스냅샷 `false`는 **"확실해질 때까지 일단 없다고 친다"** 는 보수적 출발이다. 면접장에서 "특기 있으세요?"에 일단 "없습니다"로 시작했다가(서버), 자리에 앉고 나서야(마운트) "사실 피아노 칩니다"(클라)라고 정정하는 것 — 첫 인상(HTML)이 어긋나지 않게.

### 자주 하는 실수

- **`useEffect`+`setState`로 브라우저 기능 감지.** 서버/초기 클라 렌더가 어긋나 hydration mismatch. `useSyncExternalStore`로 서버 스냅샷을 명시한다.
- **클립보드/공유 실패를 에러 UI로.** 사용자 취소(AbortError)·비보안 컨텍스트는 정상 흐름이다 — 조용히 무시.
- **공유 시트 취소 시 클립보드로 폴백.** 사용자가 일부러 닫은 건데 멋대로 복사하면 거슬린다. 취소는 그냥 둔다.

---

## #51 보너스 — 제출 후 막다른 길 방지(피드 동선)

이번 Day엔 작은 UX 수선도 들어갔다(#51). 제출 완료 화면에 **"피드 보러가기"** 링크를 추가했다(`CollagePreviewClient.tsx:471-477`). 그전엔 제출 후 화면이 막다른 길이라 사용자가 "이제 뭐 하지?" 상태였다. 공유(이번 Day의 본 주제)와 함께 **"완성 → 공유하거나 피드로"** 라는 자연스러운 다음 동선을 깐 것이다. 공유 페이지의 "나도 만들기" CTA(`ShareActions.tsx:72`)와 짝을 이뤄, 만든 사람도 본 사람도 막다른 길에 안 빠지게 한다.

---

## 자주 하는 실수 모음

| 실수 | 무슨 일이 벌어지나 | 올바른 방법 |
|------|-------------------|------------|
| **비공개 리소스에 403** | 존재가 노출돼 enumeration | 미존재·비공개·draft 전부 404(존재 은폐) |
| **페이지·OG가 가시성 따로 판정** | 한쪽 막히고 한쪽 새는 불일치 | 단일 소스 `getSharedSubmission` 공유 |
| **RLS 믿고 WHERE 가시성 생략** | Drizzle 직결 RLS 우회로 비공개 누수 | 코드가 `completed`+`public` 직접 강제 |
| **service key로 공유 서명** | 정책 우회해 비공개 콜라주까지 서명 | 쿠키 인식 client(anon) + Storage 정책 |
| **공유 TTL을 1h로** | 지연 열람 시 깨진 이미지 | `SHARE`(24h) 사용 |
| **Satori에 한글 직접 그림** | 배포 환경에서 전부 두부(□□□) | 이미지엔 라틴만, 한글은 메타태그로 |
| **OG에 signed URL 직접 박음** | 만료·재서명·URL 노출 | 바이트 fetch → data-URI 임베드 |
| **외부 바이트 검증 없이 임베드** | 메모리 폭증·악성 응답 | content-type 화이트리스트 + 4MB 상한 |
| **generateMetadata·본문 따로 조회** | 같은 요청에서 DB·서명 2회 | `cache()`로 요청 단위 메모이즈 |
| **og:image 상대 경로 + metadataBase 누락** | 크롤러가 이미지 못 찾음 | metadataBase로 절대 URL 자동화 |
| **null일 때 og:image 포함** | 비공개 미리보기 누수·검색 색인 | null이면 og:image 빼고 noindex |
| **`useEffect`+`setState`로 기능 감지** | hydration mismatch 깜빡임 | `useSyncExternalStore` 서버 스냅샷 false |
| **공유 취소를 에러로 처리하거나 폴백** | 사용자 의도 무시·거슬림 | AbortError·비보안은 조용히 무시 |

---

## Day 9(마이페이지·프로필)로 가는 다리

Day 9는 `updateSubmissionVisibility`(공개/비공개 토글)와 `updateProfile`(닉네임·아바타 수정)을 만든다. Day 8이 깔아둔 선행 개념이 그대로 발판이 된다:

### ① 가시성은 이미 "단일 진실"로 모여 있다 → 토글은 그 진실을 바꾸는 일

Day 8의 `getSharedSubmission`은 `is_public`을 **읽는** 단일 소스였다. Day 9의 `updateSubmissionVisibility`는 그 `is_public`을 **쓰는** 쪽이다. 둘이 같은 컬럼을 보므로, **공개로 토글하면 즉시 공유 가능해지고 비공개로 토글하면 즉시 공유 404**가 된다 — Day 8의 존재 은폐가 Day 9 토글의 즉각적인 효과로 이어진다. 토글 자체는 Day 7에서 확립한 **Server Action + 낙관적 업데이트** 패턴을 재사용한다(로드맵 #3 표: visibility 토글도 Server Action 후보).

### ② anon 서명 경로 ↔ 본인 서명 경로의 대비

Day 8은 **anon(비인증)** 방문자에게 공개분만 서명했다. Day 9의 마이페이지는 **본인**이 자기 비공개 제출까지 본다 — 같은 콜라주라도 **"누구 권한으로 서명하느냐"** 에 따라 보이는 범위가 다르다는 §3의 감각이 그대로 확장된다. anon은 공개분만, 본인 JWT는 본인 전체.

### ③ 아바타 = public 버킷 (Day 8 콜라주 = private의 대비)

`updateProfile`의 아바타는 `avatars` **public 버킷**(로드맵 #5)이라 signed URL이 필요 없다 — Day 8 내내 다룬 "private + signed URL" 흐름과 **반대 케이스**다. "왜 어떤 건 서명하고 어떤 건 public URL인가"를 Day 8(private 콜라주)·Day 9(public 아바타) 대비로 체득한다.

### ④ 클라 상태 사용자 경계(직전 fix와 연결)

`updateProfile`로 닉네임이 바뀌면, Day 7~fix에서 다룬 **TanStack 캐시 무효화**가 필요하다 — 피드·공유에 박힌 옛 닉네임을 갱신해야 한다. `fix-logout-draft-leak.md`의 "서버 캐시는 invalidate로 비운다"가 여기서 다시 쓰인다.

비유: Day 8이 "완성작을 남에게 보여주는 창문"을 달았다면, Day 9는 **"그 창문의 블라인드를 내가 직접 올리고 내리는 스위치(visibility 토글)"** 와 **"창문 옆에 건 내 명패(프로필)"** 를 만드는 일이다. 창문(공유)이 이미 단일 진실을 보고 있으니, 스위치만 달면 즉시 연동된다.

---

## 핵심 한 장 요약

- **존재 은폐(404)**: 미존재·비공개·draft·잘못된 id를 전부 동일 404로 — 비공개의 "존재"조차 숨긴다. 부수 효과로 #60(제출 lifecycle 버그)을 잡아냈다(404 = "서버가 보기엔 공개 완성작이 아님").
- **단일 가시성 소스** `getSharedSubmission`: 페이지·OG·generateMetadata가 같은 함수만 봐서 "한쪽은 보이고 한쪽은 막히는" 불일치를 원천 차단. Drizzle 직결 RLS 우회라 가시성 술어를 WHERE에 코드로 강제.
- **anon 서명**: 쿠키 인식 client가 비인증 방문자를 anon role로 → `collages_read_anon`이 공개 완성 콜라주만 서명(최소 권한, service key 미사용). `SHARE` TTL 24h.
- **`next/og`(Satori)**: 한글 미지원(두부) → 이미지엔 콜라주+라틴 "Typolog"만, 한글 문장·닉네임은 메타태그로(플랫폼 네이티브 렌더). 콜라주는 바이트 fetch → **data-URI 임베드**로 만료 signed URL을 결과물에 안 남김 + content-type 화이트리스트·4MB 상한 + 길게 Cache-Control.
- **React `cache()`**: generateMetadata·본문이 같은 요청 같은 id로 두 번 호출 → 요청 단위 메모이즈로 DB·서명 1회.
- **OG 메타데이터**: metadataBase로 og:image 절대 URL 자동화, 비공개/미존재 시 og:image 미포함 + noindex.
- **`useSyncExternalStore`**: 서버 스냅샷 false로 hydration-safe하게 Web Share 지원 감지(effect+setState 회피). 클립보드 폴백 + 인라인 "복사됨!" 피드백 + AbortError 조용히 무시.

---

## 참고

- 코드: `src/lib/share/get-shared-submission.ts`(단일 가시성 소스·cache·anon 서명), `src/app/api/og/[id]/route.tsx`(ImageResponse·data-URI·Cache-Control), `src/app/s/[id]/page.tsx`(generateMetadata·존재 은폐), `src/features/share/ShareActions.tsx`(useSyncExternalStore·Web Share·클립보드), `src/app/s/[id]/not-found.tsx`(사유 미구분 404 화면), `src/features/compose/CollagePreviewClient.tsx:471-477`(#51 피드 동선), `src/lib/storage/signed-url.ts`(`SIGNED_URL_TTL.SHARE`), `src/lib/supabase/server.ts`(쿠키 인식 anon client)
- 설계: `docs/backend-design-plan.md` §5.2(collages_read_anon)·§6.1(A8 OG)·§7.4(존재 은폐)·§9 Day 8
- 선행 노트: `docs/learning/phase-3-day-7.md`(Server Action·존재 은폐 토대), `docs/learning/fix-logout-draft-leak.md`(클라 상태 사용자 경계·캐시 무효화), `docs/learning/phase-2-day-4.md`(Signed URL·TTL 프리셋·admin 서명 금지), `docs/learning/phase-2-day-3.md`(404 존재 은폐·검사 순서)
</content>
</invoke>
