# Phase 3 Day 7 QA Review

> 검증 일자: 2026-06-17
> 검증자: QA Agent (독립 정적 검증)
> 대상 브랜치: worktree-phase3-day7-reactions
> 선행 Day: Phase 3 Day 6 (피드 API + 무한 스크롤) — Critical/High 0건으로 통과

---

## 검증 방식

- 정적 코드 리뷰: 신규·수정 파일 전체 정독
  - `src/lib/validations/reaction.ts`, `src/lib/actions/reactions.ts`
  - `src/features/feed/reaction-cache.ts`, `src/hooks/use-reaction.ts`
  - `src/lib/validations/report.ts`, `src/lib/actions/reports.ts`
  - `src/hooks/use-report.ts`, `src/features/feed/ReportDialog.tsx`
  - `src/types/api.ts` (is_mine 추가), `src/app/api/feed/route.ts` (is_mine 계산)
  - `src/features/feed/FeedCard.tsx`, `src/features/feed/FeedClient.tsx`
  - `tests/unit/reaction-cache.test.ts`, `tests/unit/report-validation.test.ts`
- 정적 분석 툴 실행 결과 기록 (lint / type-check / test:run / build)
- 중점 검증 포인트 6개에 대한 코드 레벨 추론
- 라이브 Supabase 의존 항목은 사용자 수동 E2E로 위임

---

## 1. 정적 분석 결과

| 명령어 | 결과 | 비고 |
|--------|------|------|
| `pnpm lint` | PASS | 경고 0건, exit 0 |
| `pnpm type-check` | PASS | 오류 0건, exit 0 |
| `pnpm test:run` | PASS | 12 파일 / 153 테스트 전통과 (Day 6 대비 +14건: reaction-cache 7건 + report-validation 7건) |
| `pnpm build` | PASS | Server Action 번들 규칙 통과, 'server-only' 경계 침해 없음, Compiled successfully |

---

## 2. QA 체크포인트 표

### 2-A. Server Action 번들 경계 (프로젝트 최초 도입)

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[B-1] `reactions.ts` — `'use server'` + `import 'server-only'` 이중 가드** | PASS | `reactions.ts` line 1, 5: 두 지시어 모두 존재. `pnpm build` 통과로 클라이언트 번들 유입 없음 확인 |
| **[B-2] `reports.ts` — `'use server'` + `import 'server-only'` 이중 가드** | PASS | `reports.ts` line 1, 3: 두 지시어 모두 존재. `pnpm build` 통과 확인 |
| **[B-3] `use-reaction.ts` — `'use client'` 지정** | PASS | `use-reaction.ts` line 1: `'use client'` 명시. Server Action을 import하는 클라이언트 훅으로 Next.js가 RPC 참조로 변환 |
| **[B-4] `use-report.ts` — `'use client'` 지정** | PASS | `use-report.ts` line 1: `'use client'` 명시 |
| **[B-5] `FeedCard.tsx`, `ReportDialog.tsx` — `'use client'` 지정** | PASS | 두 파일 모두 line 1에 `'use client'` 명시. Server Action 직접 import 없음 (훅 경유) |

### 2-B. 권한/소유권 — 서버 강제 (RLS 우회 코드 보상)

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[P-1] `toggleReaction` — user_id 서버 강제** | PASS | `reactions.ts` line 37: `getAuthUser()` 반환값만 user_id로 사용. 클라이언트는 submissionId(UUID)만 전달 — user_id 조작 불가 |
| **[P-2] `toggleReaction` — 미인증 차단(throw)** | PASS | `reactions.ts` line 38-40: `!user`면 `throw new Error('UNAUTHENTICATED')` → useMutation `onError` 롤백 처리 |
| **[P-3] `createReport` — reporter_id 서버 강제** | PASS | `reports.ts` line 53: `reporter_id: user.id` — 서버 인증 사용자 고정. 클라이언트 입력으로 대체 불가 |
| **[P-4] `createReport` — 자기 신고 서버 차단** | PASS | `reports.ts` line 49-51: `target.user_id === user.id`이면 `return { ok: false, code: 'SELF_REPORT' }`. 클라이언트 `is_mine` 숨김은 보조 수단일 뿐 — 서버에서 독립적으로 차단 |
| **[P-5] `createReport` — 미인증 반환 분기(throw 아님)** | PASS | `reports.ts` line 35-37: `!user`면 `return { ok: false, code: 'UNAUTHENTICATED' }`. 다이얼로그 메시지 분기 가능 |
| **[P-6] `is_mine` — 서버 계산(feed route)** | PASS | `route.ts` line 169: `is_mine: r.sub_user_id === user.id` — `user`는 서버의 `getAuthUser()` 결과. 클라이언트 조작 불가 |
| **[P-7] `getAuthUser` — Server Action 쿠키 접근** | PASS | `auth.ts`에서 인자 없는 호출 시 `createClient()` 내부 생성. `server.ts`가 `cookies()` (next/headers)로 쿠키 읽음. Server Action은 서버에서 실행되므로 쿠키 접근 유효 |

