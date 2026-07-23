import type { AiVaultUnsupportedDeleteReasonCode } from '../../../../shared/ai-vault-session-deletion'
import type { AiVaultAgent } from '../../../../shared/ai-vault-types'
import { agentLabel } from './ai-vault-session-filters'
import { translate } from '@/i18n/i18n'
import type { AiVaultSessionNotDeletableResult } from './ai-vault-session-deletability'

// Short, lowercase fragments composed into "{{agent}} sessions can't be
// deleted here: {{fragments}}" — one entry per AiVaultUnsupportedDeleteReasonCode.
function unsupportedAgentReasonFragment(code: AiVaultUnsupportedDeleteReasonCode): string {
  switch (code) {
    case 'directory-shaped-session':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonDirectoryShapedSession',
        'stores sessions as a folder, not a single file'
      )
    case 'dangling-registry-entry':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonDanglingRegistryEntry',
        "keeps its own session registry that Orca can't safely update"
      )
    case 'codex-hardlink-aliases':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonCodexHardlinkAliases',
        'may link one transcript under multiple session IDs'
      )
    case 'synthetic-storage-path':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonSyntheticStoragePath',
        'stores sessions in a shared database file, not a file of their own'
      )
  }
}

/**
 * Maps a not-deletable judgement to the reason tooltip text shown on the
 * disabled Delete menu item (D-2). Not the security boundary — see
 * ai-vault-session-deletability.ts.
 */
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
        "This session doesn't have its own file to delete."
      )
    case 'unsupported-agent':
      return translate(
        'auto.components.right.sidebar.AiVaultSessionRow.deleteReasonUnsupportedAgent',
        "{{value0}} sessions can't be deleted here: {{value1}}",
        {
          value0: agentLabel(agent),
          value1: result.agentReasonCodes.map(unsupportedAgentReasonFragment).join('; ')
        }
      )
  }
}
