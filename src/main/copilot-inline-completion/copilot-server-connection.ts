import { ContentLengthMessageDecoder, encodeContentLengthMessage } from './content-length-framing'
import { terminateCopilotServer, type CopilotServerProcess } from './copilot-server-process'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type ServerMessage = {
  id?: number | string
  method?: string
  result?: unknown
  error?: { message?: string }
  params?: unknown
}

export type CopilotServerConnectionOptions = {
  child: CopilotServerProcess
  initializeParams: object
  /** Runs once the `initialize` handshake completed and `initialized` was sent. */
  onReady?: (connection: CopilotServerConnection) => void
  onNotification: (method: string, params: unknown) => void
  /** Return `undefined` to fall back to a null reply. */
  onRequest: (method: string, params: unknown) => unknown
  /** Fires once when the process exits, errors, or the connection is disposed. */
  onClosed: () => void
}

export type CopilotServerConnection = {
  /** Resolves after the handshake; rejects if the server never completed it. */
  ready: Promise<void>
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>
  notify: (method: string, params: unknown) => void
  dispose: () => void
  isDisposed: () => boolean
}

/** One JSON-RPC-over-stdio client for a single copilot-language-server process. */
export function connectCopilotServer(
  options: CopilotServerConnectionOptions
): CopilotServerConnection {
  const { child } = options
  const pending = new Map<number, PendingRequest>()
  const decoder = new ContentLengthMessageDecoder()
  let nextRequestId = 1
  let disposed = false

  function send(message: unknown): void {
    if (disposed) {
      return
    }
    try {
      child.stdin.write(encodeContentLengthMessage(message))
    } catch (error) {
      close(error instanceof Error ? error : new Error('Copilot server write failed'))
    }
  }

  function request(
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    if (disposed) {
      return Promise.reject(new Error('Copilot server connection is closed'))
    }
    const id = nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Copilot server request timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  function notify(method: string, params: unknown): void {
    send({ jsonrpc: '2.0', method, params })
  }

  function close(error: Error): void {
    if (disposed) {
      return
    }
    disposed = true
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
    terminateCopilotServer(child)
    options.onClosed()
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    send({ jsonrpc: '2.0', method: 'exit' })
    close(new Error('Copilot server connection closed'))
  }

  function handleMessage(message: ServerMessage): void {
    if (message.id !== undefined && message.method === undefined) {
      const entry = pending.get(Number(message.id))
      if (!entry) {
        return
      }
      pending.delete(Number(message.id))
      clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(new Error(message.error.message ?? 'Copilot server request failed'))
      } else {
        entry.resolve(message.result ?? null)
      }
      return
    }
    if (message.method === undefined) {
      return
    }
    if (message.id === undefined) {
      options.onNotification(message.method, message.params)
      return
    }
    // Why: answer server->client requests so servers that await them don't stall.
    const custom = options.onRequest(message.method, message.params)
    send({ jsonrpc: '2.0', id: message.id, result: custom === undefined ? null : custom })
  }

  child.stdout.on('data', (chunk: Buffer) => {
    try {
      for (const message of decoder.push(chunk)) {
        handleMessage(message as ServerMessage)
      }
    } catch (error) {
      close(error instanceof Error ? error : new Error('Copilot server stream failed'))
    }
  })
  child.on('error', (error) => close(error))
  child.on('exit', () => close(new Error('Copilot server exited')))
  child.stdin.on('error', () => close(new Error('Copilot server pipe closed')))
  // Why: spawnProcess leaves stream `error` events to the caller; an unhandled one is an uncaught exception in main.
  child.stdout.on('error', () => {})
  child.stderr.on('error', () => {})

  const connection: CopilotServerConnection = {
    ready: Promise.resolve(),
    request,
    notify,
    dispose,
    isDisposed: () => disposed
  }
  connection.ready = request('initialize', options.initializeParams).then(() => {
    notify('initialized', {})
    options.onReady?.(connection)
  })
  // Why: callers await `ready`; an unobserved failed handshake must not be an unhandled rejection.
  connection.ready.catch(() => {})
  return connection
}
