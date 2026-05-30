# Typolog — 상세 테스트 전략

> 작성 기준: 2026-05-25  
> 대상: QA Agent, Frontend/Backend Agent 협업 기준  
> 전제: Next.js 15 App Router, Vitest, Playwright, Supabase, Canvas API

---

## 1. Unit Test 목록

### 문장 파싱 (`src/lib/utils/sentence-parser.ts`)

```
[U-01] src/lib/utils/sentence-parser.ts > 공백이 포함된 문장 파싱
  입력: "오늘도 화이팅"
  기대: ["오","늘","도","화","이","팅"] (공백 제외 6개)

[U-02] src/lib/utils/sentence-parser.ts > 공백 없는 문장 파싱
  입력: "참좋은날"
  기대: ["참","좋","은","날"] (4개)

[U-03] src/lib/utils/sentence-parser.ts > 다중 공백 포함 문장 파싱
  입력: "오늘  뭐  먹지"
  기대: ["오","늘","뭐","먹","지"] (연속 공백 모두 제거)

[U-04] src/lib/utils/sentence-parser.ts > 느낌표·마침표 제거
  입력: "어서 오세요!"
  기대: ["어","서","오","세","요"] (특수문자 제거)

[U-05] src/lib/utils/sentence-parser.ts > 숫자 포함 시 숫자 제거
  입력: "2025 좋은날"
  기대: ["좋","은","날"] (숫자 제거)

[U-06] src/lib/utils/sentence-parser.ts > 빈 문자열 입력
  입력: ""
  기대: [] (빈 배열, 에러 없음)
```

### 글자 슬롯 상태 관리 (`src/stores/challenge-store.ts`)

```
[U-07] src/stores/challenge-store.ts > 초기 슬롯 생성
  입력: letters=["오","늘","도","화","이","팅"]
  기대: 6개 슬롯 모두 status="empty", isComplete=false

[U-08] src/stores/challenge-store.ts > 슬롯 하나 채우기
  입력: slot_index=0에 imageBlob 저장
  기대: slot[0].status="filled", 나머지 "empty", isComplete=false

[U-09] src/stores/challenge-store.ts > 마지막 슬롯 채워 완성
  입력: 5개 슬롯 "filled" 상태에서 slot[5]에 이미지 저장
  기대: isComplete=true, 모든 슬롯 "filled"

[U-10] src/stores/challenge-store.ts > 채워진 슬롯 교체
  입력: slot[0]="filled" 상태에서 새 이미지로 교체
  기대: slot[0].imageUrl이 새 URL로 변경, status 여전히 "filled"

[U-11] src/stores/challenge-store.ts > 슬롯 전체 초기화
  입력: 4개 채운 상태에서 resetSlots() 호출
  기대: 모든 슬롯 "empty", isComplete=false

[U-12] src/stores/challenge-store.ts > 존재하지 않는 slot_index 접근
  입력: slot_index=99에 이미지 저장 시도
  기대: 에러 throw 또는 조용히 무시 (정책 결정 후 확정)

[U-13] src/stores/challenge-store.ts > localStorage persist 직렬화
  입력: blob URL이 포함된 슬롯 상태
  기대: persist 후 재로드 시 동일한 상태 복원 (blob URL은 ObjectURL이므로 재생성 필요한지 확인)
```

### 이미지 crop 좌표 계산 (`src/lib/canvas/crop.ts`)

```
[U-14] src/lib/canvas/crop.ts > 정상 crop 영역 계산
  입력: 원본(1000x800), cropArea={x:100, y:200, w:300, h:300}
  기대: 반환 canvas의 width=300, height=300

[U-15] src/lib/canvas/crop.ts > 원본보다 큰 crop 영역 클램핑
  입력: 원본(500x400), cropArea={x:0, y:0, w:600, h:500}
  기대: 에러 없이 처리, 실제 원본 크기 이내로 제한

[U-16] src/lib/canvas/crop.ts > 최소 크기 이하 crop 거부
  입력: cropArea={w:10, h:10} (최소 20x20 기준)
  기대: 에러 throw 또는 validation 실패 반환

[U-17] src/lib/canvas/crop.ts > crop 결과 WebP 변환
  입력: 정상 cropArea, format="webp"
  기대: 반환 Blob의 type="image/webp"

[U-18] src/lib/canvas/crop.ts > crop 결과 크기 제한 (500KB)
  입력: 고해상도 원본 이미지
  기대: 출력 Blob.size <= 512000 (500KB)
```

### EXIF strip (`src/lib/utils/exif-strip.ts`)

```
[U-19] src/lib/utils/exif-strip.ts > GPS 좌표 포함 JPEG에서 EXIF 제거
  입력: GPS 메타데이터(위도/경도)가 포함된 JPEG Blob
  기대: 출력 이미지에 EXIF 세그먼트 없음 (Uint8Array 파싱 후 0xFFE1 마커 없음)

[U-20] src/lib/utils/exif-strip.ts > EXIF 없는 이미지 처리
  입력: EXIF가 없는 순수 JPEG Blob
  기대: 에러 없이 정상 반환, 이미지 내용 동일

[U-21] src/lib/utils/exif-strip.ts > 이미지 품질 유지
  입력: 100x100 테스트 이미지
  기대: 출력 이미지의 width=100, height=100 유지

[U-22] src/lib/utils/exif-strip.ts > Canvas re-draw 방식으로 EXIF 자동 제거
  입력: EXIF 포함 이미지를 Canvas에 drawImage 후 toBlob
  기대: 출력 Blob에 EXIF 없음 (Canvas re-draw는 EXIF를 자동 제거)
```

### 이미지 validation (`src/lib/utils/image-validate.ts`)

