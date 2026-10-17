import type * as MonacoNamespace from 'monaco-editor'
import type { Uri, editor } from 'monaco-editor'
import { detectLanguage } from '@/lib/language-detect'

/** Read-only models that let Monaco's peek widget preview files that are not
 *  open. A separate scheme keeps them from colliding with editor tab models,
 *  which use the plain file path URI. */
export const LSP_PEEK_SCHEME = 'orca-peek'

// Why: peek lists can span many files; keep recent previews, drop the rest.
const MAX_PEEK_MODELS = 40
const peekModelsByPath = new Map<string, editor.ITextModel>()
// Why: reverse lookup instead of decoding the URI path, which mangles Windows drive paths.
const pathByPeekUri = new Map<string, string>()

function toPeekUri(monaco: typeof MonacoNamespace, absolutePath: string): Uri {
  const normalized = absolutePath.replace(/\\/g, '/')
  return monaco.Uri.from({
    scheme: LSP_PEEK_SCHEME,
    path: normalized.startsWith('/') ? normalized : `/${normalized}`
  })
}

export function peekUriToPath(resource: { toString: () => string }): string | null {
  return pathByPeekUri.get(resource.toString()) ?? null
}

function touch(absolutePath: string, model: editor.ITextModel): void {
  peekModelsByPath.delete(absolutePath)
  peekModelsByPath.set(absolutePath, model)
  while (peekModelsByPath.size > MAX_PEEK_MODELS) {
    const [oldestPath, oldest] = peekModelsByPath.entries().next().value as [
      string,
      editor.ITextModel
    ]
    peekModelsByPath.delete(oldestPath)
    pathByPeekUri.delete(oldest.uri.toString())
    oldest.dispose()
  }
}

/** Ensures a fresh preview model exists for `absolutePath`; returns its URI,
 *  or null when the file cannot be read (the location then keeps its file URI). */
export async function ensurePeekModel(
  monaco: typeof MonacoNamespace,
  absolutePath: string
): Promise<Uri | null> {
  let content: string
  try {
    const result = await window.api.fs.readFile({ filePath: absolutePath })
    if (result.isBinary) {
      return null
    }
    content = result.content
  } catch {
    return null
  }
  const uri = toPeekUri(monaco, absolutePath)
  const existing = peekModelsByPath.get(absolutePath)
  if (existing && !existing.isDisposed()) {
    // Why: the file may have changed on disk since the last peek.
    if (existing.getValue() !== content) {
      existing.setValue(content)
    }
    touch(absolutePath, existing)
    return uri
  }
  const model = monaco.editor.createModel(content, detectLanguage(absolutePath), uri)
  pathByPeekUri.set(uri.toString(), absolutePath)
  touch(absolutePath, model)
  return uri
}
