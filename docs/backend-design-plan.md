# Typolog — 백엔드/Supabase 설계 계획

> Phase 2~3 구현 전 정리하는 백엔드 설계 문서.
> 코드 작성 전에 전체 그림을 먼저 잡는다.

---

## 목차

1. [테이블 설계](#1-테이블-설계)
2. [관계 설계](#2-관계-설계)
3. [RLS 정책 초안](#3-rls-정책-초안)
4. [Storage 버킷 구조](#4-storage-버킷-구조)
5. [이미지 접근 권한 정책](#5-이미지-접근-권한-정책)
6. [API/Server Action 목록](#6-apiserver-action-목록)
7. [Validation 전략](#7-validation-전략)
8. [보안/개인정보 리스크](#8-보안개인정보-리스크)
9. [구현 순서](#9-구현-순서)
10. [이해해야 할 백엔드 개념](#10-이해해야-할-백엔드-개념)

---

## 1. 테이블 설계

### 전체 테이블 목록 (6개)

| 테이블 | 역할 | 레코드 수 예상 (베타 1개월) |
|--------|------|---------------------------|
| `profiles` | 사용자 프로필 (auth.users 확장) | ~100 |
| `challenges` | 오늘의 챌린지 문장 | ~30 |
| `submissions` | 사용자의 제출물 (draft/completed/hidden) | ~500 |
| `letter_pieces` | 글자 조각 이미지 메타데이터 | ~3,000 |
| `reactions` | 좋아요 | ~1,000 |
| `reports` | 신고 | ~10 |

> `event_logs`는 MVP에서 DB 테이블로 만들지 않는다. PostHog으로 전송.

---

### 1.1 profiles

```sql
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 자동 생성 trigger
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nickname)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      'user_' || LEFT(NEW.id::TEXT, 8)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
```

**설계 포인트**:
- PK가 `auth.users(id)`와 동일 → 1:1 관계
- `SECURITY DEFINER`: trigger 함수가 RLS를 우회해서 INSERT 가능
- `nickname` 기본값: OAuth에서 가져온 이름 또는 `user_` + UUID 앞 8자리
- `updated_at`은 수동 관리 (UPDATE 시 `now()` 세팅) — Drizzle에서 처리

**MVP에서 하지 않는 것**:
- `nickname` UNIQUE 제약 없음 (중복 허용)
- `avatar_url`은 필드만 예약, 업로드 기능 미구현

---

### 1.2 challenges

```sql
CREATE TABLE challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentence    TEXT NOT NULL,
  lines       TEXT[] NOT NULL,
  letters     TEXT[] NOT NULL,
  active_date DATE NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_challenges_active_date ON challenges(active_date);
```

**설계 포인트**:
- `active_date UNIQUE` → 날짜당 정확히 1개 문장
- `lines`는 **작성자가 지정한 줄 배열**(콜라주 줄 배치의 단일 소스). 예: "우리 동네 맛집" → `{'우리 동네','맛집'}` (단어 "동네"가 끊기지 않도록 작성자가 의도)
- `sentence`(표시용) = `lines`를 공백으로 join, `letters`(슬롯용) = `lines`의 각 줄에서 공백/특수문자 제거 후 flatten (예: "오늘도 화이팅" → `{'오','늘','도','화','이','팅'}`)
- seed SQL로 등록. Phase 2 관리자 UI는 줄별 입력(↔ `lines`). 현재 관리자 UI 없음
- 비인증 사용자도 조회 가능 (공유 페이지에서 문장 표시 필요)

**왜 letters/lines를 별도로 저장하나?**
- 클라이언트에서 "공백 제거"·"줄나눔" 로직을 중복 구현하지 않기 위해
- 서버에서 정답(슬롯 개수, 글자 순서, 줄 배치)을 한 번에 내려줌
- 줄 배치는 `lines`가 담당 — 알고리즘 줄나눔이 한글 단어를 중간에 끊는 문제를 작성자 지정으로 회피

---

### 1.3 submissions

```sql
CREATE TABLE submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenge_id      UUID NOT NULL REFERENCES challenges(id),
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'completed', 'hidden')),
  is_public         BOOLEAN NOT NULL DEFAULT true,
  collage_image_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,

  UNIQUE (user_id, challenge_id)
);

-- 피드 쿼리용 부분 인덱스
CREATE INDEX idx_submissions_feed
  ON submissions(challenge_id, created_at DESC, id)
  WHERE status = 'completed' AND is_public = true;

-- 사용자별 제출 목록
CREATE INDEX idx_submissions_user
  ON submissions(user_id, created_at DESC);
```

**상태 전이**:
```
[시작] → draft → completed → hidden (관리자/신고)
                      ↓
              is_public 토글 가능
```

**설계 포인트**:
- `UNIQUE (user_id, challenge_id)`: 사용자당 챌린지당 1개 제한
- `status = 'hidden'`으로의 전환은 서비스 키(Admin Client)만 가능
- `completed_at`은 모든 글자를 채우고 제출할 때 설정
- `collage_image_url`은 콜라주 PNG 업로드 후 채워짐
- `challenges(id)`에는 ON DELETE CASCADE 없음 — 챌린지는 삭제하지 않음

---

### 1.4 letter_pieces

```sql
CREATE TABLE letter_pieces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  character     TEXT NOT NULL,
  slot_index    INTEGER NOT NULL,
  image_url     TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (submission_id, slot_index)
);

CREATE INDEX idx_letter_pieces_submission
  ON letter_pieces(submission_id);
```

**설계 포인트**:
- `UNIQUE (submission_id, slot_index)`: 같은 슬롯에 두 장 불가
- 글자 교체 시 UPSERT: `ON CONFLICT (submission_id, slot_index) DO UPDATE`
- `character`는 표시/검증용 (OCR 안 함, 이미지 내용과 불일치해도 허용)
- `width`, `height`는 콜라주 렌더링 시 비율 계산용
- CASCADE: submission 삭제 시 글자 조각도 함께 삭제

---

### 1.5 reactions

```sql
CREATE TABLE reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'like',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, submission_id)
);

CREATE INDEX idx_reactions_submission ON reactions(submission_id);
```

**설계 포인트**:
- MVP에서 `type`은 `'like'`만 사용. 향후 이모지 확장 시 UNIQUE를 `(user_id, submission_id, type)`으로 변경
- 좋아요 토글 = INSERT or DELETE (UPDATE 없음)
- 자기 제출에 좋아요 허용 (제한 안 함)

---

### 1.6 reports

```sql
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**설계 포인트**:
- 중복 신고 허용 (UNIQUE 없음, MVP 단순화)
- 자유 텍스트 사유. 카테고리 분류 미적용
- 신고 내역은 일반 사용자 조회 불가 (관리자만)
- 처리: 관리자가 SQL로 확인 → `submissions.status = 'hidden'` 수동 처리

---

## 2. 관계 설계

### ER 다이어그램

```mermaid
erDiagram
    auth_users ||--|| profiles : "1:1 (trigger 생성)"
    profiles ||--o{ submissions : "작성 (user_id)"
    challenges ||--o{ submissions : "대상 (challenge_id)"
    submissions ||--o{ letter_pieces : "포함 (submission_id)"
    submissions ||--o{ reactions : "받음 (submission_id)"
    submissions ||--o{ reports : "신고됨 (submission_id)"
    profiles ||--o{ reactions : "누름 (user_id)"
    profiles ||--o{ reports : "신고함 (reporter_id)"
```

### 관계 요약

| 관계 | 타입 | FK 위치 | CASCADE |
|------|------|---------|---------|
| auth.users → profiles | 1:1 | profiles.id | ON DELETE CASCADE |
| profiles → submissions | 1:N | submissions.user_id | ON DELETE CASCADE |
| challenges → submissions | 1:N | submissions.challenge_id | 삭제 안 함 |
| submissions → letter_pieces | 1:N | letter_pieces.submission_id | ON DELETE CASCADE |
| submissions → reactions | 1:N | reactions.submission_id | ON DELETE CASCADE |
| submissions → reports | 1:N | reports.submission_id | ON DELETE CASCADE |
| profiles → reactions | 1:N | reactions.user_id | ON DELETE CASCADE |
| profiles → reports | 1:N | reports.reporter_id | ON DELETE CASCADE |

### CASCADE 삭제 체인

사용자가 계정을 삭제하면:
```
auth.users 삭제
  → profiles 삭제
    → submissions 삭제
      → letter_pieces 삭제
      → reactions (받은 것) 삭제
      → reports (받은 것) 삭제
    → reactions (누른 것) 삭제
    → reports (신고한 것) 삭제
```

> **주의**: Storage 파일은 CASCADE로 자동 삭제되지 않는다. 계정 삭제 시 Storage cleanup을 별도로 처리해야 함 (MVP에서는 수동 처리 또는 미처리).

---

## 3. RLS 정책 초안

### 3.0 RLS 활성화

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE letter_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
```

### 3.1 profiles

```sql
-- 모든 인증 사용자가 닉네임/아바타 조회 가능 (피드 카드)
CREATE POLICY "profiles_select"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- 본인만 수정 가능
CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- INSERT는 trigger만 (일반 사용자 차단)
-- DELETE 정책 없음 = 차단
```

### 3.2 challenges

```sql
-- 모든 사용자(비인증 포함) 조회 가능
CREATE POLICY "challenges_select"
  ON challenges FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT/UPDATE/DELETE는 정책 없음 = 차단 (서비스 키로만 접근)
```

### 3.3 submissions

```sql
-- 본인: 모든 상태 조회 / 타인: 공개 + 완성만
CREATE POLICY "submissions_select"
  ON submissions FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (status = 'completed' AND is_public = true)
  );

-- 비인증 사용자: 공개 완성 제출만 (공유 페이지)
CREATE POLICY "submissions_select_anon"
  ON submissions FOR SELECT
  TO anon
  USING (status = 'completed' AND is_public = true);

-- 본인만 생성 가능
CREATE POLICY "submissions_insert"
  ON submissions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 본인만 수정 가능 (단, status를 'hidden'으로 바꾸는 건 서비스 키만)
CREATE POLICY "submissions_update"
  ON submissions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND status != 'hidden'
  );

-- DELETE 정책 없음 = 차단
```

**핵심 판단 — 왜 `status != 'hidden'` 체크?**
- 일반 사용자가 `hidden` 상태로 직접 바꾸는 것을 방지
- 관리자(Admin Client, 서비스 키)는 RLS를 우회하므로 `hidden` 설정 가능
- 사용자가 `hidden`된 자기 제출을 `completed`로 되돌리는 것도 차단

### 3.4 letter_pieces

```sql
-- 본인 submission의 글자 조각 + 공개 submission의 글자 조각
CREATE POLICY "letter_pieces_select"
  ON letter_pieces FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND (
        s.user_id = auth.uid()
        OR (s.status = 'completed' AND s.is_public = true)
      )
    )
  );

-- 본인 submission에만 INSERT
CREATE POLICY "letter_pieces_insert"
  ON letter_pieces FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = auth.uid()
    )
  );

-- 본인 submission만 UPDATE (글자 교체 = UPSERT)
CREATE POLICY "letter_pieces_update"
  ON letter_pieces FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = auth.uid()
    )
  );

-- 본인 submission만 DELETE
CREATE POLICY "letter_pieces_delete"
  ON letter_pieces FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = auth.uid()
    )
  );
```

**성능 고려**: `EXISTS` 서브쿼리가 매번 실행됨. `submissions` 테이블의 인덱스(`idx_submissions_user`)가 커버.

### 3.5 reactions

```sql
-- 모든 인증 사용자가 좋아요 조회 가능
CREATE POLICY "reactions_select"
  ON reactions FOR SELECT
  TO authenticated
  USING (true);

-- 본인만 생성
CREATE POLICY "reactions_insert"
  ON reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 본인만 삭제 (좋아요 취소)
CREATE POLICY "reactions_delete"
  ON reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- UPDATE 정책 없음 = 차단
```

### 3.6 reports

```sql
-- SELECT 정책 없음 = 일반 사용자 조회 차단 (관리자만 서비스 키로)

-- 인증 사용자만 생성
CREATE POLICY "reports_insert"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- UPDATE/DELETE 정책 없음 = 차단
```

### RLS 정책 요약표

| 테이블 | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| profiles | 인증 사용자 전체 | trigger만 | 본인 | 차단 |
| challenges | anon + 인증 전체 | 서비스 키 | 서비스 키 | 서비스 키 |
| submissions | 본인: 전체 / 타인: 공개완성 / anon: 공개완성 | 인증(본인) | 본인 (hidden 제외) | 차단 |
| letter_pieces | submission 소유자 또는 공개 submission | submission 소유자 | submission 소유자 | submission 소유자 |
| reactions | 인증 전체 | 인증(본인) | 차단 | 본인 |
| reports | 차단 (서비스 키만) | 인증(본인) | 차단 | 차단 |

---

## 4. Storage 버킷 구조

### 버킷 3개

```
Supabase Storage
├── letter-pieces/          (Private 버킷)
│   └── {user_id}/
│       └── {submission_id}/
│           ├── 0.webp
│           ├── 1.webp
│           └── ...          (slot_index별)
│
├── collages/               (Private 버킷, 정책으로 공개 제출만 읽기 허용)
│   └── {user_id}/
│       └── {submission_id}/
│           └── collage.png
│
└── avatars/                (Public 버킷)
    └── {user_id}/
        └── avatar.webp
```

### 파일 네이밍 규칙

| 버킷 | 경로 패턴 | 포맷 | 크기 제한 |
|------|----------|------|----------|
| letter-pieces | `{user_id}/{submission_id}/{slot_index}.webp` | WebP | 500KB |
| collages | `{user_id}/{submission_id}/collage.png` | PNG | 2MB |
| avatars | `{user_id}/avatar.webp` | WebP | 500KB |

### 왜 이 구조인가?

- **user_id가 최상위**: Storage 정책에서 `auth.uid()`로 소유권 검사가 간결해짐
- **submission_id로 그루핑**: 제출물별 이미지를 한번에 관리 가능
- **slot_index가 파일명**: 글자 교체 시 같은 경로에 덮어쓰기 (별도 삭제 불필요)

---

## 5. 이미지 접근 권한 정책

### 5.1 letter-pieces 버킷 정책

```sql
-- 본인만 읽기
CREATE POLICY "letter_pieces_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- 본인만 쓰기
CREATE POLICY "letter_pieces_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- 본인만 덮어쓰기 (글자 교체)
CREATE POLICY "letter_pieces_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- 본인만 삭제
CREATE POLICY "letter_pieces_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
```

### 5.2 collages 버킷 정책

```sql
-- 본인이거나, 공개 제출인 경우 읽기 가능
CREATE POLICY "collages_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'collages'
    AND (
      -- 본인
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR
      -- 공개 제출: submission_id로 submissions 테이블 조인
      EXISTS (
        SELECT 1 FROM submissions s
        WHERE s.id = (storage.foldername(name))[2]::UUID
        AND s.status = 'completed'
        AND s.is_public = true
      )
    )
  );

-- 비인증 사용자도 공개 콜라주 읽기 가능 (공유 페이지)
CREATE POLICY "collages_read_anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'collages'
    AND EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = (storage.foldername(name))[2]::UUID
      AND s.status = 'completed'
      AND s.is_public = true
    )
  );

-- 본인만 쓰기
CREATE POLICY "collages_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'collages'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- 본인만 삭제
CREATE POLICY "collages_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'collages'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
```

### 5.3 avatars 버킷 정책

avatars는 Public 버킷이므로 RLS 정책 대신 버킷 설정으로 처리:
- **읽기**: 모든 사용자 (Public)
- **쓰기/삭제**: 본인만 (경로의 첫 번째 폴더 = auth.uid())

```sql
CREATE POLICY "avatars_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "avatars_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
```

### 5.4 collages 버킷의 한계와 대안

**문제**: Storage 정책에서 `submissions` 테이블을 조인하는 것은 동작하지만:
- 쿼리 성능 우려 (모든 이미지 접근마다 DB 조회)
- `storage.foldername(name)[2]`를 UUID로 캐스팅하는 것이 깨질 수 있음

**대안 (성능 문제 발견 시)**:
1. collages를 Public 버킷으로 변경하고, API 레벨에서 접근 제어
2. 비공개 콜라주 URL에는 Signed URL (만료 시간 포함) 사용
3. 공개 콜라주만 별도 `public-collages/` 버킷에 복사

> MVP에서는 Storage 정책으로 시작하고, 성능 이슈가 확인되면 대안으로 전환한다.

---

## 6. API/Server Action 목록

### 6.1 Route Handlers (GET + 파일 업로드)

| # | 경로 | 메서드 | 인증 | 설명 |
|---|------|--------|------|------|
| A1 | `/api/challenges/today` | GET | 불필요 | 오늘의 챌린지 문장 조회 |
| A2 | `/api/submissions` | POST | 필요 | 새 submission(draft) 생성 |
| A3 | `/api/submissions/[id]` | GET | 필요 | 제출물 상세 조회 (본인 or 공개) |
| A4 | `/api/submissions/[id]` | PATCH | 필요 | 제출물 업데이트 (status, is_public 등) |
| A5 | `/api/submissions/[id]/letters` | POST | 필요 | 글자 조각 업로드 (Storage + DB) |
| A6 | `/api/submissions/[id]/collage` | POST | 필요 | 콜라주 이미지 업로드 |
| A7 | `/api/feed` | GET | 필요 | 공개 피드 (cursor pagination) |
| A8 | `/api/og/[id]` | GET | 불필요 | OG 이미지 동적 생성 |

### 6.2 Server Actions (단순 mutation)

| # | 함수명 | 인증 | 설명 |
|---|--------|------|------|
| S1 | `toggleReaction` | 필요 | 좋아요 토글 (INSERT or DELETE) |
| S2 | `createReport` | 필요 | 신고 생성 |
| S3 | `updateProfile` | 필요 | 닉네임 수정 |
| S4 | `updateSubmissionVisibility` | 필요 | 공개/비공개 토글 |

### 6.3 각 API 상세

#### A1: GET `/api/challenges/today`

```
요청: GET /api/challenges/today
인증: 불필요
응답: {
  id, sentence, lines, letters, active_date
}
  // lines = 작성자 지정 줄 배치(콜라주 줄나눔의 단일 소스).
  // 클라이언트는 lines로 줄을 나누고, letters로 슬롯을 생성한다. (Challenge 타입과 동일)
로직:
  1. challenges 테이블에서 active_date = today인 레코드 조회
  2. 없으면 404
캐싱: 하루 단위 revalidate 가능 (Next.js ISR)
```

#### A2: POST `/api/submissions`

```
요청: POST /api/submissions
인증: 필요
Body: { challenge_id }
응답: { id, status: 'draft', ... }
로직:
  1. 오늘 날짜의 challenge인지 확인
  2. 이미 해당 challenge에 submission이 있는지 확인
     - 있으면 기존 submission 반환 (중복 생성 방지)
  3. 없으면 draft 생성
Validation: challenge_id는 UUID, 오늘의 챌린지와 일치
```

#### A5: POST `/api/submissions/[id]/letters`

```
요청: POST /api/submissions/[id]/letters
인증: 필요
Body: FormData { image (File), slot_index (number), character (string) }
응답: { id, image_url, slot_index, ... }
로직:
  1. submission이 본인 것인지 + draft 상태인지 확인
  2. slot_index가 유효한 범위인지 확인 (0 ~ letters.length - 1)
  3. 이미지 검증: WebP, 500KB 이하
  4. Storage에 업로드: letter-pieces/{user_id}/{submission_id}/{slot_index}.webp
  5. letter_pieces 테이블에 UPSERT
  6. 이미지 URL 반환
```

#### A7: GET `/api/feed`

```
요청: GET /api/feed?challenge_id=xxx&cursor=xxx&limit=20
인증: 필요
응답: {
  items: [{ submission, profile, reaction_count, user_reacted }],
  next_cursor: string | null
}
로직:
  1. status='completed' AND is_public=true 필터
  2. cursor pagination: (created_at, id) 복합 커서
  3. 각 submission에 좋아요 수 + 현재 사용자 좋아요 여부 포함
  4. profile join (닉네임, 아바타)
커서 형식: `{created_at}_{id}` (ISO timestamp + UUID)
```

#### S1: toggleReaction

```typescript
// Server Action
async function toggleReaction(submissionId: string) {
  // 1. 현재 사용자의 reaction이 있는지 확인
  // 2. 있으면 DELETE, 없으면 INSERT
  // 3. 새 좋아요 수 반환
  // TanStack Query에서 optimistic update 처리
}
```

### 6.4 Route Handler vs Server Action 선택 기준

```
GET 요청?           → Route Handler (TanStack Query 연동)
파일 업로드 포함?    → Route Handler (multipart/form-data)
비인증 접근?         → Route Handler
단순 mutation?      → Server Action (form 기반, 간결)
```

---

## 7. Validation 전략

### 7.1 Zod 스키마 공유

클라이언트와 서버에서 같은 zod 스키마를 사용한다.

```
src/lib/validations/
├── challenge.ts      # challengeIdSchema
├── submission.ts     # createSubmissionSchema, updateSubmissionSchema
├── letter-piece.ts   # uploadLetterSchema
├── reaction.ts       # toggleReactionSchema
├── report.ts         # createReportSchema
└── profile.ts        # updateProfileSchema
```

### 7.2 주요 Validation 규칙

| 필드 | 검증 | 위치 |
|------|------|------|
| `nickname` | 2~20자, 트림, XSS 문자 제거 | 클라이언트 + 서버 |
| `challenge_id` | UUID 형식 + 오늘 날짜 챌린지 존재 확인 | 서버 |
| `slot_index` | 0 이상 정수, 챌린지 letters 길이 미만 | 서버 |
| `image` (letter) | WebP, 500KB 이하 | 클라이언트 + 서버 |
| `image` (collage) | PNG, 2MB 이하 | 클라이언트 + 서버 |
| `reason` (신고) | 1~500자, 트림 | 클라이언트 + 서버 |
| `is_public` | boolean | 서버 |

### 7.3 서버 Validation 흐름

```
요청 도착
  → 1. 인증 확인 (Supabase Auth 세션)
  → 2. 요청 바디 zod 파싱
  → 3. 비즈니스 로직 검증 (소유권, 상태, 존재 여부)
  → 4. DB 쿼리 실행
  → 5. 응답
```

### 7.4 에러 응답 형식

```typescript
// 표준 에러 응답
type ApiError = {
  error: string;      // 사용자 표시용 메시지
  code: string;       // 프로그래밍용 코드
  details?: unknown;  // zod validation 에러 상세 (개발 모드만)
}

// HTTP 상태 코드 사용
// 400: validation 실패
// 401: 미인증
// 403: 권한 없음 (본인 소유가 아닌 경우)
// 404: 존재하지 않음 (비공개 제출에 타인이 접근 시에도 404)
// 409: 충돌 (이미 존재하는 submission)
// 413: 파일 크기 초과
```

**중요**: 비공개 제출에 타인이 접근하면 403이 아니라 **404를 반환**한다. 존재 여부 자체를 숨기기 위해.

### 7.5 파일 업로드 검증

서버에서 반드시 재검증해야 하는 항목:
1. **MIME type**: `Content-Type` 헤더 + 파일 매직 바이트 확인
2. **파일 크기**: 설정된 제한 이하
3. **확장자**: WebP 또는 PNG만 허용
4. **이미지 유효성**: 실제로 디코딩 가능한 이미지인지 (선택적, MVP에서는 MIME만)

> 클라이언트에서 EXIF를 strip하지만, 악의적 사용자가 직접 API를 호출할 수 있으므로 **서버에서도 EXIF strip을 수행하는 것이 이상적**. MVP에서는 클라이언트 EXIF strip만 구현하되, 서버 EXIF strip은 리스크로 기록.

---

## 8. 보안/개인정보 리스크

### 8.1 리스크 매트릭스

| # | 리스크 | 심각도 | 발생 가능성 | 대응 |
|---|--------|--------|------------|------|
| R1 | EXIF GPS 데이터 유출 | 높음 | 중간 | 클라이언트 EXIF strip + 서버 재검증(이상적) |
| R2 | 비공개 제출 URL 추측 | 중간 | 낮음 | UUID v4 (추측 불가능) + RLS + 404 응답 |
| R3 | Storage 직접 URL 접근 | 중간 | 중간 | Private 버킷 + Storage RLS 정책 |
| R4 | 서비스 키 노출 | 높음 | 낮음 | 환경변수 관리, 서버에서만 사용, 클라이언트 번들에 포함 안 됨 |
| R5 | 과도한 파일 업로드 (남용) | 중간 | 중간 | 파일 크기 제한 + Rate limiting (향후) |
| R6 | XSS (닉네임, 신고 사유) | 중간 | 낮음 | React의 기본 이스케이핑 + zod sanitize |
| R7 | 타인 submission 수정 | 높음 | 낮음 | RLS `user_id = auth.uid()` + API 레벨 소유권 확인 |
| R8 | 숨김 처리된 콘텐츠 복원 | 중간 | 낮음 | RLS에서 `status != 'hidden'` 체크 |
| R9 | 인증 토큰 탈취 | 높음 | 낮음 | Supabase Auth의 JWT + HTTP-only 쿠키 |
| R10 | 원본 이미지 유출 | 높음 | 낮음 | 원본 미저장 (crop 이미지만) |

### 8.2 개인정보 보호 조치

| 조치 | 설명 | 구현 위치 |
|------|------|----------|
| EXIF strip | 이미지 업로드 전 메타데이터 제거 (GPS, 카메라 정보 등) | 클라이언트 (Canvas API) |
| 원본 미저장 | crop된 영역만 저장, 원본 사진은 서버에 전송하지 않음 | 클라이언트 |
| 비공개 옵션 | 제출 시 공개/비공개 선택 가능 | DB (is_public) |
| 존재 숨김 | 비공개 제출에 접근 시 404 (403 아님) | API |
| 최소 수집 | PostHog 이벤트에 개인정보 미포함 | 이벤트 설계 |
| CASCADE 삭제 | 계정 삭제 시 모든 관련 데이터 자동 삭제 | DB FK |

### 8.3 MVP에서 미대응하지만 인지해야 할 것

1. **서버 EXIF strip**: 악의적 사용자가 API를 직접 호출해 EXIF 포함 이미지를 업로드할 수 있음. 서버에서 sharp 등으로 재처리하는 것이 이상적이나, MVP에서는 미구현
2. **Rate limiting**: API 레벨 rate limiting 없음. 남용 시 Supabase 제한에 의존
3. **Storage cleanup**: 계정 삭제 시 DB는 CASCADE로 정리되지만 Storage 파일은 남음
4. **Content moderation**: 부적절한 이미지 업로드 탐지 없음. 신고 + 수동 처리에 의존
5. **CSRF**: Server Action은 Next.js가 기본 CSRF 보호 제공. Route Handler는 Supabase Auth 토큰 검증으로 대체
6. **Kakao OAuth**: Supabase에서 Kakao는 커스텀 OIDC 설정 필요. Google보다 설정 복잡

### 8.4 RLS·trigger·Storage 구현 시 반드시 지킬 것 (Supabase 공식 스킬 반영, 2026-06)

`supabase` Agent Skill(`.claude/skills/supabase`)이 짚은 Supabase 고유 보안 함정. RLS/trigger/Storage 정책 작성 시 점검한다.

1. **UPDATE 정책엔 SELECT 정책도 필요**: RLS에서 UPDATE는 대상 행을 먼저 SELECT한다. SELECT 정책이 없으면 update가 에러 없이 0행 처리된다. (submissions·letter_pieces 확인)
2. **UPDATE 정책은 `USING` + `WITH CHECK` 둘 다**: WITH CHECK가 없으면 사용자가 행의 `user_id`를 타인 것으로 재할당할 수 있다.
3. **`SECURITY DEFINER` 주의**: `handle_new_user()`는 RLS를 우회한다. public 스키마의 SECURITY DEFINER 함수는 `anon`/`authenticated`가 EXECUTE 가능하므로, 본문에 검증을 두고 권한 에러를 SECURITY DEFINER로 덮지 않는다.
4. **Storage upsert엔 INSERT+SELECT+UPDATE 모두**: 글자 교체(UPSERT) 시 INSERT만 주면 덮어쓰기가 조용히 실패한다. (letter-pieces 정책, Day 3)
5. **인증 결정에 `user_metadata` 금지**: `raw_user_meta_data`는 사용자가 수정 가능. 인가는 `app_metadata`로. 노출 스키마의 모든 테이블에 RLS enable.

> 정책엔 `TO authenticated`/`TO anon`로 역할을 직접 지정하고(`auth.role()` 지양), `USING`에 소유권 술어를 함께 둔다. 변경 후 `supabase db advisors`(또는 MCP `get_advisors`)로 점검 권장.

---

## 9. 구현 순서

> **도구/스킬 메모**: Supabase Agent Skills(`supabase`, `supabase-postgres-best-practices`)가 설치되어 있다 — 구현 시 참고하되 **본 설계 문서가 source of truth**다. 특히 `supabase` 스킬은 마이그레이션을 Supabase CLI 관점으로 안내하므로, 우리 마이그레이션 방식(drizzle-kit / Supabase CLI / 하이브리드)은 Day 1 브리핑에서 명시적으로 확정한다.

### Phase 2 구현 순서 (5일)

```
Day 1: 기반 설정
├── 2-1. Supabase 프로젝트 생성 + API 키 확보
├── 2-2. Drizzle 스키마 정의 (src/db/schema.ts)
├── 2-3. SQL 마이그레이션 작성 + 실행 (6개 테이블 + 인덱스)
├── 2-4. RLS 정책 SQL 작성 + 적용
└── 2-5. DB trigger 작성 (profiles 자동 생성)

Day 2: 인증 + 클라이언트
├── 2-6. Supabase 클라이언트 3종 구현
│   ├── src/lib/supabase/browser.ts  (Browser Client, RLS O)
│   ├── src/lib/supabase/server.ts   (Server Client, RLS O)
│   └── src/lib/supabase/admin.ts    (Admin Client, RLS X)
├── 2-7. Supabase Auth 연동 (Google OAuth)
│   ├── /login 페이지 수정
│   ├── /api/auth/callback Route Handler
│   └── 세션 관리 (쿠키)
├── 2-8. Next.js Middleware (인증 체크)
└── 2-9. profiles trigger 동작 확인

Day 3: 핵심 API + Storage
├── 2-10. Storage 버킷 3개 생성 + 정책 적용
├── 2-11. GET /api/challenges/today (+ seed 데이터 2주치)
├── 2-12. POST /api/submissions (draft 생성)
├── 2-13. POST /api/submissions/[id]/letters (글자 업로드)
└── 2-14. zod validation 스키마 작성

Day 4: 제출 완성 + 동기화
├── 2-15. POST /api/submissions/[id]/collage (콜라주 업로드)
├── 2-16. PATCH /api/submissions/[id] (status: completed)
├── 2-17. GET /api/submissions/[id] (상세 조회)
├── 2-18. Zustand → Server 동기화 흐름 구현
└── 2-19. TanStack Query 연동 (useQuery/useMutation)

Day 5: 검증 + 마무리
├── 2-20. RLS 동작 검증 (타인 접근 시나리오)
├── 2-21. 전체 플로우 E2E 확인 (로그인 → 업로드 → 제출)
├── 2-22. 에러 처리 + edge case 대응
└── 2-23. .env.local.example 정리
```

### Phase 3 구현 순서 (5일)

```
Day 6: 피드
├── 3-1. GET /api/feed (cursor pagination)
├── 3-2. 피드 화면 구현 + 무한 스크롤
└── 3-3. 피드 카드 UI (콜라주, 닉네임, 좋아요 수)

Day 7: 반응 + 신고
├── 3-4. toggleReaction Server Action
├── 3-5. 좋아요 UI (optimistic update)
├── 3-6. createReport Server Action
└── 3-7. 신고 UI (다이얼로그)

Day 8: 공유
├── 3-8. /share/[id] 페이지 (비인증 접근)
├── 3-9. OG 이미지 생성 (@vercel/og)
├── 3-10. 공유 링크 복사 + Web Share API
└── 3-11. 공유 페이지에서 "나도 만들기" CTA

Day 9: 마이페이지 + 프로필
├── 3-12. /my 페이지 (내 콜라주 목록)
├── 3-13. updateSubmissionVisibility Server Action
├── 3-14. updateProfile Server Action
└── 3-15. 프로필 수정 UI

Day 10: 통합 검증
├── 3-16. 전체 플로우 점검
├── 3-17. 크로스 유저 시나리오 검증
└── 3-18. 성능 기본 점검 (피드 쿼리 속도)
```

### 의존 관계 그래프

```mermaid
graph TD
    subgraph "Day 1"
        D1[Supabase 프로젝트] --> D2[Drizzle 스키마]
        D2 --> D3[마이그레이션]
        D3 --> D4[RLS 정책]
        D3 --> D5[DB trigger]
    end

    subgraph "Day 2"
        D1 --> D6[Supabase 클라이언트]
        D6 --> D7[Auth 연동]
        D7 --> D8[Middleware]
        D5 --> D9[trigger 확인]
    end

    subgraph "Day 3"
        D6 --> D10[Storage 버킷]
        D3 --> D11[챌린지 API + seed]
        D8 --> D12[submission 생성]
        D10 --> D13[글자 업로드]
    end

    subgraph "Day 4"
        D13 --> D15[콜라주 업로드]
        D12 --> D16[status 업데이트]
        D16 --> D17[상세 조회]
        D17 --> D18[동기화]
    end

    subgraph "Day 5"
        D4 --> D20[RLS 검증]
        D18 --> D21[E2E 확인]
    end
```

---

## 10. 이해해야 할 백엔드 개념

### 10.1 Supabase Auth — OAuth가 동작하는 방식

```
사용자 → "Google로 로그인" 클릭
  → Supabase Auth → Google OAuth 서버로 리다이렉트
    → 사용자가 Google에서 인증
      → Google → Supabase callback URL로 리다이렉트 (code 포함)
        → Supabase가 code를 access_token으로 교환
          → auth.users에 레코드 생성 (또는 기존 사용자 매칭)
            → JWT 발급 → 쿠키에 저장 → 원래 페이지로 리다이렉트
```

**이해할 것**: 우리 코드에서 비밀번호를 다루지 않는다. Supabase가 모든 인증 흐름을 처리하고, 우리는 결과인 JWT를 받아서 사용한다.

### 10.2 RLS (Row Level Security) — DB가 스스로 지키는 문

**개념**: 테이블에 "이 행은 누가 볼 수 있는가?" 규칙을 SQL로 붙이는 것.

```sql
-- 이 정책이 없으면 아무도 submissions를 읽을 수 없다
CREATE POLICY "본인 것만 보기"
  ON submissions FOR SELECT
  USING (user_id = auth.uid());  -- auth.uid()는 현재 로그인한 사용자의 ID
```

**왜 중요한가**: API 코드에서 `WHERE user_id = ...`를 빠뜨려도 RLS가 마지막 방어선. 하지만 RLS에만 의존하지 말고 API에서도 검증한다 (방어적 프로그래밍).

**주의**: Admin Client(서비스 키)는 RLS를 우회한다. 서비스 키는 절대 클라이언트에 노출하면 안 된다.

### 10.3 Drizzle ORM — SQL을 TypeScript로

**역할**: SQL 쿼리를 TypeScript 함수로 작성. 타입 안전성 보장.

```typescript
// SQL: SELECT * FROM submissions WHERE user_id = '...' AND status = 'completed'
const result = await db
  .select()
  .from(submissions)
  .where(
    and(
      eq(submissions.userId, userId),
      eq(submissions.status, 'completed')
    )
  );
// result의 타입이 자동으로 Submission[]
```

**Supabase JS Client와의 차이**:
- Supabase JS: `supabase.from('submissions').select('*')` — RLS 적용, 편리하지만 타입이 약함
- Drizzle: 직접 PostgreSQL 연결, 풍부한 타입, 복잡한 쿼리 가능
- **우리의 선택**: Auth/Storage → Supabase JS, DB 쿼리 → Drizzle

### 10.4 Server Actions vs Route Handlers

```
Server Action:
  - 서버에서 실행되는 함수를 클라이언트에서 직접 호출
  - 'use server' 지시어
  - 주로 간단한 mutation (좋아요 토글, 프로필 수정)
  - form과 잘 연동

Route Handler:
  - REST API 엔드포인트
  - GET/POST/PATCH/DELETE 메서드
  - 파일 업로드, 복잡한 응답, 비인증 접근이 필요할 때
  - TanStack Query와 잘 연동
```

### 10.5 Cursor Pagination — 왜 offset이 아닌가

```
Offset pagination: "10번째부터 20개 보여줘"
  → 문제: 새 게시물이 추가되면 중복/누락 발생

Cursor pagination: "이 게시물 다음부터 20개 보여줘"
  → 실시간 피드에서 안전, 중복 없음
```

**우리의 커서**: `created_at` + `id` 조합 (같은 시각에 생성된 제출이 있을 수 있으므로 id로 구분)

### 10.6 CASCADE 삭제 — 왜 명시하는가

```sql
submissions.user_id REFERENCES profiles(id) ON DELETE CASCADE
```

이것은 "profiles 행이 삭제되면, 그 user_id를 참조하는 submissions도 자동 삭제"를 의미.

**주의**: CASCADE는 DB 안에서만 동작. Storage의 파일은 별도로 삭제해야 함.

### 10.7 UPSERT — INSERT와 UPDATE를 하나로

```sql
INSERT INTO letter_pieces (submission_id, slot_index, character, image_url, width, height)
VALUES (...)
ON CONFLICT (submission_id, slot_index)
DO UPDATE SET image_url = EXCLUDED.image_url, width = EXCLUDED.width, ...
```

글자 교체 시: 같은 슬롯에 새 이미지를 넣으면, 기존 레코드가 있으면 UPDATE, 없으면 INSERT.

### 10.8 부분 인덱스 (Partial Index)

```sql
CREATE INDEX idx_submissions_feed
  ON submissions(challenge_id, created_at DESC, id)
  WHERE status = 'completed' AND is_public = true;
```

**왜 부분 인덱스?**: 피드 쿼리는 항상 `completed + public`만 조회. draft나 hidden은 인덱스에 포함할 필요 없음 → 인덱스 크기 감소, 조회 속도 향상.

### 10.9 JWT와 쿠키 기반 세션

```
JWT (JSON Web Token):
  - Supabase Auth가 발급하는 인증 토큰
  - 안에 user_id, 만료 시간 등이 담겨있음
  - 서버에서 검증할 때 DB 조회 없이 토큰 자체만으로 확인 가능

쿠키:
  - JWT를 브라우저 쿠키에 저장
  - 모든 요청에 자동으로 포함됨
  - HTTP-only 설정으로 JavaScript에서 직접 접근 차단 (XSS 방어)
```

### 10.10 세 가지 Supabase 클라이언트의 차이

```
Browser Client (createBrowserClient):
  → 브라우저에서 실행
  → 사용자의 JWT로 인증
  → RLS가 적용됨
  → 주로 Storage 업로드에 사용

Server Client (createServerClient):
  → Next.js 서버에서 실행
  → 쿠키에서 JWT를 읽어 인증
  → RLS가 적용됨 (사용자 컨텍스트)
  → Route Handler, Server Component에서 사용

Admin Client (createClient with service_role key):
  → Next.js 서버에서만 실행
  → 서비스 키로 인증
  → RLS를 완전히 우회 (모든 행 접근 가능)
  → 챌린지 등록, 신고 처리 등 관리 작업에만 사용
  → ⚠️ 절대 클라이언트에 노출 금지
```

---

## 부록: Drizzle 스키마 구조 참고

```
src/db/
├── schema.ts         # 모든 테이블 정의 (Drizzle)
├── index.ts          # DB 연결 + export
└── migrations/       # SQL 마이그레이션 파일들

src/lib/supabase/
├── browser.ts        # Browser Client
├── server.ts         # Server Client
└── admin.ts          # Admin Client

src/lib/validations/
├── challenge.ts
├── submission.ts
├── letter-piece.ts
├── reaction.ts
├── report.ts
└── profile.ts
```

## 부록: Seed SQL 예시

불변식: `sentence = array_to_string(lines, ' ')`, `letters = lines의 각 줄에서 공백 제거 후 flatten`.
세 컬럼 모두 NOT NULL이지만 `lines`가 단일 소스이며 나머지 둘은 파생값을 미리 저장(denormalize)한 것이다.
공백이 포함된 줄은 PostgreSQL 배열 리터럴에서 `"..."`로 감싼다.

```sql
-- 아래 10건은 Phase 1 mock(src/lib/constants/challenges.ts)과 1:1로 일치한다.
INSERT INTO challenges (sentence, lines, letters, active_date) VALUES
  ('오늘도 화이팅',   '{"오늘도","화이팅"}',   '{오,늘,도,화,이,팅}',     '2026-05-26'),
  ('참 좋은 날',      '{"참 좋은 날"}',        '{참,좋,은,날}',           '2026-05-27'),
  ('어서 오세요',     '{"어서 오세요"}',       '{어,서,오,세,요}',        '2026-05-28'),
  ('오늘 뭐 먹지',    '{"오늘 뭐 먹지"}',      '{오,늘,뭐,먹,지}',        '2026-05-29'),
  ('좋아하는 것',     '{"좋아하는 것"}',       '{좋,아,하,는,것}',        '2026-05-30'),
  ('잘 지내고 있어',  '{"잘 지내고","있어"}',  '{잘,지,내,고,있,어}',     '2026-05-31'),
  ('오늘의 기분',     '{"오늘의 기분"}',       '{오,늘,의,기,분}',        '2026-06-01'),
  ('우리 동네 맛집',  '{"우리 동네","맛집"}',  '{우,리,동,네,맛,집}',     '2026-06-02'),
  ('오늘 참 수고했어','{"오늘 참","수고했어"}','{오,늘,참,수,고,했,어}',  '2026-06-03'),
  ('이 순간을 기억해','{"이 순간을","기억해"}','{이,순,간,을,기,억,해}',  '2026-06-04');

-- 2026-06-05 이후 분량(roadmap 2-7 "seed 2주치", Phase 5 베타 전)은 작성자가 lines를 직접 지정해 추가한다.
```