```
[U-23] src/lib/utils/image-validate.ts > 허용 파일 타입 통과
  입력: type="image/jpeg"
  기대: { valid: true }

[U-24] src/lib/utils/image-validate.ts > 허용되지 않는 파일 타입 거부
  입력: type="image/gif"
  기대: { valid: false, error: "허용되지 않는 파일 형식" }

[U-25] src/lib/utils/image-validate.ts > 글자 조각 500KB 초과 거부
  입력: size=600000 (600KB), context="letter"
  기대: { valid: false, error: "파일 크기 초과" }

[U-26] src/lib/utils/image-validate.ts > 콜라주 2MB 초과 거부
  입력: size=2500000 (2.5MB), context="collage"
  기대: { valid: false, error: "파일 크기 초과" }

[U-27] src/lib/utils/image-validate.ts > 정확히 경계값 처리
  입력: size=512000 (500KB), context="letter"
  기대: { valid: true } (경계값 포함 허용)
```

### 콜라주 레이아웃 계산 (`src/lib/collage/sentence-lines.ts`, `src/lib/collage/render-collage-to-blob.ts`)

> 줄나눔은 작성자 지정 `Challenge.lines`을 단일 소스로 따른다(알고리즘 추측 아님). 순수 함수 중심 테스트, Canvas 드로잉은 E2E/golden image로 커버.

```
[U-27] src/lib/collage/sentence-lines.ts > getCollageLines: 작성자 지정 lines → 줄별 슬롯 index
  입력: lines=["우리 동네","맛집"]
  기대: [[0,1,2,3],[4,5]] (단어 "동네"가 끊기지 않음)

[U-27-B] src/lib/collage/sentence-lines.ts > getCollageLines 불변식
  입력: 임의 lines
  기대: flat() === [0 .. letters.length-1] (연속·무중복·무누락 = 슬롯 index 정합)

[U-28] src/lib/collage/render-collage-to-blob.ts > getLineCellRects: 줄 기반 셀 배치
  입력: lines=[[0,1,2,3],[4,5]], canvasSize=1080
  기대: 같은 줄 y 동일, 다음 줄 y 증가, 각 줄 가로 중앙, 셀 정사각·동일 크기, canvas 범위 내

[U-29] src/lib/collage/render-collage-to-blob.ts > 배경색 적용
  입력: backgroundColor="black"
  기대: canvas 배경 픽셀이 rgb(0,0,0)

[U-30] src/lib/collage/render-collage-to-blob.ts > 콜라주 PNG Blob 생성
  입력: items + lines + 배경색
  기대: 반환 Blob.type="image/png", size <= 2097152 (2MB)
```

### 날짜 유틸리티 (`src/lib/utils/date.ts`)

```
[U-31] src/lib/utils/date.ts > 한국 시간 기준 오늘 날짜 반환
  입력: UTC+0 기준 2026-05-24T22:00:00Z (KST 2026-05-25 07:00)
  기대: "2026-05-25" (KST 기준)

[U-32] src/lib/utils/date.ts > 날짜 경계값 처리 (자정)
  입력: UTC+0 기준 2026-05-24T15:00:00Z (KST 2026-05-25 00:00)
  기대: "2026-05-25" (자정은 새 날로 처리)

[U-33] src/lib/utils/date.ts > 오늘 날짜 포맷 (ISO 형식)
  입력: Date 객체
  기대: "YYYY-MM-DD" 형식 문자열 반환
```

### Zod 스키마 validation (`src/lib/schemas/`)

```
[U-34] src/lib/schemas/submission.ts > 공개/비공개 필드 검증
  입력: { is_public: "yes" } (string, 잘못된 타입)
  기대: ZodError (is_public은 boolean이어야 함)

[U-35] src/lib/schemas/submission.ts > 정상 제출 스키마 통과
  입력: { challenge_id: "valid-uuid", is_public: true }
  기대: 에러 없이 파싱 성공

[U-36] src/lib/schemas/letter-piece.ts > slot_index 음수 거부
  입력: { slot_index: -1, character: "오" }
  기대: ZodError (slot_index는 0 이상)

[U-37] src/lib/schemas/report.ts > 신고 사유 빈 문자열 거부
  입력: { submission_id: "valid-uuid", reason: "" }
  기대: ZodError (reason은 1자 이상)
```

### Cursor Pagination 헬퍼 (`src/lib/utils/pagination.ts`)

```
[U-38] src/lib/utils/pagination.ts > cursor 없는 첫 페이지 쿼리
  입력: { cursor: undefined, limit: 20 }
  기대: limit=20 적용, cursor 조건 없음

[U-39] src/lib/utils/pagination.ts > cursor 있는 다음 페이지 쿼리
  입력: { cursor: "submission-uuid", limit: 20 }
  기대: WHERE id < cursor 조건 포함

[U-40] src/lib/utils/pagination.ts > 마지막 페이지 hasNextPage 판단
  입력: items=[19개] (limit=20)
  기대: { hasNextPage: false, nextCursor: undefined }
```

---

## 2. Component Test 목록

### LetterGrid

```
[C-01] LetterGrid > 6개 슬롯 렌더링 — 슬롯 개수가 letters 배열 길이와 일치
  시나리오: letters=["오","늘","도","화","이","팅"] prop 전달
  검증: LetterSlot 컴포넌트가 정확히 6개 렌더링됨

[C-02] LetterGrid > 빈 슬롯 클릭 → onSlotClick 콜백 호출
  시나리오: 빈 슬롯 userEvent.click
  검증: onSlotClick(0) 호출 (slot_index 전달)

[C-03] LetterGrid > 모든 슬롯 채움 → 미리보기 버튼 활성화
  시나리오: 모든 slots가 status="filled"인 상태
  검증: "미리보기" 버튼이 disabled=false

[C-04] LetterGrid > 일부 슬롯만 채워진 경우 미리보기 버튼 비활성
  시나리오: 6개 중 5개만 filled
  검증: "미리보기" 버튼 disabled=true 또는 존재하지 않음
```

### LetterSlot

