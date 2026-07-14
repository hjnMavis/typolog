-- ─────────────────────────────────────────────
-- #48 (Day 10.5): reports 중복 신고 방지 UNIQUE(reporter_id, submission_id)
-- 제약 추가 전에 기존 중복 행을 선정리한다 — 위반 데이터가 있으면 ADD CONSTRAINT가 실패하며,
-- 같은 트랜잭션 안에서 선정리→제약이 원자적으로 실행돼 그 사이 새 중복이 끼는 경합이 없다.
-- 정리 규칙(결정적): 같은 (reporter_id, submission_id) 쌍에서 가장 오래된 행만 남긴다
-- (created_at 오름차순, 동시각이면 id 작은 쪽 유지).
-- Day 10 실측(2026-07-13): 총 3건 중 중복 쌍 1개(2건) → 이 DELETE로 1행 삭제 예상.
-- ─────────────────────────────────────────────
DELETE FROM "reports" a
USING "reports" b
WHERE a.reporter_id = b.reporter_id
  AND a.submission_id = b.submission_id
  AND (a.created_at > b.created_at
    OR (a.created_at = b.created_at AND a.id > b.id));
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_submission_unique" UNIQUE("reporter_id","submission_id");
