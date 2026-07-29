import React from 'react'
import { EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorktreeOwnership } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'

export type HiddenWorktreePreview = {
  id: string
  displayName: string
  path: string
  branch?: string
  ownership: WorktreeOwnership
}

type HiddenWorktreeImportSectionProps = {
  importableWorktrees: readonly HiddenWorktreePreview[]
  importedWorktrees: readonly HiddenWorktreePreview[]
  pending: boolean
  error: string | null
  onImport: (worktreePaths: string[]) => void
  onHide: (worktreePaths: string[]) => void
}

function shortBranchName(branch: string | undefined): string {
  return (branch ?? '').replace(/^refs\/heads\//, '')
}

// Why: a worktree with no Orca metadata takes its display name from the branch,
// so rendering both would print the same string twice.
function secondaryBranchLine(worktree: HiddenWorktreePreview): string {
  const branch = shortBranchName(worktree.branch)
  return branch === worktree.displayName ? '' : branch
}

function WorktreeRow({
  worktree,
  actionLabel,
  pending,
  onAction
}: {
  worktree: HiddenWorktreePreview
  actionLabel: string
  pending: boolean
  onAction: () => void
}): React.JSX.Element {
  const branch = secondaryBranchLine(worktree)
  return (
    <li className="flex min-w-0 items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="block min-w-0 truncate text-xs font-medium outline-none"
              >
                {worktree.displayName}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {worktree.path}
            </TooltipContent>
          </Tooltip>
          {worktree.ownership === 'agent-scratch' ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {translate(
                'auto.components.sidebar.HiddenWorktreeImportSection.15211f2e20',
                'agent scratch'
              )}
            </span>
          ) : null}
        </div>
        {branch ? (
          <span className="block min-w-0 truncate font-mono text-[10px] leading-4 text-muted-foreground">
            {branch}
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={pending}
        onClick={onAction}
        className="h-6 shrink-0 px-2 text-[11px] font-medium"
      >
        {actionLabel}
      </Button>
    </li>
  )
}

export default function HiddenWorktreeImportSection({
  importableWorktrees,
  importedWorktrees,
  pending,
  error,
  onImport,
  onHide
}: HiddenWorktreeImportSectionProps): React.JSX.Element | null {
  if (importableWorktrees.length === 0 && importedWorktrees.length === 0) {
    return null
  }

  const importLabel = translate(
    'auto.components.sidebar.HiddenWorktreeImportSection.5aac009b02',
    'Import'
  )
  const hideLabel = translate(
    'auto.components.sidebar.HiddenWorktreeImportSection.7327c4f733',
    'Hide'
  )
  const sectionTitle = translate(
    'auto.components.sidebar.HiddenWorktreeImportSection.0c5d5b4f6d',
    'Import individually'
  )

  return (
    <section
      aria-busy={pending}
      aria-label={sectionTitle}
      className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
          <EyeOff className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{sectionTitle}</div>
          <div className="text-xs text-muted-foreground">
            {translate(
              'auto.components.sidebar.HiddenWorktreeImportSection.cdb536486b',
              'Pick single worktrees instead of showing every non-Orca one. Scratch worktrees agents create inside the repo stay hidden until imported here.'
            )}
          </div>
        </div>
      </div>

      {importableWorktrees.length > 0 ? (
        <div className="grid gap-1">
          <ul className="grid divide-y divide-border">
            {importableWorktrees.map((worktree) => (
              <WorktreeRow
                key={worktree.id}
                worktree={worktree}
                actionLabel={importLabel}
                pending={pending}
                onAction={() => onImport([worktree.path])}
              />
            ))}
          </ul>
          {importableWorktrees.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={pending}
              onClick={() => onImport(importableWorktrees.map((worktree) => worktree.path))}
              className="h-6 justify-self-start px-2 text-[11px] font-medium"
            >
              {translate(
                'auto.components.sidebar.HiddenWorktreeImportSection.3aeef4e6a6',
                'Import all {{value0}}',
                { value0: importableWorktrees.length }
              )}
            </Button>
          ) : null}
        </div>
      ) : null}

      {importedWorktrees.length > 0 ? (
        <div className="grid gap-1">
          <div className="text-[11px] font-medium leading-4 text-muted-foreground">
            {translate(
              'auto.components.sidebar.HiddenWorktreeImportSection.23d8116c08',
              'Imported individually'
            )}
          </div>
          <ul className="grid divide-y divide-border">
            {importedWorktrees.map((worktree) => (
              <WorktreeRow
                key={worktree.id}
                worktree={worktree}
                actionLabel={hideLabel}
                pending={pending}
                onAction={() => onHide([worktree.path])}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="text-[11px] leading-4 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export type { HiddenWorktreeImportSectionProps }
