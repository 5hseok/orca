import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { isCopilotAttachOwnerLocal } from '@/lib/monaco-copilot/copilot-attach-owner'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { attachMonacoLspDocument } from '@/lib/monaco-lsp/monaco-lsp-attach'
import { selectMarkdownDocumentWorktreePath } from './markdown-document-worktree-path-selector'

/** Attach the mounted editor's document to a local language server, when one
 *  exists for the language. Servers run on this machine, so files that are not
 *  provably local (runtime, SSH, unresolved hosts) never attach. */
export function useMonacoLsp(params: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  fileId: string
  filePath: string
  language: string
  worktreeId: string | undefined
  liveTail: boolean
}): void {
  const { mountedEditor, fileId, filePath, language, worktreeId, liveTail } = params
  const rootPath = useAppStore((s) => selectMarkdownDocumentWorktreePath(s, worktreeId))
  // Why: same host rule as Copilot — both spawn a local process that reads the path.
  const ownerLocal = useAppStore((s) =>
    isCopilotAttachOwnerLocal(s, { fileId, filePath, worktreeId: worktreeId ?? null })
  )

  useEffect(() => {
    if (!mountedEditor || !worktreeId || !rootPath || !ownerLocal || liveTail) {
      return
    }
    if (isPairedWebClientWindow()) {
      return
    }
    const model = mountedEditor.getModel()
    if (!model || model.isDisposed()) {
      return
    }
    return attachMonacoLspDocument({
      model,
      filePath,
      rootPath,
      worktreeId,
      languageId: language
    })
  }, [mountedEditor, filePath, language, worktreeId, rootPath, ownerLocal, liveTail])
}
