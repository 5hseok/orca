import { describe, expect, it, vi } from 'vitest'

import type { Repo } from '../../../../shared/types'
import { hideImportedWorktrees, importHiddenWorktrees } from './hidden-worktree-import-actions'

const projectId = 'repo-1'
const worktreePath = '/repo/.claude/worktrees/processing-lock'

function repo(
  importedExternalWorktreePaths: string[]
): Pick<Repo, 'importedExternalWorktreePaths'> {
  return { importedExternalWorktreePaths }
}

describe('hidden worktree import actions', () => {
  it('appends the path to the import allowlist and refreshes', async () => {
    const updateRepo = vi.fn().mockResolvedValue(true)
    const fetchWorktrees = vi.fn().mockResolvedValue(true)
    const setActionState = vi.fn()

    await importHiddenWorktrees({
      projectId,
      repo: repo(['/repo/.claude/worktrees/existing']),
      worktreePaths: [worktreePath],
      updateRepo,
      fetchWorktrees,
      setActionState
    })

    expect(updateRepo).toHaveBeenCalledWith(projectId, {
      importedExternalWorktreePaths: ['/repo/.claude/worktrees/existing', worktreePath]
    })
    expect(fetchWorktrees).toHaveBeenCalledWith(projectId, { requireAuthoritative: true })
    expect(setActionState).toHaveBeenLastCalledWith(projectId, null)
  })

  it('imports every path at once for the bulk action', async () => {
    const updateRepo = vi.fn().mockResolvedValue(true)
    const fetchWorktrees = vi.fn().mockResolvedValue(true)

    await importHiddenWorktrees({
      projectId,
      repo: repo([]),
      worktreePaths: [worktreePath, '/repo/.claude/worktrees/other'],
      updateRepo,
      fetchWorktrees,
      setActionState: vi.fn()
    })

    expect(updateRepo).toHaveBeenCalledWith(projectId, {
      importedExternalWorktreePaths: [worktreePath, '/repo/.claude/worktrees/other']
    })
    expect(updateRepo).toHaveBeenCalledTimes(1)
  })

  it('drops the path when hiding it again', async () => {
    const updateRepo = vi.fn().mockResolvedValue(true)

    await hideImportedWorktrees({
      projectId,
      repo: repo(['/repo/.claude/worktrees/existing', worktreePath]),
      worktreePaths: [worktreePath],
      updateRepo,
      fetchWorktrees: vi.fn().mockResolvedValue(true),
      setActionState: vi.fn()
    })

    expect(updateRepo).toHaveBeenCalledWith(projectId, {
      importedExternalWorktreePaths: ['/repo/.claude/worktrees/existing']
    })
  })

  it('rolls the allowlist back when the refresh fails', async () => {
    const updateRepo = vi.fn().mockResolvedValue(true)
    const setActionState = vi.fn()

    await importHiddenWorktrees({
      projectId,
      repo: repo([]),
      worktreePaths: [worktreePath],
      updateRepo,
      fetchWorktrees: vi.fn().mockResolvedValue(false),
      setActionState
    })

    expect(updateRepo).toHaveBeenNthCalledWith(2, projectId, {
      importedExternalWorktreePaths: []
    })
    expect(setActionState).toHaveBeenLastCalledWith(projectId, {
      pending: false,
      error: expect.stringContaining('import')
    })
  })

  it('reports an ambiguous state when the rollback write also fails', async () => {
    const updateRepo = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const setActionState = vi.fn()

    await importHiddenWorktrees({
      projectId,
      repo: repo([]),
      worktreePaths: [worktreePath],
      updateRepo,
      fetchWorktrees: vi.fn().mockResolvedValue(false),
      setActionState
    })

    expect(setActionState).toHaveBeenLastCalledWith(projectId, {
      pending: false,
      error: expect.stringContaining('could not be applied or undone')
    })
  })

  it('surfaces an error without refreshing when the repo update fails', async () => {
    const fetchWorktrees = vi.fn().mockResolvedValue(true)
    const setActionState = vi.fn()

    await importHiddenWorktrees({
      projectId,
      repo: repo([]),
      worktreePaths: [worktreePath],
      updateRepo: vi.fn().mockResolvedValue(false),
      fetchWorktrees,
      setActionState
    })

    expect(fetchWorktrees).not.toHaveBeenCalled()
    expect(setActionState).toHaveBeenLastCalledWith(projectId, {
      pending: false,
      error: expect.any(String)
    })
  })

  it('does nothing when no worktree path is given', async () => {
    const updateRepo = vi.fn().mockResolvedValue(true)
    const setActionState = vi.fn()

    await importHiddenWorktrees({
      projectId,
      repo: repo([]),
      worktreePaths: [],
      updateRepo,
      fetchWorktrees: vi.fn().mockResolvedValue(true),
      setActionState
    })

    expect(updateRepo).not.toHaveBeenCalled()
    expect(setActionState).not.toHaveBeenCalled()
  })
})
