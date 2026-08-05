import { isAiVaultDeletableAgent } from '../../../../shared/ai-vault-session-deletion'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { AgentStatusState } from '../../../../shared/agent-status-types'
import {
  canUseLocalAiVaultSessionPathActions,
  isSyntheticAiVaultSessionPath
} from './ai-vault-session-path-actions'

export type AiVaultSessionDeletabilityReasonCode =
  | 'non-local-host'
  | 'synthetic-path'
  | 'unsupported-agent'
  | 'session-live'

// Matches the active-dot rule in ai-vault-session-row-display.
function isSessionLive(liveState: AgentStatusState | null | undefined): boolean {
  return liveState != null && liveState !== 'done'
}

export type AiVaultSessionDeletableResult = { deletable: true }

export type AiVaultSessionNotDeletableResult = {
  deletable: false
  reason: AiVaultSessionDeletabilityReasonCode
}

export type AiVaultSessionDeletabilityResult =
  | AiVaultSessionDeletableResult
  | AiVaultSessionNotDeletableResult

/**
 * Whether the UI offers Delete, and if not, the reason a tooltip renders. NOT
 * the security boundary — main re-validates the path on disk regardless.
 *
 * The two sides agree on deletable-or-not but deliberately not on the reason
 * code: this checks host -> synthetic -> agent so an SSH session reads as
 * "remote" rather than "unsupported agent", where main checks agent first. A
 * session failing two gates can name a different reason on each side, which is
 * harmless since a non-deletable session never reaches main. What must hold is
 * that renderer-deletable is a subset of main-deletable, and it does: both
 * consult the same shared agent set and host/synthetic predicates.
 */
export function resolveAiVaultSessionDeletability(
  session: Pick<AiVaultSession, 'agent' | 'executionHostId' | 'filePath'>,
  liveState?: AgentStatusState | null
): AiVaultSessionDeletabilityResult {
  if (!canUseLocalAiVaultSessionPathActions(session.executionHostId)) {
    return { deletable: false, reason: 'non-local-host' }
  }
  if (isSyntheticAiVaultSessionPath(session.filePath)) {
    return { deletable: false, reason: 'synthetic-path' }
  }
  if (!isAiVaultDeletableAgent(session.agent)) {
    return { deletable: false, reason: 'unsupported-agent' }
  }
  // Last, so an otherwise-deletable session reads as "wait for it to finish"
  // rather than a permanent reason. Trashing a live transcript would drop the
  // writes the agent is still appending.
  if (isSessionLive(liveState)) {
    return { deletable: false, reason: 'session-live' }
  }
  return { deletable: true }
}
