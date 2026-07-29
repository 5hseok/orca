import type { Repo } from '../../../../shared/types'
import {
  addHiddenWorktreeImportPaths,
  removeHiddenWorktreeImportPaths
} from '../../../../shared/hidden-worktree-import'
import { translate } from '@/i18n/i18n'

export type HiddenWorktreeImportActionState = {
  pending: boolean
  error: string | null
}

type HiddenWorktreeImportDeps = {
  projectId: string
  repo: Pick<Repo, 'importedExternalWorktreePaths'>
  worktreePaths: readonly string[]
  setActionState: (projectId: string, state: HiddenWorktreeImportActionState | null) => void
  updateRepo: (
    projectId: string,
    updates: Partial<Pick<Repo, 'importedExternalWorktreePaths'>>
  ) => Promise<boolean>
  fetchWorktrees: (
    projectId: string,
    options?: { requireAuthoritative?: boolean }
  ) => Promise<boolean>
}

function hiddenWorktreeImportError(): string {
  return translate(
    'auto.components.sidebar.hidden.worktree.import.actions.1bf57d9d59',
    'Could not import the selected worktrees. Try again.'
  )
}

function hiddenWorktreeHideError(): string {
  return translate(
    'auto.components.sidebar.hidden.worktree.import.actions.fa72047d1a',
    'Could not hide the selected worktrees. Try again.'
  )
}

async function applyImportedPaths(
  args: HiddenWorktreeImportDeps,
  nextPaths: string[],
  errorMessage: string
): Promise<void> {
  if (args.worktreePaths.length === 0) {
    return
  }
  const rollbackPaths = [...(args.repo.importedExternalWorktreePaths ?? [])]
  args.setActionState(args.projectId, { pending: true, error: null })
  const updated = await args.updateRepo(args.projectId, {
    importedExternalWorktreePaths: nextPaths
  })
  if (!updated) {
    args.setActionState(args.projectId, { pending: false, error: errorMessage })
    return
  }
  const refreshed = await args.fetchWorktrees(args.projectId, { requireAuthoritative: true })
  if (!refreshed) {
    await args.updateRepo(args.projectId, { importedExternalWorktreePaths: rollbackPaths })
    args.setActionState(args.projectId, { pending: false, error: errorMessage })
    return
  }
  args.setActionState(args.projectId, null)
}

export async function importHiddenWorktrees(args: HiddenWorktreeImportDeps): Promise<void> {
  await applyImportedPaths(
    args,
    addHiddenWorktreeImportPaths(args.repo.importedExternalWorktreePaths, args.worktreePaths),
    hiddenWorktreeImportError()
  )
}

export async function hideImportedWorktrees(args: HiddenWorktreeImportDeps): Promise<void> {
  await applyImportedPaths(
    args,
    removeHiddenWorktreeImportPaths(args.repo.importedExternalWorktreePaths, args.worktreePaths),
    hiddenWorktreeHideError()
  )
}
