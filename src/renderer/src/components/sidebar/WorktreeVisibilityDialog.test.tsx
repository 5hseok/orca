// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/types'
import type HiddenWorktreeImportSection from './HiddenWorktreeImportSection'

type SectionProps = ComponentProps<typeof HiddenWorktreeImportSection>

const mocks = vi.hoisted(() => ({
  sectionProps: null as SectionProps | null,
  importableDetected: null as { worktrees: unknown[] } | null,
  state: {
    activeModal: 'worktree-visibility',
    modalData: { repoId: 'repo-1' } as Record<string, unknown>,
    closeModal: vi.fn(),
    repos: [] as Repo[],
    settings: { activeRuntimeEnvironmentId: null as string | null },
    updateRepo: vi.fn(),
    fetchWorktrees: vi.fn(),
    detectedWorktreesByRepo: {} as Record<string, { worktrees: unknown[] }>
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>
}))

vi.mock('../../../../shared/external-worktree-inbox', () => ({
  getHiddenExternalWorktrees: () => [],
  getVisibleExternalWorktrees: () => []
}))

vi.mock('../../../../shared/hidden-worktree-import', () => ({
  addHiddenWorktreeImportPaths: (existing: string[] | undefined, additions: string[]) => [
    ...(existing ?? []),
    ...additions
  ],
  removeHiddenWorktreeImportPaths: (existing: string[] | undefined, removals: string[]) =>
    (existing ?? []).filter((path) => !removals.includes(path)),
  getImportableHiddenWorktrees: (detected: { worktrees: unknown[] } | undefined) => {
    mocks.importableDetected = detected ?? null
    return []
  },
  getIndividuallyImportedWorktrees: () => []
}))

vi.mock('../../../../shared/repo-kind', () => ({
  isGitRepoKind: () => true
}))

vi.mock('../../../../shared/worktree-ownership', () => ({
  effectiveExternalWorktreeVisibility: () => 'hide',
  isLegacyRepoForExternalWorktreeVisibility: () => false
}))

vi.mock('./HiddenWorktreeImportSection', () => ({
  default: (props: SectionProps) => {
    mocks.sectionProps = props
    return <div data-testid="hidden-worktree-import-section" />
  }
}))

function repo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#999999',
    addedAt: 1,
    kind: 'git',
    importedExternalWorktreePaths: [],
    ...overrides
  }
}

function deferred(): { promise: Promise<boolean>; resolve: (value: boolean) => void } {
  let resolve = (_value: boolean): void => undefined
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('WorktreeVisibilityDialog', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    mocks.sectionProps = null
    mocks.importableDetected = null
    mocks.state.activeModal = 'worktree-visibility'
    mocks.state.modalData = { repoId: 'repo-1' }
    mocks.state.settings.activeRuntimeEnvironmentId = null
    mocks.state.repos = [repo('repo-1'), repo('repo-2')]
    mocks.state.detectedWorktreesByRepo = {
      'repo-1': { worktrees: [] },
      'repo-2': { worktrees: [] }
    }
    mocks.state.fetchWorktrees.mockResolvedValue(true)
  })

  it('keeps a newer project action pending when an older action finishes', async () => {
    const firstUpdate = deferred()
    const secondUpdate = deferred()
    mocks.state.updateRepo.mockImplementation((projectId: string) =>
      projectId === 'repo-1' ? firstUpdate.promise : secondUpdate.promise
    )
    const { default: WorktreeVisibilityDialog } = await import('./WorktreeVisibilityDialog')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<WorktreeVisibilityDialog />))
    await act(async () => mocks.sectionProps?.onImport(['/repos/repo-1/scratch']))

    mocks.state.modalData = { repoId: 'repo-2' }
    await act(async () => root.render(<WorktreeVisibilityDialog />))
    await act(async () => mocks.sectionProps?.onImport(['/repos/repo-2/scratch']))
    expect(mocks.sectionProps?.pending).toBe(true)

    await act(async () => {
      firstUpdate.resolve(true)
      await flushPromises()
    })
    expect(mocks.sectionProps?.pending).toBe(true)

    await act(async () => {
      secondUpdate.resolve(true)
      await flushPromises()
    })
    expect(mocks.sectionProps?.pending).toBe(false)

    await act(async () => root.unmount())
  })

  it('uses the modal host for repo state, detected rows, and mutations', async () => {
    const hostId = 'runtime:env-1'
    mocks.state.settings.activeRuntimeEnvironmentId = 'env-1'
    mocks.state.modalData = { repoId: 'same-repo', hostId }
    mocks.state.repos = [
      repo('same-repo', {
        displayName: 'Local',
        importedExternalWorktreePaths: ['/local/existing']
      }),
      repo('same-repo', {
        displayName: 'Remote',
        executionHostId: hostId,
        importedExternalWorktreePaths: ['/remote/existing']
      })
    ]
    mocks.state.detectedWorktreesByRepo = {
      'same-repo': {
        worktrees: [
          { id: 'local', hostId: undefined },
          { id: 'remote', hostId }
        ]
      }
    }
    mocks.state.updateRepo.mockResolvedValue(true)
    const { default: WorktreeVisibilityDialog } = await import('./WorktreeVisibilityDialog')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<WorktreeVisibilityDialog />))
    expect(mocks.importableDetected?.worktrees).toEqual([{ id: 'remote', hostId }])

    await act(async () => {
      mocks.sectionProps?.onImport(['/remote/new'])
      await flushPromises()
    })

    expect(mocks.state.updateRepo).toHaveBeenCalledWith(
      'same-repo',
      { importedExternalWorktreePaths: ['/remote/existing', '/remote/new'] },
      { hostId }
    )
    expect(mocks.state.fetchWorktrees).toHaveBeenCalledWith('same-repo', {
      requireAuthoritative: true,
      executionHostId: hostId
    })

    await act(async () => root.unmount())
  })
})
