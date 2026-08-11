import { posix, resolve } from 'node:path'
import type { Repo } from '../../shared/types'
import type { Store } from '../persistence'
import { listRepoWorktrees } from '../repo-worktrees'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { resolveRegisteredWorktreePath } from './filesystem-auth'

/**
 * Authorize a caller-supplied worktree path against one repo.
 *
 * Why both checks: `resolveRegisteredWorktreePath` only proves the path is a
 * worktree Orca knows about, not that it belongs to `repo`. Without the second
 * step a caller can pair one repo's configuration with another repo's worktree.
 */
export async function resolveRepoOwnedWorktreePath(
  repo: Repo,
  store: Store,
  worktreePath?: string
): Promise<string> {
  if (!worktreePath) {
    return repo.path
  }
  if (repo.connectionId) {
    const remoteWorktreePath = normalizeRemoteWorktreePath(worktreePath)
    const repoWorktrees = await listRepoWorktrees(repo)
    if (
      !repoWorktrees.some(
        (worktree) => normalizeRemoteWorktreePath(worktree.path) === remoteWorktreePath
      )
    ) {
      throw new Error('Access denied: worktree does not belong to repository')
    }
    return remoteWorktreePath
  }
  const resolvedWorktreePath = await resolveRegisteredWorktreePath(worktreePath, store)
  const localGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
  const repoWorktrees =
    Object.keys(localGitOptions).length > 0
      ? await listRepoWorktrees(repo, localGitOptions)
      : await listRepoWorktrees(repo)
  if (!repoWorktrees.some((worktree) => resolve(worktree.path) === resolvedWorktreePath)) {
    throw new Error('Access denied: worktree does not belong to repository')
  }
  return resolvedWorktreePath
}

export function normalizeRemoteWorktreePath(remotePath: string): string {
  if (!remotePath || remotePath.includes('\0')) {
    throw new Error('Access denied: invalid worktree path')
  }
  // Why: SSH worktree paths belong to the remote POSIX host. Local path.resolve
  // rewrites them on Windows and cannot authorize remote-only paths.
  const normalized = posix.normalize(remotePath)
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}
