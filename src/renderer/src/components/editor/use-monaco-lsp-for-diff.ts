import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { isCopilotAttachOwnerLocal } from '@/lib/monaco-copilot/copilot-attach-owner'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { attachMonacoLspDocument } from '@/lib/monaco-lsp/monaco-lsp-attach'
import { resolveAnnotationPathInsideWorktree } from './check-annotation-path'
import { selectMarkdownDocumentWorktreePath } from './markdown-document-worktree-path-selector'

/** Attach the modified pane of a diff to a local language server so hover,
 *  definitions, and diagnostics reflect real project types instead of the
 *  sandboxed single-file worker. The original (base) pane stays plain. */
export function useMonacoLspForDiff(params: {
  modifiedEditor: editor.ICodeEditor | null
  relativePath: string
  worktreeId: string | undefined
  language: string
  /** Changes whenever the diff's Monaco models are re-created. */
  modelIdentity: string
}): void {
  const { modifiedEditor, relativePath, worktreeId, language, modelIdentity } = params
  const rootPath = useAppStore((s) => selectMarkdownDocumentWorktreePath(s, worktreeId))
  const resolved = rootPath ? resolveAnnotationPathInsideWorktree(rootPath, relativePath) : null
  const absolutePath = resolved?.absolutePath ?? null
  // Why: diff surfaces have no tab id; the workspace host and active runtime still gate it.
  const ownerLocal = useAppStore((s) =>
    absolutePath
      ? isCopilotAttachOwnerLocal(s, {
          fileId: '',
          filePath: absolutePath,
          worktreeId: worktreeId ?? null
        })
      : false
  )

  useEffect(() => {
    if (!modifiedEditor || !worktreeId || !rootPath || !absolutePath || !ownerLocal) {
      return
    }
    if (isPairedWebClientWindow()) {
      return
    }
    const model = modifiedEditor.getModel()
    if (!model || model.isDisposed()) {
      return
    }
    return attachMonacoLspDocument({
      model,
      filePath: absolutePath,
      rootPath,
      worktreeId,
      languageId: language
    })
    // Why: modelIdentity re-attaches after the diff surface swaps its models.
  }, [modifiedEditor, worktreeId, rootPath, absolutePath, ownerLocal, language, modelIdentity])
}