### 2-C. 토글 멱등성·동시성

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[T-1] UNIQUE(user_id, submission_id)가 멱등성 근거** | PASS | `schema.ts` line 110-111: `unique('reactions_user_submission_unique').on(table.user_id, table.submission_id)` |
| **[T-2] INSERT 경합 — `onConflictDoNothing` 흡수** | PASS | `reactions.ts` line 57-59: `.onConflictDoNothing()`. 동일 사용자 동시 INSERT 시도 시 UNIQUE 위반 없이 흡수됨 |
| **[T-3] DELETE — 0행이어도 무해** | PASS | `reactions.ts` line 51-54: WHERE 절 매칭 없어도 에러 없음. 이후 권위값 재조회로 실제 상태 반환 |
| **[T-4] 토글 후 권위값 재조회 반환** | PASS | `reactions.ts` line 62-76: 토글 실행 후 countRow(전체 count)·mine(본인 반응 존재 여부)을 각각 SELECT해 반환. 경합 상황에서도 항상 DB 실제값 |
| **[T-5] 클라이언트 `isPending` 연타 방지** | PASS | `FeedCard.tsx` line 81: `disabled={toggle.isPending}`. 카드별 mutation 인스턴스 — 카드 A 진행 중에도 카드 B는 독립적으로 클릭 가능 |
| **[T-6] `onMutate` — 진행 중 리페치 취소** | PASS | `use-reaction.ts` line 25: `await queryClient.cancelQueries({ queryKey })`. 낙관적 업데이트를 리페치가 덮어쓰지 못하게 방어 |
| **[T-7] `onError` — 스냅샷 롤백** | PASS | `use-reaction.ts` line 32-35: `context?.previous` 존재 시 `setQueryData`로 복원. `UNAUTHENTICATED` throw 에러도 롤백 처리됨 |
| **[T-8] `onSuccess` — 권위값 정정(드리프트 보정)** | PASS | `use-reaction.ts` line 37-42: `reconcileReaction(current, submissionId, result)`로 서버 반환값(`user_reacted`, `reaction_count`)을 해당 항목에만 덮어씀 |
| **[T-9] `onSettled` invalidate 미사용 — 의도적 설계** | PASS | 무한쿼리 전체 invalidate는 모든 페이지 재fetch를 유발(signed URL 재서명·스크롤 점프·재정렬). 단일 항목 정정(onSuccess 권위값 반영)으로 충분하다는 설계 결정. 코드 주석으로 이유 명시 |

### 2-D. Optimistic 캐시(reaction-cache) 불변식

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[O-1] 단일 항목만 갱신 — 다른 항목 미오염** | PASS | `reaction-cache.ts` line 47: `it.submission.id === submissionId ? fn(it) : it` — 대상 아닌 항목은 원본 참조 유지. `reaction-cache.test.ts`: "대상 외 항목·페이지는 참조까지 그대로 둔다" (toBe 참조 동일성 검증) |
| **[O-2] 대상 없는 페이지 — 참조 보존(불필요한 리렌더 방지)** | PASS | `reaction-cache.ts` line 44-45: `page.items.some()`으로 대상 없으면 페이지 객체 그대로 반환. 단위 테스트: `expect(next.pages[1]).toBe(data.pages[1])` |
| **[O-3] reaction_count 0 클램프** | PASS | `reaction-cache.ts` line 13: `Math.max(0, item.reaction_count + delta)`. 단위 테스트: "count 0에서 취소해도 0 미만으로 내려가지 않는다" 통과 |
| **[O-4] pageParams 보존** | PASS | `reaction-cache.ts` line 42: `{ ...data, pages: ... }` — `pageParams` spread 복사. 단위 테스트: `expect(next.pageParams).toEqual(data.pageParams)` 통과 |
| **[O-5] 존재하지 않는 submission — no-op** | PASS | 단위 테스트: "존재하지 않는 submission이면 모든 페이지를 그대로 둔다" 통과. `page.items.some()` 결과 false → 모든 페이지 참조 유지 |
| **[O-6] `reconcileReaction` — 서버 권위값 덮어쓰기** | PASS | 단위 테스트: "서버 권위값으로 해당 항목을 덮어쓴다" 통과. `user_reacted: false, reaction_count: 7` 반영 확인 |

