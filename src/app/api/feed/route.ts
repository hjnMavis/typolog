import { and, count, desc, asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { profiles, reactions, submissions } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { jsonError } from '@/lib/api/errors';
import { createSignedUrl, SIGNED_URL_TTL } from '@/lib/storage/signed-url';
import { createClient } from '@/lib/supabase/server';
import { decodeFeedCursor, encodeFeedCursor, feedQuerySchema } from '@/lib/validations/feed';
import type { ApiFeedItem, ApiFeedResponse } from '@/types/api';

// Drizzle(postgres) + Supabase Storage SDK는 Node 전용이므로 엣지 추론을 막는다.
export const runtime = 'nodejs';

// GET /api/feed?challenge_id=<uuid>&cursor=<base64url>&limit=<1..50>
// 인증 필수(401). 공개 완성 제출 목록을 커서 페이지네이션으로 반환한다 (§6.3 A7, §9 Day 6).
export async function GET(request: Request) {
  // 1. 인증 — 미인증은 리소스 정보를 노출하지 않고 401 반환
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    return jsonError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  }

  // 2. 쿼리 파라미터 파싱
  const { searchParams } = new URL(request.url);
  const rawQuery = {
    challenge_id: searchParams.get('challenge_id') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  };

  const queryParsed = feedQuerySchema.safeParse(rawQuery);
  if (!queryParsed.success) {
    return jsonError(400, 'INVALID_QUERY', '요청 파라미터가 올바르지 않습니다.', queryParsed.error.issues);
  }
  const { challenge_id: challengeId, cursor: cursorRaw, limit } = queryParsed.data;

  // 3. 커서 디코드 (존재할 때만)
  let cursorPayload: { createdAt: Date; id: string } | null = null;
  if (cursorRaw !== undefined) {
    try {
      cursorPayload = decodeFeedCursor(cursorRaw);
    } catch {
      return jsonError(400, 'INVALID_CURSOR', '커서 값이 올바르지 않습니다.');
    }
  }

  // 4. 피드 쿼리 — submissions ⨝ profiles (공개 완성 제출, keyset 술어 포함)
  // DB는 Drizzle 직결(RLS 우회)이므로 가시성 필터를 코드로 적용한다 (§3.3, Day3-(b) 패턴).
  // 정렬: created_at DESC, id ASC — 부분 인덱스 idx_submissions_feed 정합 (§9 Day 6 (b)).
  // 내부 limit+1 조회로 다음 페이지 존재 여부를 판정한다.
  const baseFilter = and(
    eq(submissions.challenge_id, challengeId),
    eq(submissions.status, 'completed'),
    eq(submissions.is_public, true),
  );

  // keyset 술어: (created_at < :c) OR (created_at = :c AND id > :id)
  // — 중복·누락 없는 결정론적 페이지네이션 (§9 Day 6 (b))
  //
  // 알려진 제약(Day 6 Reviewer, Low): created_at은 Postgres timestamptz(μs 저장)지만
  // postgres.js가 JS Date(ms 정밀도)로 읽어 커서는 ms로 인코딩된다. 동일 챌린지에서
  // 같은 ms·다른 μs인 두 완성·공개 제출이 정확히 페이지 경계에 걸리면 한 행이 누락될
  // 수 있다. MVP 쓰기량(단일 챌린지 완성·공개 ≪ ms 충돌 임계)에서 발생 확률 무시 가능 →
  // 미수정. 근본 해결은 커서에 μs 정밀도(epoch microseconds)를 실어 DB와 정밀도를 맞추는 것.
  const keysetFilter = cursorPayload
    ? or(
        lt(submissions.created_at, cursorPayload.createdAt),
        and(
          eq(submissions.created_at, cursorPayload.createdAt),
          gt(submissions.id, cursorPayload.id),
        ),
      )
    : undefined;

  const whereClause = keysetFilter ? and(baseFilter, keysetFilter) : baseFilter;

  const rawRows = await db
    .select({
      // submissions 필드
      sub_id: submissions.id,
      sub_user_id: submissions.user_id,
      sub_challenge_id: submissions.challenge_id,
      sub_is_public: submissions.is_public,
      sub_created_at: submissions.created_at,
      sub_completed_at: submissions.completed_at,
      sub_collage_image_url: submissions.collage_image_url,
      // profiles 필드
      prof_id: profiles.id,
      prof_nickname: profiles.nickname,
      prof_avatar_url: profiles.avatar_url,
    })
    .from(submissions)
    .innerJoin(profiles, eq(submissions.user_id, profiles.id))
    .where(whereClause)
    .orderBy(desc(submissions.created_at), asc(submissions.id))
    .limit(limit + 1); // 다음 페이지 존재 판정용으로 1개 더 가져온다

  // 5. 다음 페이지 존재 판정 및 페이지 항목 분리
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

  // 6. 빈 페이지 조기 반환 — inArray([])는 Drizzle에서 유효하지 않으므로 건너뛴다
  if (pageRows.length === 0) {
    return NextResponse.json<ApiFeedResponse>({ items: [], next_cursor: null });
  }

  const pageIds = pageRows.map((r) => r.sub_id);

  // 7. 반응 집계 — N+1 회피: 페이지 id 배치를 두 쿼리로 처리 (§9 Day 6 (c))
  //    Q2: submission별 reaction_count GROUP BY
  //    Q3: 현재 사용자가 반응한 submission_id 목록
  const [reactionCounts, userReactedRows] = await Promise.all([
    db
      .select({
        submission_id: reactions.submission_id,
        count: count(),
      })
      .from(reactions)
      .where(inArray(reactions.submission_id, pageIds))
      .groupBy(reactions.submission_id),

    db
      .select({ submission_id: reactions.submission_id })
      .from(reactions)
      .where(
        and(
          eq(reactions.user_id, user.id),
          inArray(reactions.submission_id, pageIds),
        ),
      ),
  ]);

  // 집계 결과를 Map으로 변환 (O(1) 접근)
  const reactionCountMap = new Map<string, number>(
    reactionCounts.map((r) => [r.submission_id, r.count]),
  );
  const userReactedSet = new Set<string>(userReactedRows.map((r) => r.submission_id));

  // 8. signed URL 생성 — collages 버킷, TTL 1h, 실패 시 null 폴백 (§9 Day 6 (d), Day 4 M2 패턴)
  const signedUrls = await Promise.all(
    pageRows.map((r) =>
      r.sub_collage_image_url
        ? createSignedUrl(supabase, 'collages', r.sub_collage_image_url, SIGNED_URL_TTL.EDIT)
        : Promise.resolve(null),
    ),
  );

  // 9. ApiFeedItem[] 조립
  const items: ApiFeedItem[] = pageRows.map((r, i) => ({
    submission: {
      id: r.sub_id,
      user_id: r.sub_user_id,
      challenge_id: r.sub_challenge_id,
      status: 'completed' as const, // WHERE가 status='completed'로 고정 — 항상 completed
      is_public: r.sub_is_public,
      created_at: r.sub_created_at.toISOString(),
      completed_at: r.sub_completed_at ? r.sub_completed_at.toISOString() : null,
    },
    profile: {
      id: r.prof_id,
      nickname: r.prof_nickname,
      avatar_url: r.prof_avatar_url,
    },
    collage_url: signedUrls[i],
    reaction_count: reactionCountMap.get(r.sub_id) ?? 0,
    user_reacted: userReactedSet.has(r.sub_id),
  }));

  // 10. next_cursor — 마지막 페이지 항목 기준으로 인코딩 (끝이면 null)
  const lastItem = pageRows[pageRows.length - 1];
  const nextCursor = hasMore
    ? encodeFeedCursor(lastItem.sub_created_at, lastItem.sub_id)
    : null;

  return NextResponse.json<ApiFeedResponse>({ items, next_cursor: nextCursor });
}
