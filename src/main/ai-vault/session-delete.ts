import { lstat, realpath } from 'node:fs/promises'
import { shell } from 'electron'
import type { AiVaultAgent } from '../../shared/ai-vault-types'
import type { AiVaultSessionDeleteRejectionCode } from '../../shared/ai-vault-session-deletion'
import {
  validateAiVaultSessionDeleteTarget,
  type ValidateAiVaultSessionDeleteTargetArgs
} from './session-delete-target'
import { tryDeleteWslUncPath } from '../wsl-unc-delete'
import { isENOENT } from '../ipc/filesystem-auth'

export type AiVaultSessionDeleteExecutionResult =
  | { outcome: 'deleted' }
  | { outcome: 'rejected'; agent: AiVaultAgent; reason: AiVaultSessionDeleteRejectionCode }
  | { outcome: 'failed'; agent: AiVaultAgent; error: string }

// Removes a supported AI Vault session's transcript file for real (D-1).
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
  const { agent, resolvedPath } = validation

  try {
    // Why this order (D-5): a WSL UNC path can't be lstat/realpath-guarded
    // with Windows-local semantics, so try the WSL rm branch (its own
    // idempotent `rm -f`, which already refuses a bare directory and never
    // follows a symlink) before the fs guards below, and only fall through
    // to lstat/realpath/trashItem for a non-WSL path.
    if (await tryDeleteWslUncPath(resolvedPath)) {
      return { outcome: 'deleted' }
    }

    let stats
    try {
      stats = await lstat(resolvedPath)
    } catch (error) {
      if (isENOENT(error)) {
        return { outcome: 'deleted' }
      }
      throw error
    }
    // lstat (not stat) so a symlink is caught here rather than dereferenced (D-4a).
    if (!stats.isFile()) {
      return { outcome: 'rejected', agent, reason: 'not-a-regular-file' }
    }

    let realResolvedPath: string
    try {
      realResolvedPath = await realpath(resolvedPath)
    } catch (error) {
      if (isENOENT(error)) {
        return { outcome: 'deleted' }
      }
      throw error
    }
    // Catches a regular file reached through a symlinked parent directory
    // that escapes the agent's roots, which lstat() on the leaf can't see (D-4b).
    if (realResolvedPath !== resolvedPath) {
      const revalidation = validateAiVaultSessionDeleteTarget({
        ...args,
        filePath: realResolvedPath
      })
      if (!revalidation.allowed) {
        return { outcome: 'rejected', agent, reason: revalidation.reason }
      }
    }

    try {
      await shell.trashItem(resolvedPath)
    } catch (error) {
      if (isENOENT(error)) {
        return { outcome: 'deleted' }
      }
      throw error
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
