# Phase 1 Day 5 — IndexedDB로 crop 이미지 영속화 학습 노트

> 커밋: `0cae9b1` feat: persist cropped letter images via IndexedDB (Phase 1 Day 5)

---

## 1. 오늘 구현한 기능 요약

지금까지(Day 3·4)는 crop한 이미지를 **Object URL**로만 들고 있었다. Day 3 노트에서 배웠듯, Object URL은 **새로고침하면 사라진다.** 그래서 사진을 6개 다 모아도 새로고침 한 번이면 전부 날아갔다.

Day 5는 이 문제를 해결한다. **잘라낸 이미지를 IndexedDB에 저장**하고, 페이지가 다시 뜰 때 그 이미지로 **썸네일을 복원**한다.

핵심 설계는 **"두 곳에 나눠 저장"**이다:

| 저장소 | 무엇을 저장 | 이유 |
|--------|-----------|------|
| **IndexedDB** | 잘라낸 이미지 **Blob**(바이너리) | 큰 바이너리를 담을 수 있는 유일한 브라우저 저장소 |
| **localStorage** | 슬롯 **메타데이터**(imageKey, fileName, fileType, updatedAt) | 작고 가벼운 텍스트만. Blob은 못 담음 |
| **메모리(런타임)** | **Object URL**(`blob:...`) | 화면 표시용. 절대 영속화하지 않음 |

추가 작업:
- `indexed-image-store.ts` 신규 — IndexedDB 저장/조회/삭제 래퍼 (SSR-safe)
- 새로고침 시 IDB Blob → Object URL 재생성 → 슬롯 복원
- "다시 시작" 버튼 — 슬롯 + IDB Blob + Object URL 전부 정리
- IDB 저장 실패 시 에러 메시지 표시 (슬롯을 filled로 만들지 않음)
- crop-image.ts에 **EXIF 제거 동작**을 문서화
- 새로고침 복원이 깨지던 버그 수정 (`imageDataUrl: undefined` → `null` 정규화)

---

## 2. 핵심 개념 설명

### 2-1. 왜 localStorage가 아니라 IndexedDB인가

Day 3 노트에서 **"base64 이미지를 localStorage에 저장하면 위험"**하다고 배웠다. localStorage는:
- **문자열만** 저장 가능 (Blob, File 같은 바이너리 객체를 못 담음)
- 용량 제한 **5~10MB** (사진 몇 장이면 초과)
- **동기(synchronous)** API — 큰 데이터 읽고 쓰면 메인 스레드가 멈춤

IndexedDB는 이 한계를 전부 푼다:

| | localStorage | IndexedDB |
|---|---|---|
| 저장 형식 | 문자열만 | **Blob, File, 객체 등 거의 모든 것** |
| 용량 | 5~10MB | 수백 MB~GB (디스크 여유에 따라) |
| API | 동기 | **비동기**(콜백/이벤트) |
| 구조 | key-value 한 겹 | DB > object store > key-value |

**핵심**: IndexedDB는 **Blob을 그대로 저장**할 수 있다. base64로 변환(33% 팽창)할 필요 없이, crop 결과 Blob을 바이너리째 넣는다.

**비유**: localStorage는 지갑 속 메모지(작은 텍스트), IndexedDB는 캐비닛(큰 파일 보관함). 사진은 메모지에 못 적으니 캐비닛에 넣는다.

**쓰이는 곳**: `indexed-image-store.ts` 전체

---

### 2-2. IndexedDB 구조 — DB / object store / key

IndexedDB는 세 단계 계층이다.

```
indexedDB
  └── DB "typolog" (version 1)        ← openDb()
        └── object store "images"     ← createObjectStore (폴더 같은 것)
              ├── "1:0" → Blob         ← key → value
              ├── "1:1" → Blob
              └── "1:2" → Blob
```

```typescript
// indexed-image-store.ts:11-13
const DB_NAME = "typolog"
const STORE_NAME = "images"
const DB_VERSION = 1
```

- **DB**: 앱당 하나의 데이터베이스 (`"typolog"`)
- **object store**: 테이블/폴더에 해당 (`"images"`). 같은 종류의 데이터를 모아둠
- **key → value**: `"1:0"` 같은 키에 Blob을 저장

