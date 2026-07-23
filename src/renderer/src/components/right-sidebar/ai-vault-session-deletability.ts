import {
  AI_VAULT_UNSUPPORTED_DELETE_REASONS,
  isAiVaultDeletableAgent,
  type AiVaultUnsupportedDeleteReasonCode
} from '../../../../shared/ai-vault-session-deletion'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  canUseLocalAiVaultSessionPathActions,
  isSyntheticAiVaultSessionPath
} from './ai-vault-session-path-actions'

export type AiVaultSessionDeletabilityReasonCode =
  | 'non-local-host'
  | 'synthetic-path'
  | 'unsupported-agent'

export type AiVaultSessionDeletableResult = { deletable: true }

export type AiVaultSessionNotDeletableResult =
  | { deletable: false; reason: 'non-local-host' }
  | { deletable: false; reason: 'synthetic-path' }
  | {
      deletable: false
      reason: 'unsupported-agent'
      // Why an array, not one code: an agent can carry more than one cause
      // (e.g. antigravity is directory-shaped AND registry-backed), and a S-5
      // tooltip can join all of them without re-deriving them from the agent.
      agentReasonCodes: readonly AiVaultUnsupportedDeleteReasonCode[]
    }

export type AiVaultSessionDeletabilityResult =
  | AiVaultSessionDeletableResult
  | AiVaultSessionNotDeletableResult

/**
 * Renderer-side judgement of whether AI Vault's UI should offer Delete for a
 * session: enabled, or disabled with a reason a tooltip can render. This is
 * NOT the security boundary — the main-process validator (D-4) re-checks the
 * path on disk regardless of what this returns. Host and synthetic-path
 * checks come first because they are agent-independent gates; only then is
 * the shared deletable-agent set consulted.
 */
export function resolveAiVaultSessionDeletability(
  session: Pick<AiVaultSession, 'agent' | 'executionHostId' | 'filePath'>
): AiVaultSessionDeletabilityResult {
  if (!canUseLocalAiVaultSessionPathActions(session.executionHostId)) {
    return { deletable: false, reason: 'non-local-host' }
  }
  if (isSyntheticAiVaultSessionPath(session.filePath)) {
    return { deletable: false, reason: 'synthetic-path' }
  }
  if (!isAiVaultDeletableAgent(session.agent)) {
    return {
      deletable: false,
      reason: 'unsupported-agent',
      agentReasonCodes: AI_VAULT_UNSUPPORTED_DELETE_REASONS[session.agent]
    }
  }
  return { deletable: true }
}
