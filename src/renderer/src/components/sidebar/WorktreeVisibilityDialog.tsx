import React, { useCallback, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAppStore } from '@/store'
import { findRepoForHost, getRepoHostIdentity } from '@/store/slices/repo-host-identity'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  getHiddenExternalWorktrees,
  getVisibleExternalWorktrees
} from '../../../../shared/external-worktree-inbox'
import {
  getImportableHiddenWorktrees,
  getIndividuallyImportedWorktrees
} from '../../../../shared/hidden-worktree-import'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../shared/worktree-ownership'
import HiddenWorktreeImportSection from './HiddenWorktreeImportSection'
import {
  hideImportedWorktrees,
  importHiddenWorktrees,
  type HiddenWorktreeImportActionState
} from './hidden-worktree-import-actions'
import { translate } from '@/i18n/i18n'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'

function detectedWorktreeMatchesHost(
  worktree: Parameters<typeof getWorktreeExecutionHostId>[0] & {
    runtimeOwnerEnvironmentId?: string
  },
  hostId: string
): boolean {
  if (
    worktree.runtimeOwnerEnvironmentId &&
    toRuntimeExecutionHostId(worktree.runtimeOwnerEnvironmentId) === hostId
  ) {
    return true
  }
  return getWorktreeExecutionHostId(worktree, undefined) === hostId
}

export default function WorktreeVisibilityDialog(): React.JSX.Element | null {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const repos = useAppStore((s) => s.repos)
  const settings = useAppStore((s) => s.settings)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const fetchWorktrees = useAppStore((s) => s.fetchWorktrees)
  const detectedWorktreesByRepo = useAppStore((s) => s.detectedWorktreesByRepo)

  const repoId = typeof modalData.repoId === 'string' ? modalData.repoId : ''
  const requestedHostId = typeof modalData.hostId === 'string' ? modalData.hostId : null
  const repo = findRepoForHost(repos, repoId, { hostId: requestedHostId, settings })
  const repoHostId = repo ? getRepoExecutionHostId(repo) : null
  const detectedForRepo = repoId ? detectedWorktreesByRepo[repoId] : undefined
  const detected =
    detectedForRepo && repoHostId
      ? {
          ...detectedForRepo,
          worktrees: detectedForRepo.worktrees.filter((worktree) =>
            detectedWorktreeMatchesHost(worktree, repoHostId)
          )
        }
      : undefined
  const showOther = repo
    ? effectiveExternalWorktreeVisibility(repo, isLegacyRepoForExternalWorktreeVisibility(repo)) ===
      'show'
    : false
  const hiddenCount = getHiddenExternalWorktrees(detected).length
  const otherCount = getVisibleExternalWorktrees(detected).length
  const hiddenWorktreeLabel = `${hiddenCount} ${hiddenCount === 1 ? 'worktree' : 'worktrees'}`
  const shownWorktreeLabel = `${otherCount} ${otherCount === 1 ? 'worktree' : 'worktrees'}`
  const importableWorktrees = getImportableHiddenWorktrees(detected)
  const individuallyImportedWorktrees = getIndividuallyImportedWorktrees(detected, repo)

  // Why: the dialog is reused across projects, so a pending or failed action
  // from one must not disable controls or report an error against the next.
  const [importActionState, setImportActionState] = useState<{
    repoHostIdentity: string
    state: HiddenWorktreeImportActionState
  } | null>(null)
  const importActionGenerationRef = useRef(0)
  const repoHostIdentity = repo ? getRepoHostIdentity(repo) : null
  const activeImportActionState =
    importActionState?.repoHostIdentity === repoHostIdentity ? importActionState.state : null

  const runImportAction = useCallback(
    (
      action: typeof importHiddenWorktrees | typeof hideImportedWorktrees,
      worktreePaths: string[]
    ) => {
      if (!repo || !repoHostIdentity) {
        return
      }
      const actionHostId = getRepoExecutionHostId(repo)
      const actionGeneration = ++importActionGenerationRef.current
      void action({
        projectId: repo.id,
        repo,
        worktreePaths,
        setActionState: (_projectId, state) => {
          if (actionGeneration === importActionGenerationRef.current) {
            setImportActionState(state ? { repoHostIdentity, state } : null)
          }
        },
        updateRepo: (projectId, updates) =>
          updateRepo(projectId, updates, { hostId: actionHostId }),
        fetchWorktrees: (projectId, options) =>
          fetchWorktrees(projectId, { ...options, executionHostId: actionHostId })
      })
    },
    [fetchWorktrees, repo, repoHostIdentity, updateRepo]
  )

  const handleImport = useCallback(
    (worktreePaths: string[]) => runImportAction(importHiddenWorktrees, worktreePaths),
    [runImportAction]
  )

  const handleHide = useCallback(
    (worktreePaths: string[]) => runImportAction(hideImportedWorktrees, worktreePaths),
    [runImportAction]
  )

  const handleToggle = useCallback(async () => {
    if (!repoId || !repoHostId) {
      return
    }
    await updateRepo(
      repoId,
      {
        externalWorktreeVisibility: showOther ? 'hide' : 'show',
        // Why: showing hidden externals again should re-enable the inbox if the
        // user previously opted out of discovery prompts for this repo.
        // Why: null is the transport sentinel for clearing on remote runtime paths
        // where `undefined` is stripped before persistence.
        ...(!showOther ? { externalWorktreeDiscoverySuppressedAt: null } : {})
      },
      { hostId: repoHostId }
    )
    await fetchWorktrees(repoId, { executionHostId: repoHostId })
    closeModal()
  }, [closeModal, fetchWorktrees, repoHostId, repoId, showOther, updateRepo])

  if (activeModal !== 'worktree-visibility' || !repo || !isGitRepoKind(repo)) {
    return null
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto scrollbar-sleek sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.sidebar.WorktreeVisibilityDialog.83a5ba8dd1',
              'Non-Orca worktrees'
            )}
          </DialogTitle>
          <DialogDescription>{repo.displayName}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            {showOther ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {showOther
                ? translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.3e045d4cb8',
                    'Shown in sidebar'
                  )
                : translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.5d02a5647f',
                    'Hidden from sidebar'
                  )}
            </div>
            <div className="text-xs text-muted-foreground">
              {showOther
                ? translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.8372e4bbd9',
                    '{{value0}} currently shown',
                    { value0: shownWorktreeLabel }
                  )
                : translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.25ddf19920',
                    '{{value0}} available to import',
                    { value0: hiddenWorktreeLabel }
                  )}
            </div>
          </div>
          <Button
            type="button"
            variant={showOther ? 'secondary' : 'outline'}
            onClick={handleToggle}
          >
            {showOther
              ? translate('auto.components.sidebar.WorktreeVisibilityDialog.759371df43', 'Hide')
              : translate('auto.components.sidebar.WorktreeVisibilityDialog.f1f71b9f02', 'Import')}
          </Button>
        </div>

        <HiddenWorktreeImportSection
          importableWorktrees={importableWorktrees}
          importedWorktrees={individuallyImportedWorktrees}
          pending={activeImportActionState?.pending ?? false}
          error={activeImportActionState?.error ?? null}
          onImport={handleImport}
          onHide={handleHide}
        />
      </DialogContent>
    </Dialog>
  )
}
