import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/runtime/runtime-file-client', () => ({ readRuntimeFileContent: vi.fn() }))

import { formatSavedFile } from './editor-format-on-save'

beforeEach(() => {
  toastError.mockReset()
})

function request(overrides: {
  runFormat: Parameters<typeof formatSavedFile>[0]['runFormat']
  readSavedContent?: Parameters<typeof formatSavedFile>[0]['readSavedContent']
  savedContent?: string
}): Parameters<typeof formatSavedFile>[0] {
  return {
    repoId: 'repo-1',
    worktreePath: '/repo',
    filePath: '/repo/src/a.ts',
    savedContent: overrides.savedContent ?? 'const a=1',
    runFormat: overrides.runFormat,
    readSavedContent: overrides.readSavedContent ?? (async () => 'const a = 1')
  }
}

describe('formatSavedFile', () => {
  it('returns the reformatted text when the formatter rewrote the file', async () => {
    await expect(
      formatSavedFile(request({ runFormat: async () => ({ status: 'completed' }) }))
    ).resolves.toBe('const a = 1')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('returns null when the formatter left the file byte-identical', async () => {
    await expect(
      formatSavedFile(
        request({
          runFormat: async () => ({ status: 'completed' }),
          readSavedContent: async () => 'const a=1'
        })
      )
    ).resolves.toBeNull()
  })

  it('surfaces the formatter error without touching the buffer', async () => {
    await expect(
      formatSavedFile(
        request({
          runFormat: async () => ({ status: 'failed', message: 'SyntaxError: line 3' })
        })
      )
    ).resolves.toBeNull()

    expect(toastError).toHaveBeenCalledWith(
      'Formatter failed',
      expect.objectContaining({ description: 'SyntaxError: line 3' })
    )
  })

  it('truncates a runaway formatter error so the toast stays readable', async () => {
    await expect(
      formatSavedFile(
        request({ runFormat: async () => ({ status: 'failed', message: 'x'.repeat(1000) }) })
      )
    ).resolves.toBeNull()

    const description = toastError.mock.calls[0][1].description as string
    expect(description).toHaveLength(301)
    expect(description.endsWith('…')).toBe(true)
  })

  it('stays silent for every skip reason', async () => {
    for (const reason of [
      'not-configured',
      'not-included',
      'outside-worktree',
      'already-running',
      'unsupported-host'
    ] as const) {
      await expect(
        formatSavedFile(request({ runFormat: async () => ({ status: 'skipped', reason }) }))
      ).resolves.toBeNull()
    }
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps the save successful when the format channel itself throws', async () => {
    await expect(
      formatSavedFile(
        request({
          runFormat: async () => {
            throw new Error('ipc down')
          }
        })
      )
    ).resolves.toBeNull()
  })

  it('keeps the save successful when re-reading the formatted file fails', async () => {
    await expect(
      formatSavedFile(
        request({
          runFormat: async () => ({ status: 'completed' }),
          readSavedContent: async () => {
            throw new Error('read failed')
          }
        })
      )
    ).resolves.toBeNull()
  })
})
