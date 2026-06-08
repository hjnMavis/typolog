"use client"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/browser"

// 최소 로그인 페이지 (게이트 A 결정 b — Backend가 이 1파일만 신규 생성)
// 디자인 다듬기는 Phase 3에서 Frontend가 담당한다.
export default function LoginPage() {
  const handleGoogleLogin = async () => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/`,
      },
    })
    // 에러 UI 표시는 Phase 3 Frontend 이관 — 에러를 삼키지 않는 최소 처리만 둔다
    if (error) console.error("Google 로그인 시작 실패:", error.message)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Typolog</h1>
          <p className="text-sm text-muted-foreground">
            같은 문장을, 각자의 일상에서 다르게
          </p>
        </div>

        <Button size="lg" className="w-full" onClick={handleGoogleLogin}>
          Google로 시작하기
        </Button>
      </div>
    </div>
  )
}
