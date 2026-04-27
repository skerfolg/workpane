import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCompat, compareVersions, MIN_SUPPORTED_VERSION, parseCcVersion } from '../../src/main/l0/cc-compat'
import { detectCcVersion, isCompatible } from '../../src/main/l0/cc-version-detector'

test('parseCcVersion — labelled form (claude 2.1.119)', () => {
  const v = parseCcVersion('2.1.119 (Claude Code)\n')
  assert.deepEqual(v, { major: 2, minor: 1, patch: 119, raw: '2.1.119' })
})

test('parseCcVersion — bare version string', () => {
  const v = parseCcVersion('2.1.119')
  assert.deepEqual(v, { major: 2, minor: 1, patch: 119, raw: '2.1.119' })
})

test('parseCcVersion — unparseable returns null', () => {
  assert.equal(parseCcVersion('garbled output'), null)
  assert.equal(parseCcVersion(''), null)
  assert.equal(parseCcVersion('v1'), null)
})

test('compareVersions — major/minor/patch ordering', () => {
  assert.ok(compareVersions({ major: 2, minor: 2, patch: 0, raw: '2.2.0' }, MIN_SUPPORTED_VERSION) > 0)
  assert.ok(compareVersions({ major: 2, minor: 1, patch: 118, raw: '2.1.118' }, MIN_SUPPORTED_VERSION) < 0)
  assert.equal(compareVersions(MIN_SUPPORTED_VERSION, MIN_SUPPORTED_VERSION), 0)
  assert.ok(compareVersions({ major: 1, minor: 9, patch: 99, raw: '1.9.99' }, MIN_SUPPORTED_VERSION) < 0)
  assert.ok(compareVersions({ major: 3, minor: 0, patch: 0, raw: '3.0.0' }, MIN_SUPPORTED_VERSION) > 0)
})

test('checkCompat — supported version', () => {
  const result = checkCompat({ major: 2, minor: 1, patch: 119, raw: '2.1.119' })
  assert.equal(result.status, 'supported')
})

test('checkCompat — unsupported version includes upgrade guidance', () => {
  const result = checkCompat({ major: 2, minor: 1, patch: 0, raw: '2.1.0' })
  assert.equal(result.status, 'unsupported')
  assert.ok(result.reason.includes('2.1.119'))
})

test('checkCompat — unknown when version is null', () => {
  const result = checkCompat(null)
  assert.equal(result.status, 'unknown')
  assert.equal(result.version, undefined)
})

test('detectCcVersion — not-installed when command missing', async () => {
  const result = await detectCcVersion({
    command: 'this-command-does-not-exist-workpane',
    timeoutMs: 1_000
  })
  assert.equal(result.kind, 'not-installed')
})

test('detectCcVersion — timeout surfaces detection-failed', async () => {
  // Use a shell builtin that never exits within the timeout window
  const command = process.platform === 'win32' ? 'timeout' : 'sleep'
  const args = process.platform === 'win32' ? ['/t', '10', '/nobreak'] : ['10']
  const result = await detectCcVersion({ command, args, timeoutMs: 150 })
  assert.equal(result.kind, 'detection-failed')
  if (result.kind === 'detection-failed') {
    assert.ok(result.reason.includes('150ms') || result.reason.includes('응답하지 않음'))
  }
})

test('detectCcVersion — parses real claude --version if available', async () => {
  const result = await detectCcVersion({ timeoutMs: 5_000 })
  // On CI without CC installed this will be not-installed; locally it
  // should be supported or unsupported. Either way it is NOT
  // detection-failed (no unexpected errors) and never throws.
  assert.ok(['supported', 'unsupported', 'unknown', 'not-installed'].includes(result.kind))
})

test('isCompatible — only supported counts as compatible', () => {
  assert.equal(isCompatible({ kind: 'supported', status: 'supported', reason: '' }), true)
  assert.equal(isCompatible({ kind: 'unsupported', status: 'unsupported', reason: '' }), false)
  assert.equal(isCompatible({ kind: 'not-installed', reason: '' }), false)
  assert.equal(isCompatible({ kind: 'detection-failed', reason: '' }), false)
})
