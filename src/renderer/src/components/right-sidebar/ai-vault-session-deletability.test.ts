import { describe, expect, it } from 'vitest'
import { resolveAiVaultSessionDeletability } from './ai-vault-session-deletability'

describe('resolveAiVaultSessionDeletability', () => {
  it('allows a deletable agent on a local, real path', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'gemini',
        executionHostId: 'local',
        filePath: '/home/user/.gemini/sessions/log.jsonl'
      })
    ).toEqual({ deletable: true })
  })

  it('blocks an ssh-hosted session regardless of agent', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'gemini',
        executionHostId: 'ssh:dev-box',
        filePath: '/home/user/.gemini/sessions/log.jsonl'
      })
    ).toEqual({ deletable: false, reason: 'non-local-host' })
  })

  it('blocks a runtime-hosted session regardless of agent', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'gemini',
        executionHostId: 'runtime:gpu-box',
        filePath: '/home/user/.gemini/sessions/log.jsonl'
      })
    ).toEqual({ deletable: false, reason: 'non-local-host' })
  })

  it('blocks a synthetic OpenCode SQLite row identity', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'opencode',
        executionHostId: 'local',
        filePath: '/home/user/.opencode/db.sqlite#sess_123'
      })
    ).toEqual({
      deletable: false,
      reason: 'synthetic-path'
    })
  })

  it('blocks a directory-shaped agent (claude) with its shared reason codes', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'claude',
        executionHostId: 'local',
        filePath: '/home/user/.claude/sessions/sess-dir/log.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent',
      agentReasonCodes: ['directory-shaped-session']
    })
  })

  it('surfaces both reason codes for an agent with multiple causes (antigravity)', () => {
    // Why this case matters: agentReasonCodes is an array precisely so a
    // multi-cause agent (directory-shaped AND registry-backed) can drive a
    // tooltip that lists every reason. If this collapsed to one code the array
    // shape would be dead weight.
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'antigravity',
        executionHostId: 'local',
        filePath: '/home/user/.antigravity/brain/conv-1/.system_generated/logs/transcript.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent',
      agentReasonCodes: ['directory-shaped-session', 'dangling-registry-entry']
    })
  })

  it('blocks a registry/hardlink-backed agent (codex) with its shared reason codes', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'codex',
        executionHostId: 'local',
        filePath: '/home/user/.codex/sessions/log.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent',
      agentReasonCodes: ['dangling-registry-entry', 'codex-hardlink-aliases']
    })
  })

  it('blocks opencode on a non-synthetic path with its synthetic-storage reason code', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'opencode',
        executionHostId: 'local',
        filePath: '/home/user/.opencode/sessions/log.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent',
      agentReasonCodes: ['synthetic-storage-path']
    })
  })

  it('prioritizes the host gate over the unsupported-agent reason', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'claude',
        executionHostId: 'ssh:dev-box',
        filePath: '/home/user/.claude/sessions/sess-dir/log.jsonl'
      })
    ).toEqual({ deletable: false, reason: 'non-local-host' })
  })
})
