// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { useAiVaultSessionDeleteAction } from './ai-vault-session-delete-action'

const deleteSession = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) }
}))

const session = {
  agent: 'gemini',
  filePath: '/home/a/.gemini/s.json',
  executionHostId: 'local'
} as AiVaultSession

beforeEach(() => {
  vi.clearAllMocks()
  // Attach only the preload bridge; keep happy-dom's window/document intact so
  // @testing-library can still render.
  ;(window as unknown as { api: unknown }).api = { aiVault: { deleteSession } }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('useAiVaultSessionDeleteAction', () => {
  it('refreshes (force) and toasts success after a real delete', async () => {
    deleteSession.mockResolvedValue({ outcome: 'deleted' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAiVaultSessionDeleteAction({ refresh }))

    act(() => result.current.requestDelete(session))
    expect(result.current.sessionPendingDelete).toBe(session)

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(deleteSession).toHaveBeenCalledWith({
      agent: 'gemini',
      filePath: '/home/a/.gemini/s.json',
      executionHostId: 'local'
    })
    expect(refresh).toHaveBeenCalledWith({ force: true })
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    // Dialog closes on settle (state already flushed inside act()).
    expect(result.current.sessionPendingDelete).toBeNull()
  })

  it('does NOT refresh and toasts an error when the delete is rejected', async () => {
    deleteSession.mockResolvedValue({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'non-local-host'
    })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAiVaultSessionDeleteAction({ refresh }))

    act(() => result.current.requestDelete(session))
    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(refresh).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('does NOT refresh and toasts an error when the delete fails', async () => {
    deleteSession.mockResolvedValue({ outcome: 'failed', agent: 'gemini', error: 'EPERM' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAiVaultSessionDeleteAction({ refresh }))

    act(() => result.current.requestDelete(session))
    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(refresh).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when confirmed with nothing pending', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAiVaultSessionDeleteAction({ refresh }))

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(deleteSession).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
