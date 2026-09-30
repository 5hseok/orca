import type { CopilotStatus, CopilotStatusKind } from '../../shared/copilot-inline-completion-types'

const COPILOT_STATUS_KINDS: readonly CopilotStatusKind[] = [
  'Normal',
  'Error',
  'Warning',
  'Inactive'
]
export function buildCopilotInitializeParams(editorVersion: string): object {
  return {
    processId: process.pid,
    rootUri: null,
    workspaceFolders: [],
    capabilities: {
      workspace: { workspaceFolders: true },
      window: { showDocument: { support: true } }
    },
    initializationOptions: {
      editorInfo: { name: 'Orca', version: editorVersion },
      editorPluginInfo: { name: 'Orca Copilot', version: editorVersion }
    }
  }
}

export function parseCopilotStatusNotification(
  params: unknown
): Pick<CopilotStatus, 'kind' | 'message' | 'busy'> | null {
  const raw = params as { kind?: unknown; message?: unknown; busy?: unknown } | null
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const kind = COPILOT_STATUS_KINDS.find((candidate) => candidate === raw.kind) ?? null
  return {
    kind,
    message: typeof raw.message === 'string' ? raw.message : '',
    busy: raw.busy === true
  }
}

/** Monaco has no react language ids (.tsx shares 'typescript'), but the server
 *  keys its prompt off the didOpen languageId. */
export function toCopilotDocumentLanguageId(languageId: string, filePath: string): string {
  if (languageId === 'typescript' && /\.tsx$/i.test(filePath)) {
    return 'typescriptreact'
  }
  if (languageId === 'javascript' && /\.jsx$/i.test(filePath)) {
    return 'javascriptreact'
  }
  return languageId
}

/** Why: only the GitHub device-flow page is expected; never open file:// or other schemes a server asks for. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

export type CopilotCommand = { command: string; arguments?: unknown[] }

export type CopilotSignInResponse = {
  status?: string
  user?: string
  userCode?: string
  verificationUri?: string
  command?: CopilotCommand
}