**버전(version)과 onupgradeneeded**: IndexedDB는 스키마를 버전으로 관리한다. 버전이 올라가거나 처음 열 때 `onupgradeneeded`가 실행되어 object store를 만든다.

```typescript
// indexed-image-store.ts:24-29
request.onupgradeneeded = (event) => {
  const db = (event.target as IDBOpenDBRequest).result
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    db.createObjectStore(STORE_NAME)   // "images" store 생성
  }
}
```

나중에 인덱스 추가나 구조 변경이 필요하면 `DB_VERSION`을 올리고 `onupgradeneeded`에서 마이그레이션한다. (Phase 2 DB 마이그레이션 개념의 브라우저 버전)

**쓰이는 곳**: `indexed-image-store.ts:18-46` (openDb)

---

### 2-3. 결정적 키(deterministic key) — `${challengeId}:${index}`

이미지를 저장할 때 키를 **무작위(랜덤 UUID)**가 아니라 **계산 가능한 규칙**으로 만든다.

```typescript
// CaptureClient.tsx:147
const imageKey = `${challenge.id}:${activeSlotIndex}`
// 예: "1:0", "1:1", "1:2" ...
```

**왜 결정적 키인가?**

1. **교체 = 덮어쓰기 (orphan 없음)**: 같은 슬롯에 새 이미지를 넣으면 키가 같으므로 IDB의 `put`이 **자동으로 덮어쓴다**. 이전 Blob이 따로 남지 않는다. 만약 랜덤 키였다면, 교체할 때마다 옛 Blob을 일일이 찾아 지워야 하고, 놓치면 **고아(orphan) Blob**이 쌓인다.

2. **메타데이터 ↔ Blob 연결이 단순**: localStorage에는 `imageKey`만 저장하면 된다. 복원 시 그 키로 IDB에서 Blob을 바로 꺼낸다. 별도 매핑 테이블이 필요 없다.

```
저장:  슬롯 0 crop → key "1:0" → IDB.put(Blob)  + localStorage에 imageKey="1:0" 저장
복원:  localStorage에서 imageKey="1:0" 읽음 → IDB.get("1:0") → Blob → Object URL
교체:  슬롯 0 재crop → key "1:0" (동일) → IDB.put(새 Blob)  ← 자동 덮어쓰기
```

**비유**: 사물함 번호를 "이름 첫 글자 + 좌석번호"처럼 규칙으로 정하면, 같은 사람은 항상 같은 사물함을 쓴다. 새 짐을 넣으면 옛 짐 자리에 들어가니 빈 사물함이 안 생긴다.

**쓰이는 곳**: `CaptureClient.tsx:147` (키 생성), `indexed-image-store.ts:1-6` (키 스킴 주석)

---

### 2-4. 비동기 IndexedDB를 Promise로 감싸기

IndexedDB API는 **이벤트 기반**(`onsuccess`, `onerror`)이라 `await`로 못 쓴다. Day 4의 `loadImage` 패턴과 똑같이, Promise로 감싼다.

```typescript
// indexed-image-store.ts:56-82 (saveImageBlob)
export async function saveImageBlob(key: string, blob: Blob): Promise<void> {
  if (!isSupported()) {
    throw new Error("IndexedDB를 지원하지 않는 환경입니다. ...")
  }
  const db = await openDb()

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")  // 트랜잭션 시작
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(blob, key)                 // 저장 요청

    request.onsuccess = () => resolve()                  // 성공 → resolve
    request.onerror = () => reject(new Error(...))        // 실패 → reject
    tx.onerror = () => reject(new Error(...))             // 트랜잭션 실패
  })
}
```

**트랜잭션(transaction)**: IndexedDB의 모든 읽기/쓰기는 트랜잭션 안에서 일어난다.
- `"readwrite"`: 쓰기 가능 (save, delete)
- `"readonly"`: 읽기만 (get)

트랜잭션은 "이 작업들을 한 묶음으로 안전하게 처리"하는 단위다. 중간에 실패하면 묶음 전체가 롤백된다. `deleteImageBlobs`는 여러 키 삭제를 **한 트랜잭션**으로 처리해서 효율적이다 (`indexed-image-store.ts:151-173`).

**`dbPromise` 캐싱**: DB 열기는 비싸므로 한 번 연 Promise를 캐시해서 재사용한다.

```typescript
// indexed-image-store.ts:16-19
let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise   // 이미 열었으면 재사용
  // ... 처음만 실제로 open
}
```

