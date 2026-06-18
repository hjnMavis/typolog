# Typolog — Claude Agent View Workflow

## 개요

이 프로젝트는 Claude Code의 **Agent View**를 활용하여 여러 역할의 agent를 병렬로 운영한다. 한 명의 개발자가 여러 전문가의 도움을 받으며 효율적으로 개발하는 것이 목표.

Agent 정의 파일: `.claude/agents/`

---

## Agent 구성

### 구현 Agent

| Agent | 파일 | 모델 | 담당 |
|-------|------|------|------|
| **Frontend** | `frontend-agent.md` | Sonnet | UI, Canvas, Zustand, 모바일 UX |
| **Backend** | `backend-agent.md` | Sonnet | DB, API, Auth, RLS, Storage, CI/CD |

### 품질 Agent

| Agent | 파일 | 모델 | 담당 |
|-------|------|------|------|
| **QA** | `qa-agent.md` | Sonnet | Vitest, Playwright, 테스트 설계 |
| **Reviewer** | `reviewer-agent.md` | Opus | 코드 리뷰, 보안 검토, 타입 안전성 |

### 전략 Agent

| Agent | 파일 | 모델 | 담당 |
|-------|------|------|------|
| **Product** | `product-agent.md` | Sonnet | MVP 범위, UX 플로우, 지표 설계 |
| **Observability** | `observability-agent.md` | Sonnet | PostHog, Sentry, 이벤트 계측 |

### 학습 Agent

| Agent | 파일 | 모델 | 담당 |
|-------|------|------|------|
| **Mentor** | `mentor-agent.md` | Opus | 개념 설명, 학습 노트 작성 |

### Phase 0 (프로젝트 세팅)

Phase 0의 작업 (프로젝트 생성, 패키지 설치, ESLint, Vercel 연결 등)은 **메인 세션**에서 직접 수행한다. Agent View는 Phase 1부터 본격 활용.

---

## 파일 소유권

**같은 파일을 두 agent가 동시에 수정하지 않는다.**

```
Frontend Agent:
  src/app/ (페이지: /, /challenge, /feed, /s, /u)
  src/components/, src/stores/, src/hooks/
  src/features/, src/lib/canvas/, src/lib/utils/

Backend Agent:
  src/app/api/ (OG 이미지 포함), src/db/, src/lib/supabase/, src/lib/actions/ (Server Action — Day 7~), src/types/
  supabase/, src/proxy.ts (Next 16 — 구 middleware.ts)
  .github/workflows/, next.config.ts, drizzle.config.ts

QA Agent:
  tests/ (전체), vitest.config.ts, playwright.config.ts

Observability Agent:
  src/lib/analytics/, src/lib/sentry/
  sentry.client.config.ts, sentry.server.config.ts
  docs/events.md

Product Agent:
  docs/ (events.md 제외)

Mentor Agent:
  docs/learning/
```

---

## 작업 패턴

### Day 작업 사이클 (모든 Phase 공통)

> 표준 절차의 단일 소스는 **`docs/day-workflow.md`** (7단계 / 3 게이트). 아래는 에이전트 관점 요약.

```mermaid
graph TD
    A["1. 계획 브리핑 (메인 세션)"] --> C{"게이트 A: 사용자 승인?"}
    C -->|"수정"| A
    C -->|"승인"| D["2. Frontend/Backend: 구현"]
    D --> E["Reviewer: 코드/보안 리뷰 → 반영"]
    E --> GB["게이트 B (QA): QA 프롬프트 + E2E 체크리스트 동시 제공"]
    GB --> F["3. QA Agent: 리뷰 md + 사용자 E2E 완료"]
    F -->|"Critical/High"| D
    F -->|"green"| GC["게이트 C (학습): 멘토 프롬프트"]
    GC --> H["4. Mentor Agent: 학습 노트 md"]
    H --> I["5. 커밋 & PR (3 게이트 통과 시)"]
```

산출물: QA 리뷰 `docs/reviews/phase{N}-day{M}-qa-review.md`, 학습 노트 `docs/learning/phase-{N}-day-{M}.md`.

### 기능 구현 마이크로 사이클 (구현 단계 내부)

구현(2번) 내부에서 구현 agent와 Reviewer가 도는 짧은 루프:

```mermaid
graph TD
    A["작업 정의"] --> B["Frontend/Backend: 계획 제안"]
    B --> C{"승인?"}
    C -->|"예"| D["구현"]
    C -->|"수정"| B
    D --> E["Reviewer: 코드 리뷰"]
    E --> F["구현 agent: 리뷰 반영"]
```

### TDD 사이클 (유틸/API)

```mermaid
graph TD
    A["1. QA: 테스트 작성 (모두 fail)"] --> B["2. Frontend/Backend: 구현 (테스트 통과)"]
    B --> C["3. Reviewer: 리뷰"]
    C --> D["4. 리팩토링 (테스트 여전히 통과)"]
    D --> E["5. 커밋"]
```

### 병렬 작업 패턴

```
동시 가능:
  Frontend가 화면 A + QA가 유틸 B 테스트 (다른 파일)
  Reviewer가 코드 리뷰 + Observability가 이벤트 계측 (다른 관심사)
  Mentor가 개념 설명 + 구현 agent가 작업 (간섭 없음)

순서 필요:
  QA 테스트 작성 → Frontend/Backend 구현
  구현 완료 → Reviewer 리뷰 → 리뷰 반영
  Backend RLS 작성 → Reviewer 보안 검토
```

---

## 작업 단위 쪼개는 기준

**원칙**: "하나의 작업 단위 = 하나의 PR" — PR 범위는 작게, PR 내부는 논리적 단계별 세분 커밋으로 (정책 개정 2026-06-05, 구: 작업 단위별 커밋 + Day 단위 PR 1개)

| 기준 | 예시 |
|------|------|
| 화면 단위 | "홈 화면 구현", "피드 화면 구현" |
| 기능 단위 | "이미지 crop 기능", "좋아요 토글" |
| 레이어 단위 | "API 구현", "UI 구현", "테스트 작성" |
| 파일 5개 이내 (직접 작성 기준) | 초과 시 작업 쪼개기. 자동 생성물·lockfile·문서 1~2줄 동기화는 비산입 |

**쪼개면 안 되는 경우** (PR=머지 단위 기준 — 같은 PR 안에서의 커밋 분리는 무방):
- DB 스키마 변경 + RLS 정책 → 함께 배포해야 보안 유지
- 컴포넌트 + 해당 스타일 → 분리하면 깨진 UI가 머지됨

---

## 충돌 발생 시

1. `git status`로 변경 파일 확인
2. 충돌 파일이 있으면 한쪽이 먼저 커밋
3. 다른 쪽이 최신 상태에서 작업 재개

---

## 요약

```
구현: Frontend가 UI를 만들고, Backend가 API/DB를 만든다.
검증: QA가 테스트하고, Reviewer가 리뷰하고 보안을 점검한다.
전략: Product가 방향을 잡고, Observability가 측정한다.
학습: Mentor가 모르는 개념을 설명한다.

효율의 핵심:
"같은 파일을 동시에 건드리지 않고, 다른 영역은 병렬로 진행한다."
```