### 2-E. 입력 검증 (Validation)

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[V-1] `toggleReactionSchema` — UUID 형식 검증** | PASS | `validation/reaction.ts`: `z.uuid()`. 비 UUID 입력 시 safeParse 실패 → `throw new Error('INVALID_SUBMISSION_ID')` |
| **[V-2] `createReportSchema` — reason 1자 이상 검증** | PASS | `validation/report.ts` line 9-10: `.trim().min(1, ...)`. 단위 테스트: "빈 사유 거부", "공백만 있는 사유 거부" 통과 |
| **[V-3] `createReportSchema` — reason 500자 이하 검증** | PASS | `validation/report.ts` line 11: `.max(REPORT_REASON_MAX, ...)`. 단위 테스트: "500자 허용", "501자 거부" 통과 |
| **[V-4] `createReportSchema` — reason trim 서버 재검증** | PASS | `validation/report.ts`의 `.trim()`은 서버 Action(`reports.ts` line 24)에서 `safeParse` 호출 시 적용됨. 단위 테스트: "앞뒤 공백 trim" — `r.data.reason === '스팸'` 통과 |
| **[V-5] `createReportSchema` — submission_id UUID 검증** | PASS | `validation/report.ts` line 7: `submission_id: z.uuid()`. 단위 테스트: "submission_id가 UUID가 아니면 거부" 통과 |
| **[V-6] `createReport` — 클라이언트 입력 서버 재검증** | PASS | `reports.ts` line 24-30: 서버 Action 진입 시 `createReportSchema.safeParse()` 재실행. 클라이언트 검증 우회 불가 |

### 2-F. 신고 결과 객체 분기

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[R-1] 성공 — `{ ok: true }` 반환** | PASS | `reports.ts` line 59: `return { ok: true }` |
| **[R-2] 실패 코드 4종 — `{ ok: false, code: ... }` 반환(throw 아님)** | PASS | `CreateReportResult` 타입: `UNAUTHENTICATED / INVALID / SELF_REPORT / NOT_FOUND` 4종 모두 return으로 처리. Next.js가 production에서 throw 에러 메시지를 마스킹하는 문제 회피 |
| **[R-3] 다이얼로그 — `resultMessage()` 코드별 메시지 매핑** | PASS | `ReportDialog.tsx` line 24-35: `switch(code)` 완전 처리. TypeScript exhaustive check 가능한 union type 사용 |
| **[R-4] 다이얼로그 — network throw vs 서버 `ok:false` 분기** | PASS | `ReportDialog.tsx` line 48-52: `report.isError`(네트워크/서버 throw) vs `report.data && !report.data.ok`(ok:false) 별도 분기. 에러 메시지 표시 일관성 유지 |
| **[R-5] `done` 상태 — 접수 완료 UI 전환** | PASS | `ReportDialog.tsx` line 67-69: `onSuccess` 콜백에서 `result.ok`일 때만 `setDone(true)`. ok:false 시 done 전환 없이 에러 메시지 표시 |
| **[R-6] 다이얼로그 닫힘 — 상태 초기화** | PASS | `ReportDialog.tsx` line 54-60: `handleOpenChange(false)` 시 `setReason('')`, `setDone(false)`, `report.reset()` 모두 실행. 재오픈 시 초기 상태 |

