import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { challenges, letterPieces } from '@/db/schema';
import { getAuthUser, getOwnedSubmission } from '@/lib/api/auth';
import { jsonError, validationError } from '@/lib/api/errors';
import { uploadLetterSchema, validateLetterImage } from '@/lib/validations/letter-piece';
import { submissionIdSchema } from '@/lib/validations/submission';
import { createClient } from '@/lib/supabase/server';

// Drizzle(postgres) + Supabase Storage SDK는 Node 전용이므로 엣지 추론을 막는다.
export const runtime = 'nodejs';

// POST /api/submissions/[id]/letters — 글자 조각 업로드 (Storage + DB UPSERT, §6.3 A5)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // 인증 우선 — 미인증은 어떤 리소스 정보도 노출하지 않고 401.
  // Storage 업로드에 같은 server client(사용자 JWT)를 재사용한다.
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

  // 소유권 — 타인 소유·미존재 모두 404로 존재 은폐 (§7.4). DB는 Drizzle이라 코드로 검증.
  const submission = await getOwnedSubmission(submissionId, user.id);
  if (!submission) {
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }
  // draft 상태에서만 글자 업로드 허용
  if (submission.status !== 'draft') {
    return jsonError(409, 'SUBMISSION_NOT_DRAFT', '이미 완료되었거나 숨김 상태인 제출입니다.');
  }

  // 챌린지 letters 길이로 slot_index 상한을 검증한다.
  const [challenge] = await db
    .select({ letters: challenges.letters })
    .from(challenges)
    .where(eq(challenges.id, submission.challenge_id))
    .limit(1);
  if (!challenge) {
    return jsonError(404, 'CHALLENGE_NOT_FOUND', '챌린지를 찾을 수 없습니다.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'INVALID_FORM_DATA', '폼 데이터를 해석할 수 없습니다.');
  }

  const fields = uploadLetterSchema.safeParse({
    slot_index: form.get('slot_index'),
    character: form.get('character'),
    width: form.get('width'),
    height: form.get('height'),
  });
  if (!fields.success) {
    return validationError(fields.error);
  }
  const { slot_index, character, width, height } = fields.data;

  // slot_index 상한 — 챌린지 글자 수 미만 (§7.2)
  if (slot_index >= challenge.letters.length) {
    return jsonError(400, 'SLOT_OUT_OF_RANGE', '슬롯 번호가 챌린지 범위를 벗어났습니다.');
  }

  // 이미지 검증 (MIME + 크기까지만 — 게이트 A Day3-(f))
  const image = form.get('image');
  if (!(image instanceof File)) {
    return jsonError(400, 'IMAGE_REQUIRED', '이미지 파일이 필요합니다.');
  }
  const imageError = validateLetterImage(image);
  if (imageError) {
    return jsonError(imageError.status, imageError.code, imageError.message);
  }

  // Storage 업로드 — 경로 첫 폴더 = 인증 사용자 id (Storage 정책 §5.1과 정렬).
  // path를 서버가 user.id로 구성하므로 타인 경로 업로드가 원천 불가하며,
  // 설령 조작해도 Storage 정책이 차단한다 (이중 방어).
  // 확장자는 검증된 MIME에서 유도 — WebP 기본, JPEG는 Safari 폴백 (게이트 A Day4.5 옵션 A).
  // 같은 슬롯을 다른 포맷으로 재업로드하면 이전 확장자 파일이 고아로 남을 수 있으나(§8.3-3과
  // 동일 부류) DB image_url이 항상 최신 경로를 가리키므로 표시 손상은 없다.
  const ext = image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${user.id}/${submissionId}/${slot_index}.${ext}`;
  const bytes = await image.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from('letter-pieces')
    .upload(path, bytes, { contentType: image.type, upsert: true });
  if (uploadError) {
    return jsonError(500, 'UPLOAD_FAILED', '이미지 업로드에 실패했습니다.');
  }

  // letter_pieces UPSERT — 같은 슬롯 재업로드 시 교체 (§10.7).
  // image_url엔 버킷 내 경로를 저장한다(private 버킷이라 읽기 시 signed URL 생성 — Day 4).
  // Storage 업로드(외부 시스템)와 DB 쓰기는 원자적이지 않다 — DB 실패 시 Storage에 고아 파일이
  // 남을 수 있다(§8.3-3). 같은 path 재업로드로 덮어써지므로 손상은 없으나, cleanup 추적을 위해
  // 실패 시 path를 로깅한다 (path는 UUID만 포함, 시크릿 아님).
  let piece;
  try {
    [piece] = await db
      .insert(letterPieces)
      .values({
        submission_id: submissionId,
        character,
        slot_index,
        image_url: path,
        width,
        height,
      })
      .onConflictDoUpdate({
        target: [letterPieces.submission_id, letterPieces.slot_index],
        set: { character, image_url: path, width, height },
      })
      .returning();
  } catch (err) {
    console.error(`letter_pieces upsert failed for ${path}:`, err);
    return jsonError(500, 'PERSIST_FAILED', '글자 정보를 저장하지 못했습니다.');
  }

  return NextResponse.json(piece, { status: 200 });
}
