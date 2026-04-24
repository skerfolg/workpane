export const DETERMINISTIC_ELECTRON_GATE_SPECS = [
  'tests/e2e/app-launch.spec.ts',
  'tests/e2e/shell-supervision.spec.ts',
  'tests/e2e/explorer-file-open.spec.ts',
  'tests/e2e/search-surviving-scopes.spec.ts',
  'tests/e2e/language-settings.spec.ts',
  'tests/e2e/llm-settings.spec.ts',
  'tests/e2e/terminal-file-open.spec.ts',
  'tests/e2e/slice2-sidebar.spec.ts',
  'tests/e2e/slice3-transition-log.spec.ts',
  'tests/e2e/slice4-global-chronology.spec.ts',
  'tests/e2e/slice5-sidebar-queue.spec.ts',
  'tests/e2e/l0-cc-stream-json.spec.ts',
  'tests/e2e/l0-degrade-fallback.spec.ts'
] as const

export const NON_GATING_LIVE_PROVIDER_SMOKE_SPEC = 'tests/e2e/llm-live-provider.spec.ts'
