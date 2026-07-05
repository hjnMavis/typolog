'use server';

// Server Action 모듈 (§6.4: 단순 mutation → Server Action). Day 7 틀 재사용.
// db(Drizzle)·createClient는 서버 전용이므로 클라이언트 번들 유입을 빌드 타임에 차단.
import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { getAuthUser } from '@/lib/api/auth';
import { updateProfileSchema } from '@/lib/validations/profile';

// 결과는 구조화 객체로 반환한다 — Next.js가 production에서 throw 메시지를 마스킹하므로,
// Sheet가 사유별 메시지(닉네임 형식 / 로그인 필요)를 보이려면 반환값으로 분기해야 한다(Day 7 §6).
export type UpdateProfileResult =
  | { ok: true; nickname: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'INVALID' };

// S3 updateProfile — 닉네임 수정(아바타 업로드는 MVP 제외, §5.3). §6.2.
//
// DB는 Drizzle 직결(RLS 우회)이라 대상 행을 코드로 본인 id에 고정한다: WHERE id = user.id로
// 본인 profiles 행만 갱신하므로 클라이언트가 다른 id를 보낼 통로 자체가 없다(인자는 nickname뿐).
// 닉네임은 unique 제약이 없어 중복 검사를 하지 않는다(공개 핸들 /u/[handle]은 보류 — 후속).
export async function updateProfile(input: { nickname: string }): Promise<UpdateProfileResult> {
  const parsed = updateProfileSchema.safeParse({ nickname: input.nickname });
  if (!parsed.success) {
    return { ok: false, code: 'INVALID' };
  }
  const { nickname } = parsed.data;

  // 보호 라우트(/my)라 정상 흐름에선 도달이 드물다 — Sheet 작성 중 세션 만료 대비 방어 분기.
  const user = await getAuthUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }

  // 본인 행만 갱신. trigger가 가입 시 행을 보장하므로 RETURNING은 항상 1행이다.
  const [updated] = await db
    .update(profiles)
    .set({ nickname, updated_at: sql`now()` })
    .where(eq(profiles.id, user.id))
    .returning({ nickname: profiles.nickname });

  // 방어적: 행이 없으면(이론상 불가) 형식 오류와 같은 INVALID로 흘려 호출부가 재시도하게 둔다.
  if (!updated) {
    return { ok: false, code: 'INVALID' };
  }

  return { ok: true, nickname: updated.nickname };
}
