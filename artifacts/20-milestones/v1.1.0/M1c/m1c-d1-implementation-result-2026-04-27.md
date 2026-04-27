# M1c-d1 CC Hook Ingress — Implementation Result

**Date**: 2026-04-27
**Lane**: `M1c-d1 Claude Code PreToolUse hook ingress` (Charter Amendment #3 Platform Parity 복구 lane, Windows-first)
**Plan chain**:
- [Slice 0 spike](../../../../.omx/plans/ralplan-m1c-d1-slice-0-spike-2026-04-24.md)
- [Slice 1+2 parent](../../../../.omx/plans/ralplan-m1c-d1-cc-hook-ingress-2026-04-23.md)
- [Slice 2 Phase 2 runtime wiring](../../../../.omx/plans/ralplan-m1c-d1-slice-2-runtime-wiring-2026-04-24.md)

**Branch**: `feat/m1c-d1-slice-1` → merged into `main` (commit `5c26cf7`)
**Execution mode**: ralplan + manual smoke + 3 parallel reviewers + smoke-driven follow-ups

---

## 1. Status

**M1c-d1 (CC Hook Ingress, Windows)**: ✅ **완료** (37 commits merged to `main`)

| Stage | 상태 | 산출 |
|---|---|---|
| Slice 0 spike (Option A vs E 실 캡처 + go/no-go) | ✅ | `D:\4. Workspace\PromptManager.worktrees\m1c-d1-slice-0-spike\spike-results\` (hook 6/6 events 캡처, session-log p95=972ms) |
| Slice 1 (1A-1F): adapter interface + Option A/E adapters + path selector + L1 classifier | ✅ | `src/main/l0/adapters/L0Adapter.ts`, `cc-hook-adapter.ts`, `cc-session-log-adapter.ts`, `l0-path-selector.ts`, `l1-classifier.ts` |
| Slice 2 Phase 1 (2A-2E): CC version detector + hook installer + path snapshot IPC + 3-state UI | ✅ | `cc-version-detector.ts`, `hook-installer.ts` (4-layer safety), `l0-orchestrator.ts`, `HookIngressSettings.tsx` |
| Slice 2 Phase 2 (RW-A~F): runtime wiring | ✅ | per-terminal HookServer + `SessionLogTailerPool` (per-cwd ref-counted) + `event-key.ts` (3-tier dedup) + `cc-bridge.js` + extraResources packaging + evidence-guarded stale check + e2e IPC smoke |
| Code review (3 parallel reviewers, 12 findings) | ✅ | commit `ffce998` — 1 CRITICAL (SessionEnd dead-code) + 2 HIGH (TS2459, non-null assertion) + 5 MEDIUM + 2 LOW + 2 NIT |
| **Smoke fix 1**: hook installer canonical array form | ✅ | commit `726d5b3` — `mergeHooks` 가 CC 표준 array 형식 (`{matcher, hooks: [{type, command}]}`)으로 작성 + legacy buggy object form self-heal |
| **Smoke fix 2**: vendor banner auto-detect | ✅ | commit `9768e54` — best-effort fallback (`tryAutoDetectClaudeVendor`) |
| **Smoke fix 3**: explicit vendor selection UI | ✅ | commit `f1f8e38` — `setVendor` IPC + HookIngressSettings 패널 input/button (primary path) |
| Manual smoke (Windows 11 dev mode) | ✅ | cc-bridge `ok=1` 8회 dispatch + per-terminal breakdown UI 등장 + L0-A vendor-event 알림 |

**Deferred sub-lanes** (별도 lane 진입 결정 필요):
- `M1c-d2` Codex CLI adapter (Slice 1+2 패턴 복제 후 vendor union 확장)
- `M1c-d3` Gemini CLI adapter (동일)
- **Robust banner auto-detect** (raw byte 캡처 후 OSC title / process-tree)
- **L1 alert silencing** (L0-A active 시 stream-classifier 알림 dim)

---

## 2. Acceptance criteria status

| # | 기준 | 결과 | 검증 |
|---|---|---|---|
| 1 | settings.json hook entry가 CC settings validator를 통과 | ✅ | Manual smoke — CC v2.1.119 가 정상 boot, settings 에러 dialog 사라짐 |
| 2 | Option A primary path: hook 발화 시 페이로드가 HookServer까지 도달 | ✅ | `/tmp/workpane-hook.log.2026-04-27` — `dispatched event=PreToolUse to 1 listeners (ok=1)` 8회 |
| 3 | Option E fallback: session-log tailer가 같은 페이로드를 catch + dedup | ✅ | `tests/unit/l0-rw-c.spec.ts` (cross-source 3-tier dedup) |
| 4 | Path selector deterministic (hook_installed × hook_fires × log × regex) | ✅ | `tests/unit/l0-path-selector.spec.ts` (8 케이스) |
| 5 | Per-terminal isolation (workspacePath cwd + session_id filter) | ✅ | `tests/unit/l0-rw-b.spec.ts` (HookServer + tailer pool) |
| 6 | 4-layer hook installer safety (precheck SHA + backup + atomic + try/finally + SIGINT) | ✅ | `tests/unit/l0-hook-installer.spec.ts` (15 cases incl. legacy migration) |
| 7 | Token authentication (256-bit, constant-time) | ✅ | `tests/unit/l0-hook.spec.ts` |
| 8 | Evidence-guarded stale check (silence-only stable, log-active downgrade) | ✅ | `tests/unit/l0-rw-e.spec.ts` |
| 9 | UI 3-state badge + per-terminal breakdown + one-click install | ✅ | `tests/e2e/m1c-d1-hook-settings.spec.ts` + manual smoke (Image 11) |
| 10 | Renderer 3-tier 알림 라우팅 (L0-A `vendor event · high precision`) | ✅ | Manual smoke (Image 11 — `Approval needed - vendor event · high precision`) |
| 11 | Explicit vendor selection (renderer가 vendorHint 안 보내는 환경에서도 wire-up) | ✅ | `tests/unit/terminal-manager-vendor-detect.spec.ts` (5 setVendor + 8 auto-detect) |
| 12 | Hook installer migration: legacy buggy object form → canonical array | ✅ | `tests/unit/l0-hook-installer.spec.ts` "migrates legacy buggy object form" |

**점수**: 12/12 PASS.

---

## 3. Manual smoke evidence (Windows 11)

### 3.1 cc-bridge dispatch log

```
2026-04-27T10:52:21.340Z dispatched event=PostToolUse to 1 listeners (ok=1)
2026-04-27T10:52:37.903Z dispatched event=PreToolUse to 1 listeners (ok=1)
2026-04-27T10:52:44.147Z dispatched event=PreToolUse to 1 listeners (ok=1)
2026-04-27T10:53:41.157Z dispatched event=PostToolUse to 1 listeners (ok=1)
2026-04-27T10:54:00.095Z dispatched event=PreToolUse to 1 listeners (ok=1)
2026-04-27T10:54:09.403Z dispatched event=PostToolUse to 1 listeners (ok=1)
2026-04-27T10:54:23.621Z dispatched event=PreToolUse to 1 listeners (ok=1)
2026-04-27T10:54:35.784Z dispatched event=PreToolUse to 1 listeners (ok=1)
```

8/8 dispatch with `ok=1` — 정상.

### 3.2 Registry file 생성

`%TEMP%\workpane-hook-registry.json` (699 bytes) — `registerHookListener` 정상 작동.

### 3.3 UI evidence

- 좌측 Hook Ingress 패널: "L0 Hook active" 초록 + 모든 capability ✓
- **"Per-terminal breakdown (1)" 토글 등장** = `perTerminal.length > 0` = orchestrator가 per-terminal snapshot을 production
- 우측 timeline: **"Approval needed - vendor event · high precision - Bash requested by Claude Code"** 알림 — L0-A 채널 정상 동작

자세한 검증 결과: [recheck-2026-04-27.md](recheck-2026-04-27.md)

---

## 4. Files (newly created)

### Main process L0
- `src/main/l0/adapters/L0Adapter.ts` — adapter interface + IngestResult + AdapterStatusSnapshot
- `src/main/l0/adapters/cc-hook-adapter.ts` — Option A primary
- `src/main/l0/adapters/cc-session-log-adapter.ts` — Option E fallback
- `src/main/l0/cc-version-detector.ts` — CC version probe + compat matrix
- `src/main/l0/cc-compat.ts` — version → tier mapping
- `src/main/l0/event-key.ts` — 3-tier dedup key + `EventDedupWindow`
- `src/main/l0/hook-installer.ts` — 4-layer safety installer/uninstaller (canonical array form)
- `src/main/l0/hook-registry.ts` — atomic JSON registry, pid liveness filter, 16-entry cap
- `src/main/l0/hook-server.ts` — per-terminal TCP server + token auth + cwd/session_id filter
- `src/main/l0/l0-orchestrator.ts` — path snapshot + stale-check + observed/hookFiresOverride maps
- `src/main/l0/l0-path-selector.ts` — `pickSupervisionPath()` deterministic decision tree
- `src/main/l0/l1-classifier.ts` — port from spike (regex-based fallback)
- `src/main/l0/session-log-locator.ts` — encodeCwdToProjectDir + project dir resolution
- `src/main/l0/session-log-tailer.ts` — per-file chokidar tailer
- `src/main/l0/session-log-tailer-pool.ts` — per-cwd ref-counted pool, fan-out by subscriber

### Resources / packaging
- `resources/hooks/cc-bridge.js` — zero-deps Node bridge (stdin → registry → parallel socket dispatch)
- `package.json` — `extraResources: [{from: 'resources/hooks', to: 'hooks'}]`

### Renderer
- `src/renderer/src/components/Settings/HookIngressSettings.tsx` — 3-state badge + capability table + per-terminal breakdown + install/uninstall buttons + explicit vendor mark input/button
- `src/preload/types.ts` — extracted shape types to break circular self-import

### Tests
- `tests/unit/l0-cc-version.spec.ts`
- `tests/unit/l0-hook-installer.spec.ts` (15 cases incl. legacy migration)
- `tests/unit/l0-hook.spec.ts`
- `tests/unit/l0-orchestrator.spec.ts`
- `tests/unit/l0-path-selector.spec.ts`
- `tests/unit/l0-rw-a.spec.ts` through `l0-rw-e.spec.ts`
- `tests/unit/l0-session-log.spec.ts`
- `tests/unit/l1-classifier.spec.ts`
- `tests/unit/terminal-manager-vendor-detect.spec.ts` (13 cases — 8 banner + 5 setVendor)
- `tests/e2e/m1c-d1-hook-settings.spec.ts`

**Total**: 256 tests, 241 pass / 15 skipped (POSIX-only on Windows) / 0 fail.

---

## 5. Files (modified)

| 경로 | 변경 사유 |
|---|---|
| `src/main/index.ts` | HookServer + tailerPool wiring (RW-B), before-quit dispose (reviewer), `terminal:set-vendor` IPC handler |
| `src/main/terminal-manager.ts` | vendor auto-detect on `appendToBuffer` + public `setVendor` |
| `src/main/l0/pipeline.ts` | adapter override per-terminal + `ingestEvents` for pre-parsed L0Events + EventDedupWindow integration |
| `src/preload/index.ts` + `index.d.ts` | l0 namespace API (path snapshot + install/uninstall + setTerminalVendor) |
| `src/renderer/src/components/Settings/SettingsView.tsx` | mount HookIngressSettings panel |
| `tsconfig.web.json` | include `src/preload/types.ts` |
| `tests/perf/l0-latency.spec.ts` | adapter interface compatibility |

---

## 6. Out of scope (별도 lane)

- **Robust banner auto-detect**: CC TUI uses alternative-screen-buffer + cell-positioning, so the banner regex never matches a real session. Today's `tryAutoDetectClaudeVendor` is a no-op for live CC sessions; the explicit "Mark as Claude Code" UI is the reliable primary trigger. Robust detection requires capturing CC's raw byte stream end-to-end first (OSC title sniffing or process-tree probing) — deferred to follow-up slice.
- **L1 alert silencing**: When L0-A is active and producing `vendor-event · high precision` alerts, the L1 stream-classifier alerts (`no-api hint · low confidence`) still emit in parallel (Image 12 evidence). Touching the alert-routing layer is beyond M1c-d1's L0-ingress scope.
- **Codex / Gemini vendor**: `L0Vendor` union is currently `'claude-code'` only. The `terminal:set-vendor` IPC handler is shaped to accept additional vendors with a single-file change (M1c-d2 / M1c-d3 lanes).
- **macOS / Linux Platform Parity verification**: Manual smoke ran on Windows 11 only. macOS/Linux verification remains deferred per Charter §3.4 — these platforms have stdout-based L0 paths from the original M1c lane and may need separate parity gating.

---

## 7. Charter compliance

### §1 Positioning
"WorkPane은 터미널 멀티플렉서다 ... 외부에서 감독 신호를 제공" — hook ingress는 **외부 채널** (settings.json 등록 → CC가 자체 spawn → bridge → WorkPane HookServer). CC TUI는 그대로 호스팅됨 (Image 11/12 — "Claude Code v2.1.119 ... Opus 4.7" banner 정상 + native approval dialog 정상). ✅

### §2 Non-Goals 위반 여부

| Non-Goal | 검증 |
|----------|------|
| #1 자체 채팅 UI | ✅ 미위반 — TUI 호스팅 유지, WP는 외부 알림만 |
| #2 엔진 기능 재구현 | ✅ 미위반 — 승인 dialog는 CC native (Image 12), WP는 별도 vendor-event 알림만 발생 |
| #5 stdio MITM | ✅ 미위반 — hook은 별도 채널 (settings.json → bridge), PTY stdout READ-ONLY |
| #6 자동 개입 | ✅ 미위반 — 알림만 emit, 사용자 결정 대체 없음 |
| #7 자체 AI assistant | ✅ 미위반 — CC TUI 그대로 |
| §2.6 TUI 경계 | ✅ 미위반 — UI 엘리먼트(badge, breakdown 표, 알림)는 모두 WP 프레임 레이어 |

### §3.4 Platform Parity

- **Windows**: ✅ 검증 완료 (이번 milestone)
- **macOS**: ⚠ 미검증 — 본 lane은 Windows hook ingress 복구 목적이며 macOS는 stdout 경로를 가짐 (M1c original). **별도 검증 필요**
- **Linux**: ⚠ 미검증 — 동일

**해석**: 본 milestone scope = "Windows L0-A hook ingress 복구". Charter §3.4 의 platform parity는 lane 수준이 아니라 Sacred Journey 수준에서 판정. Journey 1 의 macOS/Linux trigger는 stdout 경로(M1c)로 이미 trigger 가능. 본 lane은 Windows의 `journey-untriggerable` 분류를 PASS로 끌어올림. 따라서 platform parity 의무는 별도 macOS/Linux smoke로 보강 필요.

---

## 8. Commit history (37 commits merged via `5c26cf7`)

```
f1f8e38 feat(l0): explicit vendor selection — reliable Claude Code wire-up
9768e54 feat(l0): auto-detect Claude Code vendor from stdout banner
726d5b3 fix(l0): hook installer writes CC-canonical array form
ffce998 fix(l0): address reviewer findings — 1 CRIT + 2 HIGH + 5 MED + 2 LOW
ab17589 test(e2e): HookIngressSettings IPC smoke (RW-F)
a526d26 feat(l0): evidence-guarded stale check + per-terminal UI breakdown (RW-E)
56bb760 feat(l0): cc-bridge.js + extraResources packaging (RW-D)
a07d0e2 feat(l0): cross-source event dedup with content-tier key + telemetry (RW-C)
ca9d592 feat(l0): HookServer per-terminal + tailer-pool per-cwd + main-process wiring (RW-B)
74e3e25 feat(l0): per-terminal adapter override + per-terminal orchestrator snapshots (RW-A)
0cef778 fix(l0): address code-reviewer findings (HIGH + 2 MEDIUM)
7064918 fix(l0): address Phase 4 reviewer findings
f9d07b1 feat(renderer): one-click hook install/uninstall + action feedback (Slice 2D)
0904f14 feat(renderer): 3-state HookIngressSettings panel (Slice 2C + 2D)
6d224df feat(l0): orchestrator + IPC surface for path snapshot (Slice 2E)
13e4483 feat(l0): hook installer with 4-layer safety (Slice 2B)
dc8f468 feat(l0): CC version detector + compat matrix (Slice 2A)
47e0031 feat(l0): Option A hook adapter + IPC server skeleton (Slice 1B)
c1ee8c6 feat(l0): Option E session-log adapter + tailer + locator (Slice 1C)
418f89d feat(l0): port path selector from spike (Slice 1D)
eebbd75 feat(l0): port L1 rule-based classifier from spike (Slice 1E)
ad3a39b feat(l0): extract L0Adapter interface (Slice 1A)
```
(나머지는 baseline + Charter compliance commits, M1c-d1 작업 외)

---

## 9. References

- [CHARTER.md](../../../00-living/CHARTER.md) §3 Sacred Journey 1, §3.4 Platform Parity, §6 Ralplan Gate, §7 Post-impl Re-check
- [STRATEGY-MAP.md](../../../00-living/STRATEGY-MAP.md) (결정사항 업데이트 필요)
- [recheck-2026-04-27.md](recheck-2026-04-27.md) — Sacred Journey 1 Runnable Procedure 재현 결과
- [m1c-implementation-result-2026-04-23.md](m1c-implementation-result-2026-04-23.md) — 선행 M1c (CC stdout, narrowed)