```
[C-05] LetterSlot > 빈 상태 — 글자 표시, + 아이콘
  시나리오: status="empty", character="오" prop
  검증: "오" 텍스트 존재, 채우기 유도 UI 존재

[C-06] LetterSlot > 채워진 상태 — 이미지 썸네일 표시
  시나리오: status="filled", imageUrl="/test.webp" prop
  검증: <img> 또는 배경 이미지로 썸네일 렌더링

[C-07] LetterSlot > 선택 상태 — 활성 테두리 표시
  시나리오: status="selected" prop
  검증: 활성화 스타일(테두리 등) 적용됨

[C-08] LetterSlot > 채워진 슬롯 클릭 → 교체 플로우 트리거
  시나리오: status="filled" 슬롯 클릭
  검증: onSlotClick 콜백 호출 (교체용 메서드 분기 확인)
```

### ImageCropper

```
[C-09] ImageCropper > 이미지 로드 후 Canvas 렌더링 (Canvas mock)
  시나리오: imageSrc="/test.jpg" prop, vitest-canvas-mock 적용
  검증: getContext("2d") 호출됨, drawImage 호출됨

[C-10] ImageCropper > crop 영역 변경 → onCropChange 콜백
  시나리오: crop 영역 드래그 시뮬레이션 (pointerdown → pointermove → pointerup)
  검증: onCropChange({ x, y, w, h }) 콜백 호출

[C-11] ImageCropper > "완료" 클릭 → onCropComplete(blob) 콜백
  시나리오: crop 영역 설정 후 완료 버튼 클릭
  검증: Blob 타입 인자로 onCropComplete 호출

[C-12] ImageCropper > "취소" 클릭 → onCancel 콜백
  시나리오: 취소 버튼 클릭
  검증: onCancel 호출, 컴포넌트가 초기 상태로 리셋됨
```

### CollagePreview

```
[C-13] CollagePreview > 글자 조각 6개 렌더링
  시나리오: pieces=[6개 mock 이미지] prop
  검증: Canvas에 drawImage 6회 호출됨 (vitest-canvas-mock 확인)

[C-14] CollagePreview > 배경색 변경 → Canvas 재렌더링
  시나리오: BackgroundColorPicker에서 "black" 선택
  검증: fillStyle이 검정색으로 변경되고 Canvas 재드로우됨

[C-15] CollagePreview > "다시 수정" 버튼 → onEditReturn 콜백
  시나리오: "다시 수정" 버튼 클릭
  검증: onEditReturn 콜백 호출
```

### FeedCard

```
[C-16] FeedCard > 닉네임, 콜라주 이미지, 좋아요 수 렌더링
  시나리오: submission mock 데이터 prop 전달
  검증: 닉네임 텍스트, img src, 좋아요 카운트 모두 표시됨

[C-17] FeedCard > 좋아요 버튼 클릭 → optimistic update (카운트 즉시 증가)
  시나리오: isLiked=false 상태에서 좋아요 버튼 클릭
  검증: 클릭 즉시 좋아요 수 +1, isLiked 아이콘 변경 (서버 응답 전)

[C-18] FeedCard > 좋아요 취소 → optimistic update (카운트 즉시 감소)
  시나리오: isLiked=true 상태에서 좋아요 버튼 클릭
  검증: 클릭 즉시 좋아요 수 -1, isLiked 해제

[C-19] FeedCard > 신고 버튼 클릭 → ReportDialog 열림
  시나리오: 더보기 메뉴 → 신고 버튼 클릭
  검증: ReportDialog가 DOM에 나타남

[C-20] FeedCard > 자신의 제출에는 신고 버튼 미표시
  시나리오: submission.user_id === currentUserId
  검증: 신고 버튼 또는 더보기 메뉴 없음
```

### ReportDialog

```
[C-21] ReportDialog > 사유 빈 채로 제출 시 에러 메시지
  시나리오: reason 입력 없이 제출 버튼 클릭
  검증: "신고 사유를 입력해주세요" 에러 메시지 표시

[C-22] ReportDialog > 정상 신고 제출 → onSubmit 콜백
  시나리오: reason 입력 후 제출
  검증: onSubmit({ reason }) 호출
```

### BackgroundColorPicker

```
[C-23] BackgroundColorPicker > 3가지 색상 옵션 렌더링
  시나리오: 기본 렌더링
  검증: white, black, cream 3개 선택지 존재

[C-24] BackgroundColorPicker > 선택된 색상 활성 표시 + onChange 콜백
  시나리오: "black" 클릭
  검증: black 버튼에 selected 스타일, onChange("black") 호출
```

### BottomNav

```
[C-25] BottomNav > 현재 경로 기준 활성 탭 표시
  시나리오: pathname="/feed/today"
  검증: 피드 탭에 active 클래스/스타일 적용

[C-26] BottomNav > 탭 클릭 → 올바른 경로로 이동
  시나리오: 홈 탭 클릭
  검증: next/navigation의 router.push("/") 호출
```

### VisibilityToggle

```
[C-27] VisibilityToggle > 공개 선택 시 레이블 표시 + onChange
  시나리오: defaultValue=true
  검증: "공개" 표시, onChange(true) 호출

[C-28] VisibilityToggle > 비공개로 전환 시 레이블 변경
  시나리오: 비공개 버튼 클릭
  검증: "비공개" 레이블 표시, onChange(false) 호출
```

### ShareButton

```
[C-29] ShareButton > Web Share API 지원 환경에서 navigator.share 호출
  시나리오: navigator.share 존재, 공유 버튼 클릭
  검증: navigator.share({ url, title }) 호출

[C-30] ShareButton > Web Share API 미지원 환경에서 클립보드 복사 폴백
  시나리오: navigator.share = undefined, 공유 버튼 클릭
  검증: navigator.clipboard.writeText 호출, "복사됨" 피드백 표시
```

---

## 3. Playwright E2E 시나리오

