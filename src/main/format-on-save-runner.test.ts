import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execMock = vi.fn()
const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => execMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

vi.mock('./wsl', () => ({
  parseWslPath: vi.fn(() => null),
  toLinuxPath: vi.fn((value: string) => value)
}))

import { _resetFormatOnSaveInFlightForTests, runFormatOnSave } from './format-on-save-runner'
import { parseWslPath } from './wsl'
import type { RepoFormatOnSaveSettings } from '../shared/types'

const enabledSettings: RepoFormatOnSaveSettings = {
  enabled: true,
  command: 'prettier --write ${file}',
  include: ['**/*.ts']
}

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

function resolveExecWith(error: Error | null, stdout = '', stderr = ''): void {
  execMock.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
    callback(error, stdout, stderr)
    return {}
  })
}

beforeEach(() => {
  execMock.mockReset()
  execFileMock.mockReset()
  _resetFormatOnSaveInFlightForTests()
  vi.mocked(parseWslPath).mockReturnValue(null)
  resolveExecWith(null)
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
    expect(execMock).not.toHaveBeenCalled()
  })

  it('skips files the include globs do not cover', async () => {
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/repo/src/a.css'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'not-included' })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('refuses to format a file outside the worktree', async () => {
    await expect(
      runFormatOnSave({
        settings: enabledSettings,
        worktreePath: '/repo',
        absoluteFilePath: '/elsewhere/src/a.ts'
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'outside-worktree' })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('runs the command in the worktree root with the saved path substituted', async () => {
    await runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })

    const [command, options] = execMock.mock.calls[0]
    expect(command).toBe("prettier --write '/repo/src/a.ts'")
    expect((options as { cwd: string }).cwd).toBe('/repo')
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
    let release: (() => void) | undefined
    execMock.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
      release = () => callback(null, '', '')
      return {}
    })

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

    release?.()
    await expect(first).resolves.toEqual({ status: 'completed' })
    expect(execMock).toHaveBeenCalledTimes(1)
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
    execMock.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
      callback(null, '', '')
      return {}
    })
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

    expect(execMock).toHaveBeenCalledTimes(2)
  })

  it('does not report a chatty but successful formatter as failed', async () => {
    // Why: node's 1 MB default maxBuffer would kill `black --verbose` mid-run and
    // surface it as a failure even though the file was rewritten.
    await runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })

    const options = execMock.mock.calls[0][1] as { maxBuffer?: number }
    expect(options.maxBuffer).toBeGreaterThanOrEqual(8 * 1024 * 1024)
  })

  it('names the timeout instead of surfacing a bare "Command failed"', async () => {
    const timedOut = Object.assign(new Error('Command failed'), { killed: true })
    resolveExecWith(timedOut, '', '')

    const result = await runFormatOnSave({
      settings: enabledSettings,
      worktreePath: '/repo',
      absoluteFilePath: '/repo/src/a.ts'
    })

    expect(result.status).toBe('failed')
    expect(result).toMatchObject({ message: expect.stringContaining('timed out') })
  })

  it('shares one in-flight slot across differently-cased windows paths', async () => {
    // Why: Windows resolves paths case-insensitively, so two tabs on the same
    // file would otherwise run the formatter over each other's output.
    let release: (() => void) | undefined
    execMock.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
      release = () => callback(null, '', '')
      return {}
    })

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
    expect(execMock).toHaveBeenCalledTimes(1)
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
    expect(execMock).not.toHaveBeenCalled()
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
    expect(execMock).not.toHaveBeenCalled()
  })
})
