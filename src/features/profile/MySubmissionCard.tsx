'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToggleVisibility } from '@/hooks/use-toggle-visibility';
import type { ApiMySubmission } from '@/types/api';

interface MySubmissionCardProps {
  item: ApiMySubmission;
}

/** completed_at ISO → KST 기준 "YYYY.MM.DD" (없으면 null) — getKSTDateString과 동일 로캘 패턴 */
function formatCompletedDate(completedAt: string | null): string | null {
  if (!completedAt) return null;
  return new Date(completedAt)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    .replaceAll('-', '.');
}

// 마이페이지 카드 — 내 완성 콜라주 1개. 공개/비공개 배지 + 토글(낙관적). 본인 것만 표시되므로
// 신고/프로필은 없고, 어떤 문장이었는지(challenge.sentence)와 반응 수를 보여준다.
// #77: 이미지 탭 → 확대 라이트박스. /api/me/submissions의 본인 JWT 서명 URL을 그대로 재사용해
// 비공개작도 크게 볼 수 있다 (`/s`는 비공개 404가 설계라 본인용 뷰는 여기뿐).
export function MySubmissionCard({ item }: MySubmissionCardProps) {
  const { submission, challenge, collage_url, reaction_count } = item;
  const isPublic = submission.is_public;
  const toggle = useToggleVisibility();
  const [viewerOpen, setViewerOpen] = useState(false);
  const completedDate = formatCompletedDate(submission.completed_at);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* 콜라주 이미지 영역 — 탭하면 확대 뷰(#77), 서명 실패(null) 폴백은 탭 불가 */}
      <div className="relative aspect-square w-full bg-muted">
        {collage_url ? (
          <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  aria-label={`${challenge.sentence} 콜라주 크게 보기`}
                  className="block h-full w-full"
                >
                  {/* next.config에 remotePatterns 미설정 → next/image 사용 불가 → <img> 사용 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={collage_url}
                    alt={`${challenge.sentence} 콜라주`}
                    className="h-full w-full object-cover"
                  />
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{challenge.sentence}</DialogTitle>
                <DialogDescription>
                  {completedDate ? `${completedDate} 완성 · ` : ''}좋아요 {reaction_count}개
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={collage_url}
                alt={`${challenge.sentence} 콜라주 확대`}
                className="w-full rounded-lg ring-1 ring-black/10"
              />
            </DialogContent>
          </Dialog>
        ) : (
          // collage_url null 폴백(서명 실패): 문장을 중앙에 표시
          <div
            className="flex h-full w-full items-center justify-center p-4 text-center"
            aria-label="콜라주 미리보기 없음"
          >
            <span className="text-sm font-medium text-muted-foreground/50">
              {challenge.sentence}
            </span>
          </div>
        )}

        {/* 공개/비공개 배지 — 좌상단 (장식 오버레이 — 탭은 아래 이미지로 통과) */}
        <span
          className={`pointer-events-none absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${
            isPublic
              ? 'bg-foreground/70 text-background'
              : 'bg-amber-500/90 text-white'
          }`}
        >
          {isPublic ? '공개' : '비공개'}
        </span>
      </div>

      {/* 카드 하단: 문장 + 반응 수 + 공개 토글 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium" title={challenge.sentence}>
            {challenge.sentence}
          </span>
          <span className="text-xs text-muted-foreground" aria-label={`좋아요 ${reaction_count}개`}>
            <span aria-hidden="true">♥</span> {reaction_count}
          </span>
        </div>

        {/* 공개/비공개 토글 — 클릭 시 optimistic 반영, 진행 중엔 비활성 */}
        <button
          type="button"
          onClick={() => toggle.mutate({ submissionId: submission.id, isPublic: !isPublic })}
          disabled={toggle.isPending}
          aria-pressed={isPublic}
          aria-label={isPublic ? '비공개로 전환' : '공개로 전환'}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
            isPublic
              ? 'border-border text-muted-foreground hover:bg-muted'
              : 'border-amber-500/40 text-amber-600 hover:bg-amber-50'
          }`}
        >
          {isPublic ? '🌐 공개' : '🔒 비공개'}
        </button>
      </div>
    </article>
  );
}
