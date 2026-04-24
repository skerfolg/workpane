# WorkPane (PromptManager)

## 프로젝트 방향성

현재 프로젝트 방향성 결정 단계에 있음. **방향성이 확정될 때까지 새 기능 구현이나 대규모 리팩터링을 진행하지 않는다.**

핵심 포지셔닝 (확정 2026-04-23, [CHARTER §1](artifacts/00-living/CHARTER.md)): **WorkPane은 터미널 멀티플렉서다. CLI 도구(claude, codex 등)의 TUI를 있는 그대로 호스팅하고, 외부에서 감독 신호를 제공하는 도구이지, 엔진의 대체 UI가 아니다.**

## 전략 문서 관리 규칙

전략 토의 과정에서 생성되는 모든 문서는 마인드맵 형태로 관리한다.

- **인덱스**: `artifacts/00-living/STRATEGY-MAP.md` — 모든 전략 문서의 관계를 마인드맵으로 정리
- **문서 위치**: `artifacts/` 디렉토리
- **새 문서 생성 시 필수 작업**:
  1. `artifacts/` 에 문서를 저장한다
  2. `artifacts/00-living/STRATEGY-MAP.md`의 적절한 카테고리에 링크를 추가한다
  3. 관련 문서가 있으면 `관련 문서:` 헤더로 상호 참조한다
- **결정이 내려지면**: `미결정 사항`에서 `결정 사항`으로 이동한다
- **카테고리**: 분석, 전략, 세부 토의, 미결정 사항, 결정 사항

## Charter 준수 의무

프로젝트에 [artifacts/00-living/CHARTER.md](artifacts/00-living/CHARTER.md) (v0, 2026-04-23) 가 설치되어 있다. 이 문서는 WorkPane의 **불변 방향성 앵커**이며 STRATEGY-MAP.md보다 상위. §1~§4는 §5 Amendment Ritual 없이 변경 금지.

### Ralplan 수행 시

- Planner는 작업 시작 전에 `artifacts/00-living/CHARTER.md` 전문을 Read
- plan 문서에 **CHARTER §6.1 Entry Gate 섹션 필수 포함**: 관련 Positioning/Non-Goals/Journey 인용 + 암묵 전제 로깅
- plan 문서에 **CHARTER §6.2 Exit Gate 섹션 필수 포함**: Sacred Journey Re-enactment Evidence + Non-Goals 비위반 증명 + Glossary 용어 일관성
- Critic은 §6.3 Anti-Rubber-Stamp 규칙에 따라 구체성 없는 "aligned with Charter" 서술은 **REJECT**

### Milestone 완료 선언 전

- [artifacts/00-living/post-impl-charter-recheck-template.md](artifacts/00-living/post-impl-charter-recheck-template.md) 를 복사하여 수행
- 관련 Sacred Journey의 **Runnable Procedure를 실 환경에서 실행**
- 증거(스크린샷/로그) 첨부한 Re-check 결과를 milestone result doc에 첨부
- FAIL 시 `infrastructure-complete / journey-untriggerable` 로 분류, "완료" 마킹 **금지** (CHARTER §7)

### Charter 개정

- Claude/에이전트의 자의 개정 **금지**
- 개정은 사용자의 명시적 요청 + CHARTER §5 Amendment Ritual 이행 필수
- "이번만 우회" 도 금지
