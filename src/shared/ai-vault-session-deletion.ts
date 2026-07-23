import type { AiVaultAgent } from './ai-vault-types'

// Agents where a single file IS the whole session: deleting that one file is
// a complete deletion (D-2). Kept here so main and renderer can never
// disagree on what "supported for deletion" means.
export const AI_VAULT_DELETABLE_AGENTS = [
  'gemini',
  'copilot',
  'cursor',
  'hermes',
  'devin',
  'openclaw',
  'droid',
  'pi',
  'omp'
] as const satisfies readonly AiVaultAgent[]

export type AiVaultDeletableAgent = (typeof AI_VAULT_DELETABLE_AGENTS)[number]

export function isAiVaultDeletableAgent(agent: AiVaultAgent): agent is AiVaultDeletableAgent {
  return (AI_VAULT_DELETABLE_AGENTS as readonly AiVaultAgent[]).includes(agent)
}

// Why a session stays undeletable even though it isn't hidden from the menu:
// the UI shows Delete as a disabled item with this reason instead (D-2).
export type AiVaultUnsupportedDeleteReasonCode =
  | 'directory-shaped-session'
  | 'dangling-registry-entry'
  | 'codex-hardlink-aliases'
  | 'synthetic-storage-path'

type AiVaultUnsupportedDeleteAgent = Exclude<AiVaultAgent, AiVaultDeletableAgent>

// An agent can carry more than one reason (e.g. antigravity is both
// directory-shaped and registry-backed); order is not significant.
export const AI_VAULT_UNSUPPORTED_DELETE_REASONS: Record<
  AiVaultUnsupportedDeleteAgent,
  readonly AiVaultUnsupportedDeleteReasonCode[]
> = {
  claude: ['directory-shaped-session'],
  rovo: ['directory-shaped-session'],
  grok: ['directory-shaped-session'],
  antigravity: ['directory-shaped-session', 'dangling-registry-entry'],
  kimi: ['directory-shaped-session', 'dangling-registry-entry'],
  codex: ['dangling-registry-entry', 'codex-hardlink-aliases'],
  opencode: ['synthetic-storage-path']
}

// A '#' marker means an OpenCode 1.17.x SQLite row's synthetic
// `<dbPath>#<sessionId>` identity, not a real file. Mirrors
// isSyntheticAiVaultSessionPath in the renderer (ai-vault-session-path-actions.ts);
// duplicated here rather than imported because main can't reach into
// renderer/src, and this slice doesn't touch renderer files.
export function isAiVaultSyntheticSessionPath(filePath: string): boolean {
  return filePath.includes('#')
}

export type AiVaultSessionDeleteRejectionCode =
  | 'invalid-path'
  | 'unsupported-agent'
  | 'non-local-host'
  | 'synthetic-path'
  | 'path-outside-known-roots'
  | 'invalid-extension'
  | 'file-predicate-mismatch'
  // D-4 fs-side guard (S-2): resolvedPath's lstat() isn't a regular file
  // (it's a directory or a symlink), or its realpath escapes the agent's roots.
  | 'not-a-regular-file'

// CALLER CONTRACT (D-4): `allowed: true` is a pure, path-only judgement — the
// validator never touches the filesystem, so it cannot tell a real session
// file from a same-named directory or from a symlink planted inside a root
// that points outside it. Before deleting, the caller MUST re-check on disk
// that `resolvedPath` is a regular file (lstat().isFile(), not a directory or
// symlink) and that its realpath still resolves inside the agent's known
// roots. That fs-side guard lives in the delete executor (S-2), not here.
export type AiVaultSessionDeleteAllowedResult = {
  allowed: true
  agent: AiVaultDeletableAgent
  resolvedPath: string
}

export type AiVaultSessionDeleteRejectedResult = {
  allowed: false
  agent: AiVaultAgent
  reason: AiVaultSessionDeleteRejectionCode
}

export type AiVaultSessionDeleteValidationResult =
  | AiVaultSessionDeleteAllowedResult
  | AiVaultSessionDeleteRejectedResult
