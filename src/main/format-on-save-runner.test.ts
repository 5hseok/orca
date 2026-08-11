import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EventEmitter } from 'node:events'

const spawnMock = vi.fn()
const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

vi.mock('./wsl', () => ({
  parseWslPath: vi.fn(() => null),
  toLinuxPath: vi.fn((value: string) => value)
}))

import {
  _resetFormatOnSaveInFlightForTests,
  FORMAT_ON_SAVE_TIMEOUT_MS,
  runFormatOnSave
} from './format-on-save-runner'
import { parseWslPath } from './wsl'
import type { RepoFormatOnSaveSettings } from '../shared/types'

const enabledSettings: RepoFormatOnSaveSettings = {
  enabled: true,
  command: 'prettier --write ${file}',
  include: ['**/*.ts']
}

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

const IS_WINDOWS_HOST = process.platform === 'win32'

/** Quotes a path the way the runner does on whichever host the suite runs on. */
function hostQuoted(value: string): string {
  return IS_WINDOWS_HOST ? `"${value}"` : `'${value}'`
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid: number | undefined = 4242
  kill = vi.fn()
}

let lastChild: FakeChildProcess | null = null

/** Drives the spawned child to a close, mirroring the real event order. */
function spawnResolvesWith(code: number | null, stdout = '', stderr = ''): void {
  spawnMock.mockImplementation(() => {
    const child = new FakeChildProcess()
    lastChild = child
    queueMicrotask(() => {
      if (stdout) {
        child.stdout.emit('data', stdout)
      }
      if (stderr) {
        child.stderr.emit('data', stderr)
      }
      child.emit('close', code)
    })
    return child
  })
}

/** Spawns a child that never closes until the returned callback runs. */
function spawnPending(): () => void {
  let release: (() => void) | undefined
  spawnMock.mockImplementation(() => {
    const child = new FakeChildProcess()
    lastChild = child
    release = () => child.emit('close', 0)
    return child
  })
  return () => release?.()
}

function spawnedCommand(callIndex = 0): string {
  const args = spawnMock.mock.calls[callIndex][1] as string[]
  return args.at(-1) ?? ''
}

function resolveExecWith(error: Error | null, stdout = '', stderr = ''): void {
  spawnResolvesWith(error ? 1 : 0, stdout, error && !stderr && !stdout ? error.message : stderr)
}

