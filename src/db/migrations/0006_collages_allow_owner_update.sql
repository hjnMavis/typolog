-- Custom SQL migration file, put your code below! --

-- ─────────────────────────────────────────────
-- #80 (Day 10.5): collages 버킷 소유자 덮어쓰기(UPDATE) 정책 추가
-- letter-pieces에는 letter_pieces_update("본인만 덮어쓰기 — 글자 교체")가 있으나
-- collages에는 UPDATE 정책이 없어 같은 path 재업로드(upsert)가 RLS에 차단된다.
-- A6 라우트와 재시도 전략(Day 4.5 게이트 A-(f) "전 단계 멱등 — 실패 시 처음부터 재시도")은
-- 콜라주 덮어쓰기를 전제하므로, 이 정책이 없으면 A6 성공 후 후속 단계(A4 등) 실패 시
-- 재시도가 영구 불능이 된다. letter_pieces_update(0003 §5.1)와 동일 패턴으로 정렬한다.
-- 발견 경위: #50 프로파일링(scripts/profile-collage-upload.ts) — 콜드 성공·웜 upsert 실패 실측.
-- ─────────────────────────────────────────────
CREATE POLICY "collages_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'collages'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
