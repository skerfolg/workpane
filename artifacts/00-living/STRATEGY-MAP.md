# WorkPane Strategy Mind Map

전략 토의 과정에서 생성된 모든 문서의 관계를 마인드맵 형태로 관리한다.

---

## 핵심 방향성

> "AI가 AI 에이전트를 분석하고, 개발자의 감독을 돕는 터미널 환경"

---

## 문서 맵

```
WorkPane 전략
│
├── [시스템 정의서](system-definitions.md)
│   ├── 세션 모니터링 시스템 — 멀티플렉서 통합 감독, LLM 필수
│   ├── 승인 감지 시스템 — ⚠ 원안(OS 프로세스 99%)은 M1 fail-and-rescope로 superseded. 현 truth: Windows `stalled candidate detection + LLM 분류 + no-API fallback` (아래 결정 사항 line 145 참조)
│   ├── LLM 통합 시스템 — 로그인된 에이전트 API 활용, 필수
│   └── 터미널 멀티플렉서 — 기존 핵심, 모니터링의 UI 기반
│
├── 전략 (To-Be)
│   └── [전략 캔버스](../10-reference/strategy/workpane-strategy-canvas-2026-04-03.md)
│       ├── Vision — AI가 AI를 감독하는 것을 돕는 터미널 환경
│       ├── Target Segments — AI 에이전트 헤비 유저 (1순위)
│       ├── Value Propositions — 입력 대기 감지, 멀티 에이전트 모니터링
│       ├── Trade-offs — 편집 투자 포기, 오탐 허용
│       ├── Key Metrics — 일일 활성 터미널 세션 수
│       ├── Growth Engine — 커뮤니티 침투 → 워드오브마우스 → 생태계
│       ├── Core Capabilities — LLM 필수 통합, 승인 감지, 세션 모니터링
│       └── Defensibility — 니치 전문성 + LLM 기반 감독 로직 (기술적 해자)
│
├── 세부 토의
│   ├── [승인 감지 99% 적중률 브레인스토밍](../10-reference/strategy/brainstorm-approval-detection-99-2026-04-03.md)
│   │   ├── 문제: 텍스트 패턴 의존 → 외부 스킬/TUI 프롬프트 미감지 (L1 API 프로토콜 보류)
│   │   ├── #1 OS 프로세스 상태 조회 (ground truth) → 기술 검증 완료, 구현 가능
│   │   ├── #2 PTY Foreground Process 추적
│   │   ├── #3 출력 속도 변화 감지 (미분 분석)
│   │   ├── #4 에이전트 프로세스 핑거프린팅 → Quick Win
│   │   ├── #5 계층적 신뢰도 시스템 (가중 합산)
│   │   ├── #6 패시브 학습 피드백 루프
│   │   ├── #7 신뢰도 기반 차등 알림 UX → Quick Win
│   │   └── #8 원클릭 피드백 → 극히 드물게만 (빈번하면 불쾌)
│   │
│   ├── [칸반 → 세션 모니터링 (멀티플렉서 통합)](../10-reference/strategy/brainstorm-kanban-context-tracker-2026-04-03.md)
│   │   ├── 추적 단위: 작업 → 세션으로 전환 (작업 경계 자동 감지 불가)
│   │   ├── UI: 칸반 보드 폐기 → 멀티플렉서에 모니터링 통합
│   │   ├── 패널 헤더: 세션 제목(첫 프롬프트) + 에이전트명 + LLM 요약
│   │   ├── 패널 테두리: 상태별 색상 (활성/승인 대기/에러/종료)
│   │   ├── 승인 대기 오버레이: 반투명 배너 + LLM 맥락 분석
│   │   ├── 그룹 헤더/탭: 집계 상태 표시
│   │   ├── 세션 타임라인: 헤더 클릭 시 상세 이벤트 로그
│   │   ├── 대기열: 유일한 수동 영역 (사이드바 경량 목록)
│   │   └── 기존 칸반 컴포넌트 폐기 대상 정리 완료
│   │
│   ├── [LLM 필수 통합](../10-reference/strategy/brainstorm-llm-integration-2026-04-03.md)
│       ├── 결정: LLM을 선택 아닌 필수로 (타겟 사용자는 이미 API 키 보유)
│       ├── 초기 설정: 로컬 API 키 자동 감지 + 사용자 확인
│       ├── 활용: 승인 맥락 분석, 에러 분석, 충돌 감지, 작업 요약/리포트
│       ├── 모델 선택: 경량 모델(Haiku/mini) 기본, 비용 $0.50/일 미만
│       └── 보안: 로컬 저장 (OS 자격증명 관리자), 서버 없음
│   │
│   └── [세션 모니터링 UI 설계](../10-reference/strategy/design-session-monitoring-ui-2026-04-03.md)
│       ├── 전체 레이아웃 (TitleBar → GroupTabs → GroupHeader → Panels → StatusBar)
│       ├── 그룹 탭: 상태 도트 + 펄스 애니메이션
│       ├── 그룹 헤더: 집계 표시 + 레이아웃 프리셋
│       ├── 패널 헤더: 2행 (제목+에이전트+시간 / LLM 요약)
│       ├── 패널 테두리: 왼쪽 3px 상태 색상선
│       ├── 승인 오버레이: 불투명 카드 + LLM 맥락 분석
│       ├── 에러 오버레이: 낮은 우선순위, 반복 시 강조
│       ├── 세션 타임라인: 헤더 클릭 → 슬라이드 다운
│       ├── 대기열: 사이드바 경량 목록 + 최근 완료
│       ├── 미션 컨트롤: 전체 조망 오버레이 (Ctrl+Shift+M / 액티비티바🎯 / 헤더버튼)
│       ├── 액티비티바: 🎯 미션컨트롤 + 📋 대기열 + 승인 대기 뱃지
│       ├── 상태 전이도: 유휴 → 활성 → 승인대기/에러 → 종료
│       └── 정보 계층: 8단계 (상태바 → 뱃지 → 탭 → 미션컨트롤 → 헤더 → 패널 → 오버레이 → 타임라인)
│
├── [기능 범위 확정](../10-reference/strategy/feature-triage-2026-04-03.md)
│   ├── 유지+강화: 터미널 멀티플렉서, 승인 감지, 알림, 워크스페이스
│   ├── 유지: 설정/테마, 내장 브라우저, i18n, 업데이트, 복구, 파일 감시, API, 커맨드팔레트
│   ├── 축소: 에디터 (패널 내 탭 뷰어로), 검색, 파일 탐색기
│   └── 폐기: 칸반, 문서/이슈, 프롬프트 생성, 스킬 (~2,902줄 절감)
│
├── 로드맵
│   ├── [v1.0 로드맵](roadmap-v1.0-2026-04-08.md) — Deep Interview 반영 업데이트
│   │   ├── Phase 0 Spike: Windows PoC + GitHub Actions 빌드
│   │   ├── A. 엔진 (L1 플랫폼 차등 + L2 멀티 provider fallback + 비용 대시보드)
│   │   ├── B. UI (패널 헤더/테두리/승인 오버레이/그룹 탭+헤더)
│   │   ├── C. 기능 트리아지 실행 (~2,902줄 제거)
│   │   ├── D. LLM 컨텍스트 스위칭 → 파일 탭 자동 정리
│   │   ├── E. 테스트 (합성 시나리오 + 3 단위 + 1 E2E 스모크)
│   │   ├── F. 빌드 (GitHub Actions, 코드 서명 후순위)
│   │   ├── G. 마이그레이션 (새 출발, %APPDATA%/WorkPane)
│   │   └── H. 법무 (동의 화면만, 정식 문서 이월)
│   │
│   └── [v1.1 로드맵](roadmap-v1.1-2026-04-08.md)
│       ├── E. 대기열 사이드바 + 최근 완료
│       ├── F. Mission Control + 레이아웃 프리셋
│       ├── G. 세션 기록 (이벤트 로깅 + 타임라인 + 리포트)
│       └── H. 고급 분석 (충돌 감지 + 규칙 자동화)
│
├── 구현 준비 검증
│   ├── [Deep Interview 스펙 (2026-04-08)](../../.omc/specs/deep-interview-roadmap-review-2026-04-08.md)
│   │   ├── 9 라운드, 최종 ambiguity 8.6% (임계값 20%)
│   │   ├── 온톨로지 13 엔티티, Round 8부터 100% 수렴
│   │   ├── Contrarian (R4), Simplifier (R6) 챌린지 모드 적용
│   │   ├── 9개 핵심 결정 (측정/플랫폼/감지/LLM/빌드/테스트/장애/마이그레이션/법무)
│   │   └── Deferred: 코드 서명, 정식 PRIVACY/TERMS, 80% 커버리지, 로컬 모델
│   │
│   ├── [Ralplan M0 합의 플랜 (2026-04-08)](../../.omc/plans/ralplan-m0-phase0-spike-2026-04-08.md)
│   │   ├── 3 iterations, Architect+Critic APPROVE
│   │   ├── Tri-state gate (<40 stop / 40-60 reduced / >60 full)
│   │   ├── PowerShell Get-CimInstance (1s 폴링), per-CLI 리포팅
│   │   └── 40% 근거: Gemini 1500req/day ÷ 1s = 15h/day 상한
│   │
│   └── [계획 진행 추적기 (2026-04-08)](planning-progression-2026-04-08.md)
│       ├── 4단계 모델: 로드맵 → Deep Interview → Ralplan → 실행
│       ├── 현재 상태 매트릭스 (`M3` Slice 1~5 완료, `M4` next, `M5` unblocked)
│       ├── 단계적 ralplan 실행 계획 (`M1 -> M1b -> M2 -> M3 -> M4/M5` 전이 규칙 반영)
│       └── M4 기능 트리아지는 M0와 병행 가능 (독립적)
│
├── 결정 사항
│   ├── [✓] 큰 방향: "AI가 AI를 감독하는 것을 돕는 터미널 환경"
│   ├── [✓] LLM 통합 필수 (선택 아닌 필수)
│   ├── [✓] 추적 단위: 작업이 아닌 세션
│   ├── [✓] 칸반 보드 UI 폐기 → 멀티플렉서에 모니터링 통합
│   ├── [✓] 세션 제목: 첫 프롬프트 기반 (C안)
│   ├── [✓] 기능 범위 확정 (유지+강화/유지/축소/폐기 4단계)
│   ├── [✓] 내장 브라우저 유지 (에이전트 디버깅 + 감독 가치)
│   ├── [✓] 에디터 축소 (고정 영역 폐기 → 패널 내 탭 뷰어)
│   ├── [✓] LLM 컨텍스트 스위칭 감지 시 파일 탭 자동 정리
│   ├── [⚠ superseded] 승인 감지 원안: 2단계 파이프라인 (L1 OS프로세스 → L2 LLM분석) — M1 fail-and-rescope로 L1 OS축 영구 기각 (line 145/146 참조). 신규 축은 세부 토의 (추가) L0 / 유휴 휴리스틱 / 우선순위 분석 노트 참조
│   ├── [✓] LLM 인증: API 키만 (OAuth 불가 확인), 무료 API 우선 안내 (Gemini/Groq)
│   ├── [✓] LLM 모델 목록: API에서 동적 로드 (하드코딩 안 함)
│   ├── [✓] 버전: 방향성 확정 후 v1.0.0부터 재시작
│   ├── [✓] v1.0 / v1.1 로드맵 확정 (v1.1까지 모든 결정사항 반영)
│   ├── [✓] 플랫폼: Windows + macOS + Linux 정식 지원 (Windows L1 약점은 L2 보완)
│   ├── [✓] 성공 지표: Linux/macOS 99%, Windows 90% (합성 시나리오 CI + release 피드백)
│   ├── [✓] LLM fallback: 멀티 키 체인 + 전멸 시 L1 단독 + 비용 대시보드
│   ├── [✓] 빌드: GitHub Actions 3플랫폼, 코드 서명은 개발 완료 후
│   ├── [✓] 테스트: 합성 시나리오 CI + 3 단위 + 1 E2E 스모크 (80% 룰 미적용)
│   ├── [✓] 마이그레이션: 없음, %APPDATA%/WorkPane 동일 폴더
│   ├── [✓] Windows claim narrowing: `L1` stalled candidate detection + optional `L2` classification + `no-API` fallback
│   ├── [✓] `M1`은 historical failed-evaluation lane, 다음 planning lane은 `M1b Windows supervision foundation`
│   ├── [✓] superseded assumption: `M1 detector rerun -> M2`를 기본 경로로 사용하지 않음
│   ├── [✓] Linux/macOS 목표는 Windows correction 때문에 낮추지 않음
│   ├── [✓] canonical `M1b` contract surface는 [시스템 정의서](system-definitions.md)
│   ├── [✓] `M2` 구현 완료 — safeStorage + provider adapters + settings/dashboard + graceful degrade
│   ├── [✓] `M3 Slice 1` 완료 — current monitoring UI integration
│   ├── [✓] `M3 Slice 2` 완료 — sidebar discoverability
│   ├── [✓] `M3 Slice 3` 완료 — panel-local transition log
│   ├── [✓] `M3 Slice 4` 완료 — app-wide in-session workspace chronology feed
│   ├── [✓] `M3 Slice 5` 완료 — terminal-local sidebar live attention queue
│   ├── [✓] OpenAI live smoke: model enumeration 성공, real classify는 quota blocked, app-path degrade 확인
│   ├── [✓] 법무: v1.0은 명시적 동의 화면만, 정식 PRIVACY/TERMS는 이월
│   ├── [✓] 주 사용 CLI 분포: Type B (CC 50% / Codex 30% / Gemini 15% / 기타 TUI 5%). 승인 감지 축 Option 선택의 입력값. Option D (L0 only) 탈락 확정
│   ├── [✓] 기타 TUI 5% = 범위 포기. L0 / 유휴 휴리스틱 어느 축도 5% 커버를 성공 기준에 포함 않음 (Option B 논거 약화)
│   ├── [✓] Codex·Gemini CLI L0 동등 API 존재 확인: Codex `--json` + `PreToolUse` hook, Gemini `--output-format stream-json` + hook v0.26.0+. 세 CLI 모두 L0 네이티브 지원
│   ├── [✓] 승인 감지 권장 Option = A (L0 먼저). 95% 커버 단일 축 완결. ralplan 진입 시 "3-CLI adapter 계약"에 범위 집중. 유휴 휴리스틱은 L0 관찰-only 축소 시 복귀 조건부
│   ├── [✓] M1b contract 재조정 = Option R2 (M1c 신규 lane). M1b는 historical 유지, L0 adapter 작업은 `M1c CLI adapter layer`로 귀속. `system-definitions.md`에 M1c 섹션 신설 완료
│   ├── [✓] `system-definitions.md:89-92` 정정 = superseded 마킹 (제거 아님). OS 프로세스 "기술 검증 완료" 원문 보존 + 경고 블록 상단 배치. 재발 방지 목적
│   ├── [✓ 2026-04-22] M1c-scoped 보류 제약 해제 (B안 채택). 근거: M1c는 핵심 방향성(#125) + Windows narrowing 결정 chain(#145-149)의 자연스러운 다음 단계로 신규 방향성 결정 아님. 범위: planning + ralplan consensus까지. 실행(team/ralph)은 별도 승인 필요. 다른 lane은 CLAUDE.md 일반 보류 유지
│   ├── [✓ 2026-04-22] M1c scope 축소 = Synthesis-A (Path B) 채택. 근거: ralplan iteration 1에서 Architect+Critic 모두 동일 권고 (Type B 분포 미측정, hook IPC 정당화 부재, 12+ revisions 필요). 결정: M1c는 **Claude Code stdout-only**로 narrow. CC hook ingress(`M1c-d1`) / Codex(`M1c-d2`) / Gemini(`M1c-d3`)는 evidence-driven deferred sub-lanes. Common adapter abstraction은 future-extensible 하게 설계 유지
│   ├── [✓ 2026-04-23] `M1c` 구현 완료 — Slice 0~3 모두 green. build/unit 101/e2e 30/perf p95=0.042ms. 3-perspective validation 모두 APPROVE post-patch. 결과: [m1c-implementation-result-2026-04-23.md](../20-milestones/v1.1.0/M1c/m1c-implementation-result-2026-04-23.md). 다음: 운영 telemetry 수집 후 sub-lane 진입 평가
│   ├── [✓ 2026-04-23] **WorkPane 포지셔닝 확정**: 터미널 멀티플렉서 (CLI의 TUI를 있는 그대로 호스팅하고 외부에서 감독 신호 제공). 엔진의 대체 UI 아님. [CHARTER §1](CHARTER.md). 근거: M1c 사후 분석에서 stdout-only 축이 대화형 TUI 포기를 전제함이 드러났고, 사용자가 "WorkPane은 TUI 호스트이지 엔진 대체 UI 아님" 을 명시 확정
│   ├── [✓ 2026-04-23] **방향성 드리프트 방지 3층 메타-프로세스 도입**: Layer 1 Charter(불변 앵커) + Layer 2 Ralplan Gate(Entry/Exit Charter audit) + Layer 3 Post-impl Re-check(Runnable Procedure 실행 + 증거). 근거: M1c 드리프트(포지셔닝 모호 → 암묵 narrowing → 구현후 미검증)의 3개 실패 지점에 1:1 대응. 산출: [CHARTER.md](CHARTER.md) + [post-impl-charter-recheck-template.md](post-impl-charter-recheck-template.md) + [ralplan](../../.omx/plans/ralplan-charter-drift-prevention-2026-04-23.md)
│   ├── [⚠ 2026-04-23] **M1c 사후 재분류**: `infrastructure-complete / journey-untriggerable` 로 분류. L0 파이프라인·telemetry·UI 배지 인프라는 완성(fixture replay 30/30 green)됐으나 WorkPane 포지셔닝 하에서 Sacred Journey #1 (대화형 CLI 감시)을 트리거할 실 경로 부재. 원인: (a) stream-json은 `-p` 비대화형 모드 필요 = TUI 포기 필요 = 포지셔닝 위반 (b) Windows 직접 spawn 시 stdio가 PTY에 도달 안 함. L0 인프라는 보존 상태로 archived-pending-hook-ingress. Sunset Clause 타이머 시작 (CHARTER §7.2, 2 ralplan cycles 후 deprecation review)
│   ├── [✓ 2026-04-23] **Charter §2.6 TUI 경계 조항 신설** (Amendment #1): "WP는 PTY 스트림을 READ-ONLY로 다룸, UI 엘리먼트는 PTY 스트림 외부 WP 프레임 레이어에만 존재, 시각적 구분 필수". 근거: deep-interview 3 rounds 5.75% ambiguity, M3 기구현(overlay/badge/border)의 정합 여부 암묵 해석 드리프트 방지. Amendment Ritual 4단계 완료 (사용자 명시 요청 + Appendix A 기록 + 영향 범위 분석 완료 + 본 결정사항 기록). 산출: [CHARTER §2.6](CHARTER.md) + [deep-interview spec](../../.omc/specs/deep-interview-charter-amendment-tui-boundary-2026-04-23.md). 잔여 방향성 검토 항목 3건(#dir-1 감독 깊이 / #dir-2 플랫폼 parity / #dir-5 경쟁 포지셔닝)은 다음 세션으로 이연. 구(舊) #3 수익 모델 / #4 사용자 세그먼트 실측은 본 프로젝트 범위 밖으로 사용자 판단 (2026-04-23)
│   ├── [✓ 2026-04-16] **M7a Execution-Surface Boundary** Completed: `executionLanes[]` authoritative state 도입, direct-HTTP/API-key 동작 유지, fallback ordering lane 기반 이동. [m7a status](../../docs/m7a-execution-surface-boundary-status.md)
│   ├── [✓ 2026-04-17] **M7b OpenAI Official-Client Bridge** 완료 (first live provider). [m7b status](../../docs/m7b-openai-official-client-bridge-status.md)
│   ├── [✓ 2026-04-17] **M7b.1 lane-native surface cleanup** 완료. [m7b.1 status](../../docs/m7b-1-lane-native-surface-cleanup-status.md)
│   ├── [✓ 2026-04-17] **M7c Gemini Official-Client Bridge** 완료 (second live provider). [m7c status](../../docs/m7c-gemini-official-client-bridge-status.md)
│   ├── [✓ 2026-04-17] **v1.0.0 development scope CLOSED** (feature-complete, publish 미완): `M5` / `M6` blocked handoff + `M7a` / `M7b` / `M7b.1` / `M7c` 모두 완료. Remote tag governance + quota LLM smoke + macOS/Linux manual QA는 release-ops blocker로 이연. [v1.0.0 closure](../../docs/v1.0.0-closure-status.md)
│   ├── [✓ 2026-04-17] **v1.1.0 narrowed scope (E+F1+G1+G2) checkpoint 완료**: main-owned `HistoryStore` (SQLite/JSON fallback) + Mission Control F1 overlay + 세션 timeline persistence + manual task CRUD + sidebar queue union(live+manual+recent). [v1.1.0 start](../../docs/v1.1.0-implementation-start-status.md)
│   ├── [✓ 2026-04-20] **F2 Mission Control layout presets** 완료: per-group 2col/2row/2x2 presets + mixed-content safety (browser-containing groups은 preset-ineligible). [F2 status](../../docs/f2-mission-control-layout-presets-status.md)
│   ├── [✓ 2026-04-20] **v1.1.0 post-checkpoint hardening** 완료: `HistoryStore` backend selection/fallback 강화 (`sqlite` / `json_fallback` / `memory`), Mission Control degraded-state surfacing, 확장된 검증 coverage. [hardening](../../docs/v1.1.0-post-checkpoint-hardening-status.md)
│   ├── [✓ 2026-04-23] **Charter Amendment #2 — `#dir-1` 감독 깊이 확정**: 범위 L-insight 까지 (L-state 상태 알림 + L-summary 세션 요약 + L-insight 대화 분석·충돌 감지 제안). L-automation(자동 개입)은 §2 Non-Goal #6 으로 배제 — "감독자는 제안, 사용자는 결정". 영향: v1.1 deferred `G3`/`H1` Charter 정합, `H2` 는 제안-수준으로 재설계 필요. [CHARTER §2 Non-Goal #6 + §4 Glossary 감독](CHARTER.md)
│   ├── [✓ 2026-04-23] **Charter Amendment #3 — `#dir-2` Platform Parity 확정**: Feature parity 강제 — 모든 Sacred Journey 가 Windows/macOS/Linux 에서 §3 Runnable Procedure 통과 의무. 플랫폼별 구현 경로는 상이 허용, **사용자가 보는 기능 깊이는 동일**. 귀결: `#lane-1` M1c-d1 (CC hook ingress) 이 **Windows Platform Parity 복구 수단**으로 우선 진입 대상 승격 (방향성 결정 후 ralplan). 기존 결정 #140 "99/90 수치 지표" 는 feature parity 하위의 세부 정밀도 지표로 재해석. [CHARTER §3.4 + §7.1 업데이트](CHARTER.md)
│   ├── [✓ 2026-04-23] **Charter Amendment #4 — `#dir-5` 경쟁 포지셔닝 확정**: §1 Positioning 에 차별 강점(defensibility) 한 줄 추가 — "엔진-중립 + 멀티 엔진 동시 감독 + 구조화 이벤트 기반, 외부 관찰자 구조". §2 Non-Goal #7 추가 — "자체 AI assistant 내장 금지" (Warp 스타일 내장 AI chat 저촉). 향후 내장 chat UI 제안은 §2 #7 으로 즉시 REJECT 가능. [CHARTER §1 + §2 #7](CHARTER.md)
│   ├── [✓ 2026-04-23] **`#pol-1` 세션 데이터 retention 정책 확정**: 사용자 설정 가능 + 기본 무제한. 설정 UI에서 retention 기간(일)/크기(MB) 선택 가능, 주기적 pruning. 기본값 무제한은 데이터 주권 우선. Charter 변경 불필요(정책 영역). 구현은 v1.2+ candidate lane (HistoryStore pruning + 설정 UI 필드 추가)
│   ├── [✓ 2026-04-23] **`#pol-2` Sacred Journey 성능 SLO 정책 확정**: Evidence 기반 설정 — 현 시점 수치 SLO 미정, 측정 도구 준비 우선. Phase 1: 각 Journey 에 perf 측정 인프라 추가 (`tests/perf/` 확장 또는 별도 lane). Phase 2: 운영/테스트 데이터 수집. Phase 3: p95 수치 SLO 설정 후 Charter §7 Re-check에 추가. 기존 M1c L0 p95 ≤ 200ms 는 infrastructure level 로 유지. v1.2+ candidate lane
│   ├── [✓ 2026-04-23] **`#pol-3` 접근성 공식 commitment 확정**: Journey 별 차등 — Sacred Journey 3개 (J1 대화형 CLI 감시 / J2 멀티 CLI 병렬 감시 / J3 세션 타임라인) 는 WCAG 2.1 AA 공식 준수, 그 외 UI 는 best effort. 근거: Journey 중심 포지셔닝과 정합, 구현 부담 현실적. Charter §7 Re-check 에 "해당 Journey 의 접근성 검증 (키보드 탐색·색 대비·ARIA·스크린 리더)" 항목 추가 검토. 구현: v1.2+ accessibility-audit lane
│   ├── [✓ 2026-04-23] **`#pol-4` i18n 공식 지원 언어 확정**: ko + en 이중 지원. 기타 언어는 미공식 (커뮤니티 PR 이 들어오면 허용 가능하나 공식 품질 보장 대상 아님). 근거: 프로젝트 creator 한국어 사용 + 글로벌 최소 영어. 구현: 기존 `i18next` 구성 유지, 번역 누락 감지 CI 추가 검토 (v1.2+ i18n-hardening lane)
│   ├── [✓ 2026-04-23] **`#pol-5` 자동 업데이트 정책 확정**: 자동 감지 + 백그라운드 다운로드 + 재시작 시 사용자 동의 설치 (표준 Electron 패턴). 근거: UX 매끄러움 + 사용자 동의 지점 유지. 구현: 기존 `electron-updater` 활용, Settings에 "자동 체크 끄기" 옵트아웃 옵션 추가 검토 (v1.2+). 강제 업데이트는 하지 않음 (critical security 도 동의 요구)
│   ├── [✓ 2026-04-23] **`#pol-6` 엔진 CLI 버전 호환성 대응 확정**: Reactive 방침 — fingerprint mismatch 감지 시 (1) L0 degrade 경로 자동 전환 (2) 사용자 DP-2 배지에 "heuristic only" 표시 (3) 텔레메트리 로그 기록 (4) 개발자 수동 fixture 재캡처 + adapter 업데이트 리뷰. Proactive CI 자동 재생성 은 투자 대비 효율 낮아 미채택. 근거: 현 M1c 구현(fingerprint invariant + degrade fallback)과 직결, 추가 인프라 불필요
│   ├── [✓ 2026-04-23] **`#pol-7` Electron sandbox:false 대응 확정**: v1.2+ candidate lane 으로 이연. 지금은 accepted risk 상태 유지 (pre-existing Security H-2). 별도 ralplan 에서 정밀 평가 — (a) sandbox:true 전환 가능 범위 조사 (b) renderer/preload audit (c) 회귀 테스트 준비. 조기 전환 시 회귀 위험 우려로 deferred
│   ├── [✓ 2026-04-23] **`#pol-8` LLM 전송 데이터 privacy 방침 확정**: Opt-in 확장 — 기본 Minimum Necessary (해당 turn approval text + last N lines context + redaction 자동 적용), 설정에서 "확장 context 허용" 옵트인 가능. 세션 종료 시 외부 데이터 폐기는 provider 정책에 위임. 기록: 전송 요약(데이터 size + timestamp)을 로컬 텔레메트리에만 저장, 실 내용은 미저장. 철회권: 외부 API 가 제공하는 기능에 의존 (별도 구현 안 함). 구현: v1.1.x 또는 v1.2+ privacy-hardening lane
│   ├── [✓ 2026-04-23] **`#lane-1` M1c-d1 CC hook ingress 진입 timing 확정**: **다음 세션 ralplan 진입**. 본 세션은 순차 결정 완료 후 종료. 다음 세션에서 M1c-d1 만을 위한 ralplan 집중 수행 (Platform Parity 복구 수단 + Windows L0 live 경로 확보). 진입 시 참조 문서: CHARTER §3.4 + §7.1 + Amendment #3 + M1c result §11 post-hoc Re-check FAIL
│   ├── [✓ 2026-04-23] **`#lane-2` + `#lane-3` M1c-d2/d3 (Codex + Gemini) adapter 통합 진입 확정**: `#lane-1` 에 흡수 — d1 + d2 + d3 를 **단일 통합 ralplan "L0 engine adapter expansion"** 으로 묶어 병행 진입. 근거: Common adapter abstraction (M1c Slice 1) 이 future-extensible 로 설계됐으므로 3 엔진 공통 뼈대 위에서 작은 공수로 확장 가능. Platform Parity (Amendment #3) 에 따라 **3 엔진 × 3 플랫폼 매트릭스 검증** 의무. 구조: 공통 hook socket + 엔진별 schema adapter (CC/Codex/Gemini 각각 fingerprint invariant) + 통합 L0 pipeline. 다음 세션 ralplan 에서 #lane-1 timing 에 포함하여 진행
│   ├── [✓ 2026-04-23] **`#lane-4` v1.1 deferred G3/H1/H2 진입 확정**: **G3 (세션 기록 확장) + H1 (충돌 감지)** 은 v1.2 scope 로 진입 (Charter L-insight 범위 정합). **H2 (규칙 자동화)** 는 보류 — 기존 "자동 개입" 형태로는 §2 Non-Goal #6 위반, "제안 수준" 재설계 필요한데 이 재설계 여부 자체를 본 세션에서 결정하지 않음. v1.2 진행 후 별도 결정. 진입 순서/우선순위는 v1.2 roadmap 세션에서 확정
│   ├── [✓ 2026-04-23] **`#lane-5` v1.1 broader Mission Control 확장 확정**: F2 로 충족 — 추가 preset families (1x1/3x2/NxM) 과 browser-safe remapping **공식 확장 안 함**. 현재 3종 presets (2col/2row/2x2) + mixed-content safety 가 v1.x lifecycle 내 Mission Control 범위. 향후 사용자 요구 누적 시 별도 재평가 가능하나 기본 방침은 "F2 로 finalized"
│   ├── [✓ 2026-04-23] **`#ops-1` live smoke 제공자 전략 확정**: **복합 검증** — (1) primary 유료 provider (Anthropic 또는 OpenAI paid tier) 로 real `source=llm` classify 성공 smoke (2) 무료 provider (Groq/Together AI/Mistral 중 하나) 로 fallback path smoke. 둘 다 수행 성공이 release gate. Action: 사용자가 API key 확보 진행 (paid + 무료 각 1종). Release 직전 M6 체크리스트에 포함
│   ├── [✓ 2026-04-23] **`#ops-2` + `#ops-3` + `#ops-4` cross-platform QA + pre-tag install smoke 수행 방식 확정**: **GitHub Actions 자동화** — macOS/Linux manual QA + pre-tag package install/open smoke 모두 GitHub Actions 워크플로우로 자동 수행. 3 플랫폼 (Windows/macOS/Linux) 빌드 → install → open → 기본 Sacred Journey 재연 → screenshot/log artifact 저장. 사용자 수동 QA 는 CI 실패 시 샘플링만. v1.1.0 post-checkpoint hardening status 의 "GitHub Actions 위임" 결정과 정합. 구현: `.github/workflows/release-qa.yml` 신설 (release-ops lane)
│   ├── [✓ 2026-04-23] **`#ops-5` 원격 `v1.0.0` tag governance 확정**: **기존 v1.0.0 삭제 + 재생성**. Pre-condition: (1) 재생성 대상 commit 명시적 사용자 approval (2) 외부 참조자 사전 공지 (현 시점 외부 사용자 없으면 skip 가능) (3) force push 전 local verify: `git tag -l v1.0.0` + `git push origin --delete v1.0.0` 후 clean commit 에서 `git tag v1.0.0` + `git push origin v1.0.0`. 관련 GitHub release (404) 도 재생성. Release 직전 M6 체크리스트 항목
│   ├── [✓ 2026-04-23] **`#ops-6` clean RC commit 준비 확정**: **이연** — release 직전 별도 cleanup 세션에서 해결. 본 세션 종료 시점의 dirty 상태는 commit push 전까지 관용. Release 준비 lane 진입 시점에 누적 변경을 구조화 commit + RC branch 분기. 근거: 현 시점 release 준비 단계 아님, 본 세션 범위 밖
│   ├── [✓ 2026-04-23] **`#m1c-1` Plan deviation #1 재평가 확정**: **M1c-d1 통합 ralplan 에서 재평가** — hook ingress lane 에서 L0 event dedup 로직 재설계 시, 기존 `lastL0SilenceAt` 500ms window 개념을 포함하여 통합 검토. 독립적 data collection lane 불요 (hook 기반에서 더 정확한 데이터 자연 확보). M1c stdout 축은 journey-untriggerable 로 dedup 자체가 moot 이므로 `#lane-1` 진입 시까지 pending
│   ├── [✓ 2026-04-24] **`M1c-d1` Slice 0 spike 완료 + 아키텍처 확정**: Windows 실측 완료 — **Option A (Hook IPC) = Primary** (6/6 events 실발화, PreToolUse payload 에 `tool_name`/`tool_input`/`session_id` 모두 존재, synchronous real-time 확인). **Option E (Session Log Tailing) = Fallback/Default** (tool_use 데이터 존재하나 latency p95=972ms 로 real-time 불충분, 이력·요약 용도로 사용). 아키텍처: **A → E → L1 heuristic** 3-layer fallback chain. Option E 가 default 인 이유: 설치 action 불요·zero cost (Option A 가 사용자 동의/OS 제약으로 사용 불가 시 자연 degrade). macOS/Linux 는 CI matrix 로 별도 검증. Slice 0 산출물: [ralplan-m1c-d1-slice-0-spike-2026-04-24.md](../../.omx/plans/ralplan-m1c-d1-slice-0-spike-2026-04-24.md) + worktree `spike/m1c-d1-slice-0` + spike-results/go-no-go-report.md. Parent plan v3 반영: [ralplan-m1c-d1-cc-hook-ingress-2026-04-23.md](../../.omx/plans/ralplan-m1c-d1-cc-hook-ingress-2026-04-23.md)
│   └── [✓ 2026-04-27] **`M1c-d1` CC Hook Ingress 구현 완료 + Sacred Journey 1 Windows PASS 복구**: 37 commits merged to `main` (`5c26cf7`). Slice 0 spike → Slice 1 (1A-1F adapter+selector+L1 port) → Slice 2 Phase 1 (2A-2E version detector+installer+IPC+UI) → Slice 2 Phase 2 (RW-A~F runtime wiring with per-terminal HookServer + tailer pool + 3-tier dedup + cc-bridge + extraResources packaging) → 3-perspective code review (12 findings 모두 해소) → smoke-driven follow-ups (canonical hook schema fix `726d5b3` + best-effort banner auto-detect `9768e54` + explicit vendor selection UI `f1f8e38`). **Manual smoke (Windows 11)**: cc-bridge `dispatched ok=1` 8회 + Per-terminal breakdown UI 등장 + L0-A `vendor event · high precision` 알림 채널 정상. **Charter Re-check 결과 PASS** (Sacred Journey 1 / 7 steps 모두 PASS, recheck doc 참조). 결과: `M1c` 의 Windows journey-untriggerable 분기 PASS 회복 → §7.2 Sunset Clause 타이머 정지. 산출: [m1c-d1-implementation-result-2026-04-27.md](../20-milestones/v1.1.0/M1c/m1c-d1-implementation-result-2026-04-27.md) + [recheck-2026-04-27.md](../20-milestones/v1.1.0/M1c/recheck-2026-04-27.md). Out of scope (별도 lane): macOS/Linux smoke (Charter §3.4 잔여 의무), robust banner auto-detect (CC TUI cell-painting 회복), L1 alert silencing (L0-A active 시 dim/dedup), Codex/Gemini vendor union 확장 + M1c-d2/d3
│
├── 미결정 사항
│   └── (2026-04-23 순차 결정 세션에서 기존 23건 모두 결정 완료 — 결정사항 섹션 참조. 새 미결정 발견 시 여기에 추가)
│
└── 세부 토의 (추가)
    ├── [노트: 구조 이벤트 수신 축 (2026-04-21)](../10-reference/strategy/note-structured-event-ingestion-2026-04-21.md)
    │   ├── CC `stream-json`·hook / Codex 이벤트 / stdio 외 사이드 채널
    │   ├── M1 실패(libuv+Ink 비동기)에 무관 — CLI가 자발 emit하는 구조
    │   └── 구현 보류, 방향성 확정 후 재검토
    │
    ├── [노트: 유휴 휴리스틱 miss 측정 축 (2026-04-21)](../10-reference/strategy/note-idle-heuristic-miss-measurement-2026-04-21.md)
    │   ├── stdin 유휴 + loose approval-like hint → HeuristicTrigger → LlmClassifier 통합
    │   ├── M1 기각(OS 프로세스 축)과 직교 — stdout 타이밍만 관찰
    │   ├── L0 노트와 상호보완 — L0=지원 CLI 정밀, 본 노트=전 CLI 근사 ground truth
    │   ├── 체감 기준 우선, MissLog는 보조 검증
    │   └── 구현 보류, 방향성 확정 후 L0와 우선순위 조율
    │
    ├── [노트: L0 vs 유휴 휴리스틱 우선순위 분석 (2026-04-21)](../10-reference/strategy/note-l0-vs-idle-heuristic-priority-2026-04-21.md)
    │   ├── 두 축 비교 (precision·recall·커버리지·구현 비용·M1 관계)
    │   ├── 시나리오별 적용 (CC단독 S1 / Multi-CLI S2 / External S3)
    │   ├── Option A/B/C/D 시퀀싱 + 결정 트리
    │   └── 결정 기록: Type B 확정 / 기타 TUI 포기 / Codex·Gemini L0 지원 확인 / Option A 권장
    │
    └── [노트: M1b contract 재조정 제안 (2026-04-21)](../10-reference/strategy/note-m1b-contract-rescope-proposal-2026-04-21.md)
        ├── Issue A: Option A가 현 "detector-only rerun out-of-scope"와 충돌
        ├── Issue B: system-definitions.md:89-92 OS 프로세스 "기술 검증 완료"가 M1 verdict과 모순 (stale)
        ├── Option R1 (M1b 확대) / R2 (M1c 신규 lane, 권장) / R3 (M1b 재정의)
        └── stale 정정 방식: 제거 vs superseded 마킹 (권장)
```

---

## 구현 순서 (Phase 정리)

```
Phase 0 (선행 없음)
  └── 대기열 (사이드바 경량 목록)

Phase 1 (핵심 엔진)
  ├── ⚠ OS 프로세스 상태 조회 (승인 감지) — REJECTED (M1 fail-and-rescope). 대체 축은 세부 토의 (추가) L0 / 유휴 휴리스틱 노트 참조
  ├── 에이전트 프로세스 핑거프린팅
  └── LLM API 연동 + 초기 설정 플로우

Phase 2 (멀티플렉서 UI 통합)
  ├── 패널 헤더 (제목 + 에이전트명 + 경과 시간 + LLM 요약)
  ├── 패널 테두리 색상 (상태별)
  ├── 승인 대기 오버레이 (+ LLM 맥락 분석)
  ├── 그룹 헤더 집계
  └── 그룹 탭 상태 아이콘

Phase 3 (세션 기록 + 분석)
  ├── 이벤트 로깅 + 세션 타임라인 뷰
  ├── 작업 완료 리포트 (LLM)
  ├── 크로스 세션 충돌 감지
  └── 규칙 기반 승인 자동화
```

---

## 문서 추가 규칙

1. 새 문서 생성 시 이 맵의 적절한 위치에 링크를 추가한다
2. 카테고리: `분석`, `전략`, `세부 토의`, `미결정 사항`, `결정 사항`
3. 문서 간 관련성이 있으면 `관련 문서:` 헤더로 상호 참조한다
4. 결정이 내려지면 `미결정 사항`에서 `결정 사항`으로 이동한다
