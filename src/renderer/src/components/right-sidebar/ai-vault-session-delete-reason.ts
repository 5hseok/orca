import type { AiVaultAgent } from '../../../../shared/ai-vault-types'
import { agentLabel } from './ai-vault-session-filters'
import { translate } from '@/i18n/i18n'
import type { AiVaultSessionNotDeletableResult } from './ai-vault-session-deletability'

// Tooltip text for a disabled Delete item. Says which sessions are affected,
// never why — a provider's storage layout is Orca's problem, not the reader's.
export function aiVaultSessionDeleteReasonText(
  result: AiVaultSessionNotDeletableResult,
  agent: AiVaultAgent
): string {
  switch (result.reason) {
    case 'non-local-host':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonNonLocalHost',
        'Only sessions on this device can be deleted.'
      )
    case 'synthetic-path':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonSyntheticPath',
        "This session can't be deleted from Orca."
      )
    case 'unsupported-agent':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonUnsupportedAgent',
        "{{value0}} sessions can't be deleted from Orca.",
        { value0: agentLabel(agent) }
      )
    case 'session-live':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonSessionLive',
        'This session is still running — wait for it to finish before deleting.'
      )
  }
}
