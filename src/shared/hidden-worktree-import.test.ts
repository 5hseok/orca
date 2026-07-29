import { describe, expect, it } from 'vitest'

import type { DetectedWorktree, DetectedWorktreeListResult } from './types'
import {
  addHiddenWorktreeImportPaths,
  getImportableHiddenWorktrees,
  getIndividuallyImportedWorktrees,
  removeHiddenWorktreeImportPaths
} from './hidden-worktree-import'

const scratchPath = '/repo/.claude/worktrees/scratch'

function detectedWorktree(overrides: Partial<DetectedWorktree> = {}): DetectedWorktree {
  return {
    id: 'repo-1::/repo/.claude/worktrees/scratch',
    repoId: 'repo-1',
    path: scratchPath,
    displayName: 'scratch',
    branch: 'refs/heads/feature',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ownership: 'agent-scratch',
    selectedCheckout: false,
    visible: false,
    ...overrides
  }
}

function detectedResult(
  worktrees: DetectedWorktree[],
  authoritative = true
): DetectedWorktreeListResult {
  return { repoId: 'repo-1', authoritative, source: 'git', worktrees }
}

describe('getImportableHiddenWorktrees', () => {
  it('covers every hidden ownership Orca keeps out of the sidebar', () => {
    const worktrees = [
      detectedWorktree({ id: 'scratch' }),
      detectedWorktree({ id: 'external', ownership: 'external' }),
      detectedWorktree({ id: 'legacy', ownership: 'unknown-legacy' })
    ]

    expect(getImportableHiddenWorktrees(detectedResult(worktrees)).map((w) => w.id)).toEqual([
      'scratch',
      'external',
      'legacy'
    ])
  })

  it('ignores visible, orca-managed, and selected-checkout worktrees', () => {
    const result = getImportableHiddenWorktrees(
      detectedResult([
        detectedWorktree({ id: 'a', visible: true }),
        detectedWorktree({ id: 'b', ownership: 'orca-managed' }),
        detectedWorktree({ id: 'c', selectedCheckout: true })
      ])
    )

    expect(result).toEqual([])
  })

  it('returns nothing for a non-authoritative listing', () => {
    expect(getImportableHiddenWorktrees(detectedResult([detectedWorktree()], false))).toEqual([])
    expect(getImportableHiddenWorktrees(undefined)).toEqual([])
  })
})

describe('getIndividuallyImportedWorktrees', () => {
  it('returns visible worktrees whose path was individually imported', () => {
    const imported = detectedWorktree({ id: 'imported', visible: true })
    const result = getIndividuallyImportedWorktrees(
      detectedResult([imported, detectedWorktree({ id: 'hidden' })]),
      { importedExternalWorktreePaths: [scratchPath] }
    )

    expect(result.map((worktree) => worktree.id)).toEqual(['imported'])
  })

  it('excludes worktrees the repo-wide show toggle reveals, since hiding them would be a no-op', () => {
    const result = getIndividuallyImportedWorktrees(
      detectedResult([
        detectedWorktree({ id: 'shown-by-toggle', ownership: 'external', visible: true })
      ]),
      { importedExternalWorktreePaths: [] }
    )

    expect(result).toEqual([])
  })

  it('excludes the selected checkout', () => {
    const result = getIndividuallyImportedWorktrees(
      detectedResult([detectedWorktree({ visible: true, selectedCheckout: true })]),
      { importedExternalWorktreePaths: [scratchPath] }
    )

    expect(result).toEqual([])
  })
})

describe('hidden worktree import path list', () => {
  it('appends without duplicating an existing path', () => {
    const result = addHiddenWorktreeImportPaths(
      ['/repo/.claude/worktrees/a'],
      ['/repo/.claude/worktrees/a', '/repo/.claude/worktrees/b']
    )

    expect(result).toEqual(['/repo/.claude/worktrees/a', '/repo/.claude/worktrees/b'])
  })

  it('removes the requested paths and leaves the rest untouched', () => {
    const result = removeHiddenWorktreeImportPaths(
      ['/repo/.claude/worktrees/a', '/repo/.claude/worktrees/b'],
      ['/repo/.claude/worktrees/a']
    )

    expect(result).toEqual(['/repo/.claude/worktrees/b'])
  })

  it('removes paths that differ only by a trailing separator', () => {
    expect(
      removeHiddenWorktreeImportPaths(['/repo/.claude/worktrees/a/'], ['/repo/.claude/worktrees/a'])
    ).toEqual([])
  })

  it('tolerates an undefined list', () => {
    expect(removeHiddenWorktreeImportPaths(undefined, ['/a'])).toEqual([])
    expect(addHiddenWorktreeImportPaths(undefined, ['/a'])).toEqual(['/a'])
  })
})
