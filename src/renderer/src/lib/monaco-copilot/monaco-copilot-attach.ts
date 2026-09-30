import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import {
  closeCopilotDocumentForModel,
  openCopilotDocumentForModel,
  type CopilotDocumentParams
} from './monaco-copilot-documents'
import { ensureCopilotInlineProvider } from './monaco-copilot-inline-provider'

/** Attach `model` to the Copilot language server for ghost text; returns the
 *  detach cleanup. Main returns no document when Copilot is missing or signed out. */
export function attachMonacoCopilotDocument(
  params: CopilotDocumentParams & { model: editor.ITextModel }
): () => void {
  const modelUri = params.model.uri.toString()
  let closed = false
  let opened = false
  void openCopilotDocumentForModel(params).then((entry) => {
    if (!entry) {
      return
    }
    if (closed) {
      closeCopilotDocumentForModel(modelUri)
      return
    }
    opened = true
    ensureCopilotInlineProvider(monaco)
  })
  return () => {
    closed = true
    if (opened) {
      closeCopilotDocumentForModel(modelUri)
    }
  }
}
