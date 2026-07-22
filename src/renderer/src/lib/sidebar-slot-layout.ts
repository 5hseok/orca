import type { WorkspaceSidebarPosition } from '../../../shared/types'
import { shouldRenderDesktopWindowChrome } from './desktop-window-chrome'

/** Workspace list vs the activity/explorer panel — the two sidebars that can swap edges. */
export type SidebarSlotOccupant = 'workspace' | 'activity'
export type WindowEdge = 'left' | 'right'

export type SidebarSlotLayoutInput = {
  workspaceSidebarPosition: WorkspaceSidebarPosition
  platform: NodeJS.Platform
  isWebClient: boolean
}

export type SidebarSlotLayout = {
  leftOccupant: SidebarSlotOccupant
  rightOccupant: SidebarSlotOccupant
  /** Edge holding the OS window controls, or null where none are drawn over the sidebars. */
  windowControlsEdge: WindowEdge | null
  /** Sidebar sharing an edge with the window controls, so it must inset to keep its top row reachable. */
  windowControlsOccupant: SidebarSlotOccupant | null
}

// Why: macOS keeps native traffic lights top-left while custom desktop chrome
// draws its overlay top-right, so the occupied edge flips per platform.
function resolveWindowControlsEdge(input: SidebarSlotLayoutInput): WindowEdge | null {
  if (input.platform === 'darwin' && !input.isWebClient) {
    return 'left'
  }
  return shouldRenderDesktopWindowChrome(input) ? 'right' : null
}

export function resolveSidebarSlotLayout(input: SidebarSlotLayoutInput): SidebarSlotLayout {
  const workspaceOnLeft = input.workspaceSidebarPosition === 'left'
  const leftOccupant: SidebarSlotOccupant = workspaceOnLeft ? 'workspace' : 'activity'
  const rightOccupant: SidebarSlotOccupant = workspaceOnLeft ? 'activity' : 'workspace'
  const windowControlsEdge = resolveWindowControlsEdge(input)
  return {
    leftOccupant,
    rightOccupant,
    windowControlsEdge,
    windowControlsOccupant:
      windowControlsEdge === null
        ? null
        : windowControlsEdge === 'left'
          ? leftOccupant
          : rightOccupant
  }
}
