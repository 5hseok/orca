import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/types'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  runFormatOnSave: vi.fn(),
  resolveRegisteredWorktreePath: vi.fn()
}))

const handleMock = mocks.handle
const removeHandlerMock = mocks.removeHandler
const runFormatOnSaveMock = mocks.runFormatOnSave
const resolveRegisteredWorktreePathMock = mocks.resolveRegisteredWorktreePath

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
    removeHandler: mocks.removeHandler
  }
}))

vi.mock('../format-on-save-runner', () => ({
  runFormatOnSave: mocks.runFormatOnSave
}))

vi.mock('./filesystem-auth', () => ({
  resolveRegisteredWorktreePath: mocks.resolveRegisteredWorktreePath
}))

import { registerEditorFormatOnSaveHandlers } from './editor-format-on-save'

const CONFIGURED = {
  enabled: true,
  command: 'prettier --write ${file}',
  include: ['**/*.ts']
}

function localRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#000000',
    addedAt: 1,
    kind: 'git',
    formatOnSave: CONFIGURED,
    ...overrides
  } as Repo
}

function registerWith(repo: Repo | undefined): (args: unknown) => Promise<unknown> {
  const store = { getRepo: vi.fn(() => repo) }
  registerEditorFormatOnSaveHandlers(store as never)
  const entry = handleMock.mock.calls.find((call) => call[0] === 'editor:formatOnSave')
  if (!entry) {
    throw new Error('handler was not registered')
  }
  return (args: unknown) => entry[1](null, args)
}

const VALID_ARGS = {
  repoId: 'repo-1',
  worktreePath: '/repo',
  filePath: '/repo/src/a.ts'
}

beforeEach(() => {
  handleMock.mockReset()
  removeHandlerMock.mockReset()
  runFormatOnSaveMock.mockReset()
  runFormatOnSaveMock.mockResolvedValue({ status: 'completed' })
  resolveRegisteredWorktreePathMock.mockReset()
  resolveRegisteredWorktreePathMock.mockImplementation(async (value: string) => value)
})

describe('editor:formatOnSave handler', () => {
  it('runs the command stored on the repo, never one supplied by the caller', async () => {
    const invoke = registerWith(localRepo())

    await invoke({ ...VALID_ARGS, command: 'rm -rf ~', settings: { command: 'rm -rf ~' } })

    expect(runFormatOnSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ command: CONFIGURED.command })
      })
    )
    const passed = runFormatOnSaveMock.mock.calls[0][0]
    expect(JSON.stringify(passed)).not.toContain('rm -rf')
  })

  it('authorizes the worktree path before running anything', async () => {
    resolveRegisteredWorktreePathMock.mockRejectedValue(
      new Error('Access denied: unknown repository or worktree path')
    )
    const invoke = registerWith(localRepo())

    await expect(invoke({ ...VALID_ARGS, worktreePath: '/etc' })).rejects.toThrow('Access denied')
    expect(runFormatOnSaveMock).not.toHaveBeenCalled()
  })

  it('skips SSH-backed repos instead of running a local command for a remote file', async () => {
    const invoke = registerWith(localRepo({ connectionId: 'ssh-target-1' }))

    await expect(invoke(VALID_ARGS)).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported-host'
    })
    expect(runFormatOnSaveMock).not.toHaveBeenCalled()
  })

  it('skips repos owned by a runtime host', async () => {
    const invoke = registerWith(localRepo({ executionHostId: 'runtime:env-1' }))

    await expect(invoke(VALID_ARGS)).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported-host'
    })
    expect(runFormatOnSaveMock).not.toHaveBeenCalled()
  })

  it('skips an unknown repo id without touching the authorizer', async () => {
    const invoke = registerWith(undefined)

    await expect(invoke(VALID_ARGS)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-configured'
    })
    expect(resolveRegisteredWorktreePathMock).not.toHaveBeenCalled()
    expect(runFormatOnSaveMock).not.toHaveBeenCalled()
  })

  it('skips a repo that has not configured a formatter', async () => {
    const invoke = registerWith(localRepo({ formatOnSave: undefined }))

    await expect(invoke(VALID_ARGS)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-configured'
    })
    expect(runFormatOnSaveMock).not.toHaveBeenCalled()
  })

  it('rejects malformed payloads before resolving any path', async () => {
    const invoke = registerWith(localRepo())

    await expect(invoke({ repoId: 'repo-1', worktreePath: '/repo' })).rejects.toThrow(
      'requires a repo, worktree, and file path'
    )
    await expect(invoke({ ...VALID_ARGS, filePath: '/repo/a\0.ts' })).rejects.toThrow(
      'Access denied'
    )
    expect(resolveRegisteredWorktreePathMock).not.toHaveBeenCalled()
    expect(runFormatOnSaveMock).not.toHaveBeenCalled()
  })

  it('passes the authorized path to the runner, not the caller-supplied one', async () => {
    resolveRegisteredWorktreePathMock.mockResolvedValue('/resolved/repo')
    const invoke = registerWith(localRepo())

    await invoke({ ...VALID_ARGS, worktreePath: '/repo/../repo' })

    expect(runFormatOnSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: '/resolved/repo' })
    )
  })

  it('replaces a stale handler when handlers are re-registered', () => {
    registerWith(localRepo())
    expect(removeHandlerMock).toHaveBeenCalledWith('editor:formatOnSave')
  })
})