### 2-G. is_mine 필드 추가 — 타입/회귀

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[M-1] `ApiFeedItem.is_mine` 필수 필드 추가** | PASS | `types/api.ts` line 95: `is_mine: boolean` (nullable 아님, 필수) |
| **[M-2] `route.ts` — is_mine 조립** | PASS | `route.ts` line 169: `is_mine: r.sub_user_id === user.id` 포함. TypeScript `ApiFeedItem[]` 타입 어노테이션으로 누락 시 컴파일 에러 발생 → `pnpm type-check` PASS로 누락 없음 확인 |
| **[M-3] `reaction-cache.test.ts` fixture — is_mine 포함** | PASS | `reaction-cache.test.ts` line 28: `is_mine: false`. ApiFeedItem 타입 변경 후 fixture 업데이트 반영 완료 |
| **[M-4] 기존 테스트 회귀** | PASS | `pnpm test:run`: 기존 139건 + 신규 14건 = 153건 전통과. 회귀 없음 |
| **[M-5] 기존 무한 스크롤·피드 카드 표시 회귀** | PASS | `FeedClient.tsx`: 변경 최소 (`FeedCard`에 `challengeId` prop 전달 로직 유지). `FeedCard.tsx`: is_mine 구조분해 추가 + 신고 버튼 조건부 렌더 추가 — 기존 이미지·닉네임·반응 수 표시 로직 무변경 |

### 2-H. 신고 버튼 UI — 접근성 및 모바일

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[U-1] 좋아요 버튼 — `aria-pressed` 접근성** | PASS | `FeedCard.tsx` line 82: `aria-pressed={user_reacted}`. React가 boolean을 `"true"/"false"` 문자열로 렌더링 — WAI-ARIA 준수 |
| **[U-2] 좋아요 버튼 — `aria-label` 상태 포함** | PASS | `FeedCard.tsx` line 83-87: `user_reacted ? '좋아요 취소 (현재 N개)' : '좋아요 (현재 N개)'` — 스크린 리더 동작 상태 전달 |
| **[U-3] 신고 버튼 — `aria-label` 포함** | PASS | `ReportDialog.tsx` line 80: `aria-label={\`${nickname}의 콜라주 신고\`}` |
| **[U-4] 신고 다이얼로그 — textarea `aria-label`** | PASS | `ReportDialog.tsx` line 112: `aria-label="신고 사유"` |
| **[U-5] 신고 다이얼로그 — 카운터 표시** | PASS | `ReportDialog.tsx` line 116: `trimmedLength/{REPORT_REASON_MAX}`. trim 후 길이 표시 — 서버 trim 검증과 일관성 유지 |
| **[U-6] `base-ui/react ^1.5.0` render prop 패턴** | PASS | `pnpm build` 성공으로 @base-ui/react의 render prop 패턴 (`<DialogTrigger render={<button>}/>`) 유효 확인 |

---

## 3. 이슈 목록

### Critical — 0건

없음.

### High — 0건

없음.

### Medium — 0건

없음.

### Low

#### L-1: `reconcileReaction` 단위 테스트 커버리지 부분 부족

- **위치**: `tests/unit/reaction-cache.test.ts`
- **내용**: `reconcileReaction`의 테스트가 1건(서버 권위값 덮어쓰기)뿐이다. `optimisticToggleReaction`과 동일하게 "존재하지 않는 submission no-op" 케이스와 "대상 외 페이지 참조 보존" 케이스가 없다. 두 함수 모두 같은 `mapFeedItem` 내부 로직을 사용하므로 `optimisticToggleReaction` 테스트가 간접 커버하지만 독립 테스트는 없다.
- **위험도 판단**: `mapFeedItem`이 두 함수의 공통 구현이고, `optimisticToggleReaction`에서 동일 로직을 이미 6개 케이스로 테스트한다. `reconcileReaction`만 별도로 no-op 케이스를 추가할 경우 중복 테스트가 된다. 실질 위험 없음.
- **게이트 B 영향**: 없음.

#### L-2: 자기 글 좋아요(self-reaction) 비제한 — 설계 결정 미문서화

- **위치**: `src/lib/actions/reactions.ts`, `src/features/feed/FeedCard.tsx`
- **내용**: 자기 글 신고는 서버에서 차단(`SELF_REPORT`)되지만, 자기 글 좋아요는 서버에서 차단하지 않는다. `FeedCard.tsx`에서 `is_mine` 카드에도 좋아요 버튼이 표시되며 동작한다. 설계 의도인지 미처리인지 코드/문서에서 명확히 기록되지 않았다.
- **위험도 판단**: 자기 글에 자기가 좋아요를 눌러도 reaction_count에 1이 추가되는 수준. 피드 순위 변경 없고(카운트만), DB UNIQUE 제약으로 1회 이상 누적 불가. MVP에서 자기 좋아요를 허용하는 것은 흔한 설계 선택. 실질 위험 없음.
- **권고**: `reactions.ts` 주석에 "자기 좋아요 허용 — 의도적 설계" 한 줄 추가로 문서화 권장 (MVP 이후 정책 변경 시 명확한 기준).
- **게이트 B 영향**: 없음.

