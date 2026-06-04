-- Custom SQL migration file, put your code below! --

-- ─────────────────────────────────────────────
-- §3.0 RLS 활성화
-- ─────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE letter_pieces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.1 profiles
-- ─────────────────────────────────────────────

-- 모든 인증 사용자가 닉네임/아바타 조회 가능 (피드 카드)
CREATE POLICY "profiles_select"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);
--> statement-breakpoint

-- 본인만 수정 가능
CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.2 challenges
-- ─────────────────────────────────────────────

-- 모든 사용자(비인증 포함) 조회 가능
CREATE POLICY "challenges_select"
  ON challenges FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.3 submissions
-- ─────────────────────────────────────────────

-- 본인: 모든 상태 조회 / 타인: 공개 + 완성만
CREATE POLICY "submissions_select"
  ON submissions FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (status = 'completed' AND is_public = true)
  );
--> statement-breakpoint

-- 비인증 사용자: 공개 완성 제출만 (공유 페이지)
CREATE POLICY "submissions_select_anon"
  ON submissions FOR SELECT
  TO anon
  USING (status = 'completed' AND is_public = true);
--> statement-breakpoint

-- 본인만 생성 가능
CREATE POLICY "submissions_insert"
  ON submissions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint

-- 본인만 수정 가능 (단, status를 'hidden'으로 바꾸는 건 서비스 키만)
-- USING의 status != 'hidden': hidden 행을 UPDATE 대상에서 제외 — hidden→completed 복원 차단 (QA Day 1 H2)
CREATE POLICY "submissions_update"
  ON submissions FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND status != 'hidden'
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status != 'hidden'
  );
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.4 letter_pieces
-- ─────────────────────────────────────────────

-- 본인 submission의 글자 조각 + 공개 submission의 글자 조각
CREATE POLICY "letter_pieces_select"
  ON letter_pieces FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND (
        s.user_id = (SELECT auth.uid())
        OR (s.status = 'completed' AND s.is_public = true)
      )
    )
  );
--> statement-breakpoint

-- 본인 submission에만 INSERT
CREATE POLICY "letter_pieces_insert"
  ON letter_pieces FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

-- 본인 submission만 UPDATE (글자 교체 = UPSERT)
-- USING + WITH CHECK 둘 다 필수 — WITH CHECK가 없으면 행을 타인 submission으로 재할당 가능 (§8.4-②)
CREATE POLICY "letter_pieces_update"
  ON letter_pieces FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

-- 본인 submission만 DELETE
CREATE POLICY "letter_pieces_delete"
  ON letter_pieces FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = letter_pieces.submission_id
      AND s.user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.5 reactions
-- ─────────────────────────────────────────────

-- 모든 인증 사용자가 좋아요 조회 가능
CREATE POLICY "reactions_select"
  ON reactions FOR SELECT
  TO authenticated
  USING (true);
--> statement-breakpoint

-- 본인만 생성
CREATE POLICY "reactions_insert"
  ON reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint

-- 본인만 삭제 (좋아요 취소)
CREATE POLICY "reactions_delete"
  ON reactions FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.6 reports
-- ─────────────────────────────────────────────

-- SELECT 정책 없음 = 일반 사용자 조회 차단 (관리자만 서비스 키로)

-- 인증 사용자만 생성
CREATE POLICY "reports_insert"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §3.7 테이블 권한(GRANT) — RLS 이전의 1차 관문
-- drizzle-kit(postgres role)으로 생성한 테이블에는 Supabase 자동 GRANT가
-- 적용되지 않는다. 정책 표면과 1:1로 정렬된 최소 권한만 부여한다. (QA Day 1 H1)
-- ─────────────────────────────────────────────
GRANT SELECT ON challenges TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON submissions TO anon, authenticated;
--> statement-breakpoint
GRANT INSERT, UPDATE ON submissions TO authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON letter_pieces TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON reactions TO authenticated;
--> statement-breakpoint
GRANT INSERT ON reports TO authenticated;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §1.1 trigger — handle_new_user
-- ─────────────────────────────────────────────

-- 자동 생성 trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nickname)
  VALUES (
    NEW.id,
    LEFT(
      COALESCE(
        NEW.raw_user_meta_data->>'name',
        'user_' || LEFT(NEW.id::TEXT, 8)
      ),
      20
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
--> statement-breakpoint

-- trigger 함수는 직접 호출될 일이 없다 — 기본 부여되는 EXECUTE 회수 (공개 API화 방지)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
