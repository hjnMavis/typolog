import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// `/s/[id]`에서 notFound() 시 렌더. 미존재·비공개·미완성을 한 화면으로 묶어 존재를 은폐한다(§7.4)
// — 어떤 사유로 막혔는지 구분해 알려주지 않는다.
export default function ShareNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">콜라주를 찾을 수 없어요</h1>
        <p className="text-sm text-muted-foreground">
          삭제됐거나, 비공개이거나, 존재하지 않는 공유 링크예요.
        </p>
      </div>
      <Link href="/" className={cn(buttonVariants({ size: 'lg' }), 'w-full max-w-xs')}>
        나도 만들기
      </Link>
    </main>
  )
}