**쓰이는 곳**: `indexed-image-store.ts:56-82`(save), `88-114`(get), `120-145`(delete), `151-173`(deleteMany)

---

### 2-5. SSR-safe — 서버에는 IndexedDB가 없다

Next.js는 컴포넌트를 **서버에서도 렌더링**한다(SSR). 그런데 IndexedDB는 **브라우저 전용** API다. 서버(Node.js)에는 `window`도 `indexedDB`도 없다. 서버에서 IndexedDB를 건드리면 즉시 크래시한다.

그래서 모든 함수가 **환경을 먼저 검사**한다:

```typescript
// indexed-image-store.ts:48-50
function isSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window
}

// saveImageBlob: 미지원이면 throw (저장은 실패를 알려야 함)
if (!isSupported()) throw new Error("IndexedDB를 지원하지 않는 환경입니다. ...")

// getImageBlob: 미지원이면 null (조회는 조용히 빈 결과)
if (!isSupported()) return null
```

**save는 throw, get은 null인 이유**: 저장 실패는 사용자에게 **알려야** 한다(이미지가 안 남으니까). 조회 실패는 **조용히** 넘어가도 된다(없으면 글자 fallback 표시).

**복원 로직도 클라이언트 전용**: 복원은 `useEffect` 안에서만 실행된다. `useEffect`는 브라우저에서만 도므로 서버 렌더링과 무관하다.

```typescript
// CaptureClient.tsx:53 — useEffect 안 = 클라이언트에서만 실행
useEffect(() => {
  const restore = async () => { ... getImageBlob(slot.imageKey) ... }
  restore()
}, [challenge.id, setSlotImageUrl])
```

**쓰이는 곳**: `indexed-image-store.ts:48-50`, 각 함수 진입부의 가드

---

### 2-6. partialize 진화 — Day 3(challengeId만) → Day 5(메타데이터까지)

Day 3에서는 persist가 **`challengeId`만** 저장했다 (이미지는 Object URL이라 못 살림). Day 5에서는 IDB가 이미지를 책임지므로, localStorage에는 **이미지를 가리키는 메타데이터**를 저장한다.

```typescript
// challenge-store.ts:153-164
partialize: (state) => ({
  challengeId: state.challengeId,
  slots: state.slots.map(({ index, character, status, imageKey, fileName, fileType, updatedAt }) => ({
    index, character, status, imageKey, fileName, fileType, updatedAt,
    // ← imageDataUrl은 의도적으로 제외!
  })),
}),
```

**무엇을 저장하고 무엇을 뺄까**:

| 필드 | 저장? | 이유 |
|------|-------|------|
| `imageKey` | ✅ | IDB에서 Blob을 찾는 열쇠 |
| `fileName`, `fileType`, `updatedAt` | ✅ | 메타데이터 (작은 텍스트/숫자) |
| `status`, `character`, `index` | ✅ | 슬롯 상태 복원용 |
| **`imageDataUrl`** | ❌ | **런타임 전용 Object URL** — 새 세션에선 무효한 값 |

**핵심 원칙(Day 3·4에서 이어짐)**: Object URL(`blob:...`)은 **절대 영속화하지 않는다.** 그 URL은 현재 페이지 세션에서만 유효하고, 새로고침하면 깨진 문자열이 된다. 저장하면 안 되고, **복원 시 IDB Blob으로부터 새로 만든다.**

> **테스트로 검증됨**: localStorage에 `blob:`, `base64`, `imageDataUrl`이 들어가지 않는 것을 확인한다. (challenge-store.test.ts, QA 체크포인트 1·2)

**쓰이는 곳**: `challenge-store.ts:146-165`, `types/index.ts:8-26` (LetterSlot 필드 주석)

---

### 2-7. 새로고침 복원 흐름 — 메타데이터 rehydrate → IDB Blob → Object URL

새로고침하면 다음 순서로 썸네일이 되살아난다.

