import {
  areExternalWorktreeInboxPathsEqual,
  isExplicitlyImportedExternalWorktreePath,
  mergeExternalWorktreeInboxPaths
} from './external-worktree-inbox'
import { isLegacyRepoForExternalWorktreeVisibility } from './external-worktree-visibility'
import { shouldShowWorktree } from './worktree-ownership'
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
 * Visible only because a path was individually imported. A worktree the repo
 * would show anyway is excluded: dropping its path would leave it on screen, so
 * the hide action would be a no-op. Asking `shouldShowWorktree` with the import
 * list withheld keeps that judgement on the one rule that owns it.
 */
export function getIndividuallyImportedWorktrees(
  detected: DetectedWorktreeListResult | undefined,
  repo: Repo | null | undefined
): DetectedWorktree[] {
  if (detected?.authoritative !== true || !repo) {
    return []
  }
  const isLegacyRepoForVisibility = isLegacyRepoForExternalWorktreeVisibility(repo)
  return detected.worktrees.filter((worktree) => {
    if (!isImportCandidate(worktree) || !worktree.visible) {
      return false
    }
    if (!isExplicitlyImportedExternalWorktreePath(worktree.path, repo)) {
      return false
    }
    return !shouldShowWorktree({
      worktree,
      ownership: worktree.ownership,
      repo,
      isLegacyRepoForVisibility,
      isSelectedCheckout: worktree.selectedCheckout,
      importedExternalWorktreePaths: undefined
    })
  })
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
