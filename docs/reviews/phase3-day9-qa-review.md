# Phase 3 Day 9 QA 리뷰 — 마이페이지·프로필

> 검증일: 2026-06-30
> 검증자: QA Agent
> 기준 브랜치: worktree-phase3-day9-mypage
> 검증 방식: 정적 리뷰 + 단위 테스트 (라이브 Supabase DB 미연결 환경이므로 API 런타임 시나리오는 정적+테스트 기반으로 검증 후 수동 체크리스트로 위임)

---

## 1. 단위 테스트 작성 결과 (Reviewer Medium 대응)

Reviewer가 지적한 "신규 순수 함수 단위 테스트 누락" Medium 이슈를 닫는다.

### 작성 파일

| 파일 | 테스트 수 | 대상 함수 |
|------|---------|---------|
| `tests/unit/visibility-cache.test.ts` | 8 | `setSubmissionVisibility` |
| `tests/unit/profile-validation.test.ts` | 17 | `updateProfileSchema` |

### 자동 검증 결과

| 명령 | 결과 | 상세 |
|------|------|------|
| `pnpm test:run` | **PASS** | 14 파일 / **182 테스트** 전원 통과 (기존 157 + 신규 25) |
| `pnpm lint` | **PASS** | 경고·오류 0건 |
| `pnpm type-check` | **PASS** | 오류 0건 |

### visibility-cache 테스트 요약 (8개)

| 케이스 | 내용 |
|--------|------|
| 1 | 대상 is_public 공개→비공개 변경 확인 |
| 2 | 대상 is_public 비공개→공개 변경 확인 |
| 3 | is_public 외 필드(reaction_count, collage_url 등) 불변 |
| 4 | 대상 외 항목 원본 참조 보존 (`toBe` 동일 참조) |
| 5 | 대상 항목은 새 참조 (`not.toBe`) |
| 6 | 여러 항목 중 대상만 교체, 나머지 참조 보존 |
| 7 | 목록에 없는 id → 입력 data 동일 참조 반환 |
| 8 | 빈 items에서도 안전하게 동일 참조 반환 |

### profile-validation 테스트 요약 (17개)

| 케이스 | 내용 |
|--------|------|
| 1 | `"<<<"` → 정제 후 빈 문자열 → min 위반 실패 |
| 2 | `">>>"` → 정제 후 빈 문자열 → min 위반 실패 |
| 3 | zero-width space(​) 제거 후 유효 닉네임 통과 |
| 4 | zero-width non-joiner·joiner(‌, ‍) 제거 |
| 5 | RTL override(‮, \p{Cf}) 제거 후 통과 |
| 6 | \p{Cf} 문자만 있는 입력 → 빈 문자열 → min 위반 실패 |
| 7 | 앞뒤 공백 trim 확인 |
| 8 | 공백만 있는 입력 → trim 후 빈 문자열 → 실패 |
| 9 | trim 후 2자 이상이면 통과 |
| 10 | 하한(2자) 경계 통과 |
| 11 | 상한(20자) 경계 통과 |
| 12 | 하한 미달(1자) 실패 |
| 13 | 상한 초과(21자) 실패 |
| 14 | 꺾쇠 제거 후 2자 이상이면 통과 (`"<<abc>>"` → `"abc"`) |
| 15 | trim 후 1자만 남으면 실패 (`"  a  "`) |
| 16 | 한글 닉네임 정상 통과 |
| 17 | 영숫자 닉네임 정상 통과 |

---

## 2. 검증 범위

