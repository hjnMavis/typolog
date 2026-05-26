export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <h1 className="text-xl font-bold">공유된 콜라주</h1>
      <p className="mt-2 text-muted-foreground">
        제출 #{id} — 나도 만들어볼까?
      </p>
    </div>
  )
}
