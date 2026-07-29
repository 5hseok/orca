import {
  areExternalWorktreeInboxPathsEqual,
  isExplicitlyImportedExternalWorktreePath,
  mergeExternalWorktreeInboxPaths
} from './external-worktree-inbox'
import type { DetectedWorktree, DetectedWorktreeListResult, Repo } from './types'

/**
 * Per-worktree import for anything Orca keeps out of the sidebar: non-Orca
 * worktrees while the repo-wide toggle stays `hide`, and agent scratch
 * worktrees, which the toggle never reveals by design (#9535). Both are
 * revealed by an explicit path in `importedExternalWorktreePaths`.
 */
function isImportCandidate(worktree: DetectedWorktree): boolean {
  return !worktree.selectedCheckout && worktree.ownership !== 'orca-managed'
}

export function getImportableHiddenWorktrees(
  detected: DetectedWorktreeListResult | undefined
): DetectedWorktree[] {
  if (detected?.authoritative !== true) {
    return []
  }
  return detected.worktrees.filter((worktree) => isImportCandidate(worktree) && !worktree.visible)
}

/**
 * Visible only because a path was individually imported. Worktrees the
 * repo-wide `show` toggle reveals are excluded: dropping their path would not
 * hide them, so offering the action would be a no-op.
 */
export function getIndividuallyImportedWorktrees(
  detected: DetectedWorktreeListResult | undefined,
  repo: Pick<Repo, 'importedExternalWorktreePaths'>
): DetectedWorktree[] {
  if (detected?.authoritative !== true) {
    return []
  }
  return detected.worktrees.filter(
    (worktree) =>
      isImportCandidate(worktree) &&
      worktree.visible &&
      isExplicitlyImportedExternalWorktreePath(worktree.path, repo)
  )
}

export function addHiddenWorktreeImportPaths(
  existing: readonly string[] | undefined,
  additions: readonly string[]
): string[] {
  return mergeExternalWorktreeInboxPaths(existing, additions)
}

export function removeHiddenWorktreeImportPaths(
  existing: readonly string[] | undefined,
  removals: readonly string[]
): string[] {
  return (existing ?? []).filter(
    (path) => !removals.some((removal) => areExternalWorktreeInboxPathsEqual(path, removal))
  )
}
