'use client';

// QueryClientProvider는 내부에서 useContext를 쓰므로 클라이언트 컴포넌트여야 한다.
// 공식 권장 패턴(advanced-ssr 가이드): isServer 분기 + 브라우저 모듈 싱글턴.
import { isServer, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 전역 기본 staleTime 60s — 마운트 직후 즉시 리페치를 막는 공식 권장 기본값.
        // 쿼리별 정책(게이트 A-(e): challenge today 5m / submission 30m)은 각 훅에서 덮어쓴다.
        staleTime: 60 * 1000,
        // 4xx(인증·존재·검증 실패)는 재시도해도 결과가 같으므로 즉시 실패시킨다.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 3;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) {
    // 서버: 요청 간 캐시가 공유되면 사용자 데이터가 섞이므로 항상 새로 만든다.
    return makeQueryClient();
  }
  // 브라우저: 모듈 싱글턴 재사용. useState 초기화는 suspense 경계가 없을 때
  // 초기 렌더 중단 시 클라이언트가 버려질 수 있어 쓰지 않는다(공식 가이드 NOTE).
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* devtools는 development에서만 렌더되고 production 번들에서 제외된다 */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
