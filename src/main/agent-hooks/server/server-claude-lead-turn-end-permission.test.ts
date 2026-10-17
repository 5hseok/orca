import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import { shouldKeepClaudePermissionVisible } from './server-claude-status-rules'
import type { EnrichedAgentHookEventPayload } from './server-types'

const leadPermission: EnrichedAgentHookEventPayload = {
  paneKey: 'tab-1:pane-1',
  connectionId: null,
  receivedAt: 1,
  stateStartedAt: 1,
  hookEventName: 'PermissionRequest',
  payload: { state: 'waiting', agentType: 'claude', prompt: 'run it', toolName: 'Bash' }
}

function claudeWorking(hookEventName: string, toolAgentId?: string): AgentHookEventPayload {
  return {
    paneKey: 'tab-1:pane-1',
    connectionId: null,
    hookEventName,
    ...(toolAgentId ? { toolAgentId } : {}),
    payload: { state: 'working', workingMode: 'monitoring', agentType: 'claude', prompt: 'run it' }
  }
}

describe('lead permission latch at turn end', () => {
  it('releases when the lead Stop still folds to working because background work runs', () => {
    expect(shouldKeepClaudePermissionVisible(leadPermission, claudeWorking('Stop'))).toBe(false)
    expect(shouldKeepClaudePermissionVisible(leadPermission, claudeWorking('StopFailure'))).toBe(
      false
    )
  })

  it('keeps the latch for an unrelated working event before the approved tool resumes', () => {
    expect(shouldKeepClaudePermissionVisible(leadPermission, claudeWorking('SubagentStart'))).toBe(
      true
    )
  })

  it('does not let a child agent Stop release the lead permission', () => {
    expect(
      shouldKeepClaudePermissionVisible(leadPermission, claudeWorking('Stop', 'agent-child'))
    ).toBe(true)
  })
})