```
1. 페이지 로드
   └─ zustand persist가 localStorage를 동기 rehydrate
      → slots에 메타데이터(imageKey 등)가 채워짐. 단 imageDataUrl은 없음(undefined)
         (status="filled"이지만 보여줄 이미지 URL이 아직 없는 상태)

2. initSlots (useEffect)
   └─ 같은 challengeId면 rehydrate된 슬롯 유지 + imageDataUrl을 null로 정규화
      + isComplete 재계산 (isComplete는 persist 안 하므로)

3. restore (useEffect)
   └─ filled이고 imageKey 있고 imageDataUrl 없는 슬롯마다:
      ├─ getImageBlob(imageKey)  → IDB에서 Blob 꺼냄
      ├─ URL.createObjectURL(blob) → 새 Object URL 생성
      ├─ objectUrlsRef.set(index, url)  → 정리용으로 추적
      └─ setSlotImageUrl(index, url)    → 슬롯에 URL 부착 → 썸네일 표시
```

```typescript
// CaptureClient.tsx:56-76 (restore)
const restore = async () => {
  const currentSlots = useChallengeStore.getState().slots
  for (const slot of currentSlots) {
    if (slot.status === "filled" && slot.imageKey && !slot.imageDataUrl) {
      try {
        const blob = await getImageBlob(slot.imageKey)
        if (!isMounted) return
        if (blob) {
          const url = URL.createObjectURL(blob)
          objectUrlsRef.current.set(slot.index, url)
          setSlotImageUrl(slot.index, url)
        }
        // blob이 null이면 글자 fallback 표시 — 허용
      } catch {
        // 비치명적: 글자 fallback 유지
      }
    }
  }
}
```

**`isMounted` 가드**: 비동기 `getImageBlob` 도중 컴포넌트가 언마운트될 수 있다. 그 후 `setSlotImageUrl`을 호출하면 "언마운트된 컴포넌트 상태 업데이트" 경고가 난다. `isMounted` 플래그로 막는다 (`CaptureClient.tsx:54,64,80-82`).

**복원 실패 = 글자 fallback**: IDB에서 Blob을 못 찾거나(null) 에러가 나도 앱은 안 깨진다. 그 슬롯은 이미지 대신 글자를 보여준다. (Day 4.5에서 만든 슬롯 UI가 imageDataUrl 없으면 글자를 표시하게 되어 있음)

**쓰이는 곳**: `CaptureClient.tsx:53-83`

---

### 2-8. `imageDataUrl: undefined` → `null` 정규화 버그 수정

이번 커밋이 **고친 버그**다. 학습 가치가 크다.

**증상**: 새로고침하면 슬롯이 filled인데도 썸네일이 안 뜨고 글자만 나왔다.

**원인 추적**:
1. `partialize`는 `imageDataUrl`을 저장 목록에서 **뺀다** (의도적).
2. 그래서 rehydrate된 슬롯 객체에는 `imageDataUrl` 키 자체가 없다 → 접근하면 **`undefined`**.
3. 그런데 타입은 `string | null`이고, 복원 가드는 원래 `=== null`로 검사했다.
4. `undefined === null`은 **false** → 가드를 통과 못 함 → 복원 로직이 안 돎 → 썸네일 안 뜸.

**수정**: `initSlots`에서 rehydrate된 슬롯의 `imageDataUrl`을 `null`로 정규화한다.

```typescript
// challenge-store.ts:70-77
if (get().challengeId === challenge.id && get().slots.length > 0) {
  const slots = get().slots.map((s) => ({
    ...s,
    imageDataUrl: s.imageDataUrl ?? null,   // undefined → null 정규화
  }))
  const isComplete = slots.every((s) => s.status === "filled")
  set({ slots, isComplete })
  return
}
```

그리고 restore 가드도 `=== null` 대신 **truthy 검사**(`!slot.imageDataUrl`)로 바꿔 `undefined`/`null` 둘 다 잡게 했다 (`CaptureClient.tsx:61`).

**교훈**: `undefined`와 `null`은 다르다. 직렬화/역직렬화(persist)를 거치면 **없는 필드는 `undefined`로 되살아난다.** `=== null` 같은 엄격 비교는 `undefined`를 놓친다. 직렬화 경계를 넘는 값은 **정규화**하거나 truthy 검사를 써야 안전하다.

**쓰이는 곳**: `challenge-store.ts:70-77`, `CaptureClient.tsx:61`

---

### 2-9. Canvas re-encode = EXIF 자동 제거

Day 4에서 만든 `createCroppedImageBlob`이 사실 **EXIF를 제거**하고 있었다는 걸 Day 5에서 문서로 명시했다.

