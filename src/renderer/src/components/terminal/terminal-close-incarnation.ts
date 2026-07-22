import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import type { AppState } from '@/store/types'

export function findTerminalIncarnationHandle(
  state: Pick<AppState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>,
  tabId: string,
  environmentId: string
): string | null {
  const ptyIds = new Set([
    ...(state.ptyIdsByTabId?.[tabId] ?? []),
    ...Object.values(state.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId ?? {})
  ])
  for (const ptyId of ptyIds) {
    const terminal = parseRemoteRuntimePtyId(ptyId)
    if (terminal?.handle && terminal.environmentId === environmentId) {
      return terminal.handle
    }
  }
  return null
}
