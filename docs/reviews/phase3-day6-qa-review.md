# Phase 3 Day 6 QA Review

> 검증 일자: 2026-06-15
> 검증자: QA Agent (독립 재검증)
> 대상 브랜치: worktree-phase3-day6-feed
> 선행 리뷰: Reviewer 1차 리뷰 통과 (Critical/High 0 기록됨)

---

## 검증 방식

- 정적 코드 리뷰: `src/app/api/feed/route.ts`, `src/lib/validations/feed.ts`, `src/types/api.ts`, `src/lib/api-client.ts`, `src/hooks/use-feed.ts`, `src/hooks/use-intersection-observer.ts`, `src/features/feed/FeedClient.tsx`, `src/features/feed/FeedCard.tsx`, `src/app/feed/today/page.tsx`
- 단위 테스트 실행 + 정적 분석 툴 실행 결과 기록
- Reviewer 기존 finding(커서 마이크로초 정밀도 Low) 독립 재평가
- 커서 인코드/디코드 로직, keyset 술어, next_cursor 판정, 빈 페이지, 인증/인가, 보안 필터를 정적 + 단위 테스트로 검증
- 무한 스크롤·실 이미지 렌더는 사용자 수동 E2E로 위임

---

## 1. 정적 분석 결과

| 명령어 | 결과 | 비고 |
|--------|------|------|
| `pnpm lint` | PASS | 경고 0건, exit 0 |
| `pnpm type-check` | PASS | 오류 0건, exit 0 |
| `pnpm test:run` | PASS | 10 파일 / 139 테스트 전통과 (이전 127 → 139, feed-cursor 12건 추가) |

---

## 2. QA 체크포인트 표

### 2-A. API 계약 및 라우트 로직

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[A-1] 미인증 → 401 반환** | PASS | `route.ts` line 21-23: `getAuthUser` null이면 `jsonError(401, 'UNAUTHORIZED', ...)` |
| **[A-2] challenge_id 누락 → 400 반환** | PASS | `feedQuerySchema` `z.uuid()` — undefined 입력 시 invalid_type 에러, safeParse 실패 → `jsonError(400, 'INVALID_QUERY', ...)` |
| **[A-3] 잘못된 UUID → 400 반환** | PASS | `z.uuid()` 형식 검증. node 직접 테스트로 확인 (`r3.success = false`) |
| **[A-4] 잘못된 커서 → 400 반환** | PASS | `route.ts` line 43-46: `decodeFeedCursor` throw → `jsonError(400, 'INVALID_CURSOR', ...)` |
| **[A-5] 빈 페이지(결과 0건) → `{items:[], next_cursor:null}`** | PASS | `route.ts` line 104-107: `pageRows.length === 0` 조기 반환. `inArray([])` 호출 방지 |
| **[A-6] limit 기본값 20 적용** | PASS | `z.coerce.number().default(20)` — undefined 입력 시 20. node 테스트 확인 |
| **[A-7] limit 범위 1~50 경계 검증** | PASS | `min(1).max(50)`. limit=0 → false, limit=51 → false, limit='abc' → false. node 테스트 확인 |
| **[A-8] limit+1 내부 조회로 hasMore 판정** | PASS | `route.ts` line 98: `.limit(limit + 1)`, line 101: `rawRows.length > limit` |
| **[A-9] next_cursor = null (마지막 페이지)** | PASS | `route.ts` line 173-175: `hasMore=false`이면 `nextCursor = null` |
| **[A-10] next_cursor = base64url 문자열 (더 있을 때)** | PASS | `hasMore=true`이면 `pageRows[last]` 기준으로 `encodeFeedCursor` |
| **[A-11] runtime = 'nodejs' 명시** | PASS | `route.ts` line 13: `export const runtime = 'nodejs'` — Drizzle/Node.js SDK 호환 |

