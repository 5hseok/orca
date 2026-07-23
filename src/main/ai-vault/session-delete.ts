import { lstat, realpath } from 'node:fs/promises'
import { shell } from 'electron'
import type { AiVaultDeleteSessionResult } from '../../shared/ai-vault-types'
import type { AiVaultSessionDeleteRemoval } from '../../shared/ai-vault-session-deletion'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import {
  validateAiVaultSessionDeleteTarget,
  type ValidateAiVaultSessionDeleteTargetArgs
} from './session-delete-target'
import { tryDeleteWslUncPath } from '../wsl-unc-delete'
import { isENOENT } from '../ipc/filesystem-auth'

// Moved to shared/ai-vault-types.ts (S-3): the IPC handler and the renderer
// both need this exact shape, and main-only files aren't importable there.
export type AiVaultSessionDeleteExecutionResult = AiVaultDeleteSessionResult

// Removes a supported AI Vault session for real (D-1/D-7): every path in the
// validated removal plan, companions first and the session's own transcript
// last, so a failure part-way leaves the session's row on screen to retry from
// instead of dropping the row and stranding the rest on disk.
// Never throws: IPC payloads are untyped at runtime, so both a rejected
// input and an unexpected fs error resolve to a discriminated result the
// caller (the S-3 IPC handler) can render instead of a crash.
export async function deleteAiVaultSessionFile(
  args: ValidateAiVaultSessionDeleteTargetArgs
): Promise<AiVaultSessionDeleteExecutionResult> {
  const validation = validateAiVaultSessionDeleteTarget(args)
  if (!validation.allowed) {
    return { outcome: 'rejected', agent: validation.agent, reason: validation.reason }
  }
  const { agent, removals } = validation

  try {
    for (const removal of removals) {
      const rejection = await removeOne(removal)
      if (rejection) {
        return { outcome: 'rejected', agent, reason: rejection }
      }
    }
    return { outcome: 'deleted' }
  } catch (error) {
    return {
      outcome: 'failed',
      agent,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// Trash one planned path, or return the rejection code that stops the whole
// plan. A missing path is success at every step: companions are optional (a
// session that never spawned a subagent has no subagents dir) and an already
// externally-deleted transcript must stay idempotent (D-1).
async function removeOne(
  removal: AiVaultSessionDeleteRemoval
): Promise<'unexpected-target-kind' | 'path-outside-known-roots' | null> {
  // Why this order (D-5): a WSL UNC path can't be lstat/realpath-guarded
  // with Windows-local semantics, so try the WSL rm branch (its own
  // idempotent `rm -f`, which already refuses a bare directory and never
  // follows a symlink) before the fs guards below, and only fall through
  // to lstat/realpath/trashItem for a non-WSL path.
  if (removal.kind === 'file' && (await tryDeleteWslUncPath(removal.path))) {
    return null
  }

  let stats
  try {
    stats = await lstat(removal.path)
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
  // lstat (not stat) so a symlink is caught here rather than dereferenced (D-4a).
  const kindMatches = removal.kind === 'file' ? stats.isFile() : stats.isDirectory()
  if (!kindMatches) {
    return 'unexpected-target-kind'
  }

  let realResolvedPath: string
  try {
    realResolvedPath = await realpath(removal.path)
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
  // Catches a path reached through a symlinked parent directory that escapes
  // the agent's roots, which lstat() on the leaf can't see (D-4b).
  if (
    realResolvedPath !== removal.path &&
    !removal.roots.some((root) => isPathInsideOrEqual(root, realResolvedPath))
  ) {
    return 'path-outside-known-roots'
  }

  try {
    await shell.trashItem(removal.path)
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
  return null
}
