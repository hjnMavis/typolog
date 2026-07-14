# Phase 3 Day 10.5 QA 리뷰 — 마무리 검수 (Day 10 이관 결함·개선 일괄 처리)

> 검증일: 2026-07-13
> 검증자: QA Agent
> 기준 브랜치: worktree-phase3-day105-inspection (base: origin/main `8a7f3c7`, Day 10 PR #79 머지 반영)
> 비교 기준: `git diff origin/main` — 워크트리 로컬 `main` ref는 stale(`874eaae`, Phase 2 이전)이므로 Day 10 QA L1 교훈대로 전 구간 `origin/main` 기준으로 검증했다 (`git rev-parse main origin/main HEAD` 확인 완료).
> 검증 방식: 정적 리뷰(코드·마이그레이션·GitHub 이슈 대조) + 실제 실행 검증(lint/type-check/test:run, verify-rls.ts, measure-perf.ts). `.env.local`은 Read/cat/grep/node 어떤 방법으로도 읽지 않았다 — presence boolean만 확인.

---

## 0. 범위 대조 — #73 체크리스트 vs 실제 diff

`git diff origin/main --stat` (15 tracked + 6 untracked = 21 files):

```
CLAUDE.md · docs/backend-design-plan.md · docs/verification/phase3-integration.md
scripts/verify-rls.ts · scripts/profile-collage-upload.ts(신규)
src/app/api/submissions/[id]/collage/route.ts
src/db/schema.ts · src/db/migrations/0005_same_phil_sheldon.sql(신규)
src/db/migrations/0006_collages_allow_owner_update.sql(신규) · meta/*(신규 snapshot 2 + journal)
src/features/challenge/CaptureClient.tsx
src/features/compose/CollagePreviewClient.tsx · submit-collage.ts
src/features/feed/ReportDialog.tsx
src/features/profile/MySubmissionCard.tsx
src/hooks/use-submission.ts
src/lib/actions/reports.ts
tests/unit/submit-collage.test.ts(대폭 수정) · tests/unit/use-submission.test.ts(신규)
```

과제 지시서의 "[변경 파일]" 목록과 1:1 일치. `day10.5-kickoff.md`는 untracked·커밋 금지 문서로 확인됨(규칙 준수).

이슈 #74·#76·#77·#78·#48·#50·#80 전부 코드 변경으로 확인되며, #40-B는 `CaptureClient.tsx`의 restore race 가드로 해결됨을 확인했다(§2-3).

---

## 1. 실행 검증 결과

| 명령 | 결과 | 상세 |
|------|------|------|
| `pnpm lint` | **PASS** (exit 0) | 경고·오류 0건 |
| `pnpm type-check` | **PASS** (exit 0) | 오류 0건. `CreateReportResult` 유니언에 `REPORT_ALREADY_EXISTS` 추가 후 `resultMessage`의 exhaustive switch가 컴파일 타임에 누락을 강제하는 것도 확인 |
| `pnpm test:run` | **PASS** | 15 파일 / **186 테스트** 전원 통과 (기대치 186 일치). Day 10 기준(182) 대비 +4 = `use-submission.test.ts` 신규 2건 + `submit-collage.test.ts` 5→7건(+2, cap 검증·부분 실패 재시도 신규 — 재시도 실패 전파 테스트는 기존 순차 테스트를 대체) |
| `pnpm dlx tsx scripts/verify-rls.ts` | **PASS 39/39** | 기대치 39 정확히 일치. 신규 프로브 3종 전부 PASS: `reports[중복]` UNIQUE 23505 차단 / `collages[#80]` 본인 덮어쓰기 허용 / `collages[#80]` 타인 덮어쓰기 차단. **이 결과로 마이그레이션 0005·0006이 실제로 적용돼 있음을 실측 확인**(지시서의 "미적용 정황 시 보류" 조건 미해당 — 라이브 실행 검증 정상 진행) |
| `pnpm dlx tsx scripts/measure-perf.ts` | **PASS (자릿수 유지)** | Q1 p50 20.9/p95 23.8ms (Day10: 17.3/25.4) · Q2+Q3 p50 20.8/p95 94.5ms (Day10: 17.3/76.7) — 동일 자릿수, 회귀 없음. Storage 고아 0/0 유지(letter-pieces 62개·collages 15개, Day10 대비 개수 증가는 정상 사용 누적으로 판단 — 고아 0건이 핵심) |
| `pnpm drizzle-kit check` | **PASS** | "Everything's fine" — schema.ts ↔ 마이그레이션 정합 |
| `pnpm drizzle-kit generate`(드라이런) | **PASS** | "No schema changes, nothing to migrate" — 스키마·마이그레이션 드리프트 없음 확인(생성된 파일 없음, 되돌릴 것 없음) |

`scripts/profile-collage-upload.ts`는 지시대로 **재실행하지 않고 정적 리뷰만** 수행(§2-8).

---

## 2. 이슈별 정적 검토

### 2-1. #74 — 제출 완성 후 `['feed']` invalidate (테스트 우선 확인)

`src/hooks/use-submission.ts:60-62`에 `invalidateQueries({ queryKey: ['feed'] })` 1줄 추가. `tests/unit/use-submission.test.ts`가 **테스트 우선**(TDD)으로 작성돼 있고 두 케이스(성공 시 3키 invalidate / 실패 시 0회)를 고정한다. `docs/verification/phase3-integration.md` §2 "제출 완성(A4)" 행도 "invalidate" + 테스트 참조로 갱신됨 — 요청하신 갱신 정합성 확인 완료.

**판정: PASS.**

### 2-2. #78 — 수집 화면 확정 리다이렉트 + 로컬 슬롯·IDB 정리

- `CaptureClient.tsx:31-53`: `useMySubmissions()`로 오늘 챌린지의 완성 여부를 조회 → 완성이면 `router.replace(preview)`, 완성 여부 확인 전/완성 시엔 `TodayChallengeGate`(따라서 `CaptureView`)를 아예 마운트하지 않아 슬롯 편집 UI가 잠깐이라도 노출되지 않는다. 조회 실패 시 fail-open(수집 화면 진행) — 서버가 재제출을 멱등 차단(#60-B)하므로 안전.
- `CollagePreviewClient.tsx:112-129`: 확정 상태 진입 시(`submittedId` 없고 `completedItem` 있음) 로컬 슬롯 메타를 `resetDraft()`로 먼저 비우고 IDB Blob을 `deleteImageBlobs()`로 정리(fire-and-forget, 실패해도 메타가 비었으므로 화면 노출 없음). `store.challengeId !== challenge.id` 가드로 다른 챌린지 draft를 건드리지 않음.
- 두 화면이 짝을 이뤄 "완성 후에도 편집되는 것처럼 보이는" F-3의 뿌리(로컬 draft 잔존)를 제거한다는 설계 의도와 코드가 일치한다.

**판정: PASS** — 단, §3-1(리스크)에 성능 관찰 사항 기록.

### 2-3. #40-B — restore stale 스냅샷 가드

`CaptureClient.tsx:107-136`의 `restore()`는 시작 시점 슬롯 스냅샷을 순회하며 각 슬롯마다 `await getImageBlob(...)`이 있어, 대기 중 사용자가 같은 슬롯을 교체·리셋할 수 있는 창이 있다. 추가된 가드(120-125행):

```ts
const current = useChallengeStore.getState().slots.find((s) => s.index === slot.index)
if (!current || current.imageKey !== slot.imageKey || current.imageDataUrl) {
  continue
}
```

- **교체 케이스**: `imageKey` 스킴이 `${challengeId}:${slotIndex}`로 슬롯마다 고정이라 교체해도 키는 같다 → `current.imageKey !== slot.imageKey`는 걸러내지 못하지만, 교체가 완료되면 `fillSlot`이 `imageDataUrl`을 이미 채우므로 세 번째 조건(`current.imageDataUrl` truthy)이 정확히 걸러낸다.
- **리셋 케이스**: `resetDraft()`가 슬롯을 `emptySlot`(imageKey=null)으로 되돌리므로 두 번째 조건이 걸러낸다.
- 가드가 **Object URL 생성 이전**에 위치해 stale 복원이 URL을 만들고 나서 map에서 밀려나 revoke 경로를 잃는(메모리 누수) 경로 자체를 차단한다.

이 판단은 코드 추적으로 검증했다(경합 자체를 실제로 트리거하는 자동화 테스트는 없음 — §3-2 리스크 참조).

**판정: PASS(로직 정확) — 회귀 테스트 부재는 리스크로 기록.**

### 2-4. #76 — 신고 트리거 아이콘 (⋯ → Flag)

`ReportDialog.tsx`: `<span aria-hidden>⋯</span>` → `<Flag className="size-4" aria-hidden="true" />` (lucide-react, 기존 의존성 재사용 — 신규 패키지 없음). `aria-label`(`"${nickname}의 콜라주 신고"`)은 그대로 유지돼 접근성 라벨은 변경 없음. 버튼 패딩을 `px-1`→`p-1`로 바꿔 아이콘 중심 정렬.

**판정: PASS.**

### 2-5. #77 — 마이 카드 탭 확대 라이트박스

`MySubmissionCard.tsx`: `Dialog`/`DialogTrigger`(render prop, `ReportDialog`와 동일 패턴)로 카드 이미지를 감싸 탭 시 확대 모달. `/api/me/submissions`가 이미 내려주는 본인 서명 URL(`collage_url`)을 그대로 재사용 — 추가 API 없음(설계 의도와 일치). `DialogContent`가 기본 `showCloseButton=true`라 X 버튼·backdrop 탭·ESC로 닫힌다(코드 확인, `components/ui/dialog.tsx:39-73`). 배지(`pointer-events-none` 추가)가 탭을 가로채지 않도록 수정된 것도 확인 — 오버레이 회귀 방지가 잘 처리됨.

**판정: PASS.**

### 2-6. #48 — reports UNIQUE + 중복 처리

- `schema.ts`: `unique('reports_reporter_submission_unique').on(reporter_id, submission_id)` 추가.
- `0005_same_phil_sheldon.sql`: 중복 쌍에서 **가장 오래된 행만 남기는 결정적 DELETE**(`created_at` 오름차순, 동시각이면 `id` 오름차순) → 같은 트랜잭션에서 `ADD CONSTRAINT UNIQUE`. 선정리→제약이 원자적이라 그 사이 새 중복이 끼어들 경합이 없다는 설계 근거가 SQL과 일치.
- `reports.ts`: `.onConflictDoNothing({ target: [...] }).returning(...)` → 0행이면 `REPORT_ALREADY_EXISTS`. "확인 후 삽입"이 아니라 삽입 자체가 원자적으로 충돌을 감지하므로 동시 요청에도 정확히 1건만 적재된다.
- `ReportDialog.tsx`: `REPORT_ALREADY_EXISTS` → "이미 신고한 글이에요." 매핑.
- `verify-rls.ts`: 같은 (reporter, submission) 2회 INSERT → 둘째가 `23505`(unique_violation)인지 프로브 추가, **라이브에서 PASS 확인**(§1).

**판정: PASS — 라이브 검증까지 완료.**

### 2-7. #50 — 프로파일링 + 조건부 병렬화

- `scripts/profile-collage-upload.ts`(신규, 정적 리뷰): verify-rls와 동일한 자체 정리형 패턴(테스트 계정 생성 → draft 제출 → 실 JWT 로그인 → 콜드1+웜N 측정 → `finally`에서 Storage 객체·제출 행·계정 순 삭제). Secret은 presence boolean만 출력. 읽기 전용이 아니라 쓰기(Storage 업로드, DB UPDATE)를 수행하지만 자체 정리로 순 변화 0을 보장하는 설계 — 지시대로 **재실행하지 않음**.
- 실측 결과(문서에 기록됨, §5 아래): 웜 업로드 p50 164ms — Day 10의 10.6s와 40~60배 괴리 → A6는 이상치로 판명. 이 판단 근거가 합리적이다(dev 서버 첫 컴파일+커넥션 웜업 중첩 가설과 A5 글자1의 3,995ms 콜드가 같은 패턴이라는 교차 근거도 있음).
- `submit-collage.ts`: 워커 풀(cap 3, `LETTER_UPLOAD_CONCURRENCY`)로 병렬 업로드. 1차 배치는 실패를 모아 계속 진행(`collectFailures: true`), 실패분만 재시도(`collectFailures: false` — 재실패 시 즉시 throw). `runBatch`가 클로저로 잡은 `onLetterDone`을 재시도 배치에서도 그대로 호출하므로 재시도 성공분도 진행 카운트에 정확히 반영된다. `Promise.all(workers)`가 각 워커 프라미스에 핸들러를 붙이므로 하나가 reject해도 나머지 워커의 미처리(unhandled) rejection이 발생하지 않는다(코드 추적으로 확인).
- `tests/unit/submit-collage.test.ts`: cap 준수(동시 in-flight ≤3, 실제 병렬 확인) / 진행 콜백 완료 누적(0→N) / 부분 실패→재시도 성공(호출 수로 재시도 1회 검증) / 재시도까지 실패 시 에러 전파 + 후속 단계 미실행 — 4개 시나리오 모두 실행·통과 확인.
- `collage/route.ts`: Server-Timing 헤더가 인증+소유권 검증 **이후**에만 응답에 실리므로 정보 노출 위험 없음(코드 순서 확인). 실패 경로(에러 응답)에는 헤더가 없음 — 진단 목적상 문제 없음.

**판정: PASS.**

### 2-8. #80 — collages UPDATE 정책 부재 (신규 발견, High → 즉시 수정)

- `0006_collages_allow_owner_update.sql`: `letter_pieces_update`(0003 §5.1)와 동일 패턴으로 `collages_update` UPDATE 정책 추가. `docs/backend-design-plan.md` §5.2에도 동기화됨.
- `verify-rls.ts`: 본인 같은 path 재업로드 허용 + 타인 덮어쓰기 차단, 2개 프로브 추가 — **라이브 PASS 확인**(§1).
- 발견 경위(프로파일링 중 실측: 콜드 성공, 웜 upsert 실패)와 영향 분석("A6 성공 후 어떤 후속 실패든 재시도가 영구 불능")이 타당하고, 기존 verify-rls가 "매 실행 새 경로만 업로드"해 이 경로를 놓쳤다는 원인 분석도 코드(Part2 매 실행 새 fixture 경로 생성)와 일치한다.

**판정: PASS — Critical/High였던 결함이 이번 Day 내에 마이그레이션+회귀 프로브로 완전히 해소됨을 라이브로 확인.**

---

## 3. 리스크·발견 사항

### M-1 (Medium) — `/challenge/[id]` 진입 시 순차 fetch로 인한 체감 지연 (신규 관찰)

`src/features/challenge/CaptureClient.tsx:36, 47` — `useMySubmissions()`가 `TodayChallengeGate` **바깥**에서 먼저 호출되고, `isMyListPending`이 풀리기 전까지는 `TodayChallengeGate`(따라서 오늘 챌린지 조회)조차 마운트되지 않는다. 이는 완성 여부 확인 → 챌린지 조회의 **순차 체인**을 만든다.

- Day 10.5 이전에는 `/challenge/[id]` 진입 시 챌린지 조회 1회(+owner-guard)만으로 수집 UI가 렌더됐다. 이번 변경으로 **완성/미완성과 무관하게 매번** `/api/me/submissions` 왕복(Day 10 기준선 p95 356ms)이 챌린지 조회보다 먼저 끝나야 수집 UI가 뜬다.
- `['my','submissions']` 캐시가 `staleTime 60s` 안에 이미 있으면(예: `/my`·미리보기 방문 직후) 체감 지연은 없다. 하지만 세션 첫 진입이 `/challenge/[id]`인 경우(가장 흔한 "오늘 챌린지 시작" 경로)는 매번 이 순차 왕복을 탄다.
- `CollagePreviewClient.tsx`도 같은 패턴(챌린지 조회 완료 후 my-submissions 조회, #60 기존 코드)이라 **아키텍처적으로는 기존 선례와 일관**되지만, 순서가 반대(#78: my-submissions 먼저 → 챌린지 나중)라 챌린지 화면 진입 경로에 새로운 지연 원인이 생겼다.
- 데이터 손상·오동작 없음, "화면 로드 <3s" 절대 기준은 지킬 가능성이 높으나(왕복 1회 수백ms대) **이 화면 자체에 대한 로드 시간 실측이 없어 정량 근거가 없다.**

**권고**: Phase 4 진입 전 또는 다음 성능 점검 때 `/challenge/[id]` 콜드 로드 시간을 1회 실측해 회귀 기준선에 추가. 급하면 두 쿼리를 병렬로 시작(`useMySubmissions`를 유지하되 `TodayChallengeGate`도 동시에 마운트해 로딩 상태만 합성)하는 리팩토링도 고려 가능 — 단, 이번 Day 범위는 아니므로 이슈화 권장.

### L-1 (Low) — `docs/verification/phase3-integration.md` §7 "재실행 가이드"가 새 프로브 수를 반영하지 않음

- 158행 `pnpm dlx tsx scripts/verify-rls.ts      # RLS·Storage 36 프로브 (자동 정리)`
- 164행 `- 합격선: ... verify-rls 36/36.`

§5 아래에 추가된 각주(138행, "재실행 시 verify-rls는 **39프로브**가 기준")가 사실상 정정하고 있지만, §7 자체의 두 숫자는 여전히 "36"이다. Phase 4~5에서 §7만 보고 재실행하는 사람은 36/36을 기대했다가 39/39를 보고 당황할 수 있다(실패는 아니지만 혼란 소지). 1~2줄 수정 권장(이 문서는 QA 소유 파일이 아니라 직접 수정하지 않고 보고만 함).

### L-2 (Low) — 로직성 수정 3건의 자동화 회귀 테스트 부재

`#78`(리다이렉트+로컬 정리), `#40-B`(restore race 가드), `#77`(라이트박스)은 순수 로직/컴포넌트 변경임에도 컴포넌트 테스트가 없다. 이는 **프로젝트 전반의 기존 관행**(`FeedCard`·`LetterGrid` 등 `testing-strategy.md`가 "높음" 우선순위로 지정한 컴포넌트들도 현재 컴포넌트 테스트가 전무 — `grep`으로 RTL 사용 파일이 `use-submission.test.ts` 1개뿐임을 확인)과 일치하므로 이번 Day 고유의 새 결함은 아니다. 다만 `#78`·`#40-B`는 데이터 정합성에 직접 관여하는 로직이라 회귀 안전망이 특히 약하다 — 수동 E2E 체크리스트(§4)로 보완 필요.

### L-3 (정보) — Storage 객체 수 증가 (조사 결과 이상 없음)

`measure-perf.ts` 재실행 결과 letter-pieces 62개(Day10: 59개)·collages 15개(Day10: 14개)로 증가했으나 고아는 0/0으로 Day10과 동일. `#50` 검증을 위한 "다음 실제 제출"(Server-Timing 검산용, #50 코멘트에 명시된 계획) 또는 자연 사용 증가로 추정되며, 자체 정리형 스크립트(verify-rls·profile-collage-upload)는 실행 후 순변화 0임을 코드로 확인했으므로 이 증가분의 원인은 아니다. 조치 불필요.

### 확인 필요 없음(정상 종결)

- **#80(구 High)**: 발견 즉시 이번 Day 내 수정 + 라이브 프로브 2종 PASS로 완전 해소.
- **마이그레이션 0005·0006 적용 여부**: verify-rls 39/39 PASS(신규 프로브 3종 전부 기대대로 동작)로 실측 확인 — 미적용 정황 없음.

---

## 4. QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|----------|
| 1 | `pnpm lint` 오류 0건 | PASS | 실행 |
| 2 | `pnpm type-check` 오류 0건 | PASS | 실행 |
| 3 | `pnpm test:run` 186/186 | PASS | 실행 |
| 4 | #74 제출 완성 시 `['feed']` invalidate | PASS | 정적 리뷰 + 유닛 테스트(테스트 우선 확인) |
| 5 | #78 완성 챌린지 `/challenge/[id]` 진입 시 확정 화면 리다이렉트 | PASS | 정적 리뷰(로직 추적) — 자동화 테스트 없음, 수동 E2E 필요 |
| 6 | #78 확정 진입 시 로컬 슬롯·IDB 정리 | PASS | 정적 리뷰(로직 추적) — 자동화 테스트 없음 |
| 7 | #40-B restore stale 스냅샷 가드 정확성 | PASS | 정적 리뷰(경합 시나리오 3가지 수기 추적) — 자동화 테스트 없음 |
| 8 | #76 신고 아이콘 Flag 교체, aria-label 유지 | PASS | 정적 리뷰 + type-check |
| 9 | #77 마이 카드 탭 확대 라이트박스(비공개 포함) | PASS | 정적 리뷰(Dialog 패턴·서명 URL 재사용 확인) — 수동 확인 권장 |
| 10 | #48 reports UNIQUE + 중복 신고 차단 | PASS | 정적 리뷰(마이그레이션·onConflictDoNothing) + **verify-rls 라이브 프로브 PASS** |
| 11 | #48 "이미 신고한 글이에요" UI 메시지 | PASS | 정적 리뷰(exhaustive switch, type-check로 누락 방지 확인) |
| 12 | #50 글자 업로드 병렬화(cap 3) + 부분 실패 재시도 | PASS | 유닛 테스트 4종 + 정적 리뷰(워커 풀·클로저 카운팅) |
| 13 | #50 A6 프로파일링 판정(이상치) 근거 타당성 | PASS | 정적 리뷰(스크립트 설계·측정 로직) — 재실행 안 함(지시 준수) |
| 14 | #80 collages UPDATE 정책 추가 | PASS | 마이그레이션 정적 리뷰 + **verify-rls 라이브 프로브 2종 PASS**(본인 허용/타인 차단) |
| 15 | `drizzle-kit check`/`generate` 드리프트 없음 | PASS | 실행 |
| 16 | `measure-perf` 성능 자릿수 유지, 고아 0건 | PASS | 실행(Day10 기준선 대조) |
| 17 | §2 invalidation map "제출 완성(A4)" 행 갱신 정합성 | PASS | 문서 대조 |
| 18 | §7 재실행 가이드 프로브 수 갱신 | **FAIL(경미)** | 문서 대조 — L-1 참조, 36→39 미갱신 |
| 19 | `/challenge/[id]` 순차 fetch 성능 영향 | 관찰 필요 | 정적 리뷰 — M-1 참조, 정량 실측 없음 |

**Critical: 0건 · High: 0건 · Medium: 1건(M-1, 게이트 비차단 — 기능 정상, 성능 관찰만) · Low: 2건(L-1, L-2)**

---

## 5. 사용자용 모바일 수동 E2E 체크리스트

모바일 뷰포트(iPhone 14 또는 Pixel 7 기준 화면 크기)에서 확인. 카메라 촬영 대신 갤러리 업로드로 대체 가능.

- [ ] **#74**: 피드(`/feed/today`) 방문 → 60초 이내에 새 챌린지 수집·미리보기·제출 완료 → "피드 보러가기" 클릭 → **방금 제출한 내 카드가 즉시 보인다** (새로고침 없이).
- [ ] **#78-a**: 오늘 챌린지를 완성한 상태에서 `/challenge/[오늘id]`로 직접 이동(주소창 입력 또는 브라우저 뒤로가기) → **자동으로 미리보기(확정 화면)로 이동**하고, 수집 화면(슬롯 편집 UI)이 한순간도 보이지 않는다.
- [ ] **#78-b**: 위 상태에서 미리보기(확정 화면)가 뜬 뒤, 개발자 도구 없이 확인 가능한 선에서 "다시 수정" 동선이 없는지(있으면 안 됨 — 완성 후 숨겨져야 함, 기존 #60 사양) 확인.
- [ ] **#40-B**: 슬롯을 1~2개 채운 뒤 새로고침 → 복원되는 즉시(가능한 한 빠르게) 방금 복원된 슬롯을 탭해 다른 사진으로 빠르게 교체 → 옛 사진으로 되돌아가지 않고 새 사진이 유지되는지, 콘솔 에러가 없는지 확인 (Day 10에서도 재현이 어려웠던 케이스라 여러 번 빠르게 시도).
- [ ] **#76**: 피드에서 타인 카드의 신고 진입 버튼이 `⋯` 대신 **깃발 아이콘**으로 보이는지 확인. 탭 시 신고 다이얼로그가 정상 동작.
- [ ] **#77**: `/my`에서 완성작 카드의 콜라주 이미지를 탭 → **확대 모달**이 뜨고 문장·완성일·좋아요 수가 보이는지 확인. 비공개 카드도 동일하게 확대되는지 확인. X 버튼 또는 바깥 탭으로 닫히는지 확인.
- [ ] **#48**: 피드에서 타인 카드를 신고 → 같은 카드를 다시 신고 시도 → **"이미 신고한 글이에요"** 메시지가 뜨는지 확인(단, 신고 버튼은 여러 번 누를 수 있어야 하고 두 번째 시도에서만 이 메시지가 떠야 함).
- [ ] **#50**: 새 챌린지 제출 시 진행 표시가 "글자 N장 업로드 중… (n/N)"으로 표시되는지, 예전(Day 9 이전, "1/5…2/5…" 순번식)보다 체감이 빨라졌는지 확인.
- [ ] **#80(간접 확인)**: 제출이 정상적으로 끝까지 완료되는지(재시도 유발은 인위적으로 어려우므로, "정상 제출 1회 성공"으로 회귀 없음만 확인 — RLS 레벨 검증은 verify-rls로 이미 완료).
- [ ] **전체 회귀**: 로그인 → 수집 → 미리보기 → 제출 → 피드 → 좋아요 → `/my` 공개 토글 → 닉네임 변경 → 로그아웃 한 바퀴를 다시 돌려 Day 10 기준선(§4 전체 플로우) 대비 회귀가 없는지 확인.

---

## 6. 커밋 가능 여부

**PASS — 커밋 가능.** (게이트 B 판단은 최종적으로 사용자의 E2E 체크리스트 완료 확인 후 확정)

- lint/type-check/test:run 전부 green(186/186), verify-rls 39/39, measure-perf 자릿수 유지.
- Critical/High 0건. 신규 발견 High(#80)는 이번 Day 내 즉시 수정 + 라이브 재검증 완료.
- Medium 1건(M-1)은 기능 결함이 아닌 성능 관찰 사항으로, 게이트를 막지 않고 이슈화(Phase 4) 권장.
- Low 2건(L-1 문서 정정, L-2 테스트 커버리지 기존 관행 확인)은 기록만으로 충분.
- 마이그레이션 0005·0006은 사용자가 이미 적용했고, verify-rls의 신규 프로브 3종이 그 적용을 라이브로 재확인했다.
