/**
 * IndexedDB wrapper for persisting cropped image Blobs.
 *
 * Key scheme: `${challengeId}:${slotIndex}` — deterministic, so replacing
 * a slot's image is an idempotent overwrite at the same key. No orphan Blobs accumulate.
 *
 * All functions are SSR-safe: they early-return / reject when
 * `typeof window === "undefined" || !("indexedDB" in window)`.
 */

const DB_NAME = "typolog"
const STORE_NAME = "images"
const DB_VERSION = 1

/** Lazily-opened DB promise, cached after first open. */
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result)
    }

    request.onerror = (event) => {
      dbPromise = null // reset so next call retries
      reject(
        new Error(
          `IndexedDB 열기 실패: ${(event.target as IDBOpenDBRequest).error?.message ?? "알 수 없는 오류"}`
        )
      )
    }
  })

  return dbPromise
}

function isSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window
}

/**
 * Save (or overwrite) a Blob at the given key.
 * Rejects on unsupported environment or IDB error.
 */
export async function saveImageBlob(key: string, blob: Blob): Promise<void> {
  if (!isSupported()) {
    throw new Error("IndexedDB를 지원하지 않는 환경입니다. 이미지를 저장할 수 없습니다.")
  }

  const db = await openDb()

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(blob, key)

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(
        new Error(
          `이미지 저장 실패 (key: ${key}): ${request.error?.message ?? "알 수 없는 오류"}`
        )
      )
    tx.onerror = () =>
      reject(
        new Error(
          `트랜잭션 오류 (key: ${key}): ${tx.error?.message ?? "알 수 없는 오류"}`
        )
      )
  })
}

/**
 * Retrieve a Blob by key.
 * Resolves `null` if the key is missing or the environment is unsupported.
 */
export async function getImageBlob(key: string): Promise<Blob | null> {
  if (!isSupported()) return null

  const db = await openDb().catch(() => null)
  if (!db) return null

  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)

    request.onsuccess = () => {
      const result = request.result
      if (result instanceof Blob) {
        resolve(result)
      } else {
        resolve(null)
      }
    }
    request.onerror = () =>
      reject(
        new Error(
          `이미지 조회 실패 (key: ${key}): ${request.error?.message ?? "알 수 없는 오류"}`
        )
      )
  })
}

/**
 * Delete a single Blob by key.
 * No-ops silently if the key does not exist.
 */
export async function deleteImageBlob(key: string): Promise<void> {
  if (!isSupported()) return

  const db = await openDb().catch(() => null)
  if (!db) return

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(key)

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(
        new Error(
          `이미지 삭제 실패 (key: ${key}): ${request.error?.message ?? "알 수 없는 오류"}`
        )
      )
    tx.onerror = () =>
      reject(
        new Error(
          `트랜잭션 오류 (key: ${key}): ${tx.error?.message ?? "알 수 없는 오류"}`
        )
      )
  })
}

/**
 * Delete multiple Blobs in a single readwrite transaction.
 * Keys that don't exist are silently skipped.
 */
export async function deleteImageBlobs(keys: string[]): Promise<void> {
  if (!isSupported() || keys.length === 0) return

  const db = await openDb().catch(() => null)
  if (!db) return

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)

    for (const key of keys) {
      store.delete(key)
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(
        new Error(
          `일괄 삭제 트랜잭션 오류: ${tx.error?.message ?? "알 수 없는 오류"}`
        )
      )
  })
}
