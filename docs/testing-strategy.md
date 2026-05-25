# Typolog — Testing Strategy

## 개요

MVP에서는 **핵심 UX와 보안에 직접 영향을 주는 부분**만 테스트한다. 100% 커버리지가 목표가 아니라, "이게 깨지면 서비스가 안 된다"는 부분을 보호하는 것이 목표.

### 테스트 피라미드

```
        ╱╲
       ╱ E2E ╲           소량 — 핵심 플로우만
      ╱────────╲
     ╱ Component ╲       중간 — 주요 인터랙션
    ╱──────────────╲
   ╱   Unit Test    ╲    다량 — 유틸, 로직
  ╱──────────────────╲
```

### 도구

| 테스트 종류 | 도구 | 설정 파일 |
|------------|------|----------|
| Unit / Component | Vitest + React Testing Library | `vitest.config.ts` |
| E2E | Playwright | `playwright.config.ts` |
| API | Vitest (Route Handler 직접 호출) | `vitest.config.ts` |
| Visual Regression | Playwright screenshot comparison | `playwright.config.ts` |

---

## Unit Test

### 대상

순수 함수, 유틸리티, 상태 로직 — UI가 아닌 **로직**을 테스트.

### 테스트할 모듈

| 모듈 | 테스트 내용 | 우선순위 |
|------|-----------|---------|
| `lib/canvas/crop.ts` | crop 좌표 계산, 이미지 리사이즈, WebP 변환 | 높음 |
| `lib/canvas/collage.ts` | 글자 배치 계산, 콜라주 레이아웃 로직 | 높음 |
| `lib/utils/exif-strip.ts` | EXIF 메타데이터 제거 확인 | 높음 |
| `lib/utils/image-validate.ts` | 파일 타입 검증, 크기 제한 검증 | 높음 |
| `stores/challenge-store.ts` | Zustand 상태 전이 (슬롯 채우기, 교체, 초기화) | 중간 |
| zod 스키마 | API 요청/응답 validation | 중간 |
| 날짜 유틸 | 오늘의 챌린지 날짜 결정, 타임존 처리 | 중간 |

### 예시 테스트 시나리오

**crop 좌표 계산**:
```
입력: 원본 이미지 (1000x800), crop 영역 (x:100, y:200, w:300, h:300)
기대: 300x300 영역이 정확히 잘려나옴
```

**EXIF strip**:
```
입력: EXIF 메타데이터(GPS 좌표 포함)가 있는 JPEG
기대: 출력 이미지에 EXIF 데이터 없음, 이미지 품질 유지
```

**Zustand store**:
```
초기: 6개 빈 슬롯
액션: slot 0에 이미지 저장
기대: slot 0만 filled, 나머지 비어있음, isComplete = false

초기: 5개 채움, 1개 비어있음
액션: 마지막 슬롯에 이미지 저장
기대: isComplete = true
```

---

## Component Test

### 대상

사용자 인터랙션이 있는 UI 컴포넌트 — 렌더링과 이벤트 핸들링 검증.

### 테스트할 컴포넌트

| 컴포넌트 | 테스트 내용 | 우선순위 |
|----------|-----------|---------|
| `LetterGrid` | 슬롯 상태별 렌더링 (빈/채운/선택), 슬롯 클릭 이벤트 | 높음 |
| `LetterSlot` | 빈 상태/채운 상태 표시, 터치 반응 | 높음 |
| `ImageCropper` | crop 영역 선택 UI 동작 (Canvas mock 필요) | 중간 |
| `FeedCard` | 콜라주 이미지/닉네임/좋아요 표시, 좋아요 토글 | 중간 |
| `BottomNav` | 현재 페이지 활성 표시, 네비게이션 | 낮음 |

### 테스트 접근법

- React Testing Library의 `render` + `userEvent` 사용
- Canvas API가 필요한 컴포넌트는 `jest-canvas-mock` 또는 로직을 유틸로 분리하여 개별 테스트
- TanStack Query 의존 컴포넌트는 `QueryClientProvider` wrapper 사용
- Supabase 호출은 MSW로 mock

---

## E2E Test

### 대상

실제 브라우저에서 사용자 시나리오 전체를 검증.

### 테스트할 시나리오

| # | 시나리오 | 우선순위 |
|---|---------|---------|
| E2E-1 | 로그인 → 오늘의 챌린지 확인 → 시작 | 높음 |
| E2E-2 | 글자 슬롯 터치 → 이미지 업로드 → crop → 슬롯 채우기 | 높음 |
| E2E-3 | 모든 슬롯 채우기 → 미리보기 → 콜라주 완성 → 제출 | 높음 |
| E2E-4 | 피드 조회 → 좋아요 → 좋아요 취소 | 중간 |
| E2E-5 | 공유 링크 접근 (비인증) → 콜라주 확인 → "나도 만들기" 클릭 | 중간 |
| E2E-6 | 신고하기 플로우 | 낮음 |
| E2E-7 | 프로필 닉네임 수정 | 낮음 |

### Playwright 설정 방향

```
// 모바일 우선
devices: ['iPhone 14', 'Pixel 7']

// 테스트 데이터
// Supabase에 테스트 전용 챌린지 + 사용자 seed
// 이미지 업로드는 fixture 파일 사용 (테스트용 글자 이미지)
```

