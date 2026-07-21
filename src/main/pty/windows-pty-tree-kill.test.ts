import { describe, expect, it, vi } from 'vitest'
import { forceKillWindowsProcessTree } from './windows-pty-tree-kill'

function mockKiller() {
  return { on: vi.fn(), unref: vi.fn() }
}

describe('forceKillWindowsProcessTree', () => {
  it('spawns taskkill /t /f for the pid without a shell', () => {
    const killer = mockKiller()
    const spawnProcess = vi.fn().mockReturnValue(killer)

    forceKillWindowsProcessTree(4321, { spawnProcess })

    expect(spawnProcess).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
    // Why: an async spawn failure must be swallowed, not left to crash the daemon.
    expect(killer.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(killer.unref).toHaveBeenCalled()
  })

  it('never throws when taskkill cannot be spawned', () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('taskkill not found')
    })

    expect(() => forceKillWindowsProcessTree(4321, { spawnProcess })).not.toThrow()
  })

  it('does not signal an invalid or recycled pid', () => {
    const spawnProcess = vi.fn()

    forceKillWindowsProcessTree(0, { spawnProcess })
    forceKillWindowsProcessTree(-1, { spawnProcess })
    forceKillWindowsProcessTree(Number.NaN, { spawnProcess })

    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('swallows a synchronous error handler registration failure', () => {
    const spawnProcess = vi.fn().mockReturnValue(null)

    expect(() => forceKillWindowsProcessTree(4321, { spawnProcess })).not.toThrow()
  })
})
