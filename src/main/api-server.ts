import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { TerminalManager } from './terminal-manager'
import { WorkspaceManager } from './workspace-manager'
import { SettingsManager } from './settings-manager'
import { McpBrowserHandler } from './mcp-browser-server'

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\workpane-api'
    : '/tmp/workpane-api.sock'

interface JsonRpcRequest {
  method: string
  params: Record<string, unknown>
  id: number
}

interface JsonRpcResponse {
  result?: unknown
  error?: string
  id: number
}

export class ApiServer {
  private server: net.Server | null = null
  private terminalManager: TerminalManager
  private workspaceManager: WorkspaceManager
  private settingsManager: SettingsManager
  private mcpBrowserHandler: McpBrowserHandler | null = null

  constructor(
    terminalManager: TerminalManager,
    workspaceManager: WorkspaceManager,
    settingsManager: SettingsManager
  ) {
    this.terminalManager = terminalManager
    this.workspaceManager = workspaceManager
    this.settingsManager = settingsManager
  }

  setMcpBrowserHandler(handler: McpBrowserHandler): void {
    this.mcpBrowserHandler = handler
  }

  private async handleRequest(req: JsonRpcRequest): Promise<unknown> {
    const { method, params } = req

    switch (method) {
      case 'terminal.create': {
        const { id, shell, cwd, vendorHint, spawnArgs } = params as {
          id: string
          shell?: string
          cwd?: string
          vendorHint?: import('../shared/types').L0Vendor
          spawnArgs?: string[]
        }
        this.terminalManager.create(id, { shell, cwd, vendorHint, spawnArgs })
        return { id }
      }

      case 'terminal.write': {
        const { id, data } = params as { id: string; data: string }
        this.terminalManager.write(id, data)
        return { ok: true }
      }

      case 'terminal.list': {
        return this.terminalManager.getAll()
      }

      case 'workspace.open': {
        const { path: dirPath } = params as { path: string }
        const info = this.workspaceManager.openWorkspace(dirPath)
        return info
      }

      case 'workspace.current': {
        return this.workspaceManager.getCurrentWorkspace()
      }

      case 'workspace.list': {
        return this.workspaceManager.listWorkspaces()
      }

      case 'app.status': {
        const { app } = await import('electron')
        return {
          version: app.getVersion(),
          workspace: this.workspaceManager.getCurrentWorkspace(),
          terminals: this.terminalManager.getAll()
        }
      }

      default: {
        if (this.mcpBrowserHandler) {
          const result = await this.mcpBrowserHandler.handleRequest(method, params)
          if (result !== null) return result
        }
        throw new Error(`Unknown method: ${method}`)
      }
    }
  }

  start(): void {
    // Clean up stale socket on Unix
    if (os.platform() !== 'win32') {
      try {
        require('fs').unlinkSync(SOCKET_PATH)
      } catch {
        // ignore if not exists
      }
    }

    this.server = net.createServer((socket) => {
      let buffer = ''

      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          let req: JsonRpcRequest
          try {
            req = JSON.parse(line) as JsonRpcRequest
          } catch {
            const resp: JsonRpcResponse = { error: 'Invalid JSON', id: -1 }
            socket.write(JSON.stringify(resp) + '\n')
            continue
          }

          this.handleRequest(req)
            .then((result) => {
              const resp: JsonRpcResponse = { result, id: req.id }
              socket.write(JSON.stringify(resp) + '\n')
            })
            .catch((err: Error) => {
              const resp: JsonRpcResponse = { error: err.message, id: req.id }
              socket.write(JSON.stringify(resp) + '\n')
            })
        }
      })

      socket.on('error', () => {
        // client disconnected
      })
    })

    this.server.listen(SOCKET_PATH, () => {
      console.log(`API server listening on ${SOCKET_PATH}`)
    })

    this.server.on('error', (err) => {
      console.error('API server error:', err)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
