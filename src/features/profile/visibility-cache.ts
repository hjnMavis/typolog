import type { ApiMySubmissionsResponse } from '@/types/api';

// /my 목록 캐시는 평탄한 items[]다(피드의 pages[].items[] 중첩과 달리 단순). visibility 토글은
// 대상 submission 1개의 is_public만 바꾸고 나머지 항목은 참조를 그대로 둔다(불필요한 리렌더 방지).
// 렌더 없이 단위 테스트 가능하도록 순수 함수로 분리한다(Day 7 reaction-cache 패턴 재사용).
//
// 낙관(onMutate)은 의도값(isPublic)을, 정정(onSuccess)은 서버 권위값을 넣는다 — 둘 다 "is_public을
// 특정 값으로 세팅"이라 한 함수로 충분하다(좋아요처럼 ±1 추정이 아니라 명시값이라 reconcile가 동일).
export function setSubmissionVisibility(
  data: ApiMySubmissionsResponse,
  submissionId: string,
  isPublic: boolean,
): ApiMySubmissionsResponse {
  // 대상이 목록에 없으면 원본을 그대로 반환(참조 보존)
  if (!data.items.some((it) => it.submission.id === submissionId)) {
    return data;
  }
  return {
    ...data,
    items: data.items.map((it) =>
      it.submission.id === submissionId
        ? { ...it, submission: { ...it.submission, is_public: isPublic } }
        : it,
    ),
  };
}