> 모든 시나리오: iPhone 14 (390x844), Pixel 7 (412x915) 뷰포트 기준  
> 카메라 촬영 불가 → 이미지 업로드(갤러리 선택)로 대체  
> OAuth 로그인 불가 → 테스트 전용 이메일/비밀번호 계정 사용  
> 테스트 계정 환경 변수: `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`  
> 테스트 챌린지: Supabase에 seed된 `active_date`가 고정된 테스트 챌린지 사용

---

```
[E2E-01] 비인증 보호 페이지 접근 시 로그인 리다이렉트
전제 조건: 로그인하지 않은 상태
스텝:
  1. "/" 접근
  2. "/challenge/[id]" 직접 접근 시도
  3. "/feed/today" 직접 접근 시도
검증:
  - 각 보호 페이지 접근 시 "/login"으로 리다이렉트됨
  - /login 페이지에 구글 로그인 버튼 존재

[E2E-02] 로그인 → 오늘의 챌린지 확인 → 챌린지 시작
전제 조건: 테스트 계정 존재, 오늘 날짜에 활성 챌린지 seed됨
디바이스: iPhone 14
스텝:
  1. /login 접속
  2. 이메일/비밀번호로 로그인
  3. 홈(/) 리다이렉트 확인
  4. 오늘의 문장 표시 확인
  5. "시작하기" 버튼 클릭
  6. /challenge/[id] 이동 확인
  7. 글자 슬롯 그리드 표시 확인
검증:
  - 로그인 후 홈 화면에 문장 카드 표시됨
  - 슬롯 개수가 문장 글자 수와 일치
  - 모든 슬롯 초기 상태 "empty"

[E2E-03] 이미지 업로드 → Crop → 첫 번째 슬롯 채우기
전제 조건: E2E-02 완료 상태 (챌린지 화면)
디바이스: iPhone 14, Pixel 7 각각 실행
스텝:
  1. 첫 번째 슬롯("오") 터치
  2. 바텀시트에서 "갤러리에서 선택" 버튼 클릭
  3. tests/fixtures/images/letter-o.jpg 파일 업로드 (setInputFiles 사용)
  4. Crop 화면 진입 확인
  5. Crop 영역을 드래그하여 설정
  6. "완료" 버튼 클릭
  7. 슬롯 화면으로 복귀 확인
검증:
  - slot[0]에 이미지 썸네일 표시됨
  - slot[0] status가 "filled"로 변경됨
  - 나머지 슬롯은 여전히 "empty"

[E2E-04] 모든 슬롯 채우기 → 미리보기 진입
전제 조건: 로그인된 상태, 챌린지 화면
스텝:
  1. 각 슬롯에 tests/fixtures/images/letter-*.jpg 파일 순차 업로드 (6개)
  2. 각 슬롯에서 crop 완료
  3. 모든 슬롯 채워진 후 "미리보기" 버튼 활성화 확인
  4. "미리보기" 버튼 클릭
  5. /challenge/[id]/preview 이동 확인
검증:
  - 미리보기 화면에 콜라주 Canvas 렌더링됨
  - 배경색 선택 UI 표시됨 (흰/검/크림)
  - "다시 수정" 버튼 존재

[E2E-05] 새로고침 후 슬롯 상태 복원 (이어하기)
전제 조건: E2E-03 완료 (3개 슬롯 채운 상태)
스텝:
  1. 페이지 새로고침 (page.reload())
  2. 슬롯 화면 재진입
검증:
  - 새로고침 전에 채워진 3개 슬롯이 그대로 유지됨
  - 채워진 슬롯에 이미지 썸네일 표시됨
  - 홈 화면에 "이어하기" 버튼 표시됨

[E2E-06] 콜라주 완성 → 공개 선택 → 제출
전제 조건: E2E-04 완료 (미리보기 화면)
스텝:
  1. 배경색 "black" 선택
  2. "완성하기" 버튼 클릭
  3. 공개/비공개 선택 다이얼로그에서 "공개" 선택
  4. 제출 완료 확인
  5. 제출 완료 화면 진입
검증:
  - 제출 완료 메시지 표시됨
  - 공유 링크 복사 버튼 존재
  - submissions 테이블에 status="completed", is_public=true 레코드 생성됨

[E2E-07] 공유 링크 접근 (비인증) → "나도 만들기" 클릭
전제 조건: 공개 완성 제출물 존재 (/s/[submission_id])
스텝:
  1. 브라우저 컨텍스트 초기화 (비인증 상태)
  2. /s/[submission_id] 접근
  3. 콜라주 이미지, 닉네임, 문장 표시 확인
  4. "나도 만들기" 버튼 클릭
검증:
  - 비인증 상태에서 페이지 정상 접근 (401 없음)
  - OG 태그 meta 태그 존재 (og:image, og:title)
  - "나도 만들기" 클릭 후 /login 또는 / 이동

[E2E-08] 비공개 제출물 타인 접근 차단
전제 조건: 비공개(is_public=false) 제출물 존재
스텝:
  1. 다른 테스트 계정으로 로그인
  2. /s/[비공개_submission_id] 접근 시도
검증:
  - 404 응답 또는 404 페이지 표시 (존재 여부 노출 안 됨)
  - 제출자의 닉네임, 이미지 노출되지 않음

[E2E-09] 채워진 슬롯 교체
전제 조건: 3개 슬롯이 채워진 챌린지 화면
스텝:
  1. 이미 채워진 slot[0] 터치
  2. "변경하기" 옵션 선택
  3. 새 이미지 파일 업로드 (letter-o-2.jpg)
  4. crop 완료
검증:
  - slot[0]의 이미지 썸네일이 새 이미지로 교체됨
  - isComplete 상태 유지 (다른 슬롯 변화 없음)

[E2E-10] 신고하기 플로우
전제 조건: 피드에 다른 사용자의 공개 제출물 존재 (Phase 3 이후)
스텝:
  1. /feed/today 진입
  2. 특정 FeedCard의 더보기 메뉴 클릭
  3. "신고하기" 선택
  4. ReportDialog에서 사유 입력
  5. 신고 제출
검증:
  - 신고 완료 토스트 메시지 표시
  - reports 테이블에 레코드 생성됨
  - 동일 제출 재신고 시도 시 에러 메시지 또는 방지 처리

[E2E-11] 인증 만료 후 API 요청 → 로그인 리다이렉트
전제 조건: 로그인 상태에서 세션 강제 만료
스텝:
  1. 로그인 후 localStorage/cookie에서 세션 토큰 삭제
  2. /api/submissions POST 요청 시도 (제출 버튼 클릭)
검증:
  - 401 응답 또는 /login 리다이렉트
  - 사용자에게 "다시 로그인해주세요" 안내

[E2E-12] 카메라 권한 거부 시 안내 메시지 표시
전제 조건: 브라우저 카메라 권한 차단 설정
스텝:
  1. 슬롯 터치 → 바텀시트 열림
  2. "카메라로 촬영" 선택
  3. 권한 거부 시뮬레이션 (Playwright context permissions=[])
검증:
  - 에러 없이 앱 크래시 없음
  - "갤러리에서 선택"으로 유도하는 안내 표시
  - 갤러리 업로드는 정상 동작
```

