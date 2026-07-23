import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { lstatMock, realpathMock, trashItemMock, tryDeleteWslUncPathMock } = vi.hoisted(() => ({
  lstatMock: vi.fn(),
  realpathMock: vi.fn(),
  trashItemMock: vi.fn(),
  tryDeleteWslUncPathMock: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  lstat: lstatMock,
  realpath: realpathMock
}))

vi.mock('electron', () => ({
  shell: { trashItem: trashItemMock }
}))

vi.mock('../wsl-unc-delete', () => ({
  tryDeleteWslUncPath: tryDeleteWslUncPathMock
}))

import { deleteAiVaultSessionFile } from './session-delete'

const HOME = join('/tmp', 'orca-ai-vault-delete-exec-fixture-home')
const GEMINI_ROOT = join(HOME, '.gemini', 'tmp')

function enoent(): NodeJS.ErrnoException {
  const error = new Error('not found') as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}

function baseArgs(filePath: string) {
  return {
    agent: 'gemini' as const,
    filePath,
    executionHostId: 'local' as const,
    rootOptions: { geminiSessionsDir: GEMINI_ROOT }
  }
}

describe('deleteAiVaultSessionFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: not a WSL UNC path, so the fs-guard branch runs.
    tryDeleteWslUncPathMock.mockResolvedValue(false)
  })

  it('trashes a regular file whose realpath matches the resolved path', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockResolvedValue({ isFile: () => true })
    realpathMock.mockResolvedValue(filePath)
    trashItemMock.mockResolvedValue(undefined)

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'deleted' })
    expect(trashItemMock).toHaveBeenCalledWith(filePath)
  })

  it('rejects a directory instead of trashing it', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockResolvedValue({ isFile: () => false })

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'rejected', agent: 'gemini', reason: 'not-a-regular-file' })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('rejects a symlink instead of trashing it (isFile() is false for a symlink under lstat)', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockResolvedValue({ isFile: () => false })

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'rejected', agent: 'gemini', reason: 'not-a-regular-file' })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('rejects a regular file whose realpath escapes the known roots', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockResolvedValue({ isFile: () => true })
    realpathMock.mockResolvedValue(join(HOME, 'Documents', 'escaped.json'))

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'path-outside-known-roots'
    })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('treats ENOENT from lstat as an idempotent success', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockRejectedValue(enoent())

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'deleted' })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('treats ENOENT from trashItem as an idempotent success (race with an external delete)', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockResolvedValue({ isFile: () => true })
    realpathMock.mockResolvedValue(filePath)
    trashItemMock.mockRejectedValue(enoent())

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'deleted' })
  })

  it('returns a failure result when trashItem throws a non-ENOENT error', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    lstatMock.mockResolvedValue({ isFile: () => true })
    realpathMock.mockResolvedValue(filePath)
    trashItemMock.mockRejectedValue(new Error('permission denied'))

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'failed', agent: 'gemini', error: 'permission denied' })
  })

  it('short-circuits a rejected validation (unsupported agent) before touching the filesystem', async () => {
    const filePath = join(HOME, '.claude', 'projects', 'proj', 'session-1.jsonl')

    const result = await deleteAiVaultSessionFile({
      agent: 'claude',
      filePath,
      executionHostId: 'local'
    })

    expect(result).toEqual({ outcome: 'rejected', agent: 'claude', reason: 'unsupported-agent' })
    expect(lstatMock).not.toHaveBeenCalled()
    expect(realpathMock).not.toHaveBeenCalled()
    expect(trashItemMock).not.toHaveBeenCalled()
    expect(tryDeleteWslUncPathMock).not.toHaveBeenCalled()
  })

  it('delegates a WSL UNC path to tryDeleteWslUncPath and never calls trashItem', async () => {
    const filePath = join(GEMINI_ROOT, 'project-a', 'session-1.json')
    tryDeleteWslUncPathMock.mockResolvedValue(true)

    const result = await deleteAiVaultSessionFile(baseArgs(filePath))

    expect(result).toEqual({ outcome: 'deleted' })
    expect(tryDeleteWslUncPathMock).toHaveBeenCalledWith(filePath)
    expect(lstatMock).not.toHaveBeenCalled()
    expect(trashItemMock).not.toHaveBeenCalled()
  })
})
