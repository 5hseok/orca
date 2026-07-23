import type { AiVaultAgent } from './ai-vault-types'

// Agents where a single file IS the whole session: deleting that one file is
// a complete deletion (D-2). Kept here so main and renderer can never
// disagree on what "supported for deletion" means.
//
// Why every other agent is excluded — recorded here because the UI
// deliberately doesn't tell the user (a provider's storage layout is Orca's
// problem, not the reader's):
// - claude, rovo, grok: a sibling directory holds the rest of the session
//   (subagents/, session_context.json, chat_history.jsonl), so removing the
//   transcript file alone leaves the conversation on disk.
// - antigravity, kimi: directory-shaped as above, and a separate registry
//   (history.jsonl / session_index.jsonl) would keep a dangling entry.
// - codex: session_index.jsonl plus hardlink aliases between the Orca-managed
//   home and ~/.codex, so a one-sided delete reappears on the next scan.
// - opencode 1.17.x: a SQLite row, not a file; its path is the synthetic
//   <dbPath>#<sessionId> form.
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
