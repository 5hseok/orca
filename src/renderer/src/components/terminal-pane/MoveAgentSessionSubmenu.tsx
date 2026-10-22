import { FolderInput } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import type { AgentSessionMoveTarget } from './terminal-agent-session-move'
import { translate } from '@/i18n/i18n'

type MoveAgentSessionSubmenuProps = {
  targets: readonly AgentSessionMoveTarget[]
  onMove: (worktreeId: string) => void
}

export function MoveAgentSessionSubmenu({
  targets,
  onMove
}: MoveAgentSessionSubmenuProps): React.JSX.Element | null {
  if (targets.length === 0) {
    return null
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput />
        {translate(
          'components.terminal.pane.agentSessionMove.menu',
          'Move Agent Session to Worktree'
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        <div className="scrollbar-sleek max-h-80 overflow-y-auto">
          {targets.map((target) => (
            <DropdownMenuItem key={target.worktreeId} onSelect={() => onMove(target.worktreeId)}>
              <span className="truncate">{target.label}</span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
