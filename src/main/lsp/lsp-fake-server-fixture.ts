import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { LspServerProcess } from './lsp-server-spawn'
import { vi } from 'vitest'
import { encodeLspMessage, LspMessageDecoder } from './lsp-message-framing'

export type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
}

/** Fake server that auto-answers `initialize` and records everything sent to it. */
export function createFakeServer(serverCapabilities: Record<string, unknown> = {}) {
  const child = new EventEmitter() as LspServerProcess & EventEmitter
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), kill: vi.fn() })

  const received: JsonRpcMessage[] = []
  const decoder = new LspMessageDecoder()
  stdin.on('data', (chunk: Buffer) => {
    for (const message of decoder.push(chunk) as JsonRpcMessage[]) {
      received.push(message)
      if (message.method === 'initialize' && message.id !== undefined) {
        stdout.write(
          encodeLspMessage({
            jsonrpc: '2.0',
            id: message.id,
            result: { capabilities: serverCapabilities }
          })
        )
      }
    }
  })

  return {
    child,
    received,
    reply(id: number, result: unknown): void {
      stdout.write(encodeLspMessage({ jsonrpc: '2.0', id, result }))
    },
    notify(method: string, params: unknown): void {
      stdout.write(encodeLspMessage({ jsonrpc: '2.0', method, params }))
    },
    requestFromServer(id: number | string, method: string, params: unknown): void {
      stdout.write(encodeLspMessage({ jsonrpc: '2.0', id, method, params }))
    },
    writeRaw(text: string): void {
      stdout.write(Buffer.from(text, 'utf8'))
    },
    async waitFor(predicate: (message: JsonRpcMessage) => boolean): Promise<JsonRpcMessage> {
      for (let attempt = 0; attempt < 200; attempt++) {
        const match = received.find(predicate)
        if (match) {
          return match
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('fake server never received the expected message')
    }
  }
}
