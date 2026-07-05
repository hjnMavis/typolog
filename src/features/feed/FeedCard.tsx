'use client';

import Link from 'next/link';
import { useToggleReaction } from '@/hooks/use-reaction';
import { ReportDialog } from './ReportDialog';
import type { ApiFeedItem } from '@/types/api';

interface FeedCardProps {
  item: ApiFeedItem;
  challengeId: string; // ['feed', challengeId] 캐시 특정용 (optimistic toggle)
}

// 닉네임 첫 글자를 아바타 이니셜로 사용 (avatar_url null 폴백)
function getInitial(nickname: string): string {
  return nickname.charAt(0).toUpperCase();
}

// Day 7: 반응 토글(optimistic) + 신고 다이얼로그. 본인 글(is_mine)은 신고 버튼을 숨긴다.
export function FeedCard({ item, challengeId }: FeedCardProps) {
  const { submission, profile, collage_url, reaction_count, user_reacted, is_mine } = item;
  const toggle = useToggleReaction(challengeId);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* 콜라주 이미지 영역 — 탭하면 공유 페이지(/s/[id])로 (#63 발견→크게보기→공유 루프) */}
      <Link
        href={`/s/${submission.id}`}
        className="relative block aspect-square w-full bg-muted"
        aria-label={`${profile.nickname}의 콜라주 자세히 보기`}
      >
        {collage_url ? (
          // next.config에 remotePatterns 미설정 → next/image 사용 불가 → <img> 사용
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={collage_url}
            alt={`${profile.nickname}의 콜라주`}
            className="h-full w-full object-cover"
          />
        ) : (
          // collage_url null 폴백: 닉네임 이니셜을 중앙에 표시
          <div
            className="flex h-full w-full items-center justify-center"
            aria-hidden="true"
          >
            <span className="text-5xl font-bold text-muted-foreground/40">
              {getInitial(profile.nickname)}
            </span>
          </div>
        )}
      </Link>

      {/* 카드 하단: 프로필 + 반응 */}
      <div className="flex items-center justify-between px-4 py-3">
        {/* 프로필 */}
        <div className="flex items-center gap-2 min-w-0">
          {/* 아바타 */}
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={`${profile.nickname} 프로필`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted-foreground/20">
                <span className="text-xs font-semibold text-muted-foreground">
                  {getInitial(profile.nickname)}
                </span>
              </div>
            )}
          </div>

          {/* 닉네임 */}
          <span className="truncate text-sm font-medium">{profile.nickname}</span>
        </div>

        {/* 우측: 신고 진입(본인 글 제외) + 반응 토글 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!is_mine && <ReportDialog submissionId={submission.id} nickname={profile.nickname} />}

          {/* 좋아요 토글 — 클릭 시 optimistic 반영, 진행 중엔 비활성 */}
          <button
            type="button"
            onClick={() => toggle.mutate(submission.id)}
            disabled={toggle.isPending}
            aria-pressed={user_reacted}
            aria-label={
              user_reacted
                ? `좋아요 취소 (현재 ${reaction_count}개)`
                : `좋아요 (현재 ${reaction_count}개)`
            }
            className="flex items-center gap-1 text-sm disabled:opacity-60"
          >
            {/* 하트 아이콘: user_reacted → 채운 하트, 아니면 빈 하트 */}
            <span
              className={user_reacted ? 'text-red-500' : 'text-muted-foreground'}
              aria-hidden="true"
            >
              {user_reacted ? '♥' : '♡'}
            </span>
            <span className="text-muted-foreground">{reaction_count}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
