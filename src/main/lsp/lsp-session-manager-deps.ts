import type { LspCommandProbe } from './lsp-server-catalog'
import type { SpawnLspServer } from './lsp-server-spawn'
import type { LspSession } from './lsp-session-state'

export type LspServerRequestHandler = (
  session: LspSession,
  method: string,
  params: unknown
) => unknown

export type LspSessionManagerDeps = {
  spawnServer?: SpawnLspServer
  probeCommand?: LspCommandProbe
  /** Answers server→client requests; `undefined` falls back to the default reply. */
  onServerRequest?: LspServerRequestHandler
}
