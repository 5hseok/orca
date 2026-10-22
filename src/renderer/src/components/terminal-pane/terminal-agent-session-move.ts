import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { collectSleepingAgentSessionRecordsForWorktree } from '@/store/slices/agent-status-recovery-collection'
import { launchSleepingAgentSession } from '@/lib/sleeping-agent-session-launch'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { translate } from '@/i18n/i18n'

// Agents whose resume can be pointed at a different cwd without losing the conversation.
const MOVABLE_AGENTS: ReadonlySet<string> = new Set(['claude', 'codex'])

export type AgentSessionMoveTarget = {
  worktreeId: string
  label: string
}

export function canMoveAgentSession(agent: string | null | undefined): boolean {
  return agent ? MOVABLE_AGENTS.has(agent) : false
}

export function listAgentSessionMoveTargets(
  state: Pick<AppState, 'getKnownWorktreeById' | 'worktreesByRepo'> &
    Parameters<typeof getExecutionHostIdForWorktree>[0],
  sourceWorktreeId: string
): AgentSessionMoveTarget[] {
  const source = state.getKnownWorktreeById(sourceWorktreeId)
  if (!source) {
    return []
  }
  const sourceHost = getExecutionHostIdForWorktree(state, sourceWorktreeId)
  return (state.worktreesByRepo[source.repoId] ?? [])
    .filter(
      (worktree) =>
        worktree.id !== sourceWorktreeId &&
        getExecutionHostIdForWorktree(state, worktree.id) === sourceHost
    )
    .map((worktree) => ({ worktreeId: worktree.id, label: worktree.displayName || worktree.path }))
}

async function relocateClaudeTranscriptForMove(
  record: SleepingAgentSessionRecord,
  targetPath: string
): Promise<SleepingAgentSessionRecord> {
  const transcriptPath = record.providerSession.transcriptPath
  if (record.agent !== 'claude' || !transcriptPath) {
    return record
  }
  const result = await window.api.aiVault.relocateClaudeTranscript({
    transcriptPath,
    targetCwd: targetPath
  })
  if (result.outcome === 'moved') {
    return {
      ...record,
      providerSession: { ...record.providerSession, transcriptPath: result.transcriptPath }
    }
  }
  if (result.outcome !== 'unchanged') {
    // Why not fatal: resume by id still works; only Claude's /resume picker keeps it under the old folder.
    toast.warning(
      translate(
        'components.terminal.pane.agentSessionMove.transcriptNotMoved',
        'The conversation resumed, but its history file stayed in the old folder.'
      )
    )
  }
  return record
}

export async function moveAgentSessionToWorktree(args: {
  tabId: string
  leafId: string
  sourceWorktreeId: string
  targetWorktreeId: string
  closeSource: () => void
}): Promise<boolean> {
  const state = useAppStore.getState()
  const paneKey = makePaneKey(args.tabId, args.leafId)
  const entry = state.agentStatusByPaneKey[paneKey]
  const target = state.getKnownWorktreeById(args.targetWorktreeId)
  const record = collectSleepingAgentSessionRecordsForWorktree(state, args.sourceWorktreeId, {
    paneKeys: [paneKey]
  })[paneKey]
  if (!entry || !target || !record || !canMoveAgentSession(record.agent)) {
    toast.error(
      translate(
        'components.terminal.pane.agentSessionMove.unavailable',
        'This agent session cannot be moved.'
      )
    )
    return false
  }
  // Why: a turn in flight would keep writing the transcript after the pane is gone.
  if (entry.state === 'working') {
    toast.error(
      translate(
        'components.terminal.pane.agentSessionMove.busy',
        'Wait until the agent finishes its turn, then move it.'
      )
    )
    return false
  }

  args.closeSource()
  // Why: a record left under the source pane would auto-resume the same session there on wake.
  useAppStore.getState().clearSleepingAgentSession(paneKey)

  const isLocal =
    getExecutionHostIdForWorktree(useAppStore.getState(), args.targetWorktreeId) ===
    LOCAL_EXECUTION_HOST_ID
  const movedRecord = isLocal ? await relocateClaudeTranscriptForMove(record, target.path) : record
  const { tabId: _sourceTabId, ...recordWithoutTab } = movedRecord
  activateAndRevealWorktree(args.targetWorktreeId)
  return launchSleepingAgentSession(
    { ...recordWithoutTab, worktreeId: args.targetWorktreeId },
    { resumeInLaunchCwd: true }
  )
}
