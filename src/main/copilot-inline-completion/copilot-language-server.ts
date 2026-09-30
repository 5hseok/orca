import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  COPILOT_MAX_DOCUMENT_CHARS,
  type CopilotInlineCompletionArgs,
  type CopilotInlineCompletionResult,
  type CopilotOpenDocumentArgs,
  type CopilotOpenDocumentResult,
  type CopilotStatus
} from '../../shared/copilot-inline-completion-types'
import { connectCopilotServer, type CopilotServerConnection } from './copilot-server-connection'
import type { CopilotServerProcess } from './copilot-server-process'
import { createCopilotSignIn } from './copilot-sign-in'

import {
  buildCopilotInitializeParams,
  isHttpsUrl,
  parseCopilotStatusNotification,
  toCopilotDocumentLanguageId
} from './copilot-protocol'

// Why: keep a doc-less server briefly for tab switches, but don't hold a node process open indefinitely.
const IDLE_SHUTDOWN_MS = 3 * 60_000

type OpenDocumentState = { version: number; refCount: number }

export type CopilotLanguageServerDeps = {
  editorVersion: string
  /** Absolute path of copilot-language-server, or null when it is not installed. */
  locateServer: () => Promise<string | null>
  spawnServer: (program: string) => CopilotServerProcess
  openExternal: (url: string) => void
  copyToClipboard: (text: string) => void
  onStatus: (status: CopilotStatus) => void
}

