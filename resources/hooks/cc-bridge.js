#!/usr/bin/env node
/**
 * cc-bridge.js — Slice 2 Phase 2 RW-D.
 *
 * Claude Code invokes this script via the hook command registered in
 * ~/.claude/settings.json. CC pipes the hook payload to stdin as a
 * single JSON object. This script:
 *
 *   1. Reads stdin to end.
 *   2. Reads the WorkPane hook-listener registry file.
 *   3. For every registered listener with a live pid, reads the
 *      matching token file and dispatches {auth, ...payload}\n to the
 *      listener socket in parallel.
 *   4. Writes a debug line to a per-day log file so misrouted events
 *      can be diagnosed offline.
 *   5. Always exits 0 so a bridge failure never blocks CC's tool
 *      execution.
 *
 * Intentionally dependency-free (only `node:` core modules) so it runs
 * under whatever Node version the user has on PATH. No bundler step
 * required at runtime; electron-builder just copies the file into
 * process.resourcesPath/hooks/.
 */

'use strict'

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const MAX_STDIN_BYTES = 256 * 1024 // 256 KB — CC payloads rarely exceed a few KB
const SOCKET_TIMEOUT_MS = 300
const MAX_REGISTRY_ENTRIES = 16

function runtimeDir() {
  return process.env.XDG_RUNTIME_DIR || os.tmpdir()
}

function registryPath() {
  // The WORKPANE_HOOK_REGISTRY override is intended for unit tests only;
  // honoring it in production would let an attacker with env-var control
  // redirect the bridge to a rogue registry and exfiltrate auth tokens.
  // Gate the override behind NODE_ENV=test (security-reviewer MEDIUM).
  if (process.env.NODE_ENV === 'test' && process.env.WORKPANE_HOOK_REGISTRY) {
    return process.env.WORKPANE_HOOK_REGISTRY
  }
  return path.join(runtimeDir(), 'workpane-hook-registry.json')
}

function logPath() {
  const stamp = new Date().toISOString().slice(0, 10)
  return path.join(runtimeDir(), `workpane-hook.log.${stamp}`)
}

function log(line) {
  try {
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 })
  } catch {
    // best effort
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let buffer = ''
    let tooBig = false
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      if (tooBig) {
        // security-reviewer LOW: stop accumulating once we have crossed
        // the cap so a single oversized chunk cannot push us into
        // hundreds of MB before the flag is checked.
        return
      }
      if (Buffer.byteLength(buffer) + Buffer.byteLength(chunk) > MAX_STDIN_BYTES) {
        tooBig = true
        return
      }
      buffer += chunk
    })
    process.stdin.on('end', () => resolve({ raw: buffer, tooBig }))
    process.stdin.on('error', () => resolve({ raw: buffer, tooBig }))
    // Safety: if stdin never ends (should not happen for CC), resolve
    // after a ceiling so the script exits.
    setTimeout(() => resolve({ raw: buffer, tooBig }), 2_000)
  })
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && error.code === 'EPERM'
  }
}

function readRegistry(registryFile) {
  try {
    const raw = fs.readFileSync(registryFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed.entries
    }
  } catch {
    // Missing / corrupt — nothing to dispatch to.
  }
  return []
}

function readToken(tokenPath) {
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim()
  } catch {
    return null
  }
}

function dispatchToListener(entry, payload) {
  return new Promise((resolve) => {
    const token = readToken(entry.tokenPath)
    if (!token) {
      resolve({ entry, ok: false, reason: 'token-read-failed' })
      return
    }

    const socket = net.createConnection(entry.socketPath)
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      try {
        socket.end()
      } catch {
        // ignore
      }
      resolve(result)
    }

    socket.setTimeout(SOCKET_TIMEOUT_MS, () => done({ entry, ok: false, reason: 'timeout' }))
    socket.on('error', (error) => done({ entry, ok: false, reason: `error:${error.code || error.message}` }))
    socket.on('connect', () => {
      const authFrame = JSON.stringify({ auth: token }) + '\n'
      const payloadFrame = JSON.stringify(payload) + '\n'
      socket.write(authFrame)
      socket.write(payloadFrame, () => done({ entry, ok: true }))
    })
  })
}

async function main() {
  const { raw, tooBig } = await readStdin()
  if (tooBig) {
    log('stdin payload exceeded size cap; dropping')
    return
  }
  let payload
  try {
    payload = JSON.parse(raw)
  } catch (error) {
    log(`stdin JSON parse failed: ${error.message}`)
    return
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    log('stdin was not a JSON object; dropping')
    return
  }

  const registry = readRegistry(registryPath())
    .filter((e) => isPidAlive(e.pid))
    .slice(0, MAX_REGISTRY_ENTRIES)

  if (registry.length === 0) {
    log(`no active listeners; event=${payload.hook_event_name ?? 'unknown'}`)
    return
  }

  const results = await Promise.all(registry.map((entry) => dispatchToListener(entry, payload)))
  const okCount = results.filter((r) => r.ok).length
  log(
    `dispatched event=${payload.hook_event_name ?? 'unknown'} to ${registry.length} listeners (ok=${okCount})`
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // Guard against non-Error throw values (code-reviewer LOW).
    const message = error && (error.stack || error.message) ? (error.stack || error.message) : String(error)
    log(`unexpected error: ${message}`)
    process.exit(0)
  })
