import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { submissions } from '@/db/schema';
import { getAuthUser, getOwnedSubmission } from '@/lib/api/auth';
import { jsonError } from '@/lib/api/errors';
import { serializeSubmission } from '@/lib/api/serialize';
import { createSignedUrl, SIGNED_URL_TTL } from '@/lib/storage/signed-url';
import { createClient } from '@/lib/supabase/server';
import { validateCollageImage } from '@/lib/validations/collage';
import { submissionIdSchema } from '@/lib/validations/submission';

// Drizzle(postgres) + Supabase Storage SDK는 Node 전용이므로 엣지 추론을 막는다.
export const runtime = 'nodejs';

// POST /api/submissions/[id]/collage — 콜라주 PNG 업로드 (Storage + DB, §6.3 A6, §9 Day4-(d))
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // #50: 핸들러 내부 구간 계측 — 성공 응답에 Server-Timing 헤더로 싣는다(브라우저 DevTools에서
  // 확인 가능). A6 총시간에서 어느 구간(인증/소유권/파싱/Storage/DB/서명)이 지배하는지 분해용.
  // 타이밍 수치만 노출되며 인증+소유권 검증 뒤에만 응답하므로 정보 노출 위험은 없다.
  const startedAt = performance.now();
  const timings: [name: string, durationMs: number][] = [];
  let lastMark = startedAt;
  const mark = (name: string) => {
    const now = performance.now();
    timings.push([name, now - lastMark]);
    lastMark = now;
  };

  // 인증 우선 — 미인증은 리소스 정보를 노출하지 않고 401. 같은 server client(사용자 JWT)로 업로드한다.
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  }
  mark('auth');

  const { id } = await params;
  const idParsed = submissionIdSchema.safeParse(id);
  if (!idParsed.success) {
    // 잘못된 형식도 존재 은폐를 위해 404로 통일
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }
  const submissionId = idParsed.data;

  // 소유권 — 타인 소유·미존재 모두 404로 존재 은폐 (§7.4). DB는 Drizzle이라 코드로 검증.
  const submission = await getOwnedSubmission(submissionId, user.id);
  mark('own');
  if (!submission) {
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }
  // 콜라주 업로드는 draft에서만 — 완성/숨김 제출은 변경 불가 (letters 업로드와 동일 규칙).
  if (submission.status !== 'draft') {
    return jsonError(409, 'SUBMISSION_NOT_DRAFT', '이미 완료되었거나 숨김 상태인 제출입니다.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'INVALID_FORM_DATA', '폼 데이터를 해석할 수 없습니다.');
  }

  // 이미지 검증 (PNG + 2MB까지만 — 게이트 A Day4-(d))
  const image = form.get('image');
  if (!(image instanceof File)) {
    return jsonError(400, 'IMAGE_REQUIRED', '이미지 파일이 필요합니다.');
  }
  const imageError = validateCollageImage(image);
  if (imageError) {
    return jsonError(imageError.status, imageError.code, imageError.message);
  }
  mark('form');

  // Storage 업로드 — 경로 첫 폴더 = 인증 사용자 id (Storage 정책 §5.2와 정렬).
  // path를 서버가 user.id로 구성하므로 타인 경로 업로드가 원천 불가하며, 조작해도 Storage 정책이 차단한다.
  const path = `${user.id}/${submissionId}/collage.png`;
  const bytes = await image.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from('collages')
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  mark('storage');
  if (uploadError) {
    return jsonError(500, 'UPLOAD_FAILED', '콜라주 업로드에 실패했습니다.');
  }

  // collage_image_url 갱신 — 조건부 UPDATE(소유권 재확인). Storage 업로드(외부 시스템)와 DB 쓰기는
  // 원자적이지 않다(§8.3-3) — DB 실패 시 고아 파일이 남을 수 있으나 같은 path 재업로드로 덮어써지므로
  // 손상은 없다. cleanup 추적을 위해 실패 시 path를 로깅한다 (path는 UUID만 포함, 시크릿 아님).
  let updated;
  try {
    [updated] = await db
      .update(submissions)
      .set({ collage_image_url: path })
      .where(and(eq(submissions.id, submissionId), eq(submissions.user_id, user.id)))
      .returning();
  } catch (err) {
    console.error(`submissions.collage_image_url update failed for ${path}:`, err);
    return jsonError(500, 'PERSIST_FAILED', '콜라주 정보를 저장하지 못했습니다.');
  }
  mark('db');
  if (!updated) {
    // 소유권이 그 사이 바뀐 경합 — 존재 은폐 404.
    return jsonError(404, 'SUBMISSION_NOT_FOUND', '제출을 찾을 수 없습니다.');
  }

  // 업로드 직후 미리보기용 signed URL(1h). 응답엔 버킷 내 원시 경로를 노출하지 않는다.
  const collageUrl = await createSignedUrl(supabase, 'collages', path, SIGNED_URL_TTL.EDIT);
  mark('sign');

  const serverTiming = [
    ...timings.map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`),
    `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
  ].join(', ');
  return NextResponse.json(
    { submission: serializeSubmission(updated), collage_url: collageUrl },
    { status: 200, headers: { 'Server-Timing': serverTiming } },
  );
}