```typescript
// crop-image.ts:17-25 (문서 주석)
/**
 * EXIF stripping: 원본 이미지를 새 <canvas>에 그리고 canvas.toBlob("image/png")로
 * 재인코딩한다. 이 파이프라인은 원본 파일의 EXIF 메타데이터(orientation, GPS 좌표,
 * 카메라 모델 등)를 전혀 가져오지 않는 새 비트맵을 만든다. 따라서 반환 Blob은
 * EXIF가 제거된 crop 이미지다 — 별도 EXIF 파서가 필요 없다.
 */
```

**왜 자동으로 제거되나**: EXIF는 **파일 형식**에 붙은 메타데이터다. Canvas에 `drawImage`하면 **순수 픽셀**만 캔버스로 옮겨진다. `toBlob`은 그 픽셀로 **완전히 새 이미지 파일**을 만든다. 원본 파일의 EXIF는 캔버스에 따라오지 않으므로 결과물엔 없다.

```
원본 사진 (EXIF: GPS 37.5/127.0, orientation 6, iPhone 15)
  → drawImage → Canvas (픽셀만, EXIF 없음)
  → toBlob → 새 PNG (EXIF 전혀 없음)
```

**프라이버시 의미**: 사용자가 찍은 사진의 **GPS 위치 정보가 자동으로 제거**된다. 별도 strip 라이브러리 없이 crop 과정에서 공짜로 해결된다. (Phase 2에서 서버 업로드 시 위치 노출 위험이 사라짐)

**주의 — orientation은 브라우저 의존**: 회전 EXIF(orientation)는 modern 브라우저가 `drawImage` 시 자동으로 올바른 방향으로 그려준다(`image-orientation: from-image` 기본값). react-image-crop의 표시도 같은 auto-orient를 받으므로 좌표가 일치한다. 단, **회전된 실제 사진으로 수동 테스트**가 권장된다 (QA M-03).

**쓰이는 곳**: `crop-image.ts:17-58`

---

### 2-10. resetDraft — 세 저장소를 순서대로 정리

"다시 시작"은 단순히 슬롯만 비우는 게 아니다. **세 곳을 모두** 정리해야 한다.

```typescript
// CaptureClient.tsx:201-220 (handleResetDraft)
const handleResetDraft = useCallback(async () => {
  const currentSlots = useChallengeStore.getState().slots
  // 1. 지울 IDB 키 수집 (store reset 전에 먼저!)
  const keysToDelete = currentSlots
    .filter((s) => s.imageKey !== null)
    .map((s) => s.imageKey as string)

  // 2. 메모리: 모든 Object URL revoke
  objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  objectUrlsRef.current.clear()

  // 3. IDB: Blob 일괄 삭제
  try {
    await deleteImageBlobs(keysToDelete)
  } catch {
    // 비치명적: 고아 IDB 항목은 UX에 영향 없음
  }

  // 4. store: 슬롯 초기화
  resetDraft()
  setSaveError(null)
}, [resetDraft])
```

**순서가 중요한 이유**: store를 먼저 reset하면 `imageKey`가 사라져서 **어떤 IDB Blob을 지울지 알 수 없게** 된다. 그래서 **키를 먼저 수집** → URL revoke → IDB 삭제 → store reset 순서다.

**store 함수 주석이 이를 강제**: `resetDraft`는 "순수 store 전용. 호출자가 IDB 삭제와 Object URL revoke를 **먼저** 처리해야 한다(상태에서 키를 먼저 읽어라)"고 명시한다 (`challenge-store.ts:34-39`). 이는 Day 4에서 본 **관심사 분리** — store는 상태만, 컴포넌트는 브라우저 리소스(IDB·Object URL) 생명주기를 책임진다.

**쓰이는 곳**: `CaptureClient.tsx:201-220`, `challenge-store.ts:130-136`

---

### 2-11. IDB 저장 실패 처리 — 슬롯을 filled로 만들지 않는다

시크릿 모드, 용량 초과, IDB 차단 환경에서는 저장이 실패할 수 있다. 이때 **이미지가 안 남았는데 슬롯만 채워진 척하면 안 된다.**

