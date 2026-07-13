# Phase 3 Day 10 QA 리뷰 — 통합 검증

> 검증일: 2026-07-13
> 검증자: QA Agent
> 기준 브랜치: worktree-phase3-day10-integration (base: origin/main `fe2c625`)
> 검증 대상: Day 10 산출물 자체(`docs/verification/phase3-integration.md`, `scripts/measure-perf.ts`, 문서 동기화) — Day 10은 신규 기능이 아닌 **Phase 3 전체의 통합 검증 Day**이므로, 이 리뷰는 "검증 문서·스크립트가 정확하고 재현 가능한가" + "회귀가 없는가"를 검증한다.
> 검증 방식: 정적 리뷰(코드 대조) + 실제 실행 검증(lint/type-check/test, `measure-perf.ts`, `verify-rls.ts` 재실행, curl 프로브) + GitHub 이슈 대조

---

## 0. 사전 확인 — 비교 기준 브랜치 정정 (중요)

이 워크트리는 로컬 `main` ref가 매우 오래된 커밋(`874eaae`, Phase 2 이전)을 가리키고 있어 `git diff main`은 136개 파일·18,785줄 변경이라는 **완전히 오도된 결과**를 낸다(Phase 2~3 전체가 "변경"으로 잡힘). 실제 최신 상태는 `origin/main`(`fe2c625`, Day 9 PR #67~#71 + #72까지 반영)이며, 이 리뷰의 모든 diff·회귀 검증은 `origin/main` 기준으로 수행했다.

```
git rev-parse main origin/main HEAD
→ main:        874eaae (stale, Phase 2 이전)
→ origin/main: fe2c625 (실제 최신)
→ HEAD:        fe2c625 (worktree는 origin/main과 정확히 일치, working tree만 변경분 있음)
```

이 자체가 Day 10 작업의 결함은 아니지만(알려진 워크트리 특성 — 이전 Day에서도 관찰됨), **향후 회귀 검증 시 `git diff origin/main`을 명시적으로 사용해야 한다**는 프로세스 노트로 §5 리스크에 기록한다.

---

## 1. 회귀 검증 — 기존 Phase 3 코드 변경 여부

**판정: PASS — 회귀 없음**

```
git diff origin/main --stat
 CLAUDE.md                   |  5 +++--
 docs/backend-design-plan.md | 22 +++++++++++++++++++++-
 docs/roadmap.md             |  5 ++++-
 docs/testing-strategy.md    |  2 ++
 4 files changed, 30 insertions(+), 4 deletions(-)

untracked:
 day10-kickoff.md            (커밋 금지 파일 — 규칙대로 미포함)
 docs/verification/          (신규 산출물)
 scripts/measure-perf.ts     (신규 산출물)
```

- `src/`, `tests/` 하위 파일은 **단 한 줄도 변경되지 않음** — Day 10은 지시대로 검증 전용이었고 제출 파이프라인·RLS·컴포넌트에 손대지 않았다.
- `CLAUDE.md`·`docs/backend-design-plan.md`·`docs/roadmap.md`·`docs/testing-strategy.md`는 게이트 A 결정을 반영하는 문서 동기화만이다(§3에서 내용 대조).
- `day10-kickoff.md`는 규칙대로 커밋 대상에서 제외된 상태(untracked, 커밋 금지 문서)로 확인됨.

---

## 2. 재실행 검증 결과

### 2.1 정적 검증 (lint / type-check / test)

| 명령 | 결과 | 상세 |
|------|------|------|
| `pnpm lint` | **PASS** (exit 0) | 경고·오류 0건 |
| `pnpm type-check` | **PASS** (exit 0) | 오류 0건. `scripts/*.ts`도 `tsconfig.json`의 `**/*.ts` include 대상이라 `measure-perf.ts`도 strict 체크에 포함됨 확인 |
| `pnpm test:run` | **PASS** | 14 파일 / **182 테스트** 전원 통과 (Day 9 이후 신규 테스트 없음 — Day 10은 검증 Day이므로 예상대로) |

### 2.2 `scripts/measure-perf.ts` 실행 검증 (read-only)

```
pnpm dlx tsx scripts/measure-perf.ts
```

| 확인 항목 | 결과 |
|-----------|------|
| Secret 미출력 | **PASS** — `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY` 값은 한 번도 출력되지 않고 presence boolean(`true`)만 출력 |
| read-only 보장 | **PASS** — 코드 스캔 결과 실행되는 쿼리는 `EXPLAIN (ANALYZE, BUFFERS)`·`SELECT`뿐이고, `enable_seqscan=off` 강제 구간은 `sql.begin(...)` 트랜잭션 내부에서 의도적으로 `throw`해 **항상 ROLLBACK**되는 구조(세션 오염 없음). Storage는 `storage.from(bucket).list()`만 사용(쓰기 없음) |
| `any` 타입 사용 | **PASS** — 파일 전체에 `any` 없음 (grep 확인) |
| ESLint (파일 단독) | **PASS** | |
| 실제 실행 성공 | **PASS** — 아래 실측 재현 |

**재실행 결과 (독립 재측정)**:
```
── Part 1: 피드 쿼리 (A7 Q1) ──
  실제 플랜의 idx_submissions_feed 사용: false (Seq Scan — 소형 테이블, 플래너 정상 선택)
  [PASS] enable_seqscan=off 강제 시 idx_submissions_feed 사용: true
  Q1: n=10 min=13.7ms p50=15.4ms p95=23.2ms max=23.2ms
  Q2+Q3: n=10 min=14.1ms p50=17.1ms p95=73.8ms max=73.8ms

── Part 2: Storage 고아 파일 ──
  letter-pieces: 객체 62개 / DB 참조 62개 / 고아 0개
  collages: 객체 15개 / DB 참조 15개 / 고아 0개
```

문서(`phase3-integration.md` §3)의 Q1 p50 17.3/p95 25.4ms, Q2+Q3 p50 17.3/p95 76.7ms와 **같은 자릿수·같은 결론(인덱스 usable, seq scan이 정상)**으로 재현됨. Storage 객체 수는 59→62 / 14→15로 소폭 늘었으나(검증 시점 사이 라이브 사용 증가로 인한 자연스러운 드리프트) **고아 0건은 동일하게 재확인** — 문서의 핵심 주장(고아 없음)은 변함없이 유효.

### 2.3 `scripts/verify-rls.ts` 재실행 (자체 정리형 — 허용 범위)

```
pnpm dlx tsx scripts/verify-rls.ts
→ 총 36건, 통과 36, 실패 0 (모두 PASS)
→ 테스트 계정 A·B 생성 → 검증 → "테스트 계정 A·B 삭제 완료" 로그로 자체 정리 확인
```

문서 §1의 "RLS·Storage 레이어: verify-rls.ts 36/36 PASS" 주장을 **독립적으로 재현·확정**. hidden 복원 차단(H2), letter_pieces 재할당 차단, B/anon의 타인 비공개 콜라주 차단, anon의 공개 콜라주 허용 등 문서가 인용한 개별 항목도 로그에서 전부 확인됨.

### 2.4 HTTP 프로브 (curl, dev 서버 localhost:3000)

| 요청 | 문서 주장 | 실측 | 판정 |
|------|-----------|------|------|
| `GET /` | 307 → `/login` | 307 → `/login` | PASS |
| `GET /feed/today` | 307 → `/login` | 307 → `/login` | PASS |
| `GET /my` | 307 → `/login` | 307 → `/login` | PASS |
| `GET /challenge/abc` | 307 → `/login` | 307 → `/login` | PASS |
| `GET /login` | 200 (공개) | 200 | PASS |
| `GET /api/me/submissions` (무인증) | 401 | 401 `{"code":"UNAUTHORIZED"}` | PASS |
| `GET /api/challenges/today` | 200 (공개) | 200, `"작은 쉼"` 챌린지 반환 — 문서 §1 대상 챌린지와 동일 id(`62e7f7fc…`) | PASS |
| `GET /s/<임의 UUID>` (미존재) | 404 | 404 | PASS |
| `GET /s/not-a-uuid` (형식 오류) | 404 | 404 | PASS |
| `GET /api/og/<임의 UUID>` (미존재) | 404 | 404 | PASS |

문서 §1의 "인증 경계"·"타인 자원 직접 접근(존재 은폐)" 표와 **전 항목 일치**.

---

## 3. 문서 실체 대조 — 인용 파일:줄 스팟체크

| 인용 | 문서 주장 | 코드 확인 | 판정 |
|------|-----------|-----------|------|
| `use-submission.ts:56-59` (V-1 근거) | 제출 완성 onSuccess가 `['submission', id]`·`['my','submissions']`만 invalidate, `['feed']` 없음 | 실제 코드(56-59행) 정확히 일치 — `invalidateQueries({queryKey:['submission', submission.id]})` + `invalidateQueries({queryKey:['my','submissions']})`, `['feed']` invalidate 없음 | **PASS** — V-1 진단 정확 |
| `idx_submissions_feed` 정의 (`src/db/schema.ts`, `migrations/0000_gigantic_wraith.sql`) | 부분 인덱스: `(challenge_id, created_at DESC, id) WHERE status='completed' AND is_public=true` | `measure-perf.ts`의 `FEED_Q1` WHERE절과 정확히 대응, 스키마·마이그레이션 SQL 모두 동일 정의 확인 | **PASS** |
| `proxy.ts` 보호 경로 | `/`, `/challenge/*`, `/feed/*`, `/my`, `/admin/*` 보호, 나머지 공개, API는 matcher에서 제외(자체 401) | `PROTECTED_PREFIXES = ['/challenge','/feed','/my','/admin']` + `pathname==='/'` 별도 처리, matcher negative-lookahead에 `api` 포함 확인 | **PASS** |
| `get-shared-submission.ts` WHERE절 | draft·hidden·비공개·미존재·형식오류 전부 null → 404 (존재 은폐 단일 소스) | `and(eq(id), eq(status,'completed'), eq(is_public,true))` — 매트릭스 주장과 정확히 일치, UUID 파싱 실패도 조기 null 반환 확인 | **PASS** |
| reports UNIQUE 미도입 (Day 10.5 이관 근거) | Day 10 시점엔 `(reporter_id, submission_id)` UNIQUE 없음 | 마이그레이션 파일 전수 grep 결과 없음 — 주장과 일치 | **PASS** |

5개 인용 전부 코드 실체와 일치. 허위·과장 인용 없음.

---

## 4. 문서 동기화 검증

| 문서 | 확인 내용 | 판정 |
|------|-----------|------|
| `docs/backend-design-plan.md` §9 "Day 10 확정 결정" | (a)~(h) + Day 10.5 신설 표 — Day 10.5 범위(#50 구현·#48 UNIQUE·#40-B 조건부·#40-D 일회성 정리·Medium 버그 이관)가 이슈 #73 본문과 **문구까지 대응** | PASS |
| `docs/roadmap.md` | 간트에 `마무리 검수 (Day 10.5)` 1일 항목 추가(Phase 3→4 사이) + 전환 노트 문단(§Phase 3→4 전환) 추가, Day 10.5 범위 요약이 backend-design-plan §9(h)와 일치 | PASS |
| `docs/testing-strategy.md` | "Phase 3 통합 검증 기준선은 `docs/verification/phase3-integration.md`에서 관리" 포인터 추가. 성능 항목 `#11 피드 초기 로딩 3초 이내(모바일 4G)` 존재 확인 — backend-design-plan §9(c)의 인용과 정합 | PASS |
| `CLAUDE.md` | "현재 상태: Phase 2 완료, Phase 3 Day 10 통합 검증 진행 중" / "현재 Phase" 절에 Day 6~9 완료·Day 10 진행 중·Day 10.5(#73) 예정 명시 | PASS |

### GitHub 이슈 대조

| 이슈 | 문서(`phase3-integration.md`) 주장 | 이슈 확인 | 판정 |
|------|-----------------------------------|-----------|------|
| **#73** (Day 10.5) | 검수 Day 신설, 범위 = #50 구현·#48 UNIQUE·#40-B 조건부·#40-D 일회성 정리·Medium 버그 | 이슈 본문·코멘트 문구까지 backend-design-plan §9와 동일. 코멘트에 "➕ #74 추가" 명시 — Medium 버그(V-1) 이관이 실제로 체크리스트에 반영됨 | PASS |
| **#74** (V-1, 신규 생성) | 제출 완성 후 `['feed']` invalidate 누락, Medium(경계), 수정 방향 제안 | 이슈 본문이 검증 문서 §5 V-1 서술과 동일 논리·동일 코드 인용(`use-submission.ts:56-59`) | PASS |
| **#50** | Day 10 = 측정+계획 셋업까지, 구현은 Day 10.5 | 코멘트에 A2/A5/A6/A4 실측표 + 구현 계획(재측정 우선순위·병렬화·웜업 완화) — 문서 §3 수치와 완전 동일 | PASS |
| **#48** | Day 10 = 중복 신고 실측만, UNIQUE 구현은 Day 10.5 | 코멘트에 "총 3건, 중복 쌍 1개(2건)" — 문서 §5 발견사항과 동일 | PASS |
| **#40** | A=Phase4 이관/B=재현시도(미재현)/C=보류/D=측정 후 정리불필요 | 코멘트에 각 항목 처분 결과 명시, D는 "59객체/59참조, 14객체/14참조, 고아 0건"으로 문서 §3과 동일 수치 | PASS |

문서·§9 표·로드맵·GitHub 이슈 4곳(문서 3개 + 이슈 5개)이 **모두 같은 결정을 일관되게 서술**한다. drift 없음.

---

## 5. QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|---------|
| C1 | 회귀 없음 — `src/`·`tests/` 미변경 | PASS | `git diff origin/main --stat` |
| C2 | `pnpm lint` 통과 | PASS | 실행 (exit 0) |
| C3 | `pnpm type-check` 통과 | PASS | 실행 (exit 0) |
| C4 | `pnpm test:run` 182/182 통과 | PASS | 실행 |
| C5 | `measure-perf.ts` read-only(SELECT/EXPLAIN/list만) | PASS | 코드 스캔 + 실행 |
| C6 | `measure-perf.ts` secret 미출력 | PASS | 실행 로그(presence boolean만) |
| C7 | `measure-perf.ts`에 `any` 없음, strict 통과 | PASS | grep + tsc 포함 확인 |
| C8 | `measure-perf.ts` 실제 실행 성공 (인덱스 usable·고아 0) | PASS | 실행 재현 |
| C9 | `verify-rls.ts` 36/36 PASS 재현 (자체 정리) | PASS | 실행 재현 |
| C10 | 인증 경계 curl 프로브 (307/401/404/200) 문서 일치 | PASS | curl 10건 |
| C11 | V-1 인용(`use-submission.ts:56-59`) 코드 실체 일치 | PASS | 정적 리뷰 |
| C12 | `idx_submissions_feed` 정의 인용 정확 | PASS | 정적 리뷰 |
| C13 | `proxy.ts`·`get-shared-submission.ts` 인용 정확 | PASS | 정적 리뷰 |
| C14 | reports UNIQUE 미도입 확인 (Day 10.5 이관 근거 유효) | PASS | grep 마이그레이션 |
| C15 | §9 결정표 ↔ roadmap ↔ CLAUDE.md ↔ GitHub(#73/#74/#50/#48/#40) 상호 일치 | PASS | 문서·이슈 대조 |
| C16 | Day 10.5(#73) 체크리스트에 Medium 버그(#74) 실제 반영 | PASS | 이슈 코멘트 확인 |
| C17 | `day10-kickoff.md` 커밋 제외 상태 유지 | PASS | git status (untracked) |
| C18 | `.env.local` 미열람 (보안 절대 규칙) | PASS | Read/cat/grep 등 어떤 방식으로도 접근하지 않음 — 본 세션 전체 로그 자체 점검 |

---

## 6. 이슈 목록

### Critical (0건)

없음.

### High (0건)

없음.

### Medium (0건 신규 — Day 10 자체 발견 V-1은 이미 이슈화·이관 완료)

Day 10 산출물이 스스로 발견한 V-1(feed invalidate 누락)은 게이트 A 처리 기준(Medium=이슈화 후 Day 10.5 이관)에 따라 **이미 #74로 이슈화되고 #73 체크리스트에 반영됨** — 이 QA 리뷰 시점에 열려있는 신규 Medium은 없다.

### Low (2건)

| # | 내용 | 근거 | 권고 |
|---|------|------|------|
| L1 | 이 워크트리의 로컬 `main` ref가 Phase 2 이전 시점(`874eaae`)에 고정되어, `git diff main`을 그대로 쓰면 136파일·18,785줄이 "변경"된 것처럼 보이는 완전히 오도된 결과가 나온다(실제로는 origin/main과 완전히 동일한 이미 머지된 코드). 이번 리뷰는 `origin/main`으로 재비교해 회피했으나, 다음 Day(10.5) 또는 향후 워크트리에서 무심코 `git diff main`을 쓰면 "대규모 회귀 발생"으로 오판할 위험이 있다 | §0 재현 확인 | 워크트리 생성 스크립트/문서에 "로컬 main은 참조하지 말고 origin/main 기준으로 diff" 안내 추가 검토 (이전에도 `.env.local` 관련 워크트리 특이사항이 기록된 전례 — `project_env_worktree_pitfall` 메모리 참고) |
| L2 | `scripts/measure-perf.ts` Storage 고아 카운트가 문서 작성 시점(59/14 객체) 대비 재실행 시점(62/15 객체)에 자연 증가함 — 고아 0건이라는 결론 자체는 재확인됐으나, 문서의 "정리 불필요 판명" 수치가 스냅샷이라는 점을 §7 재실행 가이드에 한 줄 명시하면 향후 혼동을 줄일 수 있음 | §2.2 재현 결과 | (선택) 문서에 "수치는 측정 시점 스냅샷, 재실행 시 달라질 수 있음" 각주 |

두 항목 모두 코드·데이터 정합성에 영향 없는 프로세스/문서 개선 제안이며, Day 10.5 이관 대상도 아니고 게이트 B를 막지 않는다.

---

## 7. 리스크 (테스트로 커버되지 않는 영역)

- **API 레벨 p95/화면 로드 시간**(피드 API p95 112ms, `/api/me/submissions` p95 356ms, 화면 로드 353ms)은 인증 세션이 필요해 이 QA 세션(비headed, curl 전용)에서는 재현 불가 — 문서에 기록된 대로 사용자의 인증 브라우저 콘솔 fetch 루프 실측에 의존한다. DB 레벨(Q1/Q2+Q3) 수치만 독립 재현했다.
- **크로스 유저 매트릭스의 `[UI]` 태그 셀**(headed browse 자동화로 검증된 항목)은 이번 세션에서 browse를 사용할 수 없다는 제약(메인 세션이 사용 중) 때문에 재현하지 못했다 — `[curl]`·`[RLS]`·`[유닛]` 태그 셀만 독립 재검증했고, `[UI]` 태그는 문서 서술의 논리적 정합성(코드 대조)으로만 교차 확인했다.
- **reports 중복 쌍 실측치**(총 3건, 중복 1쌍)는 라이브 DB 직접 쿼리 권한이 이 세션에는 주어지지 않아(허용된 스크립트는 verify-rls.ts·measure-perf.ts뿐) 독립 재현하지 못했다 — GitHub 이슈 #48 코멘트와의 교차 확인으로 대체했다(단, 같은 작업 세션에서 작성됐을 가능성이 있어 완전한 독립 검증은 아님).
- **P-1(A6 콜라주 업로드 10.6s)·P-2(웜업 4s)**는 "단일 표본" 실측으로, 이미 문서·이슈 양쪽에서 "재측정 필요"로 명시돼 있다 — Day 10.5에서 반복 측정이 선행돼야 병렬화 우선순위 판단이 안정적이다(이미 계획에 반영됨, 추가 지적 불필요).
- **#40-A(오프라인 UI)**는 자동화 한계로 재현되지 않았고 사용자 E2E 체크리스트(§8)에 위임돼 있다 — 이 리뷰도 동일하게 자동 검증 불가 영역으로 확인한다.

---

## 8. 사용자용 모바일 수동 테스트 체크리스트

Day 10은 새 UI가 없으므로, 이 체크리스트는 **회귀 확인용**(Day 6~9 기능이 여전히 동작하는가)과 **문서화된 엣지 케이스 중 자동화 불가 항목**에 집중한다. iPhone 14 뷰포트(390×844) 또는 Pixel 7(412×915) 기준.

### 8.1 전체 플로우 회귀 (문서 §4 재현)

- [ ] 비로그인 상태로 `/` 접속 → `/login` 리다이렉트
- [ ] 로그인 → 오늘의 챌린지 수집(글자 3장 촬영/업로드) → 0/3 → 3/3 진행
- [ ] 새로고침 후 즉시 슬롯 재탭 (#40-B 재현 시도) → IndexedDB 복원 정상, 콘솔 에러 없음
- [ ] 미리보기 화면 콜라주 렌더 정상, 공개 여부 체크박스 동작
- [ ] 제출 → "제출 완료" 메시지 → 피드 이동 시 **본인 카드가 즉시 보이는지** 확인 (V-1 재현 조건: 제출 전 60초 이내 피드를 먼저 봤던 경우에만 지연 가능성 — 안 보이면 새로고침/재진입으로 해소되는지도 함께 확인)
- [ ] 미리보기 재방문 → "이미 완성한 콜라주예요" 확정 화면 복원 (#72)
- [ ] 피드에서 타인 카드 좋아요 → 취소 → 카운트 원복
- [ ] 타인 카드 신고 → 접수 완료 메시지 (본인 카드엔 신고 버튼 없음)
- [ ] 피드 카드 탭 → `/s/[id]` 공유 페이지 진입, 뒤로가기로 피드 복귀
- [ ] `/my`에서 완성 목록(공개+비공개 배지) 확인, draft 미표시
- [ ] `/my`에서 공개↔비공개 토글 → 비공개 전환 시 `/s/[id]` 접속하여 즉시 404 확인
- [ ] 닉네임 수정 → 피드 카드 닉네임 즉시 반영
- [ ] 하단 탭(홈/피드/마이)이 `/challenge/*`, `/s/*`, `/login`에서는 보이지 않는지 확인
- [ ] 로그아웃 → `/login` 이동, 뒤로가기로 보호 라우트 재진입 불가

### 8.2 자동화 불가 엣지 케이스 (#40-A 등)

- [ ] **비행기 모드**로 전환 후 글자 업로드/제출 시도 → 에러 메시지 또는 재시도 유도 UI가 뜨는지(현재 미구현이면 어떤 실패 양상인지 기록 — Phase 4 #40-A 백로그 근거)
- [ ] 업로드 중 화면 회전(세로↔가로) → 진행 상태 유지되는지, 레이아웃 깨짐 없는지
- [ ] 카메라 권한 거부 후 갤러리 업로드로 정상 대체되는지
- [ ] 느린 네트워크(개발자 도구 3G 쓰로틀링 등)에서 콜라주 제출 시 로딩 인디케이터가 10초 이상 유지돼도 사용자가 진행 상황을 알 수 있는지 (P-1 체감 확인 — A6 10.6s 단일 표본의 실제 사용자 체감)

### 8.3 플랫폼

- [ ] iOS Safari: 전체 플로우 1회 통과
- [ ] Android Chrome: 전체 플로우 1회 통과
- [ ] 콘솔 에러 0건 (양쪽 브라우저)

---

## 9. 커밋 가능 여부

| 항목 | 결과 |
|------|------|
| `pnpm type-check` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:run` (182 테스트, 신규 0 — 검증 Day 특성상 정상) | PASS |
| `scripts/measure-perf.ts` read-only·무secret·strict·`any` 없음·실행 성공 | PASS |
| `scripts/verify-rls.ts` 재실행 36/36 PASS | PASS |
| HTTP 인증 경계 프로브(307/401/404/200) 문서 일치 | PASS |
| 회귀 검증 (`src/`·`tests/` 무변경, `git diff origin/main`) | PASS |
| 문서 동기화 (backend-design-plan §9 · roadmap · testing-strategy · CLAUDE.md · GitHub #73/#74/#50/#48/#40) | PASS, 전 항목 일관 |
| Critical 이슈 | 0건 |
| High 이슈 | 0건 |
| Medium 이슈 (신규) | 0건 — Day 10이 발견한 V-1은 이미 이슈화(#74)·Day 10.5(#73) 이관 완료 |
| Low 이슈 | 2건 (L1: 워크트리 stale main 참조 위험, L2: 고아 카운트 스냅샷 각주 권고) — 게이트 비차단 |

**게이트 B 통과 조건 충족. §8 수동 모바일 체크리스트 완료 후 커밋·PR 진행 가능.**

Day 10 산출물(`docs/verification/phase3-integration.md`, `scripts/measure-perf.ts`, 문서 동기화 4건)은 커밋 대상으로 적합하다. `day10-kickoff.md`는 규칙대로 계속 제외한다.

---

## 10. 다음 액션 (구현 agent 대상)

Day 10 자체는 통과 조건을 충족했으나, 이어지는 Day 10.5(#73)에서 아래를 통과시켜야 한다:

- [ ] **#74 (V-1)**: `use-submission.ts` onSuccess에 `invalidateQueries({ queryKey: ['feed'] })` 추가 — 회귀 테스트로 "제출 완성 mutation이 `['feed']`를 invalidate하는지" 유닛 테스트 추가 권고(현재 `submit-collage.test.ts`에는 이 assertion이 없음, Day 10.5에서 QA agent가 먼저 테스트 작성 후 구현 권장)
- [ ] **#50**: A6(콜라주 업로드) 반복 재측정·프로파일링을 글자 병렬화보다 먼저 수행
- [ ] **#48**: `reports` UNIQUE(reporter_id, submission_id) 마이그레이션 + 중복 처리 + UI, 정리 대상 1행 처리
- [ ] **#40-B**: 코드 레벨 재검토(Day 10 미재현이지만 objectURL 누수 가능성 판정 보류 상태)
- [ ] §8.2 자동화 불가 엣지 케이스(비행기 모드 등) 결과를 #40-A에 기록

---

## 내가 배워야 할 개념

- **`git diff <ref>`의 기준점 함정**: 로컬 브랜치 ref는 자동으로 원격과 동기화되지 않는다. 워크트리를 새로 만들 때 로컬 `main`이 최신이라는 보장이 없으므로, 회귀 검증처럼 "정확한 기준선"이 중요한 작업에서는 `git rev-parse`로 비교 대상 커밋을 먼저 확인하는 습관이 필요하다(오늘 이 확인을 건너뛰었다면 "136개 파일 회귀"라는 완전히 잘못된 결론을 낼 뻔했다).
- **EXPLAIN ANALYZE의 플래너 판단과 "인덱스 고장"의 구분**: 작은 테이블에서 Postgres 플래너가 Seq Scan을 선택하는 것은 인덱스가 없거나 잘못됐다는 뜻이 아니다. `enable_seqscan=off`로 강제해 "인덱스가 스케일 시 사용 가능한 상태인가"를 별도로 검증하는 패턴(`measure-perf.ts`)은 실무에서 자주 쓰이는 "인덱스 유효성 vs 플래너 선택"을 분리하는 방법이다.
- **자체 정리형(self-cleaning) 스크립트의 안전성 판단 기준**: `verify-rls.ts`처럼 트랜잭션 내에서 생성한 테스트 계정을 스크립트 종료 전에 스스로 삭제하는 패턴은, "라이브 데이터를 건드리지만 순 변화량은 0"이라는 점에서 read-only 스크립트와는 다른 카테고리의 안전성을 가진다 — 이번처럼 "자체 정리형이라 허용"이라는 예외 규정이 그래서 존재한다.
