import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { translate } from '@/i18n/i18n'

// 'rejected' and 'failed' share this one message: the specific reason is a
// main-side detail, not something to surface raw. A rejected IPC invoke
// (transport/serialization) lands here too.
function showDeleteFailedToast(): void {
  toast.error(
    translate(
      'auto.components.right.sidebar.AiVaultPanel.sessionDeleteFailed',
      "Couldn't delete the session"
    )
  )
}

/**
 * Owns the AI Vault delete-confirmation flow: which session is pending
 * deletion, the in-flight state, and the IPC call + toast + force-refresh on
 * settle. Extracted from AiVaultPanel to keep it under the file's line budget.
 */
export function useAiVaultSessionDeleteAction({
  refresh
}: {
  refresh: (options: { force: boolean }) => Promise<void>
}): {
  sessionPendingDelete: AiVaultSession | null
  deletingSession: boolean
  requestDelete: (session: AiVaultSession) => void
  handleDialogOpenChange: (open: boolean) => void
  handleConfirmDelete: () => Promise<void>
} {
  const [sessionPendingDelete, setSessionPendingDelete] = useState<AiVaultSession | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      // Radix still fires Escape / outside-click / X while Cancel is disabled
      // mid-delete; ignore those so the delete can't be dismissed under itself.
      if (deletingSession) {
        return
      }
      if (!open) {
        setSessionPendingDelete(null)
      }
    },
    [deletingSession]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!sessionPendingDelete) {
      return
    }
    setDeletingSession(true)
    try {
      const result = await window.api.aiVault.deleteSession({
        agent: sessionPendingDelete.agent,
        filePath: sessionPendingDelete.filePath,
        executionHostId: sessionPendingDelete.executionHostId
      })
      if (result.outcome === 'deleted') {
        toast.success(
          translate('auto.components.right.sidebar.AiVaultPanel.sessionDeleted', 'Session deleted')
        )
        // Main already invalidated its caches; this is only for immediate UX.
        void refresh({ force: true })
      } else {
        showDeleteFailedToast()
      }
    } catch {
      showDeleteFailedToast()
    } finally {
      setDeletingSession(false)
      setSessionPendingDelete(null)
    }
  }, [refresh, sessionPendingDelete])

  return {
    sessionPendingDelete,
    deletingSession,
    requestDelete: setSessionPendingDelete,
    handleDialogOpenChange,
    handleConfirmDelete
  }
}
