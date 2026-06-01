/**
 * 콜라주 PNG 내보내기 오케스트레이터
 *
 * 순수 함수 (buildCollageFilename, shouldUseIosFallback, canExport):
 *   DOM 의존 없음 → Vitest 단위 테스트 가능
 *
 * 비동기 함수 (downloadCollage):
 *   브라우저 전용 (window, URL.createObjectURL) → 클라이언트 핸들러 내부에서만 호출
 */

import type { LetterSlot } from "@/types"

// ─────────────────────────────────────────────────────────
// PURE 함수
// ─────────────────────────────────────────────────────────

/**
 * 콜라주 PNG 파일명을 생성한다.
 * 형식: typolog-{challengeId}-{yyyymmdd}.png
 *
 * @param challengeId - 챌린지 ID (e.g. "4")
 * @param kstDate     - Asia/Seoul 날짜 문자열 "YYYY-MM-DD" (getKSTDateString() 반환값)
 */
export function buildCollageFilename(challengeId: string, kstDate: string): string {
  const datePart = kstDate.replaceAll("-", "")
  return `typolog-${challengeId}-${datePart}.png`
}

/**
 * 현재 User-Agent가 iOS(iPhone/iPad/iPod) 환경인지 판단한다.
 * iOS Safari는 <a download>를 무시하므로 이 경우에만 새 탭 fallback을 써야 한다.
 *
 * 주의 1: UA 스니핑은 불완전하다. 잘못 감지돼도 fallback(새 탭)은 크래시를 유발하지 않는다.
 * 주의 2: iPadOS 13+ 는 데스크톱 Mac과 "완전히 동일한" UA("Macintosh; Intel Mac OS X")를 보낸다.
 *         따라서 UA 문자열만으로는 실제 Mac Safari와 iPad을 구분할 수 없다.
 *         이 순수 함수는 명확한 iOS UA만 판별하고(= Mac UA는 항상 false → 다운로드 경로),
 *         iPadOS-as-Mac 케이스는 클라이언트 핸들러가 navigator.maxTouchPoints > 1 로 보정한다.
 *         (실제 Mac은 maxTouchPoints === 0, iPad은 > 1 이므로 이 둘만이 신뢰할 수 있는 구분자다.)
 *
 * @param userAgent - navigator.userAgent 문자열
 */
export function shouldUseIosFallback(userAgent: string): boolean {
  // iPhone / iPod / iPad — iOS의 모든 브라우저(Safari/CriOS/FxiOS)는 UA에 이 토큰을 포함한다.
  // Macintosh UA는 의도적으로 매칭하지 않는다(실제 Mac 오인식 방지).
  return /iphone|ipod|ipad/i.test(userAgent)
}

/**
 * 실제 다운로드 경로 결정 함수.
 * iOS(iPhone/iPad/iPod)이거나 iPadOS-as-Mac일 때만 새 탭 fallback을 쓰고,
 * 그 외 데스크톱/Android는 <a download> 직접 다운로드를 쓴다.
 *
 * 핵심: 데스크톱 Chrome/Firefox/Edge는 <a download>를 완벽히 지원하므로
 *       maxTouchPoints 값(터치 트랙패드/태블릿 주변기기로 0이 아닐 수 있음)과 무관하게
 *       절대 fallback 대상이 아니다. → Mac Chrome 오인식 버그 방지.
 *
 * iPadOS 13+ 만 "Mac UA + 터치 + Safari(데스크톱 브라우저 아님)" 조합으로 식별한다.
 *
 * @param userAgent      - navigator.userAgent
 * @param maxTouchPoints - navigator.maxTouchPoints (Mac=0, iPad>1)
 */
export function shouldUseIosFallbackWithTouch(
  userAgent: string,
  maxTouchPoints: number
): boolean {
  // 1) 명확한 iOS UA(iPhone/iPad/iPod) → 무조건 fallback
  if (shouldUseIosFallback(userAgent)) return true

  // 2) iPadOS 13+ 위장 케이스: Mac UA + 멀티터치
  //    단, 데스크톱 브라우저(Chrome/Firefox/Edge)는 제외한다.
  //    iPad Safari(데스크톱 모드)는 Mac UA지만 chrome/firefox/edg 토큰이 없다.
  const isMacUA = /macintosh|mac os x/i.test(userAgent)
  const isDesktopBrowser = /chrome|chromium|firefox|edg\//i.test(userAgent)
  return isMacUA && maxTouchPoints > 1 && !isDesktopBrowser
}

/**
 * 모든 슬롯이 채워진 상태인지 확인한다. (collage-layout.ts의 canPreview와 동일한 로직)
 * export 버튼 활성화 조건으로 사용한다.
 *
 * @param slots - LetterSlot 배열
 */
export function canExport(slots: Pick<LetterSlot, "status">[]): boolean {
  return slots.length > 0 && slots.every((s) => s.status === "filled")
}

// ─────────────────────────────────────────────────────────
// 다운로드 오케스트레이터 — 브라우저 전용
// ─────────────────────────────────────────────────────────

export type DownloadMode = "download" | "ios-fallback"

export interface DownloadCollageResult {
  mode: DownloadMode
}

export interface DownloadCollageOptions {
  blob: Blob
  filename: string
  /**
   * iOS fallback(새 탭 열기)을 쓸지 여부.
   * 클라이언트 핸들러가 shouldUseIosFallbackWithTouch()로 미리 판단해 전달한다.
   * (이 함수는 UA를 다시 스니핑하지 않는다 — 판단 책임을 한 곳으로 모은다.)
   */
  useIosFallback: boolean
}

/**
 * Blob을 PNG로 저장한다.
 *
 * - iOS (useIosFallback=true): `window.open(url, "_blank")` — 새 탭에서 이미지를 열어
 *   사용자가 길게 눌러 저장. Object URL은 60초 후 revoke.
 *
 * - 그 외 (Android Chrome, Desktop Chrome/Safari/Firefox): `<a download>` 클릭으로 직접 다운로드.
 *   Object URL은 1초 후 revoke.
 *
 * iOS 팝업 차단 주의:
 *   window.open은 사용자 제스처(click) 핸들러 내에서 호출해야 팝업 차단을 피할 수 있다.
 *   호출자(handleExport)는 async이고 renderCollageToBlob await 이후 호출되므로,
 *   브라우저 정책에 따라 차단될 수 있다. 차단 시 호출자가 exportError로 안내한다.
 *
 * @returns DownloadCollageResult — 실행된 모드 반환 (UI가 iOS 안내 메시지 표시에 사용)
 */
export async function downloadCollage(opts: DownloadCollageOptions): Promise<DownloadCollageResult> {
  if (typeof window === "undefined") {
    // SSR 환경에서는 호출되지 않아야 하지만, 방어적으로 처리
    throw new Error("downloadCollage는 클라이언트 환경에서만 호출할 수 있습니다")
  }

  const { blob, filename, useIosFallback } = opts
  const url = URL.createObjectURL(blob)

  if (useIosFallback) {
    // iOS: 새 탭에서 이미지를 열어 사용자가 "사진에 저장"
    window.open(url, "_blank")
    // iOS의 새 탭이 이미지 URL을 읽을 시간을 충분히 주기 위해 60초 후 revoke
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return { mode: "ios-fallback" }
  }

  // Android Chrome / Desktop: <a download> 방식 (target 미지정 → 새 탭이 아닌 다운로드)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  // 다운로드 트리거 후 충분한 시간 대기 후 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1_000)

  return { mode: "download" }
}