### 2-B. 보안 및 가시성 필터 (Drizzle 직결 RLS 우회 코드 보상)

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[S-1] status='completed' 필터 — draft·hidden 미노출** | PASS | `route.ts` line 55: `eq(submissions.status, 'completed')` |
| **[S-2] is_public=true 필터 — 비공개 미노출** | PASS | `route.ts` line 56: `eq(submissions.is_public, true)` |
| **[S-3] challenge_id 필터 — 다른 챌린지 항목 미노출** | PASS | `route.ts` line 54: `eq(submissions.challenge_id, challengeId)` |
| **[S-4] user_reacted — 본인 반응만 반영** | PASS | `route.ts` line 127-131: `WHERE user_id = user.id AND submission_id IN pageIds` |
| **[S-5] 미인증 `/api/feed` → 401** | PASS | 이중 보호: middleware(`proxy.ts`)가 `/feed/*` 페이지 redirect, route handler가 401 반환 |
| **[S-6] `/feed/today` 페이지 인증 보호** | PASS | `proxy.ts` line 8: `PROTECTED_PREFIXES = ['/challenge', '/feed', '/admin']` |
| **[S-7] XSS 방지 — 닉네임/이니셜 렌더** | PASS | JSX 텍스트 노드는 자동 이스케이프. `FeedCard.tsx`: `{profile.nickname}` 텍스트 노드로만 사용 |
| **[S-8] collage signed URL 접근 — 공개 제출 only** | PASS | 쿼리 자체가 completed+public 행만 선택 → 서명할 경로는 모두 공개 허용 대상 |

### 2-C. 커서 / keyset 페이지네이션 정합성

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[C-1] 커서 encode → decode 왕복 보존** | PASS | `feed-cursor.test.ts`: "encode → decode 왕복 시 createdAt(ISO)와 id를 보존한다" |
| **[C-2] base64url 출력에 +, /, = 없음** | PASS | `feed-cursor.test.ts`: "base64url 출력에 +, /, = 문자가 없다" |
| **[C-3] 밀리초 정밀도 왕복 보존** | PASS | `feed-cursor.test.ts`: "밀리초 포함 ISO 타임스탬프를 정확히 왕복한다" (999ms 케이스) |
| **[C-4] keyset 술어 방향 정합성** | PASS | 정렬 `created_at DESC, id ASC` + 술어 `(created_at < :c) OR (created_at = :c AND id > :id)` — 수동 추론 검증: DESC 정렬에서 다음 페이지는 더 오래된 created_at 또는 동일 ms 중 id가 큰 것. 중복·누락 없음 확인 |
| **[C-5] next_cursor 마지막 항목 기준 인코딩** | PASS | `pageRows = rawRows.slice(0, limit)`, `lastItem = pageRows[last]`, `nextCursor = encode(lastItem)` |
| **[C-6] 커서 손상 케이스 7종 에러 throw** | PASS | `feed-cursor.test.ts`: garbage, 구분자 없음, 잘못된 날짜, 잘못된 UUID, 빈 문자열, 왼쪽 비어있음, 오른쪽 비어있음 |
| **[C-7] 빈 커서 문자열("") 처리** | PASS | `decodeFeedCursor('')` → `indexOf('|')` = -1 → throw → route handler 400 반환. `fetchFeed`에서 `if (cursor)` 가드로 실제 클라이언트는 "" 전송하지 않음 |
| **[C-8] inArray([]) 안전 처리 — 빈 페이지 조기 반환** | PASS | `route.ts` line 104-107: `pageRows.length === 0`이면 `inArray` 호출 전 반환 |

### 2-D. 반응 집계 및 signed URL

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[R-1] N+1 회피 — 배치 2쿼리 처리** | PASS | `Promise.all([reactionCounts쿼리, userReactedRows쿼리])`, 페이지 submission_id 배치에 `inArray` |
| **[R-2] reaction_count=0 기본값** | PASS | `reactionCountMap.get(r.sub_id) ?? 0` |
| **[R-3] signed URL 실패 시 null 폴백** | PASS | `createSignedUrl` 오류 시 null 반환, `route.ts` line 142-148: `Promise.resolve(null)` 폴백 |
| **[R-4] signed URL TTL — 1h (EDIT)** | PASS | `SIGNED_URL_TTL.EDIT = 3600`, staleTime=60s ≪ TTL=3600s 만족 |
| **[R-5] collage_image_url=null 방어 처리** | PASS | `r.sub_collage_image_url ? createSignedUrl(...) : Promise.resolve(null)`. status=completed 시 null 불가능하지만 방어적 처리 |