```typescript
// CaptureClient.tsx:156-178 (handleCropConfirm 일부)
try {
  await saveImageBlob(imageKey, croppedBlob)
} catch (err) {
  // IDB 사용 불가 — 에러 표시, 슬롯을 filled로 만들지 않음
  setSaveError(err instanceof Error ? err.message : "이미지를 저장할 수 없습니다.")
  if (cropSourceUrlRef.current) {
    URL.revokeObjectURL(cropSourceUrlRef.current)
    cropSourceUrlRef.current = null
  }
  setCropSourceUrl(null)
  setCropperOpen(false)
  return   // ← fillSlot 호출 전에 빠져나감
}

// 저장 성공해야만 여기 도달 → fillSlot 호출
setSaveError(null)
const croppedUrl = URL.createObjectURL(croppedBlob)
objectUrlsRef.current.set(activeSlotIndex, croppedUrl)
fillSlot(activeSlotIndex, { imageKey, fileName, fileType }, croppedUrl)
```

**핵심**: `saveImageBlob`이 성공해야만 `fillSlot`을 호출한다. 저장 실패하면 `return`으로 빠져나가 슬롯은 empty로 유지된다. **"저장된 것처럼 보이지만 새로고침하면 사라지는"** 거짓 상태를 막는다.

에러는 `role="alert"`로 화면에 표시된다 (`CaptureClient.tsx:288-292`).

**쓰이는 곳**: `CaptureClient.tsx:156-178, 288-292`

---

### 2-12. Day 4 → Day 5 데이터 흐름 (전체)

Day 4의 흐름에 **IDB 저장**과 **복원**이 추가됐다.

```
[저장 흐름 — crop 확인 시]
File → Object URL(원본) → ReactCrop → pixelCrop → Canvas → croppedBlob
                                                              │
                          ┌───────────────────────────────────┤
                          ▼                                   ▼
              IDB.put("1:0", croppedBlob)        URL.createObjectURL(croppedBlob)
              (영속 — 새로고침 후에도 남음)         → 슬롯 imageDataUrl (런타임 표시)
                          │                                   │
                          ▼                                   ▼
              localStorage에 메타데이터          fillSlot(meta, url)
              { imageKey:"1:0", fileName, ... }   → 썸네일 표시

[복원 흐름 — 새로고침 시]
localStorage rehydrate → slots에 메타데이터(imageKey="1:0", imageDataUrl 없음)
                          │
                          ▼ (restore useEffect)
              IDB.get("1:0") → croppedBlob
                          │
                          ▼
              URL.createObjectURL(blob) → 새 Object URL
                          │
                          ▼
              setSlotImageUrl(0, url) → 썸네일 복원
```

**무엇이 어디 사는가 한눈에**:

| 데이터 | 저장소 | 수명 |
|--------|--------|------|
| 잘라낸 이미지 Blob | IndexedDB | 영속 (명시적 삭제 전까지) |
| 슬롯 메타데이터 | localStorage | 영속 |
| Object URL | 메모리(objectUrlsRef) | 세션 한정 (새로고침 시 재생성) |
| 원본 crop source URL | 메모리 | crop 완료/취소 즉시 폐기 |

**핵심**: Store(`fillSlot`)는 이제 메타데이터 + URL을 받는다. 영속화는 persist(메타) + IDB(Blob)가 나눠 책임지고, 표시는 Object URL이 담당한다. **데이터(영속)와 표시(런타임)의 분리** — Day 4.5에서 배운 원칙이 저장 계층까지 확장됐다.

---

## 3. 이 프로젝트에서 개념이 쓰인 파일

| 개념 | 파일:줄 |
|------|---------|
| IndexedDB open + object store 생성 | `indexed-image-store.ts:18-46` |
| save/get/delete Promise 래퍼 | `indexed-image-store.ts:56-82, 88-114, 120-145, 151-173` |
| SSR-safe 가드 (`isSupported`) | `indexed-image-store.ts:48-50` |
| 결정적 키 `${challengeId}:${index}` | `CaptureClient.tsx:147`, `indexed-image-store.ts:1-6` |
| partialize (메타데이터만 영속) | `challenge-store.ts:146-165` |
| LetterSlot 메타 필드 | `types/index.ts:8-26` |
| 새로고침 복원 useEffect | `CaptureClient.tsx:53-83` |
| `undefined → null` 정규화 (버그 수정) | `challenge-store.ts:70-77`, `CaptureClient.tsx:61` |
| EXIF 제거 문서화 | `crop-image.ts:17-58` |
| resetDraft 3저장소 정리 | `CaptureClient.tsx:201-220`, `challenge-store.ts:130-136` |
| IDB 저장 실패 처리 | `CaptureClient.tsx:156-178, 288-292` |
| Object URL 정리 (unmount/교체) | `CaptureClient.tsx:86-97, 153-154` |