beforeEach(() => {
  spawnMock.mockReset()
  execFileMock.mockReset()
  lastChild = null
  _resetFormatOnSaveInFlightForTests()
  vi.mocked(parseWslPath).mockReturnValue(null)
  spawnResolvesWith(0)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('runFormatOnSave', () => {
  it('skips when the repo has no formatter configured', async () => {
    await expect(
      runFormatOnSave({
        settings: { enabled: false, command: '', include: [] },
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'not-configured' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('skips files the include globs do not cover', async () => {
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.css'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'not-included' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses to format a file outside the worktree', async () => {
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/elsewhere/src/a.ts'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'outside-worktree' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('runs the command in the worktree root with the saved path substituted', async () => {
    await runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })

    // Why: quoting follows the host shell, so derive the expectation instead of
    // hardcoding POSIX quotes — this suite also runs on Windows CI.
    expect(spawnedCommand()).toBe(`prettier --write ${hostQuoted('/repo/src/a.ts')}`)
    expect((spawnMock.mock.calls[0][2] as { cwd: string }).cwd).toBe('/repo')
  })

  it('reports the formatter stderr when the command exits non-zero', async () => {
    resolveExecWith(new Error('Command failed'), '', 'SyntaxError: Unexpected token (3:1)')

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
    ).resolves.toEqual({
      status: 'failed',
      message: 'SyntaxError: Unexpected token (3:1)'
    })
  })

  it('falls back to the process error when the formatter prints nothing', async () => {
    resolveExecWith(new Error('spawn prettier ENOENT'))

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
    ).resolves.toEqual({ status: 'failed', message: 'spawn prettier ENOENT' })
  })

  it('skips a second run while the same file is still being formatted', async () => {
    const release = spawnPending()

    const first = runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'already-running' })

    release()
    await expect(first).resolves.toEqual({ status: 'completed' })
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('frees the in-flight slot after a failed run so the next save can format', async () => {
    resolveExecWith(new Error('Command failed'), '', 'boom')
    await runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })

    resolveExecWith(null)
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
    ).resolves.toEqual({ status: 'completed' })
  })

  it('keeps posix paths case-sensitive so two real files never share a slot', async () => {
    spawnResolvesWith(0)
    const anyFile = { ...enabledSettings, include: [] }

    await runFormatOnSave({
      settings: anyFile,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })
    await runFormatOnSave({
      settings: anyFile,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/A.TS'
    })

    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('does not report a chatty but successful formatter as failed', async () => {
    // Why: `black --verbose` and `prettier --loglevel debug` succeed while
    // printing megabytes; output volume must not turn into an error.
    spawnResolvesWith(0, 'x'.repeat(4 * 1024 * 1024), 'y'.repeat(4 * 1024 * 1024))

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
    ).resolves.toEqual({ status: 'completed' })
  })

  it('kills the whole process group when the formatter times out', async () => {
    vi.useFakeTimers()
    try {
      spawnPending()
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      const pending = runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.ts'
      })
      await vi.advanceTimersByTimeAsync(FORMAT_ON_SAVE_TIMEOUT_MS + 10)

      if (process.platform === 'win32') {
        expect(execFileMock).toHaveBeenCalledWith(
          'taskkill',
          expect.arrayContaining(['/t', '/f']),
          expect.any(Function)
        )
      } else {
        // Why: the negative pid reaches the formatter the shell spawned, which a
        // plain child.kill() would leave running to overwrite a later save.
        expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL')
      }

      lastChild?.emit('close', null)
      await expect(pending).resolves.toMatchObject({
        status: 'failed',
        message: expect.stringContaining('timed out')
      })
      killSpy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares one in-flight slot across differently-cased windows paths', async () => {
    // Why: Windows resolves paths case-insensitively, so two tabs on the same
    // file would otherwise run the formatter over each other's output.
    const release = spawnPending()

    // Why: include globs stay case-sensitive like every other glob matcher, so
    // this case tests the in-flight key alone.
    const anyFile = { ...enabledSettings, include: [] }
    const first = runFormatOnSave({
      settings: anyFile,
      worktreePath: 'C:\\repo',
      absoluteFilePath: 'C:\\repo\\src\\a.ts'
    })

    await expect(
      runFormatOnSave({
        settings: anyFile,
        worktreePath: 'C:\\repo',
        absoluteFilePath: 'C:\\repo\\src\\A.TS'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'already-running' })

    release?.()
    await expect(first).resolves.toEqual({ status: 'completed' })
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('runs the formatter on the remote host for an SSH worktree', async () => {
    const remoteExec = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false
    })

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/srv/repo',
        absoluteFilePath: '/srv/repo/src/a.ts',
        remoteExec,
        hostScope: 'ssh-1'
      })
    ).resolves.toEqual({ status: 'completed' })

    expect(remoteExec).toHaveBeenCalledWith({
      binary: '/bin/bash',
      args: ['-lc', "prettier --write '/srv/repo/src/a.ts'"],
      cwd: '/srv/repo',
      timeoutMs: expect.any(Number)
    })
    // Why: the local shell must not be touched for a file that lives elsewhere.
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('uses cmd.exe when the SSH host is Windows', async () => {
    const remoteExec = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false
    })

    await runFormatOnSave({
      settings: { ...enabledSettings, include: [] },
      worktreePath: 'C:\\srv\\repo',
      absoluteFilePath: 'C:\\srv\\repo\\src\\a.ts',
      remoteExec,
      hostScope: 'ssh-win'
    })

    const call = remoteExec.mock.calls[0][0]
    expect(call.binary).toBe('cmd.exe')
    expect(call.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(call.args[3]).toContain('"C:\\srv\\repo\\src\\a.ts"')
  })

  it('reports a remote formatter failure with its stderr', async () => {
    const remoteExec = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'SyntaxError: line 3',
      exitCode: 2,
      timedOut: false
    })

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/srv/repo',
        absoluteFilePath: '/srv/repo/src/a.ts',
        remoteExec,
        hostScope: 'ssh-1'
      })
    ).resolves.toEqual({ status: 'failed', message: 'SyntaxError: line 3' })
  })

  it('names a remote timeout and a remote spawn failure distinctly', async () => {
    const timedOut = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true
    })
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/srv/repo',
        absoluteFilePath: '/srv/repo/src/a.ts',
        remoteExec: timedOut,
        hostScope: 'ssh-1'
      })
    ).resolves.toMatchObject({ status: 'failed', message: expect.stringContaining('timed out') })

    const spawnFailed = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      spawnError: 'bash: not found'
    })
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/srv/repo',
        absoluteFilePath: '/srv/repo/src/a.ts',
        remoteExec: spawnFailed,
        hostScope: 'ssh-1'
      })
    ).resolves.toEqual({ status: 'failed', message: 'bash: not found' })
  })

  it('treats a dropped relay as a skip, not a formatter failure', async () => {
    // Why: the save already landed; a transport error must not read as the
    // formatter rejecting the user's file.
    const remoteExec = vi.fn().mockRejectedValue(new Error('relay disconnected'))

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/srv/repo',
        absoluteFilePath: '/srv/repo/src/a.ts',
        remoteExec,
        hostScope: 'ssh-1'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'unsupported-host' })
  })

  it('keeps in-flight slots separate per host for an identical path', async () => {
    let releaseFirst: (() => void) | undefined
    const slowRemote = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ stdout: '', stderr: '', exitCode: 0, timedOut: false })
        })
    )
    const fastRemote = vi
      .fn()
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false })

    const first = runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/srv/repo',
      absoluteFilePath: '/srv/repo/src/a.ts',
      remoteExec: slowRemote,
      hostScope: 'ssh-1'
    })

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/srv/repo',
        absoluteFilePath: '/srv/repo/src/a.ts',
        remoteExec: fastRemote,
        hostScope: 'ssh-2'
      })
    ).resolves.toEqual({ status: 'completed' })

    releaseFirst?.()
    await expect(first).resolves.toEqual({ status: 'completed' })
  })

  it('routes a WSL worktree through wsl.exe with linux paths', async () => {
    vi.mocked(parseWslPath).mockReturnValue({ distro: 'Ubuntu', linuxPath: '/home/dev/repo' })
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
        callback(null, '', '')
        return { kill: vi.fn() }
      }
    )

    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo',
        absoluteFilePath: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo\\src\\a.ts'
      })
    ).resolves.toEqual({ status: 'completed' })

    const [file, args] = execFileMock.mock.calls[0]
    expect(file).toBe('wsl.exe')
    expect(args).toEqual([
      '-d',
      'Ubuntu',
      '--',
      'bash',
      '-c',
      expect.stringContaining("cd '/home/dev/repo' && prettier --write")
    ])
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
