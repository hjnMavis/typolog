import { z } from 'zod';

// GET /api/feed 쿼리 파라미터 스키마 (§6.3 A7, §9 Day 6 (b))
// challenge_id: UUID, cursor: 불투명 base64url 문자열(옵션), limit: 1~50 (기본 20)
export const feedQuerySchema = z.object({
  challenge_id: z.uuid(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;

// ─────────────────────────────────────────────────────────────
// 커서 인코드/디코드 (§9 Day 6 (b))
//
// 형식: base64url(`{created_at_iso}|{uuid}`)
// - created_at_iso: Date.toISOString() — ISO 8601, `|` 없음이 보장됨
// - uuid: RFC 4122 UUID v4 — `|` 없음이 보장됨
// - base64url: +, /, = 없음 (URL safe, padding 없음)
//
// 디코드 시 첫 번째 `|` 기준으로 분리 → ISO + UUID 각각 zod 검증.
// ─────────────────────────────────────────────────────────────

// 커서 내부 검증 스키마 — ISO 8601 datetime + UUID
const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
});

// keyset cursor를 base64url 문자열로 인코딩한다.
export function encodeFeedCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

// base64url 커서를 { createdAt: Date, id: string }으로 디코딩한다.
// 형식이 잘못됐거나 내부 값이 유효하지 않으면 에러를 던진다.
// 호출부에서 try/catch로 받아 400 INVALID_CURSOR를 반환한다.
export function decodeFeedCursor(raw: string): { createdAt: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new Error('INVALID_CURSOR');
  }

  // 첫 번째 `|`만 기준으로 분리 (ISO에 `|` 없음, UUID에 `|` 없음)
  const separatorIdx = decoded.indexOf('|');
  if (separatorIdx === -1) {
    throw new Error('INVALID_CURSOR');
  }

  const isoStr = decoded.slice(0, separatorIdx);
  const idStr = decoded.slice(separatorIdx + 1);

  const parsed = cursorPayloadSchema.safeParse({ createdAt: isoStr, id: idStr });
  if (!parsed.success) {
    throw new Error('INVALID_CURSOR');
  }

  return {
    createdAt: new Date(parsed.data.createdAt),
    id: parsed.data.id,
  };
}
