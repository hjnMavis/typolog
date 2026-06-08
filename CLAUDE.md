# Typolog — Project Rules

## 프로젝트 개요

- **서비스명**: Typolog (Typography + Log)
- **한 줄 요약**: 같은 문장을, 각자의 일상에서 전혀 다르게 완성하는 글자 콜라주 앱
- **플랫폼**: 모바일 웹 (모바일 우선)
- **현재 상태**: Phase 1 완료, Phase 2 (Supabase 백엔드 연동) 진행 중

## 기술 스택

| 역할 | 기술 |
|------|------|
| Framework | Next.js 16 App Router (Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Client State | Zustand (persist middleware) |
| Image Crop | react-easy-crop |
| Test | Vitest |
| Package Manager | pnpm |
| Deploy | Vercel (예정) |

## 코딩 컨벤션

- **설명은 한국어**, 코드/파일명/커밋 메시지는 **영어**
- TypeScript strict — `any` 사용 금지
- 경로 alias: `@/` → `src/`
- 컴포넌트: PascalCase (`LetterSlot.tsx`)
- 유틸/상수: camelCase (`sentenceParser.ts`)
- 디렉토리: kebab-case 또는 camelCase (일관성 유지)

## 폴더 구조

```
src/
├── app/                   — Next.js App Router 페이지
├── components/ui/         — shadcn/ui 기본 컴포넌트
├── features/              — 도메인별 feature 모듈
├── lib/                   — 유틸, 상수, Canvas 유틸
├── stores/                — Zustand stores
├── hooks/                 — 커스텀 React hooks
├── types/                 — 공유 타입 정의
└── db/                    — Drizzle 스키마·마이그레이션 (Phase 2~)
```

## 라우트 구조

```
/                          — 홈 (오늘의 챌린지)
/challenge/[id]            — 글자 수집
/challenge/[id]/preview    — 콜라주 미리보기
/feed/today                — 오늘의 피드
/s/[id]                    — 공유 (비인증)
/u/[handle]                — 유저 프로필
/admin/challenges          — 챌린지 관리
```

## 개발 원칙

1. 한 번에 5개 이상 파일을 수정하지 않는다 — **직접 작성하는 파일 기준**.
   도구 자동 생성물(예: drizzle-kit 생성 SQL·meta), 패키지 설치로 변경되는 `package.json`/lockfile,
   확정된 결정을 반영하는 문서 1~2줄 동기화는 산입하지 않는다
2. 큰 기능은 작은 태스크로 쪼갠다
3. 작업 전에는 변경 계획을 먼저 제안한다
4. 승인 없이 대규모 변경을 하지 않는다
5. 보안/개인정보/이미지 공개 범위를 항상 고려한다
6. Mock-first: Supabase 연동 전에 mock 데이터로 UX를 먼저 검증한다
7. 모든 Phase의 Day 작업은 아래 "Day 작업 사이클"을 따른다

## Day 작업 사이클 (모든 Phase 공통)

모든 Phase(1~5)의 Day 단위 작업은 **7단계 / 3개 차단 게이트** 절차를 따른다.
전체 정의·프롬프트 템플릿·체크리스트는 **`docs/day-workflow.md`** 참조.

```
브리핑 → [게이트 A: 승인] → 구현 → [게이트 B: QA] → 검증 → [게이트 C: 학습] → 커밋·PR
```

- **게이트 A (승인)**: 사용자 승인 전 구현 금지. 수정 요청 시 브리핑으로 복귀.
- **게이트 B (QA)**: QA 에이전트용 QA 프롬프트 + 사용자 직접 E2E 체크리스트를 **동시 제공**.
  QA 리포트(`docs/reviews/phase{N}-day{M}-qa-review.md`) 수령 + E2E 전 항목 완료 + Critical/High 0건이어야 통과.
- **게이트 C (학습)**: 멘토 에이전트용 학습 프롬프트 제공 → 학습 노트(`docs/learning/phase-{N}-day-{M}.md`) 수령.
- **커밋 & PR**: 세 게이트 모두 통과 시에만 커밋·PR. **작업 단위별 PR**(기준: `docs/agent-view-workflow.md`)로 범위를 작게 나눠 의존 순서대로 순차 머지하고, 각 PR 내부는 **논리적 단계별 세분 커밋**으로 구성. **AI 서명 없음.**

게이트는 차단 지점이다. 통과 전에는 다음 단계로 진행하지 않는다.

## 현재 Phase

**Phase 2: Supabase 백엔드 연동**
- DB 스키마·RLS·GRANT·trigger (Day 1 완료) → 인증·클라이언트 3종 (Day 2) → API·Storage → 동기화 → 검증
- 구현 순서·Day별 확정 결정: `docs/backend-design-plan.md` §9

## 주요 명령어

```bash
pnpm dev          # 개발 서버 (Turbopack)
pnpm build        # 프로덕션 빌드
pnpm lint         # ESLint
pnpm type-check   # TypeScript 타입 체크
pnpm test         # Vitest (watch mode)
pnpm test:run     # Vitest (single run)
```

## Agent 규칙

- Agent 정의: `.claude/agents/`
- 같은 파일을 두 agent가 동시에 수정하지 않는다
- production 코드 수정 전 계획을 먼저 제안한다
