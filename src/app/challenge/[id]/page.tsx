export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <h1 className="text-xl font-bold">글자 수집</h1>
      <p className="mt-2 text-muted-foreground">
        챌린지 #{id} — 슬롯을 터치해서 글자를 모아보세요
      </p>
    </div>
  )
}
