import { and, asc, count, eq, ne, sql, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { challenges, letterPieces, submissions } from '@/db/schema';
import { getAuthUser, getOwnedSubmission } from '@/lib/api/auth';
import { jsonError, validationError } from '@/lib/api/errors';
import { serializeSubmission } from '@/lib/api/serialize';
import { createSignedUrl, SIGNED_URL_TTL } from '@/lib/storage/signed-url';
import { createClient } from '@/lib/supabase/server';
import { submissionIdSchema, updateSubmissionSchema } from '@/lib/validations/submission';

// Drizzle(postgres) + Supabase Storage SDK는 Node 전용이므로 엣지 추론을 막는다.
export const runtime = 'nodejs';

// GET /api/submissions/[id] — 제출물 상세 + signed URL (§6.3 A3, §9 Day4-(b)(c))
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // 인증 우선 — 미인증은 리소스 정보를 노출하지 않고 401. 같은 server client로 signed URL을 만든다.
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  }

  const { id } = await params;
  const idParsed = submissionIdSchema.safeParse(id);
  if (!idParsed.success) {
    // 잘못된 형식도 존재 은폐를 위해 404로 통일
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }
  const submissionId = idParsed.data;

  // DB는 Drizzle 직결(RLS 우회)이라 가시성을 코드로 판정한다 (§3.3과 동일 규칙).
  // 본인=모든 상태 / 타인=공개 완성만 / 그 외(타인 비공개·미존재)=404로 존재 은폐 (§7.4).
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);

  const isOwner = !!submission && submission.user_id === user.id;
  const isPublicCompleted =
    !!submission && submission.status === 'completed' && submission.is_public === true;
  if (!submission || (!isOwner && !isPublicCompleted)) {
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }

  // 콜라주 signed URL — private 버킷이라 경로를 1h TTL로 서명해 내려준다.
  // 본인·공개 모두 Storage 정책(§5.2)이 읽기를 허용하므로 요청자 client로 서명된다.
  const collageUrl = submission.collage_image_url
    ? await createSignedUrl(
        supabase,
        'collages',
        submission.collage_image_url,
        SIGNED_URL_TTL.EDIT,
      )
    : null;

  // letter_pieces(원자료)는 본인에게만 내려준다 — Storage 정책(§5.1)이 owner-only라
  // 외부 뷰어는 파일을 읽지 못한다(서명 시도 시 null). 공개 제출의 뷰어에겐 완성 콜라주만 노출하고
  // 글자 조각은 응답에서 제외해 경로/메타 노출 자체를 막는다.
  const pieces = isOwner
    ? await Promise.all(
        (
          await db
            .select()
            .from(letterPieces)
            .where(eq(letterPieces.submission_id, submissionId))
            .orderBy(asc(letterPieces.slot_index))
        ).map(async (p) => ({
          id: p.id,
          slot_index: p.slot_index,
          character: p.character,
          width: p.width,
          height: p.height,
          image_url: await createSignedUrl(
            supabase,
            'letter-pieces',
            p.image_url,
            SIGNED_URL_TTL.EDIT,
          ),
        })),
      )
    : [];

  // 응답엔 버킷 내 원시 경로(collage_image_url/image_url)를 넣지 않고 signed URL만 노출한다.
  return NextResponse.json({
    submission: serializeSubmission(submission),
    collage_url: collageUrl,
    letter_pieces: pieces,
  });
}

// PATCH /api/submissions/[id] — 상태 완성/공개 토글 (§6.3 A4, §9 Day4-(e))
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) {
    return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  }

  const { id } = await params;
  const idParsed = submissionIdSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }
  const submissionId = idParsed.data;

  // 소유권 — 타인 소유·미존재 모두 404로 존재 은폐 (§7.4).
  const submission = await getOwnedSubmission(submissionId, user.id);
  if (!submission) {
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }
  // hidden은 소유자도 어떤 컬럼도 수정 불가 — RLS §3.3과 정합(fail-closed).
  if (submission.status === 'hidden') {
    return jsonError(409, 'SUBMISSION_HIDDEN', '숨김 처리된 제출은 수정할 수 없습니다.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', '요청 본문을 해석할 수 없습니다.');
  }
  const parsed = updateSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const { status, is_public } = parsed.data;

  // 적용할 변경을 모은다 — status 전이는 UPSERT가 아니라 조건부 UPDATE로 처리한다.
  const updates: { is_public?: boolean; status?: 'completed'; completed_at?: SQL } = {};
  // is_public은 draft에서도 토글 가능하나 공개 정책(submissions_select_anon·collages_read §5.2)이
  // completed+public만 노출하므로 draft 토글은 실제 노출 효과가 없다(상태 보관용).
  if (is_public !== undefined) {
    updates.is_public = is_public;
  }

  // draft → completed 전이: 모든 슬롯 + 콜라주 업로드 완료를 전제로만 허용 (§9 Day4-(e)).
  // 스키마가 'draft'(역전)·'hidden'을 차단하므로 여기선 completed 전이만 고려한다.
  // 이미 completed면 재전이하지 않는다(completed_at 보존, idempotent).
  if (status === 'completed' && submission.status === 'draft') {
    const [challenge] = await db
      .select({ letters: challenges.letters })
      .from(challenges)
      .where(eq(challenges.id, submission.challenge_id))
      .limit(1);
    if (!challenge) {
      return jsonError(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없습니다.');
    }
    // 슬롯 수 == 챌린지 글자 수 AND 콜라주 업로드 완료. slot_index는 업로드 시 [0, letters.length)로
    // 검증되고 UNIQUE라 count가 letters.length면 모든 슬롯이 정확히 채워졌음을 보장한다.
    const [{ pieceCount }] = await db
      .select({ pieceCount: count() })
      .from(letterPieces)
      .where(eq(letterPieces.submission_id, submissionId));
    if (pieceCount !== challenge.letters.length || submission.collage_image_url === null) {
      return jsonError(409, 'SUBMISSION_INCOMPLETE', '모든 글자와 콜라주를 채워야 완성할 수 있습니다.');
    }
    // 주의: 완성도(슬롯 수·콜라주)는 아래 조건부 UPDATE의 WHERE절에서 재검증되지 않는다(비원자).
    // 현재 letter_pieces 삭제 API가 없고 동일 사용자 단일 세션이라 실위험은 낮다. 삭제 API 도입 시
    // 완성도 조건을 WHERE 서브쿼리로 합치거나 단일 트랜잭션으로 원자화한다 (Reviewer Medium).
    updates.status = 'completed';
    updates.completed_at = sql`now()`;
  }

  // 변경할 것이 없으면(예: 이미 completed인데 status='completed'만 보냄) 현재 상태를 그대로 반환.
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(serializeSubmission(submission));
  }

  // 조건부 UPDATE — 소유권 + non-hidden 가드(TOCTOU 방어, RLS 정합). 0행이면 경합 → 404.
  const [updated] = await db
    .update(submissions)
    .set(updates)
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.user_id, user.id),
        ne(submissions.status, 'hidden'),
      ),
    )
    .returning();
  if (!updated) {
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }

  return NextResponse.json(serializeSubmission(updated));
}