---

## 4. 자주 하는 실수

### 실수 1: Object URL을 영속화한다

```typescript
// 나쁜 예 — partialize에 imageDataUrl 포함
partialize: (state) => ({ slots: state.slots })  // imageDataUrl까지 저장됨
// → 새로고침 후 "blob:..." 가 깨진 URL이 되어 이미지가 안 뜸

// 좋은 예 — imageDataUrl 제외, IDB Blob으로 복원
partialize: (state) => ({
  slots: state.slots.map(({ index, character, status, imageKey, ... }) => ({ ... })),
})
```

### 실수 2: `undefined`와 `null`을 같다고 본다

```typescript
// 나쁜 예 — rehydrate 후 imageDataUrl은 undefined인데 === null로 검사
if (slot.imageDataUrl === null) { restore() }  // undefined는 통과 못 함 → 복원 안 됨

// 좋은 예 — 정규화 또는 truthy 검사
imageDataUrl: s.imageDataUrl ?? null            // 정규화
if (!slot.imageDataUrl) { restore() }           // truthy 검사
```

직렬화 경계(persist, JSON)를 넘으면 없는 필드는 `undefined`로 살아난다.

### 실수 3: 서버에서 IndexedDB에 접근한다

```typescript
// 나쁜 예 — 모듈 최상단/렌더 중 IDB 접근 → SSR 크래시
const db = indexedDB.open("typolog")  // 서버에 indexedDB 없음

// 좋은 예 — isSupported 가드 + useEffect(클라이언트 전용)
if (typeof window === "undefined" || !("indexedDB" in window)) return null
useEffect(() => { restore() }, [])
```

### 실수 4: store reset을 IDB 삭제보다 먼저 한다

```typescript
// 나쁜 예 — reset 후엔 imageKey가 사라져 무엇을 지울지 모름
resetDraft()
deleteImageBlobs(keys)  // keys를 이미 못 읽음

// 좋은 예 — 키 먼저 수집 → IDB 삭제 → reset
const keys = slots.filter(s => s.imageKey).map(s => s.imageKey)
await deleteImageBlobs(keys)
resetDraft()
```

### 실수 5: 저장 실패해도 슬롯을 filled로 만든다

```typescript
// 나쁜 예 — 저장 결과와 무관하게 fillSlot
await saveImageBlob(key, blob).catch(() => {})
fillSlot(...)  // 저장 실패했는데 채워진 척 → 새로고침하면 사라짐

// 좋은 예 — 저장 성공해야만 fillSlot
try { await saveImageBlob(key, blob) }
catch { setSaveError(...); return }
fillSlot(...)
```

### 실수 6: 비동기 복원 중 언마운트를 무시한다

```typescript
// 나쁜 예 — await 후 무조건 setState → 언마운트 경고
const blob = await getImageBlob(key)
setSlotImageUrl(index, url)

// 좋은 예 — isMounted 가드
let isMounted = true
const blob = await getImageBlob(key)
if (!isMounted) return
setSlotImageUrl(index, url)
return () => { isMounted = false }
```

### 실수 7: 교체 시 옛 Object URL을 revoke 안 한다 (Day 3·4에서 이어짐)

결정적 키 덕분에 IDB Blob은 덮어쓰기로 정리되지만, **메모리의 Object URL은 별개**다. 교체 시 옛 URL을 직접 revoke해야 한다 (`CaptureClient.tsx:153-154`).

---

## 5. 모바일 수동 테스트 체크리스트

### crop 저장 + 복원 (Day 5 핵심)
- [ ] 슬롯 터치 → 갤러리 → 이미지 → crop → "이 글자로 저장" → 슬롯에 이미지 표시
- [ ] 6개 모두 채우기 → "콜라주 만들기" 활성화
- [ ] **새로고침** → 채운 슬롯이 이미지와 함께 복원됨 (글자 fallback 아님)
- [ ] 새로고침 후 진행률 바 / 카운트가 복원 상태 반영
- [ ] 일부만 채운 상태(예: 3/6)에서 새로고침 → 채운 3개만 복원, 나머지는 빈 슬롯

