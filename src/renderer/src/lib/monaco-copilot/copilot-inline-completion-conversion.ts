import type { IRange } from 'monaco-editor'
import { lspRangeToMonaco } from './lsp-monaco-position-conversion'
import type { LspRange } from './lsp-monaco-position-conversion'

export type CopilotInlineItem = { insertText: string; range: IRange | undefined }

function isLspRange(value: unknown): value is LspRange {
  const range = value as LspRange | null
  return (
    typeof range?.start?.line === 'number' &&
    typeof range.start.character === 'number' &&
    typeof range.end?.line === 'number' &&
    typeof range.end.character === 'number'
  )
}

// Why: LSP 3.18 allows a StringValue ({ kind: 'snippet', value }) as well as a plain string.
function readInsertText(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return raw
  }
  const value = (raw as { value?: unknown } | null | undefined)?.value
  return typeof value === 'string' ? value : null
}

/** textDocument/inlineCompletion result → Monaco inline items. Newlines are
 *  normalized to the model's EOL, as the Copilot LS README requires. */
export function copilotInlineCompletionsToMonaco(
  result: unknown,
  eol: string
): CopilotInlineItem[] {
  const rawItems = Array.isArray(result)
    ? result
    : ((result as { items?: unknown } | null)?.items ?? [])
  if (!Array.isArray(rawItems)) {
    return []
  }
  const items: CopilotInlineItem[] = []
  for (const raw of rawItems) {
    const item = raw as { insertText?: unknown; range?: unknown } | null
    const insertText = readInsertText(item?.insertText)
    if (!insertText) {
      continue
    }
    items.push({
      insertText: insertText.replace(/\r\n|\r|\n/g, eol),
      range: isLspRange(item?.range) ? lspRangeToMonaco(item.range) : undefined
    })
  }
  return items
}
