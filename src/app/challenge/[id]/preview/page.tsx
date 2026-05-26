export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <h1 className="text-xl font-bold">콜라주 미리보기</h1>
      <p className="mt-2 text-muted-foreground">
        챌린지 #{id} — 완성된 콜라주를 확인하세요
      </p>
    </div>
  )
}
