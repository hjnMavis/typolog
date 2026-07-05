'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, PenLine, User } from 'lucide-react';
import { cn } from '@/lib/utils';

// 하단 탭 — 홈(만들기) / 피드(발견) / 마이(나). IA 결정(#62)·#61 흡수.
const TABS = [
  { href: '/', label: '만들기', Icon: PenLine, isActive: (p: string) => p === '/' },
  { href: '/feed/today', label: '피드', Icon: Compass, isActive: (p: string) => p.startsWith('/feed') },
  {
    href: '/my',
    label: '마이',
    Icon: User,
    isActive: (p: string) => p === '/my' || p.startsWith('/my/'),
  },
] as const;

// 탭을 보여줄 경로(allowlist). 수집·미리보기(풀스크린 집중)·로그인·공유(비인증)·admin은 숨김 →
// 그 경로에선 null을 반환해 셸 밖에 둔다.
function shouldShowTabs(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/feed') ||
    pathname === '/my' ||
    pathname.startsWith('/my/')
  );
}

export function BottomTabNav() {
  const pathname = usePathname();
  if (!shouldShowTabs(pathname)) return null;

  return (
    <nav
      aria-label="주요 네비게이션"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 text-xs transition-colors',
                  active
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
