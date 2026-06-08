-- Custom SQL migration file, put your code below! --

-- ─────────────────────────────────────────────
-- §4 Storage 버킷 3개 (storage 스키마는 schemaFilter(public) 밖이라 커스텀 SQL로만 생성)
-- file_size_limit: letter-pieces/avatars 512000B(500KB), collages 2097152B(2MB)
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('letter-pieces', 'letter-pieces', false, 512000, ARRAY['image/webp']),
  ('collages', 'collages', false, 2097152, ARRAY['image/png']),
  ('avatars', 'avatars', true, 512000, ARRAY['image/webp'])
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §5.1 letter-pieces 버킷 정책 — 본인 경로(첫 폴더 = auth.uid())만 접근
-- UPSERT(글자 교체)에는 INSERT + UPDATE 모두 필요 (§8.4-④)
-- ─────────────────────────────────────────────

-- 본인만 읽기
CREATE POLICY "letter_pieces_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

-- 본인만 쓰기
CREATE POLICY "letter_pieces_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

-- 본인만 덮어쓰기 (글자 교체)
CREATE POLICY "letter_pieces_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

-- 본인만 삭제
CREATE POLICY "letter_pieces_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'letter-pieces'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §5.2 collages 버킷 정책 — 본인이거나 공개 완성 제출이면 읽기
-- ─────────────────────────────────────────────

-- 본인이거나, 공개 제출인 경우 읽기 가능
CREATE POLICY "collages_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'collages'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      OR EXISTS (
        SELECT 1 FROM submissions s
        WHERE s.id = (storage.foldername(name))[2]::UUID
        AND s.status = 'completed'
        AND s.is_public = true
      )
    )
  );
--> statement-breakpoint

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
--> statement-breakpoint

-- 본인만 쓰기
CREATE POLICY "collages_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'collages'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

-- 본인만 삭제
CREATE POLICY "collages_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'collages'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

-- ─────────────────────────────────────────────
-- §5.3 avatars 버킷 정책 — Public 버킷(읽기 공개), 쓰기/삭제만 본인
-- ─────────────────────────────────────────────

CREATE POLICY "avatars_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
--> statement-breakpoint

CREATE POLICY "avatars_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
