import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createFakeServer } from './lsp-fake-server-fixture'
import { createLspSessionManager } from './lsp-session-manager'

function createManagerWithFakeServer(serverCapabilities?: Record<string, unknown>) {
  const fake = createFakeServer(serverCapabilities)
  const spawnServer = vi.fn(() => fake.child)
  const manager = createLspSessionManager({
    spawnServer,
    probeCommand: (command) => Promise.resolve(`/usr/local/bin/${command}`)
  })
  return { fake, manager, spawnServer }
}

const openArgs = {
  filePath: '/workspace/repo/src/index.ts',
  rootPath: '/workspace/repo',
  languageId: 'typescript',
  text: 'const x = 1'
}

describe('createLspSessionManager', () => {
  it('returns no session when no server matches the language', async () => {
    const { manager, spawnServer } = createManagerWithFakeServer()
    const result = await manager.openDocument({ ...openArgs, languageId: 'plaintext' })
    expect(result).toEqual({
      sessionId: null,
      fileUri: null,
      serverId: null,
      pullDiagnostics: false
    })
    expect(spawnServer).not.toHaveBeenCalled()
  })

  it('initializes once, sends didOpen, and reuses the session per root', async () => {
    const { fake, manager, spawnServer } = createManagerWithFakeServer()
    const first = await manager.openDocument(openArgs)
    const second = await manager.openDocument({
      ...openArgs,
      filePath: '/workspace/repo/src/other.ts'
    })
    expect(first.sessionId).toBe(second.sessionId)
    expect(first.fileUri).toBe(pathToFileURL(openArgs.filePath).toString())
    expect(first.serverId).toBe('tsgo')
    expect(first.pullDiagnostics).toBe(false)
    expect(spawnServer).toHaveBeenCalledTimes(1)
    await fake.waitFor((m) => m.method === 'initialized')
    const didOpens = fake.received.filter((m) => m.method === 'textDocument/didOpen')
    expect(didOpens).toHaveLength(2)
  })

  it('reports pullDiagnostics when the server advertises a diagnosticProvider', async () => {
    const { manager } = createManagerWithFakeServer({ diagnosticProvider: { identifier: 'ts' } })
    const opened = await manager.openDocument(openArgs)
    expect(opened.pullDiagnostics).toBe(true)
  })

  it('answers workspace/configuration with one null per requested item', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    await manager.openDocument(openArgs)
    fake.requestFromServer('cfg-1', 'workspace/configuration', {
      items: [{ section: 'a' }, { section: 'b' }]
    })
    const reply = await fake.waitFor((m) => (m.id as unknown) === 'cfg-1' && m.method === undefined)
    expect(reply.result).toEqual([null, null])
  })

  it('routes requests and resolves with the server result', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const { sessionId } = await manager.openDocument(openArgs)
    const pending = manager.request(sessionId!, 'textDocument/hover', { position: {} })
    const hoverRequest = await fake.waitFor((m) => m.method === 'textDocument/hover')
    fake.reply(hoverRequest.id!, { contents: 'docs' })
    await expect(pending).resolves.toEqual({ contents: 'docs' })
  })

  it('forwards publishDiagnostics for open documents only', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const diagnostics = vi.fn()
    manager.onDiagnostics(diagnostics)
    const { sessionId, fileUri } = await manager.openDocument(openArgs)
    fake.notify('textDocument/publishDiagnostics', {
      uri: fileUri,
      diagnostics: [{ message: 'boom' }]
    })
    fake.notify('textDocument/publishDiagnostics', {
      uri: 'file:///workspace/repo/never-opened.ts',
      diagnostics: [{ message: 'ignored' }]
    })
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(1))
    expect(diagnostics).toHaveBeenCalledWith({
      sessionId,
      fileUri,
      diagnostics: [{ message: 'boom' }]
    })
  })

  it('sends didChange with growing versions and didClose only at refcount zero', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const { sessionId, fileUri } = await manager.openDocument(openArgs)
    // Why: a repeat open re-syncs text (last writer wins), producing version 2.
    await manager.openDocument({ ...openArgs, text: 'const x = 1.5' })
    manager.changeDocument(sessionId!, fileUri!, 'const x = 2')
    manager.closeDocument(sessionId!, fileUri!)
    manager.changeDocument(sessionId!, fileUri!, 'const x = 3')
    manager.closeDocument(sessionId!, fileUri!)
    await fake.waitFor((m) => m.method === 'textDocument/didClose')
    const changes = fake.received.filter((m) => m.method === 'textDocument/didChange')
    expect(
      changes.map((m) => (m.params as { textDocument: { version: number } }).textDocument.version)
    ).toEqual([2, 3, 4])
    expect(fake.received.filter((m) => m.method === 'textDocument/didClose')).toHaveLength(1)
  })

  it('forwards publishDiagnostics whose URI encodes the path differently', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const diagnostics = vi.fn()
    manager.onDiagnostics(diagnostics)
    const { sessionId, fileUri } = await manager.openDocument(openArgs)
    // Why: vscode-uri-based servers percent-encode where pathToFileURL does not.
    fake.notify('textDocument/publishDiagnostics', {
      uri: fileUri!.replace('index.ts', 'index%2Ets'),
      diagnostics: [{ message: 'boom' }]
    })
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(1))
    expect(diagnostics).toHaveBeenCalledWith({
      sessionId,
      fileUri,
      diagnostics: [{ message: 'boom' }]
    })
  })

  it('announces .tsx documents as typescriptreact in didOpen', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    await manager.openDocument({ ...openArgs, filePath: '/workspace/repo/src/App.tsx' })
    const didOpen = await fake.waitFor((m) => m.method === 'textDocument/didOpen')
    expect(
      (didOpen.params as { textDocument: { languageId: string } }).textDocument.languageId
    ).toBe('typescriptreact')
  })

  it('rejects in-flight requests when the server exits', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const { sessionId } = await manager.openDocument(openArgs)
    const pending = manager.request(sessionId!, 'textDocument/definition', {})
    await fake.waitFor((m) => m.method === 'textDocument/definition')
    fake.child.emit('exit', 1)
    await expect(pending).rejects.toThrow('LSP server exited')
    await expect(manager.request(sessionId!, 'textDocument/hover', {})).rejects.toThrow(
      'Unknown LSP session'
    )
  })

  it('ends only that session when the server declares an oversized frame', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const { sessionId } = await manager.openDocument(openArgs)
    const pending = manager.request(sessionId!, 'textDocument/hover', {})
    pending.catch(() => {})
    fake.writeRaw('Content-Length: 999999999\r\n\r\n')
    await expect(pending).rejects.toThrow(/size limit/)
    expect(fake.child.kill).toHaveBeenCalled()
    await expect(manager.request(sessionId!, 'textDocument/hover', {})).rejects.toThrow(
      'Unknown LSP session'
    )
  })

  it('ends only that session when a server stdio stream errors', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const { sessionId } = await manager.openDocument(openArgs)
    const pending = manager.request(sessionId!, 'textDocument/hover', {})
    pending.catch(() => {})
    fake.child.stdout.emit('error', new Error('EPIPE'))
    await expect(pending).rejects.toThrow('LSP server pipe closed')
    expect(fake.child.kill).toHaveBeenCalled()
  })

  it('kills every child on disposeAll', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    await manager.openDocument(openArgs)
    manager.disposeAll()
    expect(fake.child.kill).toHaveBeenCalled()
  })
})
