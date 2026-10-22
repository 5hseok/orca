import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moveAgentSessionToWorktree } from './terminal-agent-session-move'

const calls: string[] = []
const agentStatusByPaneKey: Record<string, { agentType: string; state: string }> = {}
const store = {
  agentStatusByPaneKey,
  getKnownWorktreeById: (id: string) =>
    id === 'repo::/repo/feature' ? { id, repoId: 'repo', path: '/repo/feature' } : undefined,
  clearSleepingAgentSession: vi.fn((paneKey: string) => calls.push(`clear:${paneKey}`))
}
const collected = vi.fn()
const launch = vi.fn((_record: unknown, _options: unknown) => true)
const relocate = vi.fn()
let hostId = 'local'

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/store/slices/agent-status-recovery-collection', () => ({
  collectSleepingAgentSessionRecordsForWorktree: () => collected()
}))
vi.mock('@/lib/sleeping-agent-session-launch', () => ({
  launchSleepingAgentSession: (record: unknown, options: unknown) => {
    calls.push('launch')
    return launch(record, options)
  }
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => hostId
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab-1:${LEAF_ID}`
const record = {
  paneKey: PANE_KEY,
  tabId: 'tab-1',
  worktreeId: 'repo::/repo',
  agent: 'claude',
  providerSession: { sessionId: 'abc', transcriptPath: '/h/.claude/projects/-repo/abc.jsonl' }
}

function move(): Promise<boolean> {
  return moveAgentSessionToWorktree({
    tabId: 'tab-1',
    leafId: LEAF_ID,
    sourceWorktreeId: 'repo::/repo',
    targetWorktreeId: 'repo::/repo/feature',
    closeSource: () => calls.push('close')
  })
}

beforeEach(() => {
  calls.length = 0
  hostId = 'local'
  store.agentStatusByPaneKey = { [PANE_KEY]: { agentType: 'claude', state: 'done' } }
  collected.mockReturnValue({ [PANE_KEY]: record })
  launch.mockClear()
  relocate.mockReset()
  relocate.mockImplementation(async () => {
    calls.push('relocate')
    return { outcome: 'moved', transcriptPath: '/h/.claude/projects/-repo-feature/abc.jsonl' }
  })
  vi.stubGlobal('window', { api: { aiVault: { relocateClaudeTranscript: relocate } } })
})

describe('moveAgentSessionToWorktree', () => {
  it('retires the source pane before relaunching the session in the target workspace', async () => {
    await expect(move()).resolves.toBe(true)

    expect(calls).toEqual(['close', `clear:${PANE_KEY}`, 'relocate', 'launch'])
    expect(relocate).toHaveBeenCalledWith({
      transcriptPath: '/h/.claude/projects/-repo/abc.jsonl',
      targetCwd: '/repo/feature'
    })
    const [launched, options] = launch.mock.calls[0]
    expect(launched).toMatchObject({
      worktreeId: 'repo::/repo/feature',
      providerSession: { transcriptPath: '/h/.claude/projects/-repo-feature/abc.jsonl' }
    })
    expect(launched).not.toHaveProperty('tabId')
    expect(options).toEqual({ resumeInLaunchCwd: true })
  })

  it('leaves a working agent in place', async () => {
    store.agentStatusByPaneKey[PANE_KEY].state = 'working'

    await expect(move()).resolves.toBe(false)
    expect(calls).toEqual([])
  })

  it('resumes without moving files when the workspace runs on another host', async () => {
    hostId = 'ssh:box'

    await expect(move()).resolves.toBe(true)
    expect(relocate).not.toHaveBeenCalled()
    expect(calls).toEqual(['close', `clear:${PANE_KEY}`, 'launch'])
  })
})