---

## 4. Mock Image Fixture 전략

### 필요한 Fixture 분류

**글자별 WebP fixture** (기본 테스트용)
```
tests/fixtures/images/letters/
  letter-o.webp         (한글 "오" — slot_index=0 기준)
  letter-n.webp         (한글 "늘")
  letter-d.webp         (한글 "도")
  letter-h.webp         (한글 "화")
  letter-i.webp         (한글 "이")
  letter-t.webp         (한글 "팅")
```

실제 글자가 찍힌 이미지를 준비할 필요는 없다. 단색 배경에 글자를 렌더링한 100x100 PNG를 sharp 또는 Canvas로 프로그래매틱 생성해도 된다. fixture 생성 스크립트는 `tests/fixtures/scripts/generate-letters.ts`에 작성.

**크기별 fixture** (용량 제한 테스트용)
```
tests/fixtures/images/sizes/
  letter-100kb.webp     (100KB — 정상 범위)
  letter-499kb.webp     (499KB — 경계값 이내)
  letter-501kb.webp     (501KB — 500KB 초과)
  collage-1mb.png       (1MB — 정상 범위)
  collage-2mb.png       (2MB — 경계값)
  collage-2001kb.png    (2MB 초과)
```

**포맷별 fixture** (타입 검증 테스트용)
```
tests/fixtures/images/formats/
  test.jpg              (JPEG — 허용)
  test.png              (PNG — 허용)
  test.webp             (WebP — 허용)
  test.gif              (GIF — 거부)
  test.heic             (HEIC — 거부)
  test.pdf              (PDF — 거부)
  test-fake.jpg         (확장자는 .jpg지만 실제로는 GIF — 타입 위조 테스트)
```

**EXIF fixture** (EXIF strip 테스트용)
```
tests/fixtures/images/exif/
  with-gps.jpg          (GPS 좌표 포함 JPEG — piexifjs로 주입)
  with-gps.jpg.meta.json (위도/경도 값 기록 — 테스트 비교용)
  without-exif.jpg      (순수 JPEG — EXIF 없음)
  clean-after-strip.jpg (with-gps.jpg에서 strip한 결과 — golden)
```

EXIF 포함 fixture 생성 방법: `piexifjs` 라이브러리로 GPS 데이터를 프로그래매틱 주입. 스크립트는 `tests/fixtures/scripts/inject-exif.ts`.

**콜라주 golden image** (visual regression 기준)
```
tests/fixtures/images/golden/
  collage-white-bg.png  (흰 배경, 6개 고정 letter fixture 입력)
  collage-black-bg.png  (검정 배경)
  collage-cream-bg.png  (크림 배경)
```

golden image는 콜라주 생성 함수가 검증된 시점에 1회 생성하고 git에 커밋. 이후 visual regression 기준 이미지로 사용.

**비정상 이미지** (에러 처리 테스트용)
```
tests/fixtures/images/invalid/
  corrupt.jpg           (JPEG 헤더는 맞지만 데이터 손상)
  empty.jpg             (0바이트)
  too-large.jpg         (12MP 이상, 10MB)
  wrong-extension.webp  (실제로는 JPEG인데 .webp로 저장)
```

### 네이밍 컨벤션 요약

- 글자 fixture: `letter-{한글_로마자표기}.{ext}` (예: `letter-o.webp`)
- 크기 fixture: `letter-{크기}.{ext}` (예: `letter-501kb.webp`)
- golden image: `collage-{background}.png` (예: `collage-black-bg.png`)
- EXIF fixture: `{상태}-exif.{ext}` (예: `with-gps.jpg`)
- 비정상 이미지: `{설명}.{ext}` (예: `corrupt.jpg`)

---

## 5. Visual Regression이 필요한 지점

### 대상 화면/컴포넌트

**Priority 1 — 콜라주 렌더링 결과**
- `/challenge/[id]/preview` 미리보기 화면 전체
- 배경색 3종(흰/검/크림) × 고정 letter fixture 입력
- 이유: 콜라주 레이아웃 코드 변경 시 글자 배치, 각도, 여백이 의도치 않게 바뀔 수 있음

**Priority 2 — 핵심 상태 UI**
- LetterGrid: 슬롯 3가지 상태(empty/filled/selected)가 모두 표시된 화면
- FeedCard: 좋아요 상태 켜짐/꺼짐

**Priority 3 — 공유 페이지 OG 대상**
- `/s/[id]` 전체 페이지 (SSR 결과물이 OG로 사용됨)

### 비교 전략

