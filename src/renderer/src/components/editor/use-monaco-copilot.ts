import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { isLocalPathOpenBlocked } from '@/lib/local-path-open-guard'
import { attachMonacoCopilotDocument } from '@/lib/monaco-copilot/monaco-copilot-attach'
import { useCopilotStatus } from '@/lib/monaco-copilot/copilot-status'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

/** Attach an editable local file to GitHub Copilot for ghost text. Inert unless
 *  copilot-language-server is installed and signed in; SSH and remote-runtime
 *  workspaces never attach, since their paths belong to another machine. */
export function useMonacoCopilot(params: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  filePath: string
  language: string
  worktreeId: string | undefined
  readOnly: boolean
  liveTail: boolean
}): void {
  const { mountedEditor, filePath, language, worktreeId, readOnly, liveTail } = params
  const rootPath = useAppStore((s) => {
    if (!worktreeId) {
      return null
    }
    const scope = parseWorkspaceKey(worktreeId)
    if (scope?.type === 'folder') {
      return s.folderWorkspaces.find((w) => w.id === scope.folderWorkspaceId)?.folderPath ?? null
    }
    return findWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null
  })
  const remoteRuntimeActive = useAppStore((s) => isLocalPathOpenBlocked(s.settings))
  const copilotStatus = useCopilotStatus()
  const installed = copilotStatus !== null
  // Why: signing in or out re-attaches open editors, so ghost text starts or stops without a reload.
  const copilotUser = copilotStatus?.user ?? null

  useEffect(() => {
    if (!mountedEditor || !worktreeId || !rootPath || !installed || readOnly || liveTail) {
      return
    }
    // Why: `=== null` only -- undefined means the owning host is not resolved yet.
    if (remoteRuntimeActive || getConnectionIdForFile(worktreeId, filePath) !== null) {
      return
    }
    const model = mountedEditor.getModel()
    if (!model || model.isDisposed()) {
      return
    }
    return attachMonacoCopilotDocument({ model, filePath, rootPath, languageId: language })
  }, [
    mountedEditor,
    filePath,
    language,
    worktreeId,
    rootPath,
    installed,
    copilotUser,
    remoteRuntimeActive,
    readOnly,
    liveTail
  ])
}
