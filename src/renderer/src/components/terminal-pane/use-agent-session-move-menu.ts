import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  canMoveAgentSession,
  listAgentSessionMoveTargets,
  moveAgentSessionToWorktree,
  type AgentSessionMoveTarget
} from './terminal-agent-session-move'

const NO_TARGETS: readonly AgentSessionMoveTarget[] = []

export function useAgentSessionMoveMenu(args: {
  managerRef: React.RefObject<PaneManager | null>
  menuOpen: boolean
  menuPaneId: number | null
  paneCount: number
  tabId: string
  worktreeId: string
}): {
  targets: readonly AgentSessionMoveTarget[]
  onMove: (targetWorktreeId: string) => void
} {
  const menuLeafId =
    args.menuOpen && args.menuPaneId !== null
      ? (args.managerRef.current?.getPanes().find((pane) => pane.id === args.menuPaneId)?.leafId ??
        null)
      : null
  const state = useAppStore.getState()
  // Why single-pane only: closing one split leaf goes through the close-confirmation dialog.
  const canMove =
    menuLeafId !== null &&
    args.paneCount === 1 &&
    canMoveAgentSession(state.agentStatusByPaneKey[makePaneKey(args.tabId, menuLeafId)]?.agentType)
  const targets = canMove ? listAgentSessionMoveTargets(state, args.worktreeId) : NO_TARGETS

  const onMove = (targetWorktreeId: string): void => {
    if (!menuLeafId) {
      return
    }
    void moveAgentSessionToWorktree({
      tabId: args.tabId,
      leafId: menuLeafId,
      sourceWorktreeId: args.worktreeId,
      targetWorktreeId,
      closeSource: () =>
        useAppStore.getState().closeTab(args.tabId, { captureRecentlyClosed: false })
    })
  }
  return { targets, onMove }
}
