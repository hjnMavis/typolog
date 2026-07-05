'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdateProfile } from '@/hooks/use-update-profile';
import { NICKNAME_MAX, updateProfileSchema } from '@/lib/validations/profile';

interface ProfileEditSheetProps {
  currentNickname: string;
  /** 저장 성공 시 새 닉네임을 부모(/my 헤더)에 반영 — 서버 prop은 안 바뀌므로 state로 갱신한다. */
  onUpdated: (nickname: string) => void;
}

// 서버 결과 코드 → 메시지 (throw 메시지에 의존하지 않음, production 마스킹 회피 — Day 7 §6)
function serverErrorMessage(code: 'UNAUTHENTICATED' | 'INVALID'): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return '로그인이 필요해요.';
    case 'INVALID':
      return '닉네임을 다시 확인해 주세요.';
  }
}

// 프로필 수정 Sheet(하단 시트) — 닉네임만 수정(아바타 업로드 MVP 제외). 클라이언트가 같은 zod
// 스키마로 즉시 검증하고, 서버(S3)가 권위 검증한다. 열 때 현재 닉네임으로 시드한다.
export function ProfileEditSheet({ currentNickname, onUpdated }: ProfileEditSheetProps) {
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState(currentNickname);
  const update = useUpdateProfile();

  // 클라 검증 — transform(정제) 후 길이 검사. 정제된 값으로 "변경 없음"도 판단한다.
  const parsed = updateProfileSchema.safeParse({ nickname });
  const validationMessage = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? '닉네임을 확인해 주세요.');
  const unchanged = parsed.success && parsed.data.nickname === currentNickname;
  const canSubmit = parsed.success && !unchanged && !update.isPending;

  const serverError =
    update.data && !update.data.ok
      ? serverErrorMessage(update.data.code)
      : update.isError
        ? '저장에 실패했어요. 잠시 후 다시 시도해 주세요.'
        : null;
  // 입력 형식 오류를 우선 노출하고, 형식이 맞으면 서버 오류를 보여준다.
  const message = validationMessage ?? serverError;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setNickname(currentNickname); // 열 때 현재 닉네임으로 시드
      update.reset();
    }
  }

  function handleSave() {
    update.mutate(
      { nickname },
      {
        onSuccess: (result) => {
          if (result.ok) {
            onUpdated(result.nickname);
            setOpen(false);
          }
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            프로필 수정
          </button>
        }
      />
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md gap-4 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader>
          <SheetTitle>프로필 수정</SheetTitle>
          <SheetDescription>닉네임을 바꿀 수 있어요. (2~{NICKNAME_MAX}자)</SheetDescription>
        </SheetHeader>

        <div className="grid gap-1.5 px-4">
          <label htmlFor="nickname-input" className="text-sm font-medium">
            닉네임
          </label>
          <Input
            id="nickname-input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            // 표시 길이 상한은 NICKNAME_MAX이나, trim·정제(\p{Cc}\p{Cf}<>) 여유분을 위해 2배까지 입력 허용
            maxLength={NICKNAME_MAX * 2}
            autoComplete="off"
            aria-invalid={!!validationMessage}
            placeholder="닉네임"
          />
          <div className="min-h-4 text-xs text-red-500" aria-live="polite">
            {message}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <SheetClose render={<Button variant="outline" />}>취소</SheetClose>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {update.isPending ? '저장 중…' : '저장'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