```
도구: Playwright built-in screenshot comparison (toHaveScreenshot)
threshold: 0.01 (픽셀 diff 1% 이내 허용)
          — 폰트 렌더링 차이(OS별 안티앨리어싱)로 완전 0%는 불가
maxDiffPixels: 100 (작은 픽셀 차이는 허용)
업데이트 방법: npx playwright test --update-snapshots (의도적 변경 시만)
저장 경로: tests/e2e/__snapshots__/
```

### Deterministic 렌더링 확보 방법

콜라주는 랜덤 각도(±15도)가 적용되면 매 실행마다 결과가 달라져 visual regression이 불가능해진다.

해결책:
1. 콜라주 생성 함수에 `seed` 파라미터를 추가한다. (`src/lib/canvas/collage.ts`에 `{ seed?: number }` 옵션)
2. 테스트 시 `seed=42` 고정 값을 전달해 랜덤 각도를 결정론적으로 생성한다.
3. E2E visual regression에서는 페이지에 `?seed=42` 쿼리 또는 테스트 환경변수(`NEXT_PUBLIC_COLLAGE_SEED`)로 주입.
4. golden image도 `seed=42`로 생성한 결과물을 기준으로 사용.

```
tests/e2e/visual-regression/
  collage-white.spec.ts   (흰 배경 콜라주 visual regression)
  collage-black.spec.ts   (검정 배경)
  collage-cream.spec.ts   (크림 배경)
  share-page.spec.ts      (공유 페이지)
```

---

## 6. MVP에서 반드시 막아야 할 버그 (Ship Blocker)

```
[BUG-01] 업로드된 이미지에 GPS 좌표가 포함되어 전송됨
원인: EXIF strip 누락 또는 Canvas re-draw 없이 원본 파일 그대로 업로드
영향: 사용자 실시간 위치 노출, GDPR·개인정보보호법 위반 수준
방어 테스트: U-19, U-20 (EXIF strip 유닛 테스트), E2E에서 업로드된 이미지 EXIF 검사

[BUG-02] 타인의 비공개 제출이 /s/[id]에서 보임
원인: RLS 정책 누락 또는 서버 컴포넌트에서 RLS 우회 쿼리
영향: 사용자 신뢰 붕괴, 비공개 설정이 무의미해짐
방어 테스트: E2E-08, API 테스트 (비인증/타계정으로 비공개 조회 → 404 확인)

[BUG-03] 타인의 제출에 PATCH 요청으로 is_public 변경 가능
원인: Route Handler에서 소유자 확인 누락 (`user_id = auth.uid()` 미검증)
영향: 다른 사람의 공개 콜라주를 강제로 숨길 수 있음
방어 테스트: API 테스트 (타계정 세션으로 PATCH /api/submissions/[id] → 403 확인)

[BUG-04] 비인증 상태에서 /api/submissions POST 성공
원인: Route Handler에서 인증 체크 누락
영향: 인증 없이 DB 레코드 생성, 스팸 가능
방어 테스트: API 테스트 (Authorization 헤더 없이 POST → 401 확인)

[BUG-05] 같은 사용자가 같은 챌린지를 중복 제출
원인: UNIQUE(user_id, challenge_id) DB 제약은 있지만 서버에서 duplicate 에러를 무시
영향: 콜라주가 2개 생성되어 피드에 중복 노출, 데이터 무결성 파괴
방어 테스트: API 테스트 (동일 user_id + challenge_id로 2번 POST → 409 또는 기존 draft 반환)

[BUG-06] 500KB 초과 이미지 업로드 시 Storage에 저장됨
원인: 클라이언트 검증만 있고 서버 Route Handler에서 크기 검증 누락
영향: Storage 비용 폭증, 악의적 사용자가 대용량 파일 업로드 가능
방어 테스트: U-25, API 테스트 (501KB 파일 POST → 400 확인)

[BUG-07] 허용되지 않는 파일 타입이 Storage에 저장됨
원인: Content-Type 헤더 위조 또는 서버 타입 검증 누락
영향: SVG를 통한 XSS, 실행 파일 업로드 가능성
방어 테스트: U-24, API 테스트 (image/gif, application/pdf로 요청 → 400 확인), 파일 Magic Bytes 검증 포함

[BUG-08] 새로고침 후 진행 중인 슬롯 상태가 사라짐
원인: Zustand persist 미설정 또는 localStorage 직렬화 오류
영향: 글자 수집 중 이탈 → 재시작 강요 → 완성률 하락
방어 테스트: U-13, E2E-05 (새로고침 후 슬롯 상태 복원 확인)

[BUG-09] 콜라주 PNG 생성 실패 (Canvas toBlob 에러)
원인: cross-origin 이미지를 Canvas에 그릴 때 tainted canvas 에러 (Supabase Storage URL에 CORS 미설정)
영향: 콜라주 완성 불가, 핵심 플로우 차단
방어 테스트: E2E-04 (실제 Storage URL로 콜라주 생성 확인), Storage CORS 설정 검증

[BUG-10] iOS Safari에서 PNG 다운로드가 안 됨
원인: Safari는 `<a download>` 속성이 blob URL에서 동작하지 않음
영향: iOS 사용자가 콜라주를 기기에 저장할 수 없음
방어 테스트: E2E에서 iPhone 14 (iOS Safari Webkit) 뷰포트로 다운로드 플로우 확인

[BUG-11] 피드에 hidden 상태 제출이 노출됨
원인: /api/feed에서 status 필터 누락 (status='completed' AND is_public=true 조건 미적용)
영향: 신고 처리된 콘텐츠가 피드에 그대로 노출됨
방어 테스트: API 테스트 (hidden 제출이 GET /api/feed 응답에 포함되지 않음 확인)

[BUG-12] 좋아요 optimistic update 실패 후 UI가 잘못된 상태로 고착
원인: TanStack Query onError 롤백 미구현
영향: 좋아요 수와 서버 실제 데이터 불일치, UI 혼란
방어 테스트: C-17에서 mutate 실패 mock 주입 후 UI가 원래 카운트로 복원되는지 확인

[BUG-13] slot_index 범위 밖 값으로 letter_pieces에 잘못된 레코드 생성
원인: 서버에서 slot_index가 문장 길이 이내인지 검증 안 함
영향: DB 무결성 파괴, 콜라주 렌더링 오류
방어 테스트: U-36, API 테스트 (slot_index=99로 POST /api/submissions/[id]/letters → 400 확인)

[BUG-14] 문장에서 공백이 슬롯으로 만들어짐
원인: 문장 파싱 시 공백 제거 로직 누락
영향: "오늘도 화이팅" → 슬롯 7개(공백 포함)로 잘못 생성
방어 테스트: U-01, U-03

[BUG-15] 오늘의 챌린지 타임존 오류 (KST 00:00 전후 경계)
원인: 서버가 UTC 기준으로 날짜를 비교해 한국 자정 기준이 아닌 UTC 자정에 챌린지가 바뀜
영향: 한국 사용자가 밤 12시 이후 이전 날 챌린지를 보게 됨
방어 테스트: U-31, U-32, API 테스트 (KST 00:01 타임스탬프로 요청 시 올바른 날짜 챌린지 반환)

[BUG-16] 비공개 letter_pieces 이미지 URL이 타인에게 노출
원인: Supabase Storage letter-pieces 버킷의 RLS/정책이 public으로 설정됨
영향: 원본 글자 이미지(위치 정보 없어도 개인 사진)가 URL 추측으로 접근 가능
방어 테스트: API 테스트 (다른 user의 letter_pieces Storage URL에 비인증 GET 요청 → 403 또는 404 확인)
```