### 2-E. 프론트엔드 — 무한 스크롤 및 상태 관리

| 체크포인트 | 결과 | 검증 방법 |
|-----------|------|----------|
| **[F-1] useFeed queryKey — cursor 미포함** | PASS | `queryKey: ['feed', challengeId ?? '']` — cursor는 pageParam으로만 처리 |
| **[F-2] getNextPageParam — null=끝 처리** | PASS | `next_cursor ?? undefined` — null이면 undefined 반환(TanStack이 hasNextPage=false로 처리) |
| **[F-3] IntersectionObserver 이중 트리거 방어** | PASS | `shouldObserve = hasNextPage && !isFetchingNextPage` — 진행 중이면 observe 해제 |
| **[F-4] useCallback deps 안정성** | PASS | `useCallback(() => void fetchNextPage(), [fetchNextPage])` — TanStack fetchNextPage는 stable ref |
| **[F-5] 챌린지 로딩 → 피드 로딩 의존 체인** | PASS | `useFeed(challenge?.id)` + `enabled: !!challengeId` — challengeId 확정 전 쿼리 시작 안 함 |
| **[F-6] 챌린지 없음(CHALLENGE_NOT_FOUND) 상태 처리** | PASS | `FeedClient.tsx` line 76-88: `ApiError.code === 'CHALLENGE_NOT_FOUND'` 분기 메시지 표시 |
| **[F-7] 빈 피드 상태 UI** | PASS | `items.length === 0`이면 "아직 제출이 없어요" 메시지 렌더 |
| **[F-8] 에러 상태 재시도 버튼** | PASS | `feedError` 시 "다시 시도" 버튼 + `refetchFeed()`, `disabled={isFeedRefetching}` |
| **[F-9] FeedCard — collage_url null → 이니셜 폴백** | PASS | `collage_url ? <img> : <div>{getInitial(nickname)}</div>` |
| **[F-10] FeedCard — avatar_url null → 이니셜 폴백** | PASS | `profile.avatar_url ? <img> : <div>{getInitial(profile.nickname)}</div>` |
| **[F-11] 하트 표시 — user_reacted 반영 (토글 비활성)** | PASS | `user_reacted ? '♥' : '♡'`, 클릭 이벤트 없음 (Day 7 구현 예정) |
| **[F-12] 로딩 스켈레톤 레이아웃 점프 방지** | PASS | `aspect-square` 고정 비율 + `animate-pulse` 스켈레톤, `aria-hidden="true"` |

---

## 3. 이슈 목록

### Critical — 0건

없음.

### High — 0건

없음.

### Medium — 0건

없음.

### Low

#### L-1: 커서 마이크로초 정밀도 경계 누락 (Reviewer 기존 finding 독립 재평가)

- **위치**: `src/app/api/feed/route.ts`, keyset 술어 블록 (line 67-75)
- **내용**: Postgres timestamptz는 마이크로초(μs) 정밀도로 저장하지만 postgres.js는 JS `Date`(밀리초 정밀도)로 읽는다. 커서는 `Date.toISOString()`으로 ms 정밀도만 인코딩하므로, 동일 챌린지에서 두 completed+public 제출의 created_at이 정확히 같은 ms인데 다른 μs(예: T+000001μs와 T+000999μs)이고 이 둘이 페이지 경계에 걸리면, 후행 행이 keyset 술어에서 누락 가능하다. 구체적으로: cursor = `T+000ms`로 인코딩되면, `T+000999μs`는 `(created_at < T+000ms)` = FALSE, `(created_at = T+000ms)` = FALSE → 누락.
- **독립 재평가 결론**: **Low 유지가 타당하다.** 이유:
  1. 트리거 조건이 극히 좁다 — 같은 ms 안에 2명이 각각 챌린지를 독립적으로 완성·공개해야 하며, 그 두 행이 정확히 페이지 경계(마지막 항목)에 위치해야 한다.
  2. MVP 예상 일일 완성·공개 제출 수는 수십 건 수준(§1 테이블 설계 베타 1개월 ~500건 / 일 ~17건)으로, 1ms 내 충돌 확률은 무시 가능.
  3. 누락 발생 시 증상이 항목 1개 스킵(새로고침으로 첫 페이지 재로드하면 확인 가능) — 데이터 손실·보안 이슈 없음.
  4. 근본 해결(커서에 μs 단위 epoch integer 사용)이 명확하며 `route.ts` 주석에 문서화됨.
