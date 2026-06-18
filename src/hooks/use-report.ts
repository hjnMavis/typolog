'use client';

import { useMutation } from '@tanstack/react-query';
import { createReport, type CreateReportResult } from '@/lib/actions/reports';

export interface ReportVariables {
  submissionId: string;
  reason: string;
}

// 신고 mutation — optimistic 불필요(신고는 피드 UI에 반영되지 않음).
// 결과 객체(ok/code)로 성공·실패를 분기한다. 다이얼로그가 code → 메시지를 매핑.
export function useCreateReport() {
  return useMutation<CreateReportResult, Error, ReportVariables>({
    mutationFn: (vars: ReportVariables) => createReport(vars),
  });
}