---

## 7. 테스트 구현 우선순위

### P0 — Phase 2 완료 전 필수 (핵심 로직 보호)

핵심 로직이 망가지면 서비스 자체가 불가능한 테스트. 구현 시작 전 먼저 작성한다.

**Unit Tests (P0)**
- U-01, U-02, U-03, U-04 — 문장 파싱 (슬롯 생성의 기초)
- U-07, U-08, U-09, U-10, U-11 — Zustand 슬롯 상태 관리
- U-14, U-15, U-16, U-17, U-18 — Crop 좌표 계산
- U-19, U-20, U-21 — EXIF strip (보안)
- U-23, U-24, U-25, U-26 — 이미지 validation

**Component Tests (P0)**
- C-05, C-06, C-07, C-08 — LetterSlot 상태
- C-01, C-02, C-03, C-04 — LetterGrid
- C-09, C-10, C-11, C-12 — ImageCropper (Canvas mock 필요)

**Ship Blocker 방어**
- BUG-01 (EXIF), BUG-08 (슬롯 복원), BUG-14 (문장 파싱)

---

### P1 — Phase 3 완료 전 필수 (서버 연동 + 보안)

서버 연동 후 데이터 보안과 비즈니스 로직 보호.

**Unit Tests (P1)**
- U-28, U-29, U-30 — 콜라주 레이아웃
- U-31, U-32, U-33 — 날짜 유틸 (타임존)
- U-34, U-35, U-36, U-37 — Zod 스키마
- U-38, U-39, U-40 — Pagination 헬퍼

**Component Tests (P1)**
- C-13, C-14, C-15 — CollagePreview
- C-16, C-17, C-18, C-19, C-20 — FeedCard + optimistic update
- C-21, C-22 — ReportDialog
- C-23, C-24 — BackgroundColorPicker
- C-27, C-28 — VisibilityToggle

**E2E Tests (P1)**
- E2E-01 — 비인증 보호 페이지 리다이렉트
- E2E-02 — 로그인 → 챌린지 시작
- E2E-03 — 이미지 업로드 → crop → 슬롯 채우기
- E2E-05 — 새로고침 후 상태 복원
- E2E-08 — 비공개 제출 타인 접근 차단
- E2E-11 — 인증 만료 처리

**API Tests (P1)**
- POST /api/submissions → 401 (비인증), 409 (중복), 201 (정상)
- POST /api/submissions/[id]/letters → 400 (타입 오류), 400 (크기 초과), 403 (타인 접근)
- PATCH /api/submissions/[id] → 403 (타인), 200 (소유자)
- GET /api/challenges/today → 200, 404 (챌린지 없음)

**Ship Blocker 방어**
- BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-11, BUG-13, BUG-15, BUG-16

---

### P2 — Phase 4, 베타 전 (완성도 + 회귀 방지)

기능은 동작하지만 edge case와 visual regression 추가.

**E2E Tests (P2)**
- E2E-04 — 전체 슬롯 채우기 + 미리보기
- E2E-06 — 콜라주 완성 + 제출
- E2E-07 — 공유 링크 비인증 접근
- E2E-09 — 슬롯 교체
- E2E-10 — 신고하기
- E2E-12 — 카메라 권한 거부

**Component Tests (P2)**
- C-25, C-26 — BottomNav
- C-29, C-30 — ShareButton

**Visual Regression (P2)**
- 콜라주 3종 배경색 golden screenshot
- LetterGrid 상태별 screenshot
- /s/[id] 페이지 screenshot

**Unit Tests (P2)**
- U-05, U-06 — 문장 파싱 edge case
- U-12, U-13 — Zustand persist edge case
- U-22, U-27 — EXIF/validation 경계값

**Ship Blocker 방어**
- BUG-09 (Canvas CORS), BUG-10 (iOS 다운로드), BUG-12 (optimistic update 롤백)

---

## 8. 내가 이해해야 할 테스트 개념

### Vitest vs Jest