- **게이트 B 영향**: 없음.

#### L-2: challenge_id 존재 검증 미수행 (신규 발견)

- **위치**: `src/app/api/feed/route.ts`, `src/lib/validations/feed.ts`
- **내용**: `feedQuerySchema`는 `challenge_id`가 UUID 형식인지만 검증하고 해당 챌린지가 DB에 실제로 존재하는지는 확인하지 않는다. 유효한 UUID를 임의로 조합해 API를 호출하면 비어있는 `{items:[], next_cursor:null}`을 200으로 반환하며, 인증된 사용자가 challenge_id를 조합해 챌린지 존재 여부를 탐색할 수 있다.
- **위험도 판단**:
  - 요청자가 인증된 사용자여야 하므로(401 보호) 비인증 탐색 불가.
  - 반환 정보는 "해당 챌린지에 완성·공개 제출이 0건"이라는 사실뿐 — 챌린지 존재 여부 자체를 노출하지 않는다. 빈 응답은 "챌린지 없음"과 "챌린지 있으나 제출 없음"을 구분하지 않는다.
  - 챌린지 UUID는 예측 불가(PostgreSQL `gen_random_uuid()`).
  - `FeedClient`는 항상 `useTodayChallenge` 결과만 challenge_id로 사용하므로 정상 플로우에서 잘못된 ID 전송 불가.
- **결론**: MVP 범위에서 실질 위험 없음. **Low. 현재 미수정 유지 타당.** 추후 challenge_id가 오늘 날짜 챌린지인지 강제 검증이 필요하면 route에서 `challenges` 테이블 조인을 추가하는 방향으로 해결 가능.
- **게이트 B 영향**: 없음.

#### L-3: 공개 피드 API 미인증 접근 차단 (설계 확인)

- **위치**: `src/app/api/feed/route.ts` line 21-23
- **내용**: `/api/feed`는 인증 필수 설계(§6.3 A7). 비로그인 사용자가 피드를 볼 수 없다. 이는 현재 MVP 설계 의도와 일치하지만, 추후 `/s/[id]` 공유 페이지처럼 비인증 피드 열람을 고려할 때는 설계 변경이 필요하다.
- **현재 판정**: 설계 의도대로 구현되어 있음. 변경 사항 없음. **정보성 기록.**

---

## 4. Reviewer 기존 finding 독립 재평가 요약

| Finding | Reviewer 심각도 | QA 독립 판정 | 판단 근거 |
|---------|----------------|-------------|----------|
| 커서 마이크로초 정밀도 경계 누락 | Low | **Low 유지 타당** | MVP 일일 제출량에서 1ms 내 2건 충돌 + 페이지 경계 중첩 확률 무시 가능. 누락 증상이 항목 1개 스킵(비파괴적). 코드 주석으로 근본 해결책 문서화됨. |

---

## 5. 커버리지 갭 — 런타임 위임 항목

아래 영역은 인증 세션·실제 DB 시드가 필요하여 정적 검증으로 커버하지 못한다. 사용자 수동 E2E로 위임한다.

| 영역 | 이유 | 위임 |
|------|------|------|
| `/api/feed` 실제 401 동작 | 인증 세션 필요 | 수동 E2E 6-A |
| 피드 카드 실 이미지 렌더 | 완성·공개 제출 + signed URL 필요 | 수동 E2E 6-B |
| 무한 스크롤 트리거 (센티널 교차) | 실 브라우저 IntersectionObserver 필요 | 수동 E2E 6-B |
| 페이지 경계 커서 연속 로드 | 21건 이상 완성·공개 제출 시드 필요 | 수동 E2E 6-C (선택) |
| user_reacted=true 카드 하트 표시 | reactions 데이터 필요 (Day 6 시점 reaction 0건) | Day 7 이후 자동 검증 |
| is_public=false 제출 미노출 런타임 검증 | 비공개 제출 + 다른 계정 필요 | 수동 E2E 6-D |

