import type { editor } from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPILOT_MAX_DOCUMENT_CHARS } from '../../../../shared/copilot-inline-completion-types'
import {
  closeCopilotDocumentForModel,
  flushPendingCopilotChange,
  openCopilotDocumentForModel
} from './monaco-copilot-documents'

function createFakeModel(initialText: string) {
  let text = initialText
  let listener: () => void = () => {}
  const model = {
    uri: { toString: () => 'file:///repo/a.ts' },
    getValue: () => text,
    getValueLength: () => text.length,
    isDisposed: () => false,
    onDidChangeContent: (callback: () => void) => {
      listener = callback
      return { dispose: vi.fn() }
    }
  } as unknown as editor.ITextModel
  return {
    model,
    edit(next: string): void {
      text = next
      listener()
    }
  }
}

const api = {
  openDocument: vi.fn(),
  changeDocument: vi.fn(),
  closeDocument: vi.fn()
}

beforeEach(() => {
  vi.useFakeTimers()
  api.openDocument.mockResolvedValue({ fileUri: 'file:///repo/a.ts' })
  api.changeDocument.mockResolvedValue(undefined)
  api.closeDocument.mockResolvedValue(undefined)
  vi.stubGlobal('window', { api: { copilotCompletion: api } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const params = { filePath: '/repo/a.ts', rootPath: '/repo', languageId: 'typescript' }

describe('monaco copilot documents', () => {
  it('debounces edits into one full-text change and closes on last release', async () => {
    const { model, edit } = createFakeModel('a')
    const entry = await openCopilotDocumentForModel({ model, ...params })
    expect(entry?.fileUri).toBe('file:///repo/a.ts')
    edit('ab')
    edit('abc')
    expect(api.changeDocument).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(api.changeDocument).toHaveBeenCalledTimes(1)
    expect(api.changeDocument).toHaveBeenCalledWith({ fileUri: 'file:///repo/a.ts', text: 'abc' })
    closeCopilotDocumentForModel(model.uri.toString())
    expect(api.closeDocument).toHaveBeenCalledWith({ fileUri: 'file:///repo/a.ts' })
  })

  it('flushes a pending change before a completion request', async () => {
    const { model, edit } = createFakeModel('a')
    const entry = await openCopilotDocumentForModel({ model, ...params })
    edit('ab')
    await flushPendingCopilotChange(entry!)
    expect(api.changeDocument).toHaveBeenCalledWith({ fileUri: 'file:///repo/a.ts', text: 'ab' })
    closeCopilotDocumentForModel(model.uri.toString())
  })

  it('does not attach oversized models', async () => {
    const { model } = createFakeModel('x'.repeat(COPILOT_MAX_DOCUMENT_CHARS + 1))
    await expect(openCopilotDocumentForModel({ model, ...params })).resolves.toBeNull()
    expect(api.openDocument).not.toHaveBeenCalled()
  })

  it('stays detached when main returns no document (signed out or not installed)', async () => {
    api.openDocument.mockResolvedValue({ fileUri: null })
    const { model } = createFakeModel('a')
    await expect(openCopilotDocumentForModel({ model, ...params })).resolves.toBeNull()
  })
})