### E2E 주의사항

- 카메라 촬영은 E2E로 테스트 불가 → 이미지 업로드(갤러리)로 대체
- Canvas 렌더링 결과는 스크린샷 비교로 검증
- OAuth 로그인은 Supabase의 테스트 모드 또는 이메일/비밀번호 테스트 계정 사용

---

## API Test

### 대상

Route Handler의 요청/응답, 인증/인가, 유효성 검증.

### 테스트할 API

| API | 테스트 내용 | 우선순위 |
|-----|-----------|---------|
| `POST /api/submissions` | 인증 필요 확인, 중복 제출 방지, draft 생성 | 높음 |
| `POST /api/submissions/[id]/letters` | 소유자만 업로드 가능, 파일 타입/크기 검증 | 높음 |
| `PATCH /api/submissions/[id]` | 소유자만 수정 가능, status 전이 규칙 | 높음 |
| `GET /api/feed` | cursor pagination 동작, 공개 제출만 반환, hidden 제외 | 중간 |
| `POST /api/reactions` | 좋아요 토글 동작, 중복 방지 | 중간 |
| `POST /api/reports` | 인증 필요, 사유 필수 | 중간 |
| `GET /api/challenges/today` | 오늘 날짜 기준 반환, 없을 때 처리 | 낮음 |

### 테스트 방법

- Vitest에서 Route Handler를 직접 import하여 호출
- Supabase는 테스트 DB 또는 MSW mock 사용
- 인증 상태는 Supabase 세션 mock으로 주입

### 보안 테스트 시나리오

| 시나리오 | 기대 결과 |
|---------|----------|
| 비인증 상태에서 제출 생성 | 401 반환 |
| 타인의 제출 수정 시도 | 403 반환 |
| 타인의 비공개 제출 조회 시도 | 404 반환 (존재 여부 노출 방지) |
| 잘못된 파일 타입 업로드 | 400 반환 |
| 크기 초과 파일 업로드 | 400 반환 |

---

## Visual Regression

### 대상

콜라주 렌더링 결과의 시각적 일관성. 코드 변경으로 콜라주 모양이 의도치 않게 바뀌는 것을 방지.

### MVP 범위

- 콜라주 렌더링 결과 스크린샷 비교 (Playwright)
- 기준: 고정 입력(글자 이미지 fixture)으로 동일한 콜라주가 생성되는가

### 접근법

```
1. fixture 글자 이미지 6개 준비
2. 콜라주 렌더링 함수에 입력
3. Playwright로 결과 스크린샷 촬영
4. 이전 스크린샷과 pixel 비교
5. 차이 발생 시 리뷰
```

**참고**: Visual regression은 Phase 4에서 설정. 초기에는 수동 확인.

---

## MVP에서 반드시 검증할 시나리오

이 목록에 있는 항목이 하나라도 실패하면 베타 출시하지 않는다.

### 기능 검증

| # | 시나리오 | 검증 방법 |
|---|---------|----------|
| 1 | 카메라로 사진 찍고 글자를 crop할 수 있다 | 수동 + E2E (업로드) |
| 2 | 모든 글자를 채우면 콜라주가 생성된다 | E2E |
| 3 | 콜라주 PNG를 다운로드/저장할 수 있다 | 수동 |
| 4 | 제출한 콜라주가 피드에 표시된다 | E2E |
| 5 | 공유 링크가 작동하고 OG 이미지가 표시된다 | 수동 (카카오톡/X) |
| 6 | 새로고침 해도 진행 중인 글자가 사라지지 않는다 | E2E |

### 보안 검증

| # | 시나리오 | 검증 방법 |
|---|---------|----------|
| 7 | 업로드된 이미지에 EXIF 데이터가 없다 | Unit test |
| 8 | 타인의 비공개 제출을 볼 수 없다 | API test |
| 9 | 타인의 제출을 수정/삭제할 수 없다 | API test |
| 10 | 인증 없이 보호 페이지에 접근하면 로그인으로 리다이렉트 | E2E |

### 성능 검증

| # | 시나리오 | 기준 |
|---|---------|------|
| 11 | 피드 초기 로딩 | 3초 이내 (모바일 4G) |
| 12 | 이미지 crop 반응 속도 | 터치에 100ms 이내 반응 |
| 13 | 콜라주 생성 시간 | 2초 이내 |

---

## 테스트 실행 전략

### 로컬 개발

```bash
# 유닛 + 컴포넌트 테스트 (변경된 파일만)
npm run test

# 전체 테스트
npm run test:all

# E2E (로컬 서버 필요)
npm run test:e2e
```

### CI (GitHub Actions)

```
PR 생성 시:
  1. lint + type-check
  2. unit + component test
  3. build

merge 시:
  4. E2E test (Playwright on CI)
```

### 테스트 데이터 관리

- Unit/Component: fixture 파일 (`tests/fixtures/`)
- E2E: Supabase 테스트 프로젝트 또는 로컬 Supabase
- API: MSW mock 또는 테스트 DB
- 이미지 fixture: `tests/fixtures/images/` (crop/collage 테스트용 글자 이미지)
