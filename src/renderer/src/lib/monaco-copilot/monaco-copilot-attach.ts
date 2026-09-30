import type { IDisposable, editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import {
  closeCopilotDocumentForModel,
  isWithinCopilotSizeLimit,
  onCopilotModelWithinSizeLimit,
  openCopilotDocumentForModel,
  type CopilotDocumentParams
} from './monaco-copilot-documents'
import { ensureCopilotInlineProvider } from './monaco-copilot-inline-provider'

/** Attach `model` to the Copilot language server for ghost text; returns the
 *  detach cleanup. Main returns no document when Copilot is missing or signed out. */
export function attachMonacoCopilotDocument(
  params: CopilotDocumentParams & { model: editor.ITextModel }
): () => void {
  const { model } = params
  const modelUri = model.uri.toString()
  let closed = false
  let opened = false
  let sizeWatch: IDisposable | null = null

  const tryOpen = (): void => {
    if (closed || model.isDisposed()) {
      return
    }
    if (!isWithinCopilotSizeLimit(model)) {
      // Why: an oversized model gets no content listener; wait for it to shrink instead of staying detached.
      sizeWatch = onCopilotModelWithinSizeLimit(model, tryOpen)
      return
    }
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
  }
  tryOpen()

  return () => {
    closed = true
    sizeWatch?.dispose()
    if (opened) {
      closeCopilotDocumentForModel(modelUri)
    }
  }
}
