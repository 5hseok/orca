import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useLspStatusForFile } from '@/lib/monaco-lsp/monaco-lsp-status'

/** Language-server indicator for the active editor file: hidden when no
 *  server is attached, pulsing while starting, then the server name (e.g. tsgo). */
export function LspStatusSegment({ iconOnly }: { iconOnly: boolean }): React.JSX.Element | null {
  const activeFilePath = useAppStore(
    (s) => s.openFiles.find((file) => file.id === s.activeFileId)?.filePath ?? null
  )
  const status = useLspStatusForFile(activeFilePath)
  if (!status) {
    return null
  }
  const starting = status.state === 'starting'
  const serverLabel = status.serverId ?? 'LSP'
  const tooltip = starting
    ? translate('auto.components.status.bar.LspStatusSegment.starting', 'Language server starting…')
    : `${translate('auto.components.status.bar.LspStatusSegment.running', 'Language server')}: ${serverLabel}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={tooltip}
          className="inline-flex select-none items-center gap-1.5 px-1 py-0.5 text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              starting ? 'animate-pulse bg-status-warning' : 'bg-status-success'
            )}
          />
          {iconOnly ? null : (
            <span className="text-[11px] font-medium">
              {starting
                ? translate('auto.components.status.bar.LspStatusSegment.badge', 'LSP')
                : serverLabel}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