---

## 6. 변경 파일별 점검

### `src/app/api/feed/route.ts` (신규)

- 역할: A7 GET /api/feed keyset 커서 페이지네이션 Route Handler
- 인증 레이어: `getAuthUser` → null이면 401 즉시 반환
- 가시성 필터: `status='completed' AND is_public=true AND challenge_id=:id` 3종 모두 코드로 적용(RLS 우회 보상)
- keyset 술어: `(created_at DESC, id ASC)` 정렬과 `(created_at < :c) OR (created_at = :c AND id > :id)` 술어 방향 정합 확인
- N+1 회피: 페이지 submissions 1쿼리 + reaction 배치 2쿼리(Promise.all)
- 빈 페이지 조기 반환: `pageRows.length === 0`이면 `inArray([])` 호출 전 200+빈 배열 반환
- signed URL: `SIGNED_URL_TTL.EDIT(1h)`, 실패 시 null 폴백 (Day 4 M2 패턴 일관성)
- `runtime = 'nodejs'`: Drizzle + Storage SDK Node.js 전용 모듈 호환

### `src/lib/validations/feed.ts` (신규)

- `feedQuerySchema`: `challenge_id z.uuid()`, `cursor z.string().optional()`, `limit z.coerce.number().int().min(1).max(50).default(20)` — 경계값 테스트 확인
- `encodeFeedCursor`/`decodeFeedCursor`: base64url 불투명 인코딩, `|` 구분자, zod 내부 검증(ISO datetime + UUID). 12케이스 단위 테스트 전통과

### `src/types/api.ts` (추가)

- `ApiFeedProfile`, `ApiFeedItem`, `ApiFeedResponse` 타입 추가
- 서버·클라이언트 공유 경계 준수: 런타임 import 없음, 타입만 정의
- `collage_url: string | null` — null 가능성 타입 수준에서 명시

### `src/lib/api-client.ts` (`fetchFeed` 추가)

- `if (cursor) params.set('cursor', cursor)` — 빈 문자열 커서 미전송 처리(falsy 가드)
- 에러 시 `toApiError` 표준 변환 일관성 유지
- 반환 타입 `ApiFeedResponse` — 공유 타입 사용

### `src/hooks/use-feed.ts` (신규)

- `useInfiniteQuery` 설정 검증: `queryKey=['feed', challengeId]`(cursor 미포함), `initialPageParam=undefined`, `getNextPageParam: next_cursor ?? undefined`
- `staleTime: 60_000` 명시 — TTL(3600s) 내 충분
- `enabled: !!challengeId` — challengeId 없을 때 실행 안 됨

### `src/hooks/use-intersection-observer.ts` (신규)

- `enabled=false`이면 observe 시작 안 함, cleanup으로 `observer.disconnect()` 보장
- `rootMargin: '200px'` — 200px 여유 트리거(모바일 네트워크 지연 보완)
- `[enabled, onIntersect]` deps — 의존성 정확

### `src/features/feed/FeedClient.tsx` (신규)

- 5가지 상태 분기 완비: challengePending, challengeError, feedPending, feedError, 빈피드, 성공
- `CHALLENGE_NOT_FOUND` vs 일반 에러 메시지 분기
- `shouldObserve = hasNextPage && !isFetchingNextPage` — 이중 트리거 방어
- `useCallback([fetchNextPage])` — TanStack stable ref deps

### `src/features/feed/FeedCard.tsx` (신규)

- `article` 시맨틱 태그 사용
- `aria-label` 적용: 좋아요 수, 콜라주 미리보기 없음 등
- Day 6 표시 전용(클릭 이벤트 없음) 명확히 주석화
- `// eslint-disable-next-line @next/next/no-img-element` — `next/image` 미설정 remotePatterns 대응, 이유 주석 명시

### `src/app/feed/today/page.tsx` (교체)

- SSR prefetch 없이 CSR 마운트: Day 4.5 패턴 일관성
- `<FeedClient />` 단순 마운트 — 인증은 middleware + route handler 담당

---

## 7. 사용자 모바일 수동 E2E 체크리스트

