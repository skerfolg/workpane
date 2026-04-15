import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DETERMINISTIC_ELECTRON_GATE_SPECS,
  NON_GATING_LIVE_PROVIDER_SMOKE_SPEC
} from '../e2e/helpers/gate-pack'

test('deterministic Electron gate pack is explicit and excludes live-provider smoke', () => {
  assert.ok(DETERMINISTIC_ELECTRON_GATE_SPECS.length > 0)
  assert.equal(
    new Set(DETERMINISTIC_ELECTRON_GATE_SPECS).size,
    DETERMINISTIC_ELECTRON_GATE_SPECS.length
  )
  assert.equal(
    (DETERMINISTIC_ELECTRON_GATE_SPECS as readonly string[]).includes(NON_GATING_LIVE_PROVIDER_SMOKE_SPEC),
    false
  )
  assert.deepEqual(DETERMINISTIC_ELECTRON_GATE_SPECS.slice(0, 4), [
    'tests/e2e/app-launch.spec.ts',
    'tests/e2e/shell-supervision.spec.ts',
    'tests/e2e/explorer-file-open.spec.ts',
    'tests/e2e/search-surviving-scopes.spec.ts'
  ])
})

test('deterministic Electron gate pack keeps supervision and terminal reveal regressions in scope', () => {
  assert.equal(DETERMINISTIC_ELECTRON_GATE_SPECS.includes('tests/e2e/terminal-file-open.spec.ts'), true)
  assert.equal(DETERMINISTIC_ELECTRON_GATE_SPECS.includes('tests/e2e/slice4-global-chronology.spec.ts'), true)
  assert.equal(DETERMINISTIC_ELECTRON_GATE_SPECS.includes('tests/e2e/slice5-sidebar-queue.spec.ts'), true)
})