export function createCopilotLanguageServer(deps: CopilotLanguageServerDeps) {
  let status: CopilotStatus = { installed: false, kind: null, message: '', busy: false, user: null }
  // null until the first checkStatus answer; false keeps the server unspawned (inert).
  let authenticated: boolean | null = null
  let connectionPromise: Promise<CopilotServerConnection | null> | null = null
  let activeConnection: CopilotServerConnection | null = null
  const documents = new Map<string, OpenDocumentState>()
  const workspaceRoots = new Set<string>()
  let idleTimer: NodeJS.Timeout | null = null

  function updateStatus(patch: Partial<CopilotStatus>): void {
    status = { ...status, ...patch }
    deps.onStatus(status)
  }

  function clearIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function disposeIfIdle(): void {
    if (documents.size === 0 && !signInFlow.isActive()) {
      activeConnection?.dispose()
    }
  }

  function scheduleIdleShutdown(): void {
    clearIdleTimer()
    idleTimer = setTimeout(disposeIfIdle, IDLE_SHUTDOWN_MS)
    idleTimer.unref?.()
  }

  async function refreshAuth(connection: CopilotServerConnection): Promise<void> {
    try {
      const result = (await connection.request('checkStatus', {})) as {
        status?: string
        user?: string
      } | null
      const signedIn = result?.status === 'OK' || result?.status === 'MaybeOk'
      authenticated = signedIn
      updateStatus({
        installed: true,
        user: signedIn ? (result?.user ?? null) : null,
        ...(signedIn ? {} : { kind: 'Error' as const })
      })
    } catch {
      // Status stays whatever didChangeStatus last reported.
    }
  }

  function handleNotification(method: string, params: unknown): void {
    if (method !== 'didChangeStatus') {
      return
    }
    const parsed = parseCopilotStatusNotification(params)
    if (!parsed) {
      return
    }
    updateStatus({ installed: true, ...parsed })
    // Why: a finished device flow surfaces only as a Normal status; fetch the login.
    if (parsed.kind === 'Normal' && !status.user && activeConnection) {
      void refreshAuth(activeConnection)
    }
  }

  function handleRequest(method: string, params: unknown): unknown {
    if (method !== 'window/showDocument') {
      return undefined
    }
    const uri = (params as { uri?: unknown } | null)?.uri
    // Why: a server asking to open pages outside a user-started sign-in is not expected.
    if (signInFlow.isActive() && isHttpsUrl(uri)) {
      deps.openExternal(uri)
      return { success: true }
    }
    return { success: false }
  }

  function handleClosed(connection: CopilotServerConnection): void {
    if (activeConnection !== connection) {
      return
    }
    activeConnection = null
    connectionPromise = null
    documents.clear()
    workspaceRoots.clear()
    clearIdleTimer()
  }

  async function startConnection(): Promise<CopilotServerConnection | null> {
    const program = await deps.locateServer()
    if (!program) {
      if (status.installed) {
        updateStatus({ installed: false })
      }
      return null
    }
    let connection: CopilotServerConnection
    try {
      connection = connectCopilotServer({
        child: deps.spawnServer(program),
        initializeParams: buildCopilotInitializeParams(deps.editorVersion),
        // Why: the server waits for an initial configuration push before serving completions.
        onReady: (ready) => ready.notify('workspace/didChangeConfiguration', { settings: {} }),
        onNotification: handleNotification,
        onRequest: handleRequest,
        onClosed: () => handleClosed(connection)
      })
    } catch {
      return null
    }
    activeConnection = connection
    if (connection.isDisposed()) {
      handleClosed(connection)
      return null
    }
    try {
      await connection.ready
      await refreshAuth(connection)
    } catch {
      connection.dispose()
      handleClosed(connection)
      return null
    }
    scheduleIdleShutdown()
    return connection.isDisposed() ? null : connection
  }

  function ensureConnection(): Promise<CopilotServerConnection | null> {
    if (!connectionPromise) {
      const promise = startConnection()
      connectionPromise = promise
      void promise.then((connection) => {
        if (!connection && connectionPromise === promise) {
          connectionPromise = null
        }
      })
    }
    return connectionPromise
  }

  const signInFlow = createCopilotSignIn({
    openExternal: deps.openExternal,
    copyToClipboard: deps.copyToClipboard,
    ensureConnection,
    refreshAuth,
    currentUser: () => status.user,
    // Why: a server nothing uses (no documents, not signed in) should not linger after the flow ends.
    onSettled: () => {
      if (documents.size > 0) {
        return
      }
      if (authenticated) {
        scheduleIdleShutdown()
      } else {
        disposeIfIdle()
      }
    }
  })

  async function getStatus(): Promise<CopilotStatus> {
    const installed = (await deps.locateServer()) !== null
    if (installed !== status.installed) {
      status = { ...status, installed }
    }
    return status
  }

  async function openDocument(args: CopilotOpenDocumentArgs): Promise<CopilotOpenDocumentResult> {
    const none: CopilotOpenDocumentResult = { fileUri: null }
    if (authenticated === false || args.text.length > COPILOT_MAX_DOCUMENT_CHARS) {
      return none
    }
    const connection = await ensureConnection()
    if (!connection) {
      return none
    }
    if (!authenticated) {
      // Why: not signed in means nothing may run; drop the process spawned to find that out.
      disposeIfIdle()
      return none
    }
    clearIdleTimer()
    const rootUri = pathToFileURL(args.rootPath).toString()
    if (!workspaceRoots.has(rootUri)) {
      workspaceRoots.add(rootUri)
      connection.notify('workspace/didChangeWorkspaceFolders', {
        event: { added: [{ uri: rootUri, name: basename(args.rootPath) }], removed: [] }
      })
    }
    const fileUri = pathToFileURL(args.filePath).toString()
    const existing = documents.get(fileUri)
    if (existing) {
      existing.refCount++
      // Why: a second surface can open the same file with different text; last writer wins.
      sendDidChange(connection, fileUri, existing, args.text)
    } else {
      documents.set(fileUri, { version: 1, refCount: 1 })
      connection.notify('textDocument/didOpen', {
        textDocument: {
          uri: fileUri,
          languageId: toCopilotDocumentLanguageId(args.languageId, args.filePath),
          version: 1,
          text: args.text
        }
      })
    }
    return { fileUri }
  }

  function sendDidChange(
    connection: CopilotServerConnection,
    fileUri: string,
    document: OpenDocumentState,
    text: string
  ): void {
    document.version++
    connection.notify('textDocument/didChange', {
      textDocument: { uri: fileUri, version: document.version },
      contentChanges: [{ text }]
    })
  }

  function changeDocument(fileUri: string, text: string): void {
    const document = documents.get(fileUri)
    if (!activeConnection || !document || text.length > COPILOT_MAX_DOCUMENT_CHARS) {
      return
    }
    sendDidChange(activeConnection, fileUri, document, text)
  }

  function closeDocument(fileUri: string): void {
    const document = documents.get(fileUri)
    if (!activeConnection || !document) {
      return
    }
    document.refCount--
    if (document.refCount > 0) {
      return
    }
    documents.delete(fileUri)
    activeConnection.notify('textDocument/didClose', { textDocument: { uri: fileUri } })
    if (documents.size === 0) {
      scheduleIdleShutdown()
    }
  }

  async function inlineCompletion(
    args: CopilotInlineCompletionArgs
  ): Promise<CopilotInlineCompletionResult> {
    const document = documents.get(args.fileUri)
    if (!activeConnection || !document) {
      return { opened: false, result: null }
    }
    const result = await activeConnection.request('textDocument/inlineCompletion', {
      // Why: the server drops requests whose version differs from what it holds, and only main knows it.
      textDocument: { uri: args.fileUri, version: document.version },
      position: args.position,
      // LSP InlineCompletionTriggerKind: Invoked = 1, Automatic = 2.
      context: { triggerKind: args.trigger === 'explicit' ? 1 : 2 },
      formattingOptions: args.formattingOptions
    })
    return { opened: true, result }
  }

  function dispose(): void {
    clearIdleTimer()
    activeConnection?.dispose()
  }

  return {
    getStatus,
    openDocument,
    changeDocument,
    closeDocument,
    inlineCompletion,
    signIn: signInFlow.signIn,
    dispose
  }
}
