import { useEffect, useSyncExternalStore } from 'react'
import type { CopilotStatus } from '../../../../shared/copilot-inline-completion-types'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'

/** Copilot server status for the status bar and editor attachment. */
let status: CopilotStatus | null = null
const listeners = new Set<() => void>()
let unsubscribeStatus: (() => void) | null = null

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function ensureStatusSubscription(): void {
  // Why: the paired web client has no Copilot bridge; its API stub answers every call with undefined.
  const api = isPairedWebClientWindow() ? undefined : window.api?.copilotCompletion
  if (unsubscribeStatus || !api?.onStatus) {
    return
  }
  unsubscribeStatus = api.onStatus((next) => {
    status = next
    emit()
  })
  void api
    .status()
    .then((initial) => {
      // Why: a pushed status may have landed while this was in flight.
      if (!status) {
        status = initial
        emit()
      }
    })
    .catch(() => {})
}

export function setCopilotStatus(next: CopilotStatus): void {
  status = next
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Status whenever the server is installed, independent of the active tab, so
 *  sign-in stays reachable before any file is opened. Null when not installed. */
export function useCopilotStatus(): CopilotStatus | null {
  useEffect(ensureStatusSubscription, [])
  return useSyncExternalStore(subscribe, () => (status?.installed ? status : null))
}
