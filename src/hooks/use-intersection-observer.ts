'use client';

import { useEffect, useRef } from 'react';

// IntersectionObserver 센티널 훅. 대상 요소가 뷰포트에 진입하면 onIntersect를 호출한다.
// 컴포넌트 언마운트 시 observer를 정리한다.
// enabled: false이면 observe를 시작하지 않는다 (다음 페이지 없거나 로딩 중일 때).
export function useIntersectionObserver(
  onIntersect: () => void,
  enabled: boolean,
) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onIntersect();
        }
      },
      { rootMargin: '200px' }, // 200px 여유를 두고 미리 트리거
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [enabled, onIntersect]);

  return sentinelRef;
}