Jest는 Node.js 생태계에서 오래된 테스트 프레임워크다. Vitest는 Vite 기반 프로젝트에 최적화된 최신 프레임워크로, Next.js 프로젝트에서 훨씬 빠르게 실행된다. API가 Jest와 거의 동일해서 기존 Jest 지식을 그대로 쓸 수 있지만, 설정이 단순하고 ESM(모듈 시스템) 지원이 기본이다. 타이포로그처럼 Next.js + TypeScript 프로젝트에서는 Vitest를 쓰는 것이 표준이다.

### React Testing Library 철학

"사용자가 실제로 보는 것을 테스트한다"는 원칙이다. `getByRole("button", { name: "완료" })`처럼 화면에 보이는 텍스트나 ARIA 역할로 요소를 찾는다. 내부 구현(컴포넌트 state, 함수 이름)이 아닌 사용자 행동(클릭, 입력)을 시뮬레이션한다. 이렇게 하면 리팩토링해도 테스트가 깨지지 않는다.

### Canvas mock (vitest-canvas-mock)

Canvas API는 실제 DOM이 없는 Node.js 테스트 환경에서 동작하지 않는다. `vitest-canvas-mock`은 `getContext("2d")`를 가짜로 구현해서 `drawImage`, `fillRect` 등의 호출을 추적(spy)할 수 있게 해준다. 실제 픽셀을 그리지는 않지만, "crop 함수가 drawImage를 올바른 좌표로 호출했는가?"를 검증할 수 있다.

### MSW (Mock Service Worker)

API 요청을 가로채서 가짜 응답을 반환하는 라이브러리다. 컴포넌트 테스트에서 실제 Supabase 서버 없이도 "좋아요 API가 성공했을 때 카운트가 증가한다"를 테스트할 수 있다. 브라우저의 Service Worker를 이용해 네트워크 레벨에서 가로채기 때문에, fetch/axios 등 라이브러리 종류와 무관하게 동작한다.

### Playwright의 mobile emulation

Playwright는 실제 iPhone, Android 화면 크기, User-Agent, 터치 이벤트를 시뮬레이션한다. `devices["iPhone 14"]`를 쓰면 390×844 해상도, Safari User-Agent, 고해상도 픽셀비율이 자동 설정된다. 실제 기기 없이도 모바일 레이아웃과 터치 인터랙션을 테스트할 수 있다. 단, 카메라 하드웨어 접근은 불가능하다.

### fixture vs factory

fixture는 미리 만들어진 고정 데이터(파일, JSON 등)다. `tests/fixtures/images/letter-o.webp`처럼 파일이 이미 존재한다. factory는 테스트마다 다른 데이터를 동적으로 생성하는 함수다. `createSubmission({ is_public: false })`처럼 기본값을 override할 수 있다. 이미지처럼 파일이 필요한 경우는 fixture를, 다양한 조합이 필요한 DB 데이터는 factory를 쓴다.

### visual regression testing

스크린샷을 찍어서 이전 기준 이미지와 픽셀 단위로 비교하는 테스트다. 콜라주 레이아웃 코드를 수정했는데 글자 배치가 의도치 않게 변경됐을 때 이를 잡아낸다. Playwright의 `toHaveScreenshot()`이 기준 이미지를 자동 생성·비교한다. 처음 실행 시 기준 이미지를 생성하고, 이후 실행마다 비교한다.

### optimistic update 테스트 방법

좋아요 버튼을 클릭하면 서버 응답 전에 UI가 먼저 바뀌어야 한다. 테스트에서는 두 단계로 나눈다. 첫째, mutation이 진행 중일 때 UI 상태 확인 (MSW로 응답 지연 설정). 둘째, mutation 실패 시 원래 상태로 롤백되는지 확인 (MSW로 에러 응답 주입). TanStack Query의 `onMutate`, `onError`, `onSettled`가 올바르게 구현됐는지 검증한다.

### cursor pagination 테스트

`GET /api/feed?cursor=xxx`에서 cursor 이후의 데이터만 반환하는지 검증한다. 첫 페이지(cursor 없음), 다음 페이지(cursor 있음), 마지막 페이지(hasNextPage=false), 빈 결과(0건)의 4가지 케이스를 테스트한다. 무한스크롤 컴포넌트 테스트에서는 IntersectionObserver를 mock해서 스크롤 트리거를 시뮬레이션한다.

### RLS 테스트 접근법

Supabase RLS는 실제 PostgreSQL에서만 동작하기 때문에 unit test로는 검증이 불가능하다. 두 가지 방법을 병행한다. 첫째, 로컬 Supabase(supabase start)를 띄워서 실제 RLS 정책을 테스트 DB에 적용한 후 API 테스트를 실행. 둘째, Route Handler 단위에서 `user_id !== auth.uid()`를 확인하는 서버 로직을 unit test로 검증 (RLS와 이중 방어). MVP에서는 주요 시나리오를 수동으로 확인하는 것이 현실적이다.

### CI에서의 E2E 전략

GitHub Actions에서 Playwright를 실행하면 브라우저 설치와 실행 시간이 길다. 전략은 두 단계로 나눈다. PR 머지 시: unit + component 테스트만 (빠름, 1~2분). 스테이징 배포 후: E2E 테스트 실행 (느림, 5~10분). E2E에 필요한 Supabase 테스트 프로젝트를 별도로 유지하고, 테스트 전 seed 데이터를 초기화하는 스크립트(`tests/e2e/setup/seed.ts`)를 작성한다.

### test isolation (각 테스트 독립성)

각 테스트는 다른 테스트가 만든 데이터에 의존하면 안 된다. 한 테스트가 실패하면 다른 테스트도 연쇄 실패하기 때문이다. E2E에서는 각 테스트 전 `beforeEach`로 DB를 초기 상태로 리셋하거나, 테스트마다 고유한 user_id와 challenge_id를 사용한다. Zustand store는 테스트마다 `beforeEach`에서 초기화(`store.getState().reset()`)해야 한다. MSW 핸들러도 `afterEach`에서 `server.resetHandlers()`로 리셋한다.
