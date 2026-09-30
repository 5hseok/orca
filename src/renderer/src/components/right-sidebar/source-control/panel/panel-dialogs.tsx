import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { readSourceControlLaunchRecipeAgentId } from '../../../../../../shared/source-control-launch-agent-selection'
import {
  planSourceControlCompareBaseRefWrite,
  type SourceControlCompareBaseRefWrite
} from './compare-base-ref-write'
import { SourceControlDialogLayer } from './dialog-layer'
import type { SourceControlPanelReadyProps } from './panel-props'

/** Every modal the panel can raise, kept outside the scrolling surface so none of them clip. */
export function SourceControlPanelDialogs({
  activeRepo,
  activeWorktree,
  model
}: SourceControlPanelReadyProps) {
  const {
    activeConnectionId,
    activeGroupId,
    activeSourceControlLaunchPlatform,
    activeWorktreeId,
    baseRefDialogOpen,
    baseRefOwnedByWorktree,
    cancelPendingDiscard,
    commitGenerationDialogOpen,
    confirmPendingDiscard,
    getLaunchActionRecipe,
    handleConfirmDiffCommentsClear,
    handleGenerate,
    handleGeneratePullRequestFields,
    handleSaveCommitMessageGenerationDefaults,
    handleSavePullRequestGenerationDefaults,
    isClearingDiffComments,
    openSourceControlAiSettings,
    pendingDiffCommentsClearCount,
    pendingDiffCommentsClearDescription,
    pendingDiscard,
    pickerBaseRef,
    pullRequestGenerationDialogOpen,
    refreshBranchCompare,
    resolveConflictsComposerOpen,
    resolveConflictsPrompt,
    resolvedPendingDiffCommentsClear,
    saveLaunchActionDefault,
    setBaseRefDialogOpen,
    setCommitGenerationDialogOpen,
    setPendingDiffCommentsClear,
    setPullRequestGenerationDialogOpen,
    setResolveConflictsComposerOpen,
    settings,
    sourceControlAiActionsVisible,
    sourceControlAiDiscoveryHostKey,
    updateRepo,
    updateWorktreeMeta
  } = model

  const closeAndRefreshCompare = (): void => {
    setBaseRefDialogOpen(false)
    window.setTimeout(() => void refreshBranchCompare(), 0)
  }

  const applyCompareBaseRefWrite = (write: SourceControlCompareBaseRefWrite): boolean => {
    if (write.worktreeUpdate) {
      void updateWorktreeMeta(write.worktreeUpdate.worktreeId, {
        baseRef: write.worktreeUpdate.baseRef
      })
    }
    if (write.repoUpdate) {
      void updateRepo(write.repoUpdate.repoId, {
        worktreeBaseRef: write.repoUpdate.worktreeBaseRef
      })
    }
    return Boolean(write.worktreeUpdate || write.repoUpdate)
  }

  return (
    <SourceControlDialogLayer
      clearNotesOpen={resolvedPendingDiffCommentsClear !== null}
      clearNotesDescription={pendingDiffCommentsClearDescription}
      clearNotesCount={pendingDiffCommentsClearCount}
      isClearingNotes={isClearingDiffComments}
      onDismissClearNotes={() => setPendingDiffCommentsClear(null)}
      onConfirmClearNotes={() => void handleConfirmDiffCommentsClear()}
      pendingDiscard={pendingDiscard}
      onCancelDiscard={cancelPendingDiscard}
      onConfirmDiscard={confirmPendingDiscard}
      baseRefDialogOpen={baseRefDialogOpen}
      onBaseRefDialogOpenChange={setBaseRefDialogOpen}
      baseRefRepoId={activeRepo.id}
      pickerBaseRef={pickerBaseRef}
      baseRefOwnedByWorktree={baseRefOwnedByWorktree}
      onSelectBaseRef={(ref) => {
        if (
          !applyCompareBaseRefWrite(
            planSourceControlCompareBaseRefWrite({
              action: 'select',
              worktreeId: activeWorktreeId,
              ref
            })
          )
        ) {
          return
        }
        closeAndRefreshCompare()
      }}
      onUsePrimaryBaseRef={() => {
        if (
          !applyCompareBaseRefWrite(
            planSourceControlCompareBaseRefWrite({
              action: 'use-project-default',
              worktreeId: activeWorktreeId
            })
          )
        ) {
          return
        }
        closeAndRefreshCompare()
      }}
      onSetAsProjectDefault={() => {
        if (
          !applyCompareBaseRefWrite(
            planSourceControlCompareBaseRefWrite({
              action: 'set-project-default',
              repoId: activeRepo.id,
              ref: pickerBaseRef
            })
          )
        ) {
          return
        }
        toast.success(
          translate(
            'auto.components.right.sidebar.SourceControl.4c8f1e2a90',
            'Saved as project default'
          )
        )
        closeAndRefreshCompare()
      }}
      sourceControlAiActionsVisible={sourceControlAiActionsVisible}
      resolveConflictsComposerOpen={resolveConflictsComposerOpen}
      onResolveConflictsComposerOpenChange={setResolveConflictsComposerOpen}
      resolveConflictsPrompt={resolveConflictsPrompt}
      worktreeId={activeWorktreeId}
      groupId={activeGroupId ?? activeWorktreeId}
      connectionId={activeConnectionId}
      repoId={activeRepo.id}
      launchPlatform={activeSourceControlLaunchPlatform}
      savedResolveConflictsAgentId={readSourceControlLaunchRecipeAgentId(
        getLaunchActionRecipe('resolveConflicts')
      )}
      savedResolveConflictsCommandInputTemplate={
        getLaunchActionRecipe('resolveConflicts').commandInputTemplate ?? null
      }
      savedResolveConflictsAgentArgs={getLaunchActionRecipe('resolveConflicts').agentArgs ?? null}
      onSaveAgentDefault={saveLaunchActionDefault}
      onOpenSourceControlAiSettings={openSourceControlAiSettings}
      commitGenerationDialogOpen={commitGenerationDialogOpen}
      onCommitGenerationDialogOpenChange={setCommitGenerationDialogOpen}
      pullRequestGenerationDialogOpen={pullRequestGenerationDialogOpen}
      onPullRequestGenerationDialogOpenChange={setPullRequestGenerationDialogOpen}
      settings={settings}
      repo={activeRepo}
      discoveryHostKey={sourceControlAiDiscoveryHostKey}
      linkedIssue={activeWorktree.linkedIssue ?? null}
      onGenerateCommitMessage={(params) => {
        void handleGenerate({ sourceControlAiResolvedParams: params })
      }}
      onSaveCommitMessageDefaults={handleSaveCommitMessageGenerationDefaults}
      onGeneratePullRequestFields={(params) => {
        void handleGeneratePullRequestFields({ sourceControlAiResolvedParams: params })
      }}
      onSavePullRequestDefaults={handleSavePullRequestGenerationDefaults}
    />
  )
}