#### L-3: 신고 중복 — 동일 사용자 다중 신고 허용

- **위치**: `src/lib/actions/reports.ts`, `src/db/schema.ts`
- **내용**: `reports` 테이블에 `(reporter_id, submission_id)` UNIQUE 제약이 없다. 동일 사용자가 같은 submission을 여러 번 신고하면 `reports` 테이블에 중복 행이 쌓인다. 코드 주석 "중복 신고는 현재 허용 — 이슈 #48로 이관"으로 의도적 설계 결정 문서화됨.
- **위험도 판단**: MVP에서 신고 처리는 수동(§8.3 "신고 + 수동 처리"). 중복 신고가 쌓여도 관리자가 중복을 감지하고 처리 가능. 자동 처리 시스템이 없으므로 남용 위험 최소. 이슈 #48으로 추적 관리 중.
- **게이트 B 영향**: 없음.

#### L-4: Day 6 기존 Low 이슈 현황 (승계 확인)

- **L-4-1 커서 마이크로초 정밀도 (Day 6 L-1)**: Day 7에서 feed route.ts 수정 없음 — 동일 Low 유지. is_mine 필드 추가는 커서 로직과 무관.
- **L-4-2 challenge_id 존재 검증 미수행 (Day 6 L-2)**: Day 7에서 변경 없음 — 동일 Low 유지.

---

## 4. 중점 검증 포인트 결론

| 검증 포인트 | 결론 |
|------------|------|
| **1. 권한/소유권** | PASS. `toggleReaction`의 user_id, `createReport`의 reporter_id 모두 서버 인증 사용자로 강제. 자기 신고가 서버에서 독립적으로 차단됨. 클라이언트 `is_mine` 숨김은 보조. |
| **2. 토글 멱등·동시성** | PASS. UNIQUE 제약이 무결성 근거, onConflictDoNothing이 경합 흡수, 반환값이 DB 권위값, isPending 가드가 연타 방지. read-then-write race 시 UNIQUE가 최종 일관성 보장. |
| **3. Optimistic 캐시** | PASS. 단일 항목만 갱신, 타 항목/페이지 참조 보존, 0 클램프, onError 롤백, onSuccess 정정. 7개 단위 테스트 전통과. |
| **4. 입력 검증** | PASS. reason 1~500 trim(서버 재검증 포함), submissionId UUID — 7개 단위 테스트 전통과. |
| **5. 신고 결과 분기** | PASS. throw 아닌 반환 객체 4종 분기, 다이얼로그 메시지 매핑 완전성 확인. |
| **6. 회귀** | PASS. is_mine 필수 필드 추가 후 type-check/테스트 전통과. 피드 기존 동작 무변경. |

---

## 5. 커버리지 갭 — 런타임 위임 항목

정적 검증으로 커버하지 못한 영역. 사용자 수동 E2E로 위임한다.

| 영역 | 이유 | 위임 |
|------|------|------|
| 좋아요 토글 실제 DB 반영 | Drizzle DB 세션 필요 | 수동 E2E 7-A |
| Optimistic 업데이트 시각적 즉시 반영 | 실 브라우저 렌더 필요 | 수동 E2E 7-A |
| 빠른 연타 시 isPending 가드 동작 | 실 브라우저 입력 필요 | 수동 E2E 7-A |
| 자기 글 신고 버튼 숨김 | 본인 제출이 피드에 노출되어야 함 | 수동 E2E 7-B |
| 신고 다이얼로그 실 제출 | Drizzle DB 세션 필요 | 수동 E2E 7-B |
| SELF_REPORT 서버 차단 런타임 확인 | DB 인증 세션 + is_mine 조작 필요 | 수동 E2E 7-B (선택) |
| 세션 만료 후 신고 시 UNAUTHENTICATED 메시지 | 세션 만료 시나리오 재현 필요 | 수동 E2E 7-C (선택) |

---

## 6. 변경 파일별 점검

### `src/lib/validations/reaction.ts` (신규)

- `z.uuid()` 단일 스키마 — toggleReaction 인자 타입 강제. 간결하고 목적에 맞음.

