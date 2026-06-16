'use client';

import type { ApiFeedItem } from '@/types/api';

interface FeedCardProps {
  item: ApiFeedItem;
}

// 닉네임 첫 글자를 아바타 이니셜로 사용 (avatar_url null 폴백)
function getInitial(nickname: string): string {
  return nickname.charAt(0).toUpperCase();
}

// Day 6: 반응(reaction)은 표시 전용 — 클릭 이벤트 없음 (toggle은 Day 7 구현)
export function FeedCard({ item }: FeedCardProps) {
  const { profile, collage_url, reaction_count, user_reacted } = item;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* 콜라주 이미지 영역 */}
      <div className="relative aspect-square w-full bg-muted">
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
            aria-label={`${profile.nickname}의 콜라주 (미리보기 없음)`}
          >
            <span className="text-5xl font-bold text-muted-foreground/40">
              {getInitial(profile.nickname)}
            </span>
          </div>
        )}
      </div>

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

        {/* 반응 (표시 전용) */}
        <div
          className="flex shrink-0 items-center gap-1 text-sm"
          aria-label={`좋아요 ${reaction_count}개`}
        >
          {/* 하트 아이콘: user_reacted → 채운 하트, 아니면 빈 하트 */}
          <span
            className={user_reacted ? 'text-red-500' : 'text-muted-foreground'}
            aria-hidden="true"
          >
            {user_reacted ? '♥' : '♡'}
          </span>
          <span className="text-muted-foreground">{reaction_count}</span>
        </div>
      </div>
    </article>
  );
}
