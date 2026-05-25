# Typolog — Event Logging Design

## 개요

모든 제품 이벤트는 **PostHog**으로 전송한다. MVP에서는 DB에 별도 저장하지 않는다.

이벤트 설계 원칙:
1. **동사 기반 네이밍**: `{대상}_{행동}` 형식 (예: `challenge_started`)
2. **최소 속성**: 분석에 필요한 최소한의 속성만 기록
3. **개인정보 미포함**: 사진 내용, 위치 정보, EXIF 데이터를 이벤트에 포함하지 않음
4. **자동 속성 활용**: PostHog이 자동 수집하는 기기, 브라우저, URL 정보에 의존

## 이벤트 목록

### 챌린지 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `challenge_viewed` | 홈 화면에서 오늘의 문장을 확인했을 때 | `challenge_id`, `sentence_length` |
| `challenge_started` | "시작하기" 버튼을 클릭했을 때 | `challenge_id`, `sentence_length` |
| `challenge_resumed` | 진행 중인 챌린지를 "이어하기"로 재개했을 때 | `challenge_id`, `filled_count`, `total_count` |

### 글자 수집 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `letter_slot_tapped` | 빈 슬롯을 터치했을 때 | `challenge_id`, `slot_index`, `character` |
| `letter_capture_started` | 카메라 촬영 또는 이미지 업로드를 시작했을 때 | `challenge_id`, `slot_index`, `method` ("camera" / "gallery") |
| `letter_capture_cancelled` | 촬영/업로드를 취소했을 때 | `challenge_id`, `slot_index`, `method` |
| `letter_cropped` | 이미지에서 글자를 crop 완료했을 때 | `challenge_id`, `slot_index`, `crop_duration_ms` |
| `letter_crop_cancelled` | crop 화면에서 취소했을 때 | `challenge_id`, `slot_index` |
| `letter_replaced` | 이미 채운 슬롯의 글자를 교체했을 때 | `challenge_id`, `slot_index` |

### 콜라주 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `collage_preview_entered` | 모든 글자 채운 후 미리보기 화면에 진입했을 때 | `challenge_id`, `total_duration_ms` |
| `collage_background_changed` | 콜라주 배경색을 변경했을 때 | `challenge_id`, `background_color` |
| `collage_edit_returned` | 미리보기에서 "다시 수정"을 눌러 수집 화면으로 돌아갔을 때 | `challenge_id` |
| `collage_completed` | "완성하기" 버튼을 눌러 콜라주 PNG가 생성됐을 때 | `challenge_id`, `total_duration_ms` |

### 제출 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `submission_created` | 콜라주를 제출했을 때 | `challenge_id`, `submission_id`, `is_public` |
| `submission_visibility_changed` | 공개/비공개를 전환했을 때 | `submission_id`, `is_public` |

### 공유 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `share_link_copied` | 공유 링크를 클립보드에 복사했을 때 | `submission_id` |
| `share_triggered` | Web Share API로 공유를 트리거했을 때 | `submission_id`, `share_method` |
| `share_page_viewed` | /share/[id] 페이지가 조회됐을 때 (비인증 포함) | `submission_id`, `is_authenticated` |
| `share_page_cta_clicked` | 공유 페이지에서 "나도 만들기" 클릭 | `submission_id` |

### 피드 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `feed_viewed` | 피드 화면에 진입했을 때 | `challenge_id` |
| `feed_scrolled` | 피드에서 스크롤하여 다음 페이지를 로드했을 때 | `challenge_id`, `page_number` |
| `feed_card_tapped` | 피드에서 콜라주 카드를 터치했을 때 | `submission_id` |
| `reaction_toggled` | 좋아요를 눌렀거나 취소했을 때 | `submission_id`, `action` ("added" / "removed") |

### 신고 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `report_started` | 신고 다이얼로그를 열었을 때 | `submission_id` |
| `report_submitted` | 신고를 제출했을 때 | `submission_id`, `reason_length` |

