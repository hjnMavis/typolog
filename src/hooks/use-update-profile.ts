'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProfile, type UpdateProfileResult } from '@/lib/actions/profile';

// 닉네임 수정 mutation (S3). 성공 시 닉네임이 박힌 피드 캐시를 무효화해 새 닉네임이 반영되게 한다
// (Day 8 학습 ④: 클라 상태/서버 캐시의 닉네임 갱신). /my 계정 헤더는 호출부가 직접 state로 갱신한다.
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation<UpdateProfileResult, Error, { nickname: string }>({
    mutationFn: ({ nickname }: { nickname: string }) => updateProfile({ nickname }),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: ['feed'] });
      }
    },
  });
}