| 대상 파일 | 신규/수정 |
|-----------|---------|
| `src/lib/validations/profile.ts` | 신규 |
| `src/lib/actions/profile.ts` (S3) | 신규 |
| `src/lib/actions/submissions.ts` (S4) | 신규 |
| `src/app/api/me/submissions/route.ts` | 신규 |
| `src/types/api.ts` | 수정 (ApiMySubmission 추가) |
| `src/proxy.ts` | 수정 (/my 추가) |
| `src/app/my/page.tsx` | 신규 |
| `src/features/profile/MyClient.tsx` | 신규 |
| `src/features/profile/MySubmissionCard.tsx` | 신규 |
| `src/features/profile/ProfileEditSheet.tsx` | 신규 |
| `src/features/profile/visibility-cache.ts` | 신규 |
| `src/hooks/use-my-submissions.ts` | 신규 |
| `src/hooks/use-toggle-visibility.ts` | 신규 |
| `src/hooks/use-update-profile.ts` | 신규 |
| `src/features/nav/BottomTabNav.tsx` | 신규 |
| `src/app/layout.tsx` | 수정 (BottomTabNav 삽입) |
| `src/features/home/HomeClient.tsx` | 수정 (로그아웃 버튼 제거) |
| `src/features/feed/FeedClient.tsx` | 수정 (#63 피드카드→/s) |
| `src/features/feed/FeedCard.tsx` | 수정 (#63 Link 래핑) |

---

## 3. 권한 검증 시나리오

### 3.1 타인 제출 id로 S4 토글 시도 → NOT_FOUND 존재 은폐

**판정: PASS**

`src/lib/actions/submissions.ts` 코드 경로:
- `getOwnedSubmission(submissionId, user.id)` 호출
- DB 쿼리: `SELECT * FROM submissions WHERE id = submissionId LIMIT 1`
- `row.user_id !== userId` 조건에서 null 반환
- 타인 소유·미존재 모두 동일 null → `throw new Error('NOT_FOUND')`
- 존재 여부를 구분하지 않아 타인 id 추측 불가 ✓

조건부 UPDATE에도 `eq(submissions.user_id, user.id)` 재확인이 WHERE에 포함되어 TOCTOU(읽기-쓰기 사이 소유권 변경)에 안전하다.

### 3.2 비로그인 /my 직접 진입 → /login redirect

**판정: PASS**

두 겹 방어:
1. `src/proxy.ts:8`: `PROTECTED_PREFIXES = ['/challenge', '/feed', '/my', '/admin']` — `/my` 포함 ✓
2. `isProtectedPath('/my')`: `pathname === prefix` 정확 매치 → true ✓
3. `src/app/my/page.tsx:12`: 서버 컴포넌트 방어적 재확인 `if (!user) redirect('/login')` ✓

proxy가 막히더라도 서버 컴포넌트에서 2차로 차단한다.

### 3.3 비로그인 GET /api/me/submissions → 401

**판정: PASS**

`src/app/api/me/submissions/route.ts:21-25`:
```
const user = await getAuthUser(supabase);
if (!user) {
  return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
}
```
미인증 요청은 리소스 정보를 일절 노출하지 않고 401 반환 ✓

### 3.4 /my 목록이 서버에서 본인 user_id로만 필터

**판정: PASS**

`route.ts:45`:
```
.where(and(eq(submissions.user_id, user.id), eq(submissions.status, 'completed')))
```
- `user.id`는 JWT `getClaims().sub`에서 오는 서버 인증값 (클라이언트 조작 불가) ✓
- `status='completed'` 추가 필터로 draft·hidden 제외 ✓
- 클라이언트에 타인 항목이 도달하지 않으므로 토글 UI 자체가 부재 ✓

### 3.5 본인만 프로필 수정 (S3)

**판정: PASS**

`src/lib/actions/profile.ts:38-42`:
```
await db
  .update(profiles)
  .set({ nickname, updated_at: sql`now()` })
  .where(eq(profiles.id, user.id))
```
- 클라이언트 인자는 `nickname`뿐 — `user_id`를 받지 않음 ✓
- WHERE는 서버 인증 `user.id`로만 고정 ✓
- 다른 사용자의 프로필 행에 접근할 통로 없음 ✓

### 3.6 #60 방향(B): 완성=확정, 공개여부만 토글

**판정: PASS**

- S4 `updateSubmissionVisibility`: `status !== 'completed'` → `throw 'NOT_COMPLETED'` ✓
- `/api/me/submissions`가 `status='completed'` 항목만 반환하므로 UI는 완성 제출만 표시 ✓
- `is_public` 이외 필드(콜라주 이미지 등)를 변경하는 통로가 없음 ✓

---

## 4. QA 체크포인트 표

| # | 체크포인트 | 결과 | 검증 방법 |
|---|-----------|------|---------|
| P1 | /my proxy 보호 (`PROTECTED_PREFIXES`에 '/my' 포함) | PASS | 정적 리뷰 — `proxy.ts:8` |
| P2 | 비로그인 /my → /login redirect | PASS | 정적 리뷰 — proxy + 서버 컴포넌트 2중 가드 |
| P3 | 비로그인 GET /api/me/submissions → 401 | PASS | 정적 리뷰 — `route.ts:21-25` |
| P4 | 본인 submission만 목록 반환 (`user_id` 서버 고정) | PASS | 정적 리뷰 — `route.ts:45` |
| P5 | 타인 submission id로 S4 토글 → NOT_FOUND 은폐 | PASS | 정적 리뷰 — `getOwnedSubmission` null 반환 패턴 |
| P6 | S4 UPDATE WHERE에 `user_id` 재확인 (TOCTOU 방어) | PASS | 정적 리뷰 — `submissions.ts:67-73` |
| P7 | S3 updateProfile WHERE `profiles.id = user.id` | PASS | 정적 리뷰 — `profile.ts:38` |
| P8 | #60(B): completed 외 상태 토글 → NOT_COMPLETED | PASS | 정적 리뷰 — `submissions.ts:58-60` |
| P9 | hidden submission 토글 시도 → HIDDEN 거부 | PASS | 정적 리뷰 — `submissions.ts:55-57` |
| P10 | 비공개 전환 시 `/s` 즉시 404 (is_public 서버 소스) | PASS | 정적 리뷰 — `getSharedSubmission` `is_public=true` WHERE (phase3-day8) |
| P11 | 비공개 전환 후 피드 invalidate (`['feed']` queryKey) | PASS | 정적 리뷰 — `use-toggle-visibility.ts:49` |
| P12 | 닉네임 수정 성공 후 피드 invalidate (`['feed']` queryKey) | PASS | 정적 리뷰 — `use-update-profile.ts:15` |
| P13 | /my 계정 헤더 닉네임 즉시 반영 (state 갱신) | PASS | 정적 리뷰 — `MyClient.tsx:28,54`: `useState(initialNickname)` + `ProfileEditSheet.onUpdated` |
| P14 | optimistic 토글: onMutate 낙관 → onError 롤백 → onSuccess 정정 | PASS | 정적 리뷰 — `use-toggle-visibility.ts` 3-콜백 구조 ✓ |
| P15 | 비공개 콜라주도 본인 서명(signed URL) — mypage에선 표시 | PASS | 정적 리뷰 — `route.ts:67-73` 본인 supabase client로 서명 |
| P16 | BottomTabNav allowlist: 홈·피드·마이에서만 표시 | PASS | 정적 리뷰 — `BottomTabNav.tsx:22-29` `shouldShowTabs` 로직 |
| P17 | `/challenge/*`, `/s/*`, `/login`, `/admin/*`에서 탭 미표시 | PASS | 정적 리뷰 — `shouldShowTabs` 화이트리스트 미포함 |
| P18 | #63 피드카드 이미지 탭 → /s/[id] Link | PASS | 정적 리뷰 — `FeedCard.tsx:28-49` `<Link href="/s/${submission.id}">` |
| P19 | 로그아웃: Supabase signOut + QueryClient.clear() + replace('/login') | PASS | 정적 리뷰 — `use-logout.ts:20-31` |
| P20 | 홈 로그아웃 버튼 제거 (Day 9 IA #52·#62) | PASS | 정적 리뷰 — `HomeClient.tsx` 로그아웃 관련 코드 없음 |
| P21 | `server-only` 가드 — S3·S4 클라이언트 번들 유입 차단 | PASS | 정적 리뷰 — `profile.ts:5`, `submissions.ts:5` `import 'server-only'` |
| P22 | `any` 타입 없음 | PASS | `pnpm type-check` PASS + grep |
| P23 | S4 입력 UUID 검증 (`z.uuid()`) | PASS | 정적 리뷰 — `submissions.ts:16` |
| P24 | S3 닉네임 transform·검증 (`updateProfileSchema`) | PASS | 단위 테스트 17건 통과 |
| P25 | visibility-cache 참조 동일성 (비대상 항목 shallow equality) | PASS | 단위 테스트 8건 통과 |
| P26 | `useMySubmissions` staleTime 60s — 캐시 키 `['my','submissions']` 일관성 | PASS | 정적 리뷰 — `use-my-submissions.ts:12` / `use-toggle-visibility.ts:8` 동일 키 |
| P27 | MAX_ITEMS 100 상한, 커서 없이 전량 반환 | PASS | 정적 리뷰 — `route.ts:15,47` |
| P28 | 반응 수 집계 N+1 회피 (배치 1쿼리, GROUP BY) | PASS | 정적 리뷰 — `route.ts:57-64` |
| P29 | 빈 items 조기 반환 (inArray([]) Drizzle 미지원 회피) | PASS | 정적 리뷰 — `route.ts:50-52` |

---

## 5. 이슈 목록

### Critical (0건)

없음.

### High (0건)

없음.

### Medium (0건, 모두 해소)

| # | 이슈 | 상태 | 해소 방법 |
|---|------|------|---------|
| M1 | 신규 순수 함수 단위 테스트 누락 (visibility-cache, profile-validation) | **해소** | `tests/unit/visibility-cache.test.ts` (8건) + `tests/unit/profile-validation.test.ts` (17건) 작성 및 전원 통과 |

### Low (0건)

없음.

### 참고 (이슈 아님, 문서화)

| # | 내용 |
|---|------|
| N1 | `<img>` 사용: `next/image` 미사용은 `next.config`에 `remotePatterns` 미설정 때문. 주석으로 이유 명시됨. 기존 Day 8 패턴 동일. |
| N2 | 닉네임 unique 제약 없음: 의도된 설계 (`profile.ts:23` 주석). `/u/[handle]` 도입 시 재검토 예정. |
| N3 | 아바타 업로드 MVP 제외: `ProfileEditSheet.tsx:98` 명시. |
| N4 | 비공개 토글 진행 중 연타 방지: 각 `MySubmissionCard`가 자체 `isPending`으로 비활성. 다른 카드는 독립 토글 가능 — 의도된 UX. |
| N5 | `getInitial` 빈 문자열 폴백: `nickname.charAt(0).toUpperCase() || '?'` — 빈 닉네임 엣지케이스 방어 ✓ |

---

## 6. 수동 모바일 체크리스트 (사용자 직접 확인)

iPhone 14 뷰포트(390×844) 또는 Pixel 7(412×915) 기준. 실제 앱이 실행되는 환경에서 확인한다.

### 6.1 /my 페이지 기본

- [ ] **로그인 상태**에서 `/my` 접속 → 내 닉네임·아이콘(이니셜) 계정 헤더 표시
- [ ] 완성 콜라주 목록 2열 그리드로 표시 (공개 배지: 어두운 배경, 비공개 배지: 주황색)
- [ ] 비공개 콜라주도 이미지 정상 표시 (본인 signed URL)
- [ ] 콜라주가 없을 때 "아직 완성한 콜라주가 없어요" + "만들러 가기" 링크
- [ ] 네트워크 오류 시 에러 화면 + "다시 시도" 버튼

### 6.2 공개/비공개 토글 (S4)

- [ ] 카드 하단 토글 버튼 탭 → 배지 즉시 변경 (낙관적 반영)
- [ ] 토글 진행 중 버튼 비활성(opacity)
- [ ] 공개 → 비공개 후 `/s/[해당id]` 접속 → 404 화면 표시
- [ ] 비공개 → 공개 후 `/s/[해당id]` 접속 → 콜라주 정상 표시
- [ ] 토글 후 `/feed/today` 접속 → 피드 갱신 (비공개 항목 미표시 / 공개 항목 표시)

### 6.3 프로필 수정 (S3)

- [ ] "프로필 수정" 탭 → 하단 Sheet 열림, 현재 닉네임으로 시드
- [ ] 1자 입력 → "닉네임은 2자 이상" 오류 메시지 즉시 표시
- [ ] 21자 이상 입력 → "닉네임은 20자 이하" 오류 메시지
- [ ] "저장" 버튼 비활성 (유효성 오류 또는 변경 없음)
- [ ] 유효한 닉네임 입력 → "저장" 활성 → 탭 → 헤더 닉네임 즉시 갱신, Sheet 닫힘
- [ ] Sheet 취소 → 닉네임 변경 없음

### 6.4 로그아웃

- [ ] "로그아웃" 탭 → 로그아웃 중 텍스트 표시 → `/login` 이동
- [ ] `/login` 이동 후 뒤로가기 → `/my` 재진입 불가 (redirect `/login`)

### 6.5 하단 탭 네비

- [ ] 홈(`/`)·피드(`/feed/today`)·마이(`/my`)에서 탭 표시
- [ ] `/challenge/[id]`, `/s/[id]`, `/login`에서 탭 미표시
- [ ] 현재 경로 탭 강조 표시 (`aria-current="page"`)

### 6.6 피드카드 → /s 진입 (#63)

- [ ] 피드 카드 이미지 영역 탭 → `/s/[id]` 공유 페이지 진입
- [ ] 공유 페이지에서 뒤로가기 → 피드로 복귀

### 6.7 비인증 접근 (로그아웃 상태)

- [ ] `/my` 직접 접속 → `/login` redirect
- [ ] `/my` 접속 후 로그인 → `/my` 재진입 가능

---

## 7. 커밋 가능 여부

| 항목 | 결과 |
|------|------|
| `pnpm type-check` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:run` (182 테스트) | PASS |
| Critical 이슈 | 0건 |
| High 이슈 | 0건 |
| Medium 이슈 (Reviewer 지적 포함) | **모두 해소 (0건 잔여)** |

**게이트 B 통과 조건 충족. 수동 모바일 체크리스트(§6) 완료 후 커밋·PR 진행 가능.**
