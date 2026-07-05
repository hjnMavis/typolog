'use client';

import { useToggleVisibility } from '@/hooks/use-toggle-visibility';
import type { ApiMySubmission } from '@/types/api';

interface MySubmissionCardProps {
  item: ApiMySubmission;
}

// 마이페이지 카드 — 내 완성 콜라주 1개. 공개/비공개 배지 + 토글(낙관적). 본인 것만 표시되므로
// 신고/프로필은 없고, 어떤 문장이었는지(challenge.sentence)와 반응 수를 보여준다.
export function MySubmissionCard({ item }: MySubmissionCardProps) {
  const { submission, challenge, collage_url, reaction_count } = item;
  const isPublic = submission.is_public;
  const toggle = useToggleVisibility();

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* 콜라주 이미지 영역 */}
      <div className="relative aspect-square w-full bg-muted">
        {collage_url ? (
          // next.config에 remotePatterns 미설정 → next/image 사용 불가 → <img> 사용
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={collage_url}
            alt={`${challenge.sentence} 콜라주`}
            className="h-full w-full object-cover"
          />
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

        {/* 공개/비공개 배지 — 좌상단 */}
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${
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
