import { describe, expect, it } from 'vitest'
import { aiVaultSessionDeleteReasonText } from './ai-vault-session-delete-reason'

// translate() with no loaded catalog returns the English fallback, so these
// assertions pin the English copy and, crucially, the composition logic.
describe('aiVaultSessionDeleteReasonText', () => {
  it('explains a non-local host', () => {
    expect(
      aiVaultSessionDeleteReasonText({ deletable: false, reason: 'non-local-host' }, 'gemini')
    ).toBe('Only sessions on this device can be deleted.')
  })

  it('explains a session with no file of its own', () => {
    expect(
      aiVaultSessionDeleteReasonText({ deletable: false, reason: 'synthetic-path' }, 'opencode')
    ).toBe("This session doesn't have its own file to delete.")
  })

  it('names the agent and its single reason', () => {
    expect(
      aiVaultSessionDeleteReasonText(
        {
          deletable: false,
          reason: 'unsupported-agent',
          agentReasonCodes: ['directory-shaped-session']
        },
        'claude'
      )
    ).toBe("Claude sessions can't be deleted here: stores sessions as a folder, not a single file")
  })

  it('joins multiple reason codes with a semicolon (the array-shape core case)', () => {
    expect(
      aiVaultSessionDeleteReasonText(
        {
          deletable: false,
          reason: 'unsupported-agent',
          agentReasonCodes: ['directory-shaped-session', 'dangling-registry-entry']
        },
        'antigravity'
      )
    ).toBe(
      "Antigravity sessions can't be deleted here: stores sessions as a folder, not a single file; keeps its own session registry that Orca can't safely update"
    )
  })
})
