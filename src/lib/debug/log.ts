/**
 * 개발용 구조화 로깅 — E2E 증거 수집.
 *
 * production에서는 완전 no-op(콘솔/메모리 부작용 없음).
 * 개발/프리뷰(NODE_ENV !== "production")에서만 동작하며:
 *   - 구조화 엔트리 { ts, scope, message, data } 를 메모리 버퍼에 쌓고
 *   - 콘솔에 `[typolog:scope] message (+data)` 형태로 출력하며
 *   - 브라우저에 window.__typolog(로그 배열)·window.typologDump()(JSON+클립보드)를 노출한다.
 *
 * sink 추상화: addLogSink로 출력처를 추가할 수 있어, 향후 OpenSearch/PostHog/Sentry 등으로
 * 호출부 변경 없이 확장·교체할 수 있다.
 */

/** 구조화 로그 엔트리. data는 직렬화 가능한 임의 값(unknown — any 금지). */
export interface LogEntry {
  /** Unix epoch ms */
  ts: number
  /** 로그 범위 태그 (예: "capture", "preview", "export") */
  scope: string
  /** 사람이 읽는 메시지 */
  message: string
  /** 부가 데이터 (선택) */
  data?: unknown
}

/** 로그 엔트리를 받아 처리하는 출력처. */
export type LogSink = (entry: LogEntry) => void

declare global {
  interface Window {
    /** 개발 중 수집된 로그 엔트리 버퍼 (production에서는 미설정) */
    __typolog?: LogEntry[]
    /** 콘솔에서 호출: 버퍼를 JSON으로 출력 + 클립보드 복사 */
    typologDump?: () => void
  }
}

/** production 빌드에서는 false → 모든 로깅이 no-op이 되고 데드코드로 제거 가능 */
const isEnabled = process.env.NODE_ENV !== "production"

/** 메모리 버퍼(기본 sink). window.__typolog로도 접근 가능. */
const buffer: LogEntry[] = []

/** addLogSink로 등록된 추가 출력처들 */
const sinks: LogSink[] = []

/** 기본 콘솔 sink: `[typolog:scope] message (+data)` */
function consoleSink(entry: LogEntry): void {
  if (entry.data !== undefined) {
    console.log(`[typolog:${entry.scope}] ${entry.message}`, entry.data)
  } else {
    console.log(`[typolog:${entry.scope}] ${entry.message}`)
  }
}

/**
 * 추가 출력처(sink)를 등록한다. 향후 OpenSearch/PostHog/Sentry 연동 지점.
 * @returns 등록 해제 함수
 */
export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink)
  return () => {
    const i = sinks.indexOf(sink)
    if (i >= 0) sinks.splice(i, 1)
  }
}

/**
 * 구조화 개발 로그를 남긴다. production에서는 no-op.
 *
 * @param scope   - 범위 태그 (capture / preview / export …)
 * @param message - 사람이 읽는 메시지
 * @param data    - 부가 데이터(선택, 직렬화 가능 값)
 */
export function debugLog(scope: string, message: string, data?: unknown): void {
  if (!isEnabled) return

  const entry: LogEntry = { ts: Date.now(), scope, message, data }

  buffer.push(entry)
  consoleSink(entry)
  for (const sink of sinks) {
    try {
      sink(entry)
    } catch {
      // sink 오류가 로깅 흐름 자체를 막지 않도록 무시한다
    }
  }

  // 브라우저 전역 노출 (window 가드)
  if (typeof window !== "undefined") {
    window.__typolog = buffer
    if (!window.typologDump) {
      window.typologDump = typologDump
    }
  }
}

/**
 * 수집된 로그 버퍼를 JSON으로 콘솔에 출력하고 클립보드에 복사한다.
 * 브라우저 콘솔에서 `typologDump()`로 호출.
 */
export function typologDump(): void {
  const json = JSON.stringify(buffer, null, 2)
  console.log(json)
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(json).catch(() => {
      // 클립보드 거부(권한/포커스 없음) 시 콘솔 출력만으로 충분
    })
  }
}
