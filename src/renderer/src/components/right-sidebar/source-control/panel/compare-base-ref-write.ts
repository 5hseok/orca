export type SourceControlCompareBaseRefWrite = {
  worktreeUpdate?: { worktreeId: string; baseRef: string | undefined }
  repoUpdate?: { repoId: string; worktreeBaseRef: string }
}

/**
 * Source Control compare-base writes.
 * Why: picking a compare ref used to mutate the repo pin when the worktree had
 * no baseRef yet, so every workspace of the project jumped together.
 */
export function planSourceControlCompareBaseRefWrite(
  input:
    | { action: 'select'; worktreeId: string | null; ref: string }
    | { action: 'use-project-default'; worktreeId: string | null }
    | { action: 'set-project-default'; repoId: string; ref: string | null | undefined }
): SourceControlCompareBaseRefWrite {
  if (input.action === 'select') {
    const ref = input.ref.trim()
    if (!input.worktreeId || !ref) {
      return {}
    }
    return { worktreeUpdate: { worktreeId: input.worktreeId, baseRef: ref } }
  }
  if (input.action === 'use-project-default') {
    if (!input.worktreeId) {
      return {}
    }
    return { worktreeUpdate: { worktreeId: input.worktreeId, baseRef: undefined } }
  }
  const ref = input.ref?.trim()
  if (!ref) {
    return {}
  }
  return { repoUpdate: { repoId: input.repoId, worktreeBaseRef: ref } }
}
