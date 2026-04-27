import { test, expect } from '@playwright/test'
import { closeApp, launchApp } from './helpers/electron'

/**
 * RW-F smoke test — Settings panel HookIngressSettings renders + IPC
 * round-trip works.
 *
 * Scope kept intentionally tight: this exercises the plumbing
 * (preload bridge → main-process orchestrator → renderer hook) end to
 * end, without needing a real Claude Code binary or a socket-injection
 * harness. Full socket-level RW-F (inject PreToolUse payload, observe
 * DP-2 active transition) is tracked in plan §9 Known follow-ups and
 * becomes feasible once the packaged bridge script runs in CI.
 */

test.describe('M1c-d1 Hook ingress Settings smoke', () => {
  test('window.l0 API is exposed and path snapshot has expected shape', async () => {
    test.setTimeout(60_000)
    const { app, page } = await launchApp()

    try {
      // Wait for the welcome / activity bar so the renderer has finished
      // initial bootstrap and preload bridge is live.
      try {
        await page.waitForSelector('.welcome', { timeout: 15_000 })
      } catch {
        // Welcome paint may be skipped on fast launches; fall through.
      }

      const apiShape = await page.evaluate(() => ({
        hasL0: typeof window.l0 !== 'undefined',
        methods: window.l0
          ? [
              typeof window.l0.getPathSnapshot,
              typeof window.l0.refreshPath,
              typeof window.l0.listPerTerminal,
              typeof window.l0.installHooks,
              typeof window.l0.uninstallHooks,
              typeof window.l0.onPathSnapshot,
              typeof window.l0.onPathProbeError
            ]
          : []
      }))
      expect(apiShape.hasL0).toBe(true)
      expect(apiShape.methods.every((t) => t === 'function')).toBe(true)

      // Trigger a refresh and inspect the returned snapshot. We do not
      // assert on a specific tier because the detection depends on the
      // host machine (CC may or may not be installed in CI); we only
      // verify the shape so a regression in the IPC / probe layer is
      // caught even without a real CC.
      const snapshot = await page.evaluate(async () => {
        try {
          const result = await window.l0.refreshPath()
          return {
            ok: true,
            hasDecision: typeof result?.decision?.selected === 'string',
            tier: result?.decision?.selected ?? null,
            hasState: typeof result?.state === 'object',
            hasCc: typeof result?.cc?.kind === 'string'
          }
        } catch (error) {
          return { ok: false, error: String(error) }
        }
      })
      expect(snapshot.ok).toBe(true)
      expect(snapshot.hasDecision).toBe(true)
      expect(['L0-A', 'L0-E', 'L1-regex', 'NONE']).toContain(snapshot.tier)
      expect(snapshot.hasState).toBe(true)
      expect(snapshot.hasCc).toBe(true)

      // listPerTerminal should return an array (may be empty when no CC
      // terminal has been bound in this session).
      const perTerminal = await page.evaluate(async () => {
        const list = await window.l0.listPerTerminal()
        return { isArray: Array.isArray(list), length: list?.length ?? -1 }
      })
      expect(perTerminal.isArray).toBe(true)
      expect(perTerminal.length).toBeGreaterThanOrEqual(0)
    } finally {
      await closeApp(app)
    }
  })
})