> 아래 항목은 QA 에이전트가 정적으로 검증할 수 없는 런타임 시나리오다.
> 피드를 채우려면 먼저 완성·공개 제출이 1건 이상 존재해야 한다. 제출이 없으면 빈 피드 상태만 확인 가능하다.
> 모든 항목을 완료해야 게이트 B가 완전히 통과된다.

### 사전 조건: 피드 시드 생성

- [ ] 로그인 후 `/challenge/[today]`에서 모든 슬롯 채우기 → 콜라주 완성 → 공개 제출 1건 이상 생성
- [ ] (선택) 무한 스크롤 검증을 위해 limit+1=21건 이상 완성·공개 제출 필요 (테스트용 시드 또는 여러 계정 활용)

### 6-A. 인증 보호 확인

- [ ] 비로그인 상태로 `/feed/today` 접근 → `/login` redirect 확인
- [ ] 비로그인 상태로 `/api/feed?challenge_id=<유효UUID>` 직접 호출 → 401 JSON 응답 확인 (`{"error":"로그인이 필요합니다.","code":"UNAUTHORIZED"}`)

### 6-B. 피드 기본 동작 확인 (iPhone 14 또는 Pixel 7 기준)

- [ ] 공개 완성 제출 1건 이상 있는 상태에서 `/feed/today` 진입 → 피드 카드 정상 렌더 확인
- [ ] 콜라주 이미지가 카드에 표시됨 (signed URL 동작 확인)
- [ ] 닉네임이 카드 하단에 표시됨
- [ ] 좋아요 수(0)와 빈 하트(♡) 표시됨
- [ ] 하트 탭 시 반응 없음 (Day 6 표시 전용 확인)
- [ ] collage_url 없는 카드: 이니셜 폴백 확인 (시드에서 강제 생성하거나 개발자 도구로 collage_url을 null로 만들어 테스트)

### 6-C. 무한 스크롤 (선택 — 21건 이상 시드 필요)

- [ ] 피드 하단까지 스크롤 → 추가 카드 자동 로드 확인 (스켈레톤 → 실 카드)
- [ ] 마지막 페이지 도달 후 "모든 콜라주를 다 봤어요" 텍스트 확인

### 6-D. 비공개 제출 미노출 확인

- [ ] is_public=false인 제출이 있는 상태에서 피드에 해당 카드가 표시되지 않음 확인
- [ ] 다른 계정(또는 시크릿 창)으로 로그인 → 첫 번째 계정의 비공개 제출이 피드에 미노출 확인

### 6-E. 빈 피드 및 에러 상태

- [ ] 오늘 챌린지에 완성·공개 제출이 0건일 때 "아직 제출이 없어요" 메시지 확인
- [ ] 네트워크 차단 후 피드 진입 → "피드를 불러오지 못했어요" + "다시 시도" 버튼 확인
- [ ] "다시 시도" 버튼 탭 → 재요청 동작 확인

### 6-F. 콜라주 없는 상태 처리 (엣지)

- [ ] avatar_url이 없는 프로필의 카드 — 아바타 이니셜 원 표시 확인

---

## 8. 커밋 가능 여부

**조건부 가능**

정적 분석(lint, type-check, test:run) 전통과 + Reviewer Critical/High 0건 + QA Critical/High/Medium 0건이므로 **코드 품질 측면에서 커밋 가능하다.**

단, 아래 런타임 조건이 충족되어야 게이트 B가 완전히 통과된다:

1. **사용자 수동 E2E 6-A~6-E 완료**: 인증 보호, 피드 렌더, 비공개 미노출, 빈/에러 상태 실기기 확인.
2. **공개 완성 제출 1건 이상 생성 선행**: 피드 카드가 실제로 보여야 기본 동작 검증 가능.

Low 2건(L-1 마이크로초 정밀도, L-2 challenge_id 존재 미검증)은 MVP 수준에서 수용 가능 — 게이트 B를 차단하지 않는다.

---

## 9. 이슈 요약

| 등급 | 건수 | 내용 |
|------|------|------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low | 2 | L-1(커서 μs 정밀도, Reviewer 기존 finding — Low 유지 확인), L-2(challenge_id 존재 미검증 — MVP 실질 위험 없음) |
