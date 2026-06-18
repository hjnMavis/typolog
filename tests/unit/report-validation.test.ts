/**
 * createReportSchema 단위 테스트 — 신고 사유 검증 (S2, §7.2)
 *
 * reason: 1~500자, 트림. submission_id: UUID.
 */

import { describe, it, expect } from 'vitest';
import { createReportSchema, REPORT_REASON_MAX } from '@/lib/validations/report';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('createReportSchema', () => {
  it('유효한 사유를 통과시킨다', () => {
    const r = createReportSchema.safeParse({ submission_id: VALID_UUID, reason: '부적절한 이미지예요' });
    expect(r.success).toBe(true);
  });

  it('빈 사유를 거부한다', () => {
    expect(createReportSchema.safeParse({ submission_id: VALID_UUID, reason: '' }).success).toBe(false);
  });

  it('공백만 있는 사유를 거부한다 (trim 후 빈 문자열)', () => {
    expect(createReportSchema.safeParse({ submission_id: VALID_UUID, reason: '   ' }).success).toBe(false);
  });

  it('사유 앞뒤 공백을 trim한다', () => {
    const r = createReportSchema.safeParse({ submission_id: VALID_UUID, reason: '  스팸  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe('스팸');
  });

  it('500자 정확히는 허용한다', () => {
    const r = createReportSchema.safeParse({
      submission_id: VALID_UUID,
      reason: 'a'.repeat(REPORT_REASON_MAX),
    });
    expect(r.success).toBe(true);
  });

  it('501자는 거부한다', () => {
    const r = createReportSchema.safeParse({
      submission_id: VALID_UUID,
      reason: 'a'.repeat(REPORT_REASON_MAX + 1),
    });
    expect(r.success).toBe(false);
  });

  it('submission_id가 UUID가 아니면 거부한다', () => {
    expect(createReportSchema.safeParse({ submission_id: 'not-a-uuid', reason: '사유' }).success).toBe(
      false,
    );
  });
});
