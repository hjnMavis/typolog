import { ImageResponse } from 'next/og';
import { getSharedSubmission } from '@/lib/share/get-shared-submission';

// next/og(Satori)와 getSharedSubmission의 Drizzle 조회는 Node 전용이므로 엣지 추론을 막는다
// (feed/A3와 동일 규칙).
export const runtime = 'nodejs';

// OG 이미지 크기 — 카톡/X 권장 1200×630 (1.91:1).
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const COLLAGE_SIZE = 460;

// GET /api/og/[id] — 공유용 OG 이미지 동적 생성 (§6.1 A8, §9 Day 8).
// 비인증 라우트(proxy 공개). 공개 완성 제출만 이미지를 만들고, 그 외는 404로 존재 은폐(§7.4).
// 결정 2(게이트 A): 이미지엔 한글을 그리지 않는다 — 콜라주 자체가 문장의 시각화이고, 한글 문장·
// 닉네임은 `/s/[id]`의 메타태그(og:title/description)에서 플랫폼이 네이티브로 렌더한다.
// Satori 기본 폰트는 한글 미지원(두부)이라 라틴 "Typolog" 브랜딩만 그려 폰트 로딩을 회피한다.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shared = await getSharedSubmission(id);

  // 미존재·비공개·미완성·잘못된 id → 404. 크롤러에 미리보기를 노출하지 않는다(존재 은폐).
  if (!shared) {
    return new Response('Not found', { status: 404 });
  }

  // 콜라주 바이트를 직접 fetch해 data-URI로 박는다 — Satori의 원격 fetch 의존보다 결정론적이고,
  // 렌더 결과물에 signed URL을 남기지 않는다. 실패하면 콜라주 없이 브랜드 폴백으로 렌더한다.
  let collageDataUri: string | null = null;
  if (shared.collage_url) {
    try {
      const res = await fetch(shared.collage_url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        // 방어(Reviewer): content-type은 image/* 화이트리스트(아니면 png 폴백), 크기는 상한.
        // 콜라주는 본인만 업로드(write 정책)하는 PNG≤2MB지만, next/og 메모리를 예측 가능하게 묶고
        // 비정상 응답을 폴백("T")으로 흘린다. base64 헤드룸 포함 4MB 상한.
        const rawType = res.headers.get('content-type') ?? '';
        const contentType = rawType.startsWith('image/') ? rawType : 'image/png';
        if (buf.byteLength <= 4 * 1024 * 1024) {
          collageDataUri = `data:${contentType};base64,${buf.toString('base64')}`;
        }
      }
    } catch {
      collageDataUri = null;
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#fafaf9',
          padding: 48,
        }}
      >
        {collageDataUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={collageDataUri}
            alt=""
            width={COLLAGE_SIZE}
            height={COLLAGE_SIZE}
            style={{
              width: COLLAGE_SIZE,
              height: COLLAGE_SIZE,
              objectFit: 'cover',
              borderRadius: 28,
            }}
          />
        ) : (
          // 콜라주 폴백 — FeedCard null 폴백 철학(이니셜 대신 브랜드 글자)과 동일하게 처리.
          <div
            style={{
              width: COLLAGE_SIZE,
              height: COLLAGE_SIZE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 28,
              backgroundColor: '#e7e5e4',
              fontSize: 160,
              fontWeight: 700,
              color: '#a8a29e',
            }}
          >
            T
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 28,
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: -1,
            color: '#1c1917',
          }}
        >
          Typolog
        </div>
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: {
        // 콜라주 바이트를 구워 넣어 24h 서명 만료와 무관 → 길게 캐시 가능. CDN은 하루(s-maxage),
        // 브라우저는 1h, 그 뒤 일주일간 stale-while-revalidate로 백그라운드 갱신.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}
