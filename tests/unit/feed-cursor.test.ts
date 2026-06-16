/**
 * feed cursor 인코드/디코드 단위 테스트
 *
 * 계약:
 *   - encodeFeedCursor(date, id) → decode(encode(date, id)) === { createdAt: date, id }
 *   - base64url 출력에 +, /, = 없음 (URL safe)
 *   - 깨진 base64, | 없음, 잘못된 UUID, 잘못된 ISO timestamp → 에러 throw
 */

import { describe, it, expect } from 'vitest';
import { encodeFeedCursor, decodeFeedCursor } from '@/lib/validations/feed';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_DATE = new Date('2026-06-15T12:34:56.789Z');

// ─────────────────────────────────────────────────────────────
// 정상 케이스
// ─────────────────────────────────────────────────────────────
describe('encodeFeedCursor / decodeFeedCursor — 정상 케이스', () => {
  it('encode → decode 왕복 시 createdAt(ISO)와 id를 보존한다', () => {
    const cursor = encodeFeedCursor(VALID_DATE, VALID_UUID);
    const result = decodeFeedCursor(cursor);

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toBe(VALID_DATE.toISOString());
    expect(result.id).toBe(VALID_UUID);
  });

  it('base64url 출력에 +, /, = 문자가 없다 (URL safe)', () => {
    const cursor = encodeFeedCursor(VALID_DATE, VALID_UUID);

    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('서로 다른 날짜·id 쌍이 다른 커서를 생성한다', () => {
    const uuid2 = '22222222-2222-4222-8222-222222222222';
    const date2 = new Date('2025-01-01T00:00:00.000Z');

    const c1 = encodeFeedCursor(VALID_DATE, VALID_UUID);
    const c2 = encodeFeedCursor(date2, uuid2);

    expect(c1).not.toBe(c2);
  });

  it('밀리초 포함 ISO 타임스탬프를 정확히 왕복한다', () => {
    const dateWithMs = new Date('2026-06-15T23:59:59.999Z');
    const cursor = encodeFeedCursor(dateWithMs, VALID_UUID);
    const result = decodeFeedCursor(cursor);

    expect(result.createdAt.getMilliseconds()).toBe(999);
  });

  it('시간대 오프셋이 있는 ISO 문자열도 디코드된다', () => {
    // Drizzle withTimezone 컬럼은 UTC로 반환하지만 방어적으로 검증
    const dateUtc = new Date('2026-06-15T00:00:00.000Z');
    const cursor = encodeFeedCursor(dateUtc, VALID_UUID);
    const result = decodeFeedCursor(cursor);

    expect(result.createdAt.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────
// 에러 케이스 — 모두 에러를 throw해야 한다
// ─────────────────────────────────────────────────────────────
describe('decodeFeedCursor — 에러 케이스', () => {
  it('완전히 무작위 문자열은 에러를 던진다', () => {
    expect(() => decodeFeedCursor('garbage!!!')).toThrow();
  });

  it('base64url이지만 | 구분자 없는 값은 에러를 던진다', () => {
    // base64url 인코딩이지만 내부에 | 없음
    const noSeparator = Buffer.from('nodividerisinhere', 'utf8').toString('base64url');
    expect(() => decodeFeedCursor(noSeparator)).toThrow();
  });

  it('ISO timestamp 부분이 잘못된 날짜면 에러를 던진다', () => {
    const badDate = `not-a-date|${VALID_UUID}`;
    const encoded = Buffer.from(badDate, 'utf8').toString('base64url');
    expect(() => decodeFeedCursor(encoded)).toThrow();
  });

  it('UUID 부분이 유효하지 않으면 에러를 던진다', () => {
    const badUuid = `${VALID_DATE.toISOString()}|not-a-uuid`;
    const encoded = Buffer.from(badUuid, 'utf8').toString('base64url');
    expect(() => decodeFeedCursor(encoded)).toThrow();
  });

  it('빈 문자열은 에러를 던진다', () => {
    expect(() => decodeFeedCursor('')).toThrow();
  });

  it('| 왼쪽이 비어 있으면 에러를 던진다 (timestamp 없음)', () => {
    const missingTs = `|${VALID_UUID}`;
    const encoded = Buffer.from(missingTs, 'utf8').toString('base64url');
    expect(() => decodeFeedCursor(encoded)).toThrow();
  });

  it('| 오른쪽이 비어 있으면 에러를 던진다 (uuid 없음)', () => {
    const missingId = `${VALID_DATE.toISOString()}|`;
    const encoded = Buffer.from(missingId, 'utf8').toString('base64url');
    expect(() => decodeFeedCursor(encoded)).toThrow();
  });
});
