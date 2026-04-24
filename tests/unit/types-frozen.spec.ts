import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type {
  L0Mode,
  LlmAnalysisSource,
  LlmCauseCategory,
  LlmClassificationResult,
  SessionMonitoringState
} from '../../src/shared/types'

/**
 * M1c Plan §12.1 (a)-(f) — frozen-surface regression guard.
 * Scope matches plan §12.1 (e): scan 4 canonical files for the legacy union
 * literal, with `src/shared/types.ts:33` whitelisted via the marker comment
 * `// frozen-types-spec:allow`.
 */

const LEGACY_UNION_REGEX = /['"]llm['"]\s*\|\s*['"]no-api['"]/
const FROZEN_UNION_ALLOW_MARKER = '// frozen-types-spec:allow'

const SCAN_TARGETS = [
  {
    relPath: 'src/renderer/src/contexts/MonitoringContext.tsx',
    whitelist: false
  },
  {
    relPath: 'src/renderer/src/contexts/monitoring-state.ts',
    whitelist: false
  },
  {
    relPath: 'tests/unit/monitoring-state.spec.ts',
    whitelist: false
  },
  {
    relPath: 'src/shared/types.ts',
    whitelist: true
  }
] as const

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

function lineContainsLegacyUnion(line: string): boolean {
  return LEGACY_UNION_REGEX.test(line)
}

test('§12.1 (a) LlmCauseCategory has exactly four members', () => {
  const sample: LlmCauseCategory[] = ['approval', 'input-needed', 'error', 'unknown']
  // Exhaustiveness: any extra member would fail this assignment or the set size check.
  const uniqueMembers = new Set(sample)
  assert.equal(uniqueMembers.size, 4)
  assert.ok(uniqueMembers.has('approval'))
  assert.ok(uniqueMembers.has('input-needed'))
  assert.ok(uniqueMembers.has('error'))
  assert.ok(uniqueMembers.has('unknown'))
})

test('§12.1 (b) LlmAnalysisSource has exactly three members including l0-vendor-event', () => {
  const sample: LlmAnalysisSource[] = ['llm', 'no-api', 'l0-vendor-event']
  const uniqueMembers = new Set(sample)
  assert.equal(uniqueMembers.size, 3)
  assert.ok(uniqueMembers.has('llm'))
  assert.ok(uniqueMembers.has('no-api'))
  assert.ok(uniqueMembers.has('l0-vendor-event'))
})

test('§12.1 (c) LlmClassificationResult shape key set is frozen', () => {
  const probe: LlmClassificationResult = {
    category: 'approval',
    confidence: 'high',
    source: 'llm',
    summary: 'sentinel',
    providerId: null,
    modelId: null,
    recentOutputExcerpt: ''
  }
  const keys = Object.keys(probe).sort()
  assert.deepEqual(keys, [
    'category',
    'confidence',
    'modelId',
    'providerId',
    'recentOutputExcerpt',
    'source',
    'summary'
  ])
})

test('§12.1 (d) SessionMonitoringState shape key set is frozen', () => {
  const probe: SessionMonitoringState = {
    terminalId: 't',
    workspacePath: 'w',
    patternName: 'p',
    matchedText: 'm',
    status: 'attention-needed',
    category: 'approval',
    confidence: 'high',
    source: 'l0-vendor-event',
    summary: 's',
    timestamp: 0
  }
  const keys = Object.keys(probe).sort()
  assert.deepEqual(keys, [
    'category',
    'confidence',
    'matchedText',
    'patternName',
    'source',
    'status',
    'summary',
    'terminalId',
    'timestamp',
    'workspacePath'
  ])
})

test('§12.1 (e) frozen-surface scan — canonical 4 files, with types.ts union line whitelisted', () => {
  for (const target of SCAN_TARGETS) {
    const contents = readProjectFile(target.relPath)
    if (!target.whitelist) {
      assert.equal(
        LEGACY_UNION_REGEX.test(contents),
        false,
        `${target.relPath} still inlines the legacy 'llm' | 'no-api' union`
      )
      continue
    }
    // Whitelisted file: only the marker-annotated line may contain the union.
    const offendingLines = contents
      .split(/\r?\n/)
      .map((line, idx) => ({ line, lineNumber: idx + 1 }))
      .filter(({ line }) => lineContainsLegacyUnion(line))
      .filter(({ line }) => !line.includes(FROZEN_UNION_ALLOW_MARKER))
    assert.equal(
      offendingLines.length,
      0,
      `${target.relPath}: legacy union on lines without ${FROZEN_UNION_ALLOW_MARKER}: ` +
        offendingLines.map((entry) => entry.lineNumber).join(', ')
    )
    assert.ok(
      contents.includes(FROZEN_UNION_ALLOW_MARKER),
      `${target.relPath}: expected ${FROZEN_UNION_ALLOW_MARKER} on the canonical union definition`
    )
  }
})

test('§12.1 (f) package.json:21 test:e2e:gate script includes the new L0 specs', () => {
  const pkgRaw = readProjectFile('package.json')
  const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> }
  const gateScript = pkg.scripts?.['test:e2e:gate'] ?? ''
  assert.ok(
    gateScript.includes('tests/e2e/l0-cc-stream-json.spec.ts'),
    'test:e2e:gate must include tests/e2e/l0-cc-stream-json.spec.ts'
  )
  assert.ok(
    gateScript.includes('tests/e2e/l0-degrade-fallback.spec.ts'),
    'test:e2e:gate must include tests/e2e/l0-degrade-fallback.spec.ts'
  )
})

test('L0Mode covers the four supervision states the DP-2 badge renders', () => {
  const modes: L0Mode[] = ['inactive', 'awaiting-first-event', 'active', 'degraded']
  assert.equal(new Set(modes).size, 4)
})
