import { canonicalFileUriKey } from './lsp-file-uri-key'
import type { LspSessionManagerDeps } from './lsp-session-manager-deps'
import type { LspDiagnosticsListener, LspSession } from './lsp-session-state'

/** Routes one server→client message: responses, diagnostics, notifications, requests. */
export function dispatchLspServerMessage({
  session,
  message,
  send,
  deps,
  diagnosticsListeners
}: {
  session: LspSession
  message: unknown
  send: (session: LspSession, message: unknown) => void
  deps: LspSessionManagerDeps | undefined
  diagnosticsListeners: ReadonlySet<LspDiagnosticsListener>
}): void {
  const parsed = message as {
    id?: number | string
    method?: string
    result?: unknown
    error?: { message?: string }
    params?: { uri?: string; diagnostics?: unknown[] }
  }
  if (parsed.id !== undefined && parsed.method === undefined) {
    const pending = session.pending.get(Number(parsed.id))
    if (!pending) {
      return
    }
    session.pending.delete(Number(parsed.id))
    clearTimeout(pending.timer)
    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? 'LSP request failed'))
    } else {
      pending.resolve(parsed.result ?? null)
    }
    return
  }
  if (parsed.method === 'textDocument/publishDiagnostics' && parsed.params?.uri) {
    // Why: servers may publish for files the editor never opened (project-wide
    // scans); forwarding only open docs keeps renderer marker state bounded.
    // Match on the canonical key — servers mint their own URI form.
    const document = session.documentsByUri.get(canonicalFileUriKey(parsed.params.uri))
    if (!document) {
      return
    }
    for (const listener of diagnosticsListeners) {
      listener({
        sessionId: session.sessionId,
        fileUri: document.fileUri,
        diagnostics: parsed.params.diagnostics ?? []
      })
    }
    return
  }
  if (parsed.id !== undefined && parsed.method !== undefined) {
    const custom = deps?.onServerRequest?.(session, parsed.method, parsed.params)
    if (custom !== undefined) {
      send(session, { jsonrpc: '2.0', id: parsed.id, result: custom })
      return
    }
    // Why: answer server→client requests so servers that await them don't
    // stall. workspace/configuration expects one entry per requested item
    // (pyright hangs on a bare null); everything else accepts null.
    const configurationItems = (parsed.params as { items?: unknown[] } | undefined)?.items
    const result =
      parsed.method === 'workspace/configuration' && Array.isArray(configurationItems)
        ? configurationItems.map(() => null)
        : null
    send(session, { jsonrpc: '2.0', id: parsed.id, result })
  }
}
