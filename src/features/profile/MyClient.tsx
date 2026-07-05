'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMySubmissions } from '@/hooks/use-my-submissions';
import { useLogout } from '@/hooks/use-logout';
import { Button } from '@/components/ui/button';
import { MySubmissionCard } from './MySubmissionCard';
import { ProfileEditSheet } from './ProfileEditSheet';

interface MyClientProps {
  /** 서버에서 주입한 현재 사용자 닉네임 — 계정 표시용(프로필 수정 UI는 U3에서 추가). */
  initialNickname: string;
  /** public 버킷 아바타 URL(없으면 이니셜 폴백). 아바타 업로드는 MVP 제외. */
  avatarUrl: string | null;
}

function getInitial(nickname: string): string {
  return nickname.charAt(0).toUpperCase() || '?';
}

// 마이페이지(/my) — 계정 표시 + 로그아웃 + 내 콜라주 목록(비공개 포함). Day 9 IA 결정으로
// 계정 표시(#6)·로그아웃이 홈에서 여기로 이전됐다.
export function MyClient({ initialNickname, avatarUrl }: MyClientProps) {
  const { logout, isPending: isLoggingOut } = useLogout();
  const { data, isPending, isError, refetch, isRefetching } = useMySubmissions();
  // 서버 prop은 갱신되지 않으므로 닉네임을 state로 들고, 프로필 수정 성공 시 즉시 반영한다.
  const [nickname, setNickname] = useState(initialNickname);

  return (
    // pb-24: 하단 탭 네비(U4)가 가리지 않도록 여유 — 탭 도입 전에도 무해.
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-6">
      {/* ─── 계정 헤더 ─── */}
      <header className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={`${nickname} 프로필`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted-foreground/20">
              <span className="text-base font-semibold text-muted-foreground">
                {getInitial(nickname)}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{nickname}</p>
          <ProfileEditSheet currentNickname={nickname} onUpdated={setNickname} />
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          disabled={isLoggingOut}
          className="shrink-0 text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-60"
        >
          {isLoggingOut ? '로그아웃 중…' : '로그아웃'}
        </button>
      </header>

      {/* ─── 내 콜라주 목록 ─── */}
      <section className="mt-6">
        {isPending ? (
          <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="내 콜라주 로딩 중">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                aria-hidden="true"
              >
                <div className="aspect-square w-full animate-pulse bg-muted" />
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-semibold">내 콜라주를 불러오지 못했어요</p>
            <p className="mt-1 text-xs text-muted-foreground">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              {isRefetching ? '다시 시도 중…' : '다시 시도'}
            </Button>
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl" aria-hidden="true">✦</p>
            <p className="mt-4 text-sm font-semibold">아직 완성한 콜라주가 없어요</p>
            <p className="mt-1 text-xs text-muted-foreground">오늘의 문장을 완성해 보세요!</p>
            <Link
              href="/"
              className="mt-4 text-sm font-medium text-foreground underline underline-offset-4"
            >
              만들러 가기
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data.items.map((item) => (
              <MySubmissionCard key={item.submission.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
