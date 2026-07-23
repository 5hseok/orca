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

  it('blocks a directory-shaped agent (claude)', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'claude',
        executionHostId: 'local',
        filePath: '/home/user/.claude/sessions/sess-dir/log.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent'
    })
  })

  it('blocks a multi-cause agent (antigravity) with the same single reason', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'antigravity',
        executionHostId: 'local',
        filePath: '/home/user/.antigravity/brain/conv-1/.system_generated/logs/transcript.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent'
    })
  })

  it('blocks a registry/hardlink-backed agent (codex)', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'codex',
        executionHostId: 'local',
        filePath: '/home/user/.codex/sessions/log.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent'
    })
  })

  it('blocks opencode on a non-synthetic path as an unsupported agent', () => {
    expect(
      resolveAiVaultSessionDeletability({
        agent: 'opencode',
        executionHostId: 'local',
        filePath: '/home/user/.opencode/sessions/log.jsonl'
      })
    ).toEqual({
      deletable: false,
      reason: 'unsupported-agent'
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
