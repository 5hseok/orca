import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import HiddenWorktreeImportSection from './HiddenWorktreeImportSection'
import { TooltipProvider } from '@/components/ui/tooltip'

const importable = [
  {
    id: 'scratch-1',
    displayName: 'processing-lock',
    path: '/repo/.claude/worktrees/processing-lock',
    branch: 'refs/heads/fix/app-api/processing-lock-release',
    ownership: 'agent-scratch' as const
  },
  {
    id: 'external-1',
    displayName: 'payments-refactor',
    path: '/worktrees/payments-refactor',
    branch: 'refs/heads/payments-refactor',
    ownership: 'external' as const
  }
]

function render(
  overrides: Partial<ComponentProps<typeof HiddenWorktreeImportSection>> = {}
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <HiddenWorktreeImportSection
        importableWorktrees={importable}
        importedWorktrees={[]}
        pending={false}
        error={null}
        onImport={vi.fn()}
        onHide={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>
  )
}

describe('HiddenWorktreeImportSection', () => {
  it('lists hidden worktrees of every ownership with short branch names', () => {
    const markup = render()

    expect(markup).toContain('processing-lock')
    expect(markup).toContain('payments-refactor')
    expect(markup).toContain('fix/app-api/processing-lock-release')
    expect(markup).not.toContain('refs/heads/')
  })

  it('marks only agent scratch rows so the reason for hiding is visible', () => {
    expect(render().match(/agent scratch/g)).toHaveLength(1)
    expect(render({ importableWorktrees: [importable[1]] })).not.toContain('agent scratch')
  })

  it('offers a bulk import only when more than one worktree is importable', () => {
    expect(render()).toContain('Import all 2')
    expect(render({ importableWorktrees: [importable[0]] })).not.toContain('Import all')
  })

  it('renders individually imported worktrees under a hide action', () => {
    const markup = render({ importableWorktrees: [], importedWorktrees: importable })

    expect(markup).toContain('Imported individually')
    expect(markup).toContain('Hide')
  })

  it('renders nothing when the repo has no hidden worktrees', () => {
    expect(render({ importableWorktrees: [], importedWorktrees: [] })).toBe('')
  })

  it('disables the actions and marks the section busy while pending', () => {
    const markup = render({ pending: true })

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
  })

  it('shows the error message', () => {
    expect(render({ error: 'Could not import the selected worktrees. Try again.' })).toContain(
      'Could not import the selected worktrees. Try again.'
    )
  })
})
