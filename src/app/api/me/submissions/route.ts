import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { challenges, reactions, submissions } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { jsonError } from '@/lib/api/errors';
import { createSignedUrl, SIGNED_URL_TTL } from '@/lib/storage/signed-url';
import { createClient } from '@/lib/supabase/server';
import type { ApiMySubmission, ApiMySubmissionsResponse } from '@/types/api';

// Drizzle(postgres) + Supabase Storage SDK는 Node 전용이므로 엣지 추론을 막는다.
export const runtime = 'nodejs';

// 내 제출 목록은 챌린지당 1개(unique user_challenge)라 수가 작다 — MVP는 커서 없이 상한만 둔다.
const MAX_ITEMS = 100;

// GET /api/me/submissions — 본인 완성 제출 목록(공개+비공개). §9 Day 9, 피드 A7 패턴 재사용.
// 인증 필수(401). 피드(A7)는 공개 전용이지만 여기는 본인 것이라 비공개도 포함한다.
// 본인 JWT가 실린 server client로 서명하므로 비공개 콜라주도 Storage 정책상 서명된다(Day 8 §3 대비).
export async function GET() {
  // 1. 인증 — 미인증은 리소스 정보를 노출하지 않고 401. 같은 server client로 signed URL을 만든다.
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  }

  // 2. 내 완성 제출 ⨝ challenges (문장 라벨용). draft·hidden은 갤러리에서 제외.
  //    DB는 Drizzle 직결(RLS 우회)이라 본인 user_id로 직접 좁힌다. 정렬: created_at DESC.
  const rows = await db
    .select({
      sub_id: submissions.id,
      sub_user_id: submissions.user_id,
      sub_challenge_id: submissions.challenge_id,
      sub_status: submissions.status,
      sub_is_public: submissions.is_public,
      sub_created_at: submissions.created_at,
      sub_completed_at: submissions.completed_at,
      sub_collage_image_url: submissions.collage_image_url,
      chal_id: challenges.id,
      chal_sentence: challenges.sentence,
    })
    .from(submissions)
    .innerJoin(challenges, eq(submissions.challenge_id, challenges.id))
    .where(and(eq(submissions.user_id, user.id), eq(submissions.status, 'completed')))
    .orderBy(desc(submissions.created_at))
    .limit(MAX_ITEMS);

  // 3. 빈 목록 조기 반환 — inArray([])는 Drizzle에서 유효하지 않으므로 건너뛴다.
  if (rows.length === 0) {
    return NextResponse.json<ApiMySubmissionsResponse>({ items: [] });
  }

  const ids = rows.map((r) => r.sub_id);

  // 4. 반응 수 집계 — 페이지 id 배치 1쿼리로 N+1 회피(A7과 동일). user_reacted는 본인 목록이라 불필요.
  const reactionCounts = await db
    .select({ submission_id: reactions.submission_id, count: count() })
    .from(reactions)
    .where(inArray(reactions.submission_id, ids))
    .groupBy(reactions.submission_id);
  const reactionCountMap = new Map<string, number>(
    reactionCounts.map((r) => [r.submission_id, r.count]),
  );

  // 5. signed URL — collages 버킷, TTL 1h(EDIT), 실패 시 null 폴백(A7과 동일).
  //    본인 client로 서명하므로 비공개 콜라주도 §5.2 본인 읽기 정책으로 서명된다.
  const signedUrls = await Promise.all(
    rows.map((r) =>
      r.sub_collage_image_url
        ? createSignedUrl(supabase, 'collages', r.sub_collage_image_url, SIGNED_URL_TTL.EDIT)
        : Promise.resolve(null),
    ),
  );

  // 6. ApiMySubmission[] 조립
  const items: ApiMySubmission[] = rows.map((r, i) => ({
    submission: {
      id: r.sub_id,
      user_id: r.sub_user_id,
      challenge_id: r.sub_challenge_id,
      status: 'completed' as const, // WHERE가 status='completed'로 고정
      is_public: r.sub_is_public,
      created_at: r.sub_created_at.toISOString(),
      completed_at: r.sub_completed_at ? r.sub_completed_at.toISOString() : null,
    },
    challenge: {
      id: r.chal_id,
      sentence: r.chal_sentence,
    },
    collage_url: signedUrls[i],
    reaction_count: reactionCountMap.get(r.sub_id) ?? 0,
  }));

  return NextResponse.json<ApiMySubmissionsResponse>({ items });
}
