/**
 * updateProfileSchema 단위 테스트 — 닉네임 transform·검증 (S3, §6.2)
 *
 * transform이 먼저 정제(trim·\p{Cc}\p{Cf}<> 제거)하고 pipe가 길이를 검사한다.
 * 참고: src/lib/validations/profile.ts
 */

import { describe, it, expect } from 'vitest';
import { updateProfileSchema, NICKNAME_MIN, NICKNAME_MAX } from '@/lib/validations/profile';

describe('updateProfileSchema — 닉네임 transform & 검증', () => {
  // ─── 제어/포맷 문자 제거 ───────────────────────────────────────────────
  it('"<<<" 는 transform 후 빈 문자열 → min 위반으로 실패', () => {
    const r = updateProfileSchema.safeParse({ nickname: '<<<' });
    expect(r.success).toBe(false);
  });

  it('꺾쇠(>)만 있는 문자열 → 빈 문자열 → min 위반으로 실패', () => {
    const r = updateProfileSchema.safeParse({ nickname: '>>>' });
    expect(r.success).toBe(false);
  });

  it('zero-width space(\\u200B) 제거 후 유효 닉네임이면 통과', () => {
    // "​ab​" — zero-width space 2개가 사이에 있어도 정제 후 "ab"
    const r = updateProfileSchema.safeParse({ nickname: '​ab​' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('ab');
  });

  it('zero-width non-joiner(\\u200C)·zero-width joiner(\\u200D) 제거', () => {
    const r = updateProfileSchema.safeParse({ nickname: '‌닉‍네임' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('닉네임');
  });

  it('RTL override(\\u202E, \\p{Cf}) 제거 후 유효 닉네임이면 통과', () => {
    // "‮nick" → "nick" (2글자 이상이므로 통과)
    const r = updateProfileSchema.safeParse({ nickname: '‮nick' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('nick');
  });

  it('\\p{Cf} 문자만으로 구성된 입력 → 빈 문자열 → min 위반으로 실패', () => {
    // zero-width no-break space (BOM, U+FEFF)도 \p{Cf}
    const r = updateProfileSchema.safeParse({ nickname: '﻿​‌' });
    expect(r.success).toBe(false);
  });

  // ─── 공백 trim ─────────────────────────────────────────────────────────
  it('앞뒤 공백을 trim한다', () => {
    const r = updateProfileSchema.safeParse({ nickname: '  타이포  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('타이포');
  });

  it('공백만 있는 입력 → trim 후 빈 문자열 → min 위반으로 실패', () => {
    const r = updateProfileSchema.safeParse({ nickname: '   ' });
    expect(r.success).toBe(false);
  });

  it('앞뒤 공백 trim 후 2자 이상이면 통과', () => {
    const r = updateProfileSchema.safeParse({ nickname: '  로그  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('로그');
  });

  // ─── 길이 경계 ─────────────────────────────────────────────────────────
  it(`정확히 ${NICKNAME_MIN}자(하한)는 통과한다`, () => {
    const r = updateProfileSchema.safeParse({ nickname: 'ab' }); // 2자
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('ab');
  });

  it(`정확히 ${NICKNAME_MAX}자(상한)는 통과한다`, () => {
    const r = updateProfileSchema.safeParse({ nickname: 'a'.repeat(NICKNAME_MAX) });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toHaveLength(NICKNAME_MAX);
  });

  it(`${NICKNAME_MIN - 1}자(하한 미달)는 실패한다`, () => {
    const r = updateProfileSchema.safeParse({ nickname: 'a' }); // 1자
    expect(r.success).toBe(false);
  });

  it(`${NICKNAME_MAX + 1}자(상한 초과)는 실패한다`, () => {
    const r = updateProfileSchema.safeParse({ nickname: 'a'.repeat(NICKNAME_MAX + 1) });
    expect(r.success).toBe(false);
  });

  // ─── 정제 후 길이 검사 순서 ────────────────────────────────────────────
  it('꺾쇠 제거 후 2자 이상이면 통과한다 ("<<abc>>" → "abc")', () => {
    const r = updateProfileSchema.safeParse({ nickname: '<<abc>>' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('abc');
  });

  it('trim + 정제 후 1자만 남으면 실패한다 ("  a  " 은 통과이나 "<a>" → "a" 는 실패)', () => {
    // trim("  a  ") = "a" → 1자 → 실패
    const r = updateProfileSchema.safeParse({ nickname: '  a  ' });
    expect(r.success).toBe(false);
  });

  // ─── 정상 케이스 ──────────────────────────────────────────────────────
  it('한글 닉네임은 통과한다', () => {
    const r = updateProfileSchema.safeParse({ nickname: '타이포로그' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('타이포로그');
  });

  it('영숫자 닉네임은 통과한다', () => {
    const r = updateProfileSchema.safeParse({ nickname: 'user123' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe('user123');
  });
});
