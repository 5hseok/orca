import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store/types'
import { findTerminalIncarnationHandle } from './terminal-close-incarnation'

function makeState(ptyIds: string[]): Pick<AppState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'> {
  return {
    ptyIdsByTabId: { 'tab-1': ptyIds },
    terminalLayoutsByTabId: {}
  }
}

describe('terminal close incarnation', () => {
  it('selects only a terminal handle owned by the target runtime environment', () => {
    const state = makeState([
      'remote:other-env@@other-terminal',
      'remote:target-env@@target-terminal'
    ])

    expect(findTerminalIncarnationHandle(state, 'tab-1', 'target-env')).toBe('target-terminal')
  })

  it('does not reinterpret native, WSL, or SSH identities as runtime authority', () => {
    const state = makeState([
      'remote:legacy-unscoped-handle',
      'native-pty',
      'wsl:Ubuntu:pty-1',
      'ssh:host:pty-2'
    ])

    expect(findTerminalIncarnationHandle(state, 'tab-1', 'target-env')).toBeNull()
  })
})