### 인증 관련

| 이벤트 | 발생 시점 | Properties |
|--------|----------|------------|
| `login_started` | 로그인 버튼을 클릭했을 때 | `provider` ("google" / "kakao") |
| `login_completed` | 로그인 성공 콜백 처리됐을 때 | `provider`, `is_new_user` |
| `logout` | 로그아웃했을 때 | — |

## Properties 예시

### `letter_cropped` 이벤트 전체 예시

```json
{
  "event": "letter_cropped",
  "properties": {
    "challenge_id": "abc-123",
    "slot_index": 2,
    "crop_duration_ms": 4500
  },
  "$set": {
    "total_letters_cropped": 15
  }
}
```

PostHog 자동 수집 (별도 설정 불필요):
- `$current_url`: 현재 페이지 URL
- `$device_type`: mobile / desktop
- `$browser`: Chrome / Safari
- `$os`: iOS / Android
- `$screen_width`, `$screen_height`
- `$referrer`: 유입 경로

## 핵심 퍼널 정의

### 퍼널 1: 챌린지 완성 퍼널 (가장 중요)

사용자가 오늘의 문장을 보고 콜라주를 완성하기까지의 여정.

```
challenge_viewed          (100%)
  → challenge_started     (목표: 60%)
    → letter_cropped      (첫 글자 완료, 목표: 80%)
      → collage_preview_entered  (모든 글자 완료, 목표: 50%)
        → submission_created     (제출, 목표: 90%)
```

**분석 포인트**:
- viewed → started 이탈: 문장이 매력적이지 않거나 진입 장벽
- started → first letter: 카메라/crop UX 문제
- first letter → all letters: 글자 수가 많으면 이탈? 몇 번째 글자에서 포기?
- preview → submit: 완성했는데 제출하지 않는 이유?

### 퍼널 2: 공유 퍼널

완성된 콜라주가 외부로 공유되는 비율.

```
submission_created        (100%)
  → share_link_copied     (목표: 30%)
    → share_page_viewed   (목표: 50% of shared)
      → share_page_cta_clicked  (목표: 20% of viewed)
        → login_completed (신규 가입, 바이럴 계수)
```

### 퍼널 3: 피드 참여 퍼널

피드에서의 소비 행동.

```
feed_viewed               (100%)
  → feed_card_tapped      (목표: 40%)
    → reaction_toggled    (목표: 30%)
```

## 사용자 속성 (User Properties)

PostHog의 `$set`으로 누적 관리할 사용자 속성:

| 속성 | 타입 | 설명 |
|------|------|------|
| `total_submissions` | number | 총 제출 수 |
| `total_letters_cropped` | number | 총 crop한 글자 수 |
| `total_shares` | number | 총 공유 횟수 |
| `last_submission_date` | date | 마지막 제출일 |
| `signup_date` | date | 가입일 |

## 구현 가이드

### PostHog 래퍼 함수

```typescript
// 예시 — 실제 구현은 Phase 4에서
import posthog from 'posthog-js'

export function trackEvent(
  name: string,
  properties?: Record<string, unknown>
) {
  posthog.capture(name, properties)
}
```

### 이벤트 심는 위치

| 위치 | 방법 |
|------|------|
| 페이지 진입 이벤트 | `useEffect`에서 한 번 |
| 버튼 클릭 이벤트 | onClick 핸들러 |
| 비동기 완료 이벤트 | mutation의 onSuccess 콜백 |
| 서버 사이드 이벤트 | Route Handler에서 직접 호출 (필요 시) |

### 주의사항

1. **개발 환경 필터링**: `NODE_ENV === 'development'`일 때는 PostHog 비활성화 또는 별도 프로젝트
2. **이벤트 이름 일관성**: 항상 snake_case, 동일한 접두어 패턴 유지
3. **과도한 이벤트 방지**: 스크롤, resize 등 빈도 높은 이벤트는 debounce/throttle 적용
