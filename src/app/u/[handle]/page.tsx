export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <h1 className="text-xl font-bold">@{handle}</h1>
      <p className="mt-2 text-muted-foreground">콜라주 목록</p>
    </div>
  )
}
