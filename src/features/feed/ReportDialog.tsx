'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCreateReport } from '@/hooks/use-report';
import { REPORT_REASON_MAX } from '@/lib/validations/report';

interface ReportDialogProps {
  submissionId: string;
  nickname: string;
}

// 결과 코드 → 사용자 메시지 (서버 결과 객체 기반, throw 메시지에 의존하지 않음)
function resultMessage(code: 'UNAUTHENTICATED' | 'INVALID' | 'SELF_REPORT' | 'NOT_FOUND'): string {
  switch (code) {
    case 'SELF_REPORT':
      return '본인 글은 신고할 수 없어요.';
    case 'UNAUTHENTICATED':
      return '로그인이 필요해요.';
    case 'NOT_FOUND':
      return '이미 삭제된 글이에요.';
    case 'INVALID':
      return '신고 사유를 다시 확인해 주세요.';
  }
}

// 신고 다이얼로그 — 카드의 "신고" 진입에서 열린다(§3-7). 사유 입력(1~500자) → 제출 → 피드백.
// open을 제어 상태로 두어 닫힐 때 입력·결과를 초기화한다.
export function ReportDialog({ submissionId, nickname }: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const report = useCreateReport();

  const trimmedLength = reason.trim().length;
  const canSubmit = trimmedLength > 0 && trimmedLength <= REPORT_REASON_MAX && !report.isPending;

  const errorMessage = report.isError
    ? '신고에 실패했어요. 잠시 후 다시 시도해 주세요.'
    : report.data && !report.data.ok
      ? resultMessage(report.data.code)
      : null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason('');
      setDone(false);
      report.reset();
    }
  }

  function handleSubmit() {
    report.mutate(
      { submissionId, reason: reason.trim() },
      {
        onSuccess: (result) => {
          if (result.ok) setDone(true);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`${nickname}의 콜라주 신고`}
            className="shrink-0 rounded-full px-1 text-base leading-none text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        }
      />
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>신고가 접수됐어요</DialogTitle>
              <DialogDescription>검토 후 조치할게요. 알려주셔서 고마워요.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button />}>닫기</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>이 콜라주 신고</DialogTitle>
              <DialogDescription>신고 사유를 적어 주세요. 검토 후 조치합니다.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={REPORT_REASON_MAX}
                placeholder="예: 부적절한 이미지예요"
                aria-label="신고 사유"
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {trimmedLength}/{REPORT_REASON_MAX}
                </span>
                {errorMessage && <span className="text-red-500">{errorMessage}</span>}
              </div>
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {report.isPending ? '제출 중…' : '신고하기'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
