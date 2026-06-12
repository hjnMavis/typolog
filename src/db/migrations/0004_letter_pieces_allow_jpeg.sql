-- Custom SQL migration file, put your code below! --

-- ─────────────────────────────────────────────
-- letter-pieces 버킷에 image/jpeg 허용 (Day 4.5 게이트 A 옵션 A, 2026-06-11)
-- Safari(iOS)는 canvas WebP 인코딩을 지원하지 않아 클라이언트가 JPEG로 폴백한다.
-- 크기 제한(500KB)·경로 정책(§5.1)은 그대로 유지 — MIME 허용 목록만 확장.
-- ─────────────────────────────────────────────
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg']
WHERE id = 'letter-pieces';