### 교체
- [ ] 채운 슬롯 재터치 → 새 이미지 crop → 저장 → 이전 이미지 교체
- [ ] 교체 후 **새로고침** → 새 이미지로 복원 (이전 것 아님 — 결정적 키 덮어쓰기 검증)

### 다시 시작
- [ ] "다시 시작" 클릭 → 모든 슬롯 비워짐
- [ ] 다시 시작 후 **새로고침** → 빈 상태 유지 (IDB/localStorage 정리 검증)
- [ ] 슬롯이 0개 채워졌을 때 "다시 시작" 버튼이 안 보이는가 (filledCount > 0 조건)

### EXIF / 회전 (수동 검증 권장 — QA M-03)
- [ ] 세로로 찍은 실제 사진(회전 EXIF 포함) crop → 결과가 올바른 방향으로 저장
- [ ] crop 좌표가 표시와 일치 (회전 사진에서 어긋나지 않는지)
- [ ] (가능하면) 저장된 이미지에 GPS 정보가 없는지 확인

### 에러 / 엣지
- [ ] **시크릿 모드 / IDB 차단** 환경에서 저장 시 에러 메시지 표시, 앱 안 깨짐
- [ ] 저장 실패한 슬롯이 empty로 유지되는가 (filled 거짓 표시 없음)
- [ ] 새로고침 직후 빠르게 슬롯 탭 → crop (restore와 충돌 없는지 — QA M-01)

### iOS Safari (QA H-01 확인 필요)
- [ ] 새로고침 후 복원 시 **hydration 깜빡임/콘솔 경고** 없는지 (Safari 콘솔 직접 확인)
- [ ] crop 모달 전체화면 + safe-area

### Android Chrome
- [ ] 대형 카메라 이미지(12MP+) crop 저장 → IDB 저장 속도 체감
- [ ] 새로고침 복원 속도 (6장 모두 채운 상태)

---

## 6. Day 6(콜라주 Preview) 전에 이해하면 좋은 개념

Day 6은 모은 글자 6개를 **하나의 콜라주 이미지로 합성**하고 다운로드하는 단계다.

| 개념 | 왜 필요한가 | 핵심 |
|------|------------|------|
| **여러 이미지 Canvas 합성** | 콜라주 = 글자 N개를 한 캔버스 격자에 배치 | `drawImage`를 N번 호출, 각 글자의 destination 좌표 계산 |
| **IDB에서 Blob 다시 읽기** | preview 페이지도 저장된 이미지가 필요 | `getImageBlob(slot.imageKey)` → Blob → ImageBitmap/Object URL |
| **이미지 실제 크기 획득** | 비율 제각각인 crop을 격자에 배치 | Blob 디코드로 width/height (현재 metadata엔 없음 — QA Day 6 준비) |
| **`createImageBitmap`** | Blob을 Canvas에 그릴 형태로 디코드 | `await createImageBitmap(blob)` → drawImage 가능 |
| **canvas.toBlob 다운로드** | 완성 콜라주를 PNG로 저장 | `toBlob` → Object URL → `<a download>` |
| **확인 다이얼로그** | "다시 시작" 실수 방지 (QA M-02) | 파괴적 작업 전 confirm |
| **hydration 안정화** | SSR/CSR 불일치 경고 해결 (QA H-01) | `skipHydration` + mounted 가드 검토 |

**Day 6으로 가는 연결고리**: Day 5에서 이미지가 **IDB에 영속 저장**되고 `imageKey`로 언제든 꺼낼 수 있게 됐다. preview 페이지는 저장된 6개 Blob을 `getImageBlob`으로 읽어, Day 4에서 배운 `drawImage`를 6번 호출해 한 캔버스에 격자로 배치하면 콜라주가 된다. 그리고 그 콜라주도 `toBlob`으로 추출해 다운로드한다. **crop이 "1 이미지 → 1 영역 → 1 캔버스"였다면, 콜라주는 "N 이미지 → N 영역 → 1 캔버스"다.**

> 관련 개념의 상세 설명은 `docs/learning/learning-first-roadmap.md`의 Phase 1(#11 Canvas)과 Phase 5(성능)를 참고. 직전 노트는 `docs/learning/phase-1-day-4-5-thumbnail-fit.md`.
