import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { letterPieces, submissions } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { jsonError } from '@/lib/api/errors';
import { createSignedUrl, SIGNED_URL_TTL } from '@/lib/storage/signed-url';
import { createClient } from '@/lib/supabase/server';
import { submissionIdSchema } from '@/lib/validations/submission';

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
    submission: {
      id: submission.id,
      user_id: submission.user_id,
      challenge_id: submission.challenge_id,
      status: submission.status,
      is_public: submission.is_public,
      created_at: submission.created_at,
      completed_at: submission.completed_at,
    },
    collage_url: collageUrl,
    letter_pieces: pieces,
  });
}
