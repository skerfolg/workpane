import * as net from 'net'
import * as os from 'os'

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\workpane-api'
    : '/tmp/workpane-api.sock'

const TIMEOUT_MS = 5000

let requestId = 1

export function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = requestId++
    const socket = net.connect(SOCKET_PATH)
    let settled = false
    let buffer = ''

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        socket.destroy()
        reject(new Error('Request timed out (5s)'))
      }
    }, TIMEOUT_MS)

    socket.on('connect', () => {
      const payload = JSON.stringify({ method, params, id }) + '\n'
      socket.write(payload)
    })

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const resp = JSON.parse(line) as { result?: unknown; error?: string; id: number }
          if (resp.id === id) {
            clearTimeout(timer)
            settled = true
            socket.destroy()
            if (resp.error) {
              reject(new Error(resp.error))
            } else {
              resolve(resp.result)
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    })

    socket.on('error', (err) => {
      if (!settled) {
        clearTimeout(timer)
        settled = true
        if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error('App is not running'))
        } else {
          reject(err)
        }
      }
    })

    socket.on('close', () => {
      if (!settled) {
        clearTimeout(timer)
        settled = true
        reject(new Error('Connection closed unexpectedly'))
      }
    })
  })
}