### `src/lib/actions/reactions.ts` (신규, Server Action)

- `'use server'` + `import 'server-only'` 이중 가드로 클라이언트 번들 유입 차단
- user_id 서버 강제, UUID 검증, 인증 체크, read-then-write-reconcile 패턴
- 권위값 재조회(countRow + mine 재SELECT) — 경합 드리프트 보정
- onConflictDoNothing으로 INSERT 멱등 보장. DELETE는 0행도 무해

### `src/features/feed/reaction-cache.ts` (신규)

- 순수 함수 — 렌더 없이 단위 테스트 가능한 설계 의도 실현
- `mapFeedItem`이 두 함수(optimistic + reconcile)의 공통 로직 추출 — DRY
- 참조 보존(`page.items.some()`) — 불필요한 리렌더 방지

### `src/hooks/use-reaction.ts` (신규)

- TanStack Query `useMutation` 패턴 — onMutate/onError/onSuccess 3단 처리
- onSettled invalidate 의도적 미사용 — 주석으로 이유 명시됨
- queryKey `['feed', challengeId ?? '']` — challengeId가 없으면 optimistic 업데이트 skip(Server Action은 실행) — FeedCard가 challenge 확정 후에만 렌더되므로 실제로는 발생하지 않음

### `src/lib/validations/report.ts` (신규)

- `REPORT_REASON_MAX = 500` 상수 export — 다이얼로그와 서버 검증이 같은 상수 공유
- `.trim().min(1).max(500)` — 서버 trim 후 길이 검증 순서 정합

### `src/lib/actions/reports.ts` (신규, Server Action)

- throw 대신 반환 객체 패턴 — Next.js production 에러 마스킹 우회
- DB 조회 순서: 인증 → submission 존재 확인 → self-report 체크 → INSERT — 필요 최소 쿼리 수
- 중복 신고 허용은 의도적 결정 (코드 주석 + 이슈 #48 이관)

### `src/hooks/use-report.ts` (신규)

- optimistic 업데이트 없음 — 신고는 피드 UI에 반영되지 않으므로 올바른 선택
- `mutationFn`에서 `createReport(vars)` 직접 호출 — Server Action RPC 정상 연결

### `src/features/feed/ReportDialog.tsx` (신규)

- controlled open 상태 — 닫힘 시 입력/결과 초기화 보장
- `done` 상태 분리 — 성공 UI와 입력 UI를 상태로 전환. ok:false 시 done 전환 없음
- `canSubmit` 로직: `trimmedLength > 0 && trimmedLength <= REPORT_REASON_MAX && !isPending` — maxLength raw 500 제한 범위 내에서 trimmedLength > 500은 불가능하므로 조건 일관성 OK

### `src/types/api.ts` (수정)

- `is_mine: boolean` 필수 필드 추가 — nullable 아님. 서버는 항상 계산해 포함
- 타입 주석에 Day 7 결정 5 참조 명시

### `src/app/api/feed/route.ts` (수정)

- `is_mine: r.sub_user_id === user.id` 1행 추가. 기존 로직 무변경
- 인증 완료 후(`user`가 확정된 상태)에서 계산 — 안전

### `src/features/feed/FeedCard.tsx` (수정)

- `is_mine` 구조분해 추가
- `{!is_mine && <ReportDialog .../>}` — 본인 카드 신고 버튼 조건부 렌더
- `useToggleReaction` 연결 — `toggle.mutate(submission.id)`, `toggle.isPending`
- 기존 콜라주 이미지·아바타·닉네임 렌더 무변경

### `src/features/feed/FeedClient.tsx` (수정)

- `<FeedCard item={item} challengeId={challenge.id} />` — challengeId prop 추가
- 기존 무한 스크롤·상태 분기 로직 무변경

---

## 7. 사용자 모바일 수동 E2E 체크리스트

> 아래 항목은 QA 에이전트가 정적으로 검증할 수 없는 런타임 시나리오다.
> 피드를 채우려면 완성·공개 제출이 1건 이상 존재해야 한다.
> iPhone 14 또는 Pixel 7 기준으로 진행한다. **모든 필수 항목을 완료해야 게이트 B가 완전히 통과된다.**

### 사전 조건

- [ ] 본인 계정으로 로그인된 상태
- [ ] 오늘의 챌린지에 완성·공개 제출 1건 이상 존재 (본인 또는 다른 계정)
- [ ] 다른 사람의 제출이 피드에 보여야 신고 버튼 검증 가능 (2개 계정 또는 별도 계정으로 제출 선행)

### 7-A. 반응 토글(필수)

- [ ] `/feed/today` 진입 → 피드 카드 하단 빈 하트(♡)와 카운트(0) 표시 확인
- [ ] 하트 버튼 탭 → 즉시 채운 하트(♥)로 변경 + 카운트 +1 (optimistic)
- [ ] 페이지 새로고침 → DB 반영된 좋아요 상태 유지 확인
- [ ] 채운 하트 다시 탭 → 빈 하트(♡)로 변경 + 카운트 -1 (optimistic)
- [ ] 빠른 연타(좋아요 → 바로 탭) → 두 번째 탭 비활성화(disabled) 확인 (isPending 가드)
- [ ] 카드 A 좋아요 처리 중 카드 B 좋아요 → 카드 B 독립적으로 동작 확인

### 7-B. 신고 다이얼로그(필수)

- [ ] 타인 제출 카드 하단 우측 `⋯` 버튼 표시 확인
- [ ] `⋯` 버튼 탭 → "이 콜라주 신고" 다이얼로그 오픈 확인
- [ ] 사유 입력란 탭 → 가상 키보드 올라옴 확인 (모바일)
- [ ] 사유 비워둔 상태 → "신고하기" 버튼 비활성화 확인
- [ ] 사유 입력 후 → "신고하기" 버튼 활성화 확인
- [ ] 500자 입력 → 더 이상 입력 안 됨 확인 (maxLength)
- [ ] "신고하기" 탭 → "신고가 접수됐어요" 완료 화면 전환 확인
- [ ] "닫기" 탭 → 다이얼로그 닫힘 확인
- [ ] 다이얼로그 재오픈 → 입력란 비어있음(초기화) 확인

### 7-C. 본인 카드 신고 버튼 숨김(필수 — 본인 제출이 피드에 있을 때)

- [ ] 본인 제출 카드 → `⋯` 버튼 없음 확인 (신고 진입 불가)
- [ ] 타인 제출 카드 → `⋯` 버튼 있음 확인

### 7-D. 자기 신고 서버 차단(선택 — 개발자 도구 필요)

- [ ] (선택) 개발자 도구로 `createReport({ submissionId: 본인제출ID, reason: '테스트' })` 직접 호출 → `{ ok: false, code: 'SELF_REPORT' }` 응답 확인

### 7-E. 세션 만료 시나리오(선택)

- [ ] (선택) 신고 다이얼로그 열린 상태에서 세션 강제 만료(쿠키 삭제) → 신고하기 탭 → "로그인이 필요해요" 메시지 확인

### 7-F. 회귀 — 기존 피드 동작

- [ ] 피드 무한 스크롤 정상 동작 (Day 6 검증 유지 확인)
- [ ] 콜라주 이미지, 닉네임, 좋아요 수 표시 정상

---

## 8. 이슈 요약

| 등급 | 건수 | 내용 |
|------|------|------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low | 4 | L-1(reconcileReaction 단위 테스트 부분 부족 — mapFeedItem 공통 로직 간접 커버로 수용), L-2(자기 좋아요 비제한 미문서화 — 의도적 설계로 판단, 주석 추가 권장), L-3(신고 중복 허용 — 이슈 #48로 이관된 의도적 결정), L-4(Day 6 기존 Low 2건 승계 — 미변경) |

---

## 9. 커밋 가능 여부

**조건부 가능**

정적 분석(lint, type-check, test:run, build) 4종 전통과 + Critical/High/Medium 0건이므로 **코드 품질 측면에서 커밋 가능하다.**

단, 아래 런타임 조건이 충족되어야 게이트 B가 완전히 통과된다:

1. **사용자 수동 E2E 7-A~7-C 완료**: 반응 토글 optimistic 동작, 신고 다이얼로그 제출, 본인 카드 신고 버튼 숨김을 실 기기에서 확인.
2. **다른 계정의 제출 1건 이상 필요**: 7-C(본인 카드 숨김) 검증에 본인 제출이, 7-B(신고 버튼) 검증에 타인 제출이 모두 필요.

Low 4건은 MVP 수준에서 수용 가능 — 게이트 B를 차단하지 않는다.
