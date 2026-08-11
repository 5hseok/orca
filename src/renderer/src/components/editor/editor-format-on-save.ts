import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import type { OpenFile } from '@/store/slices/editor'
import type { Worktree } from '../../../../shared/types'
import type { FormatOnSaveResult } from '../../../../shared/format-on-save-command'

export type FormatSavedFileRequest = {
  repoId: string
  worktreePath: string
  filePath: string
  savedContent: string
  runFormat: (args: {
    repoId: string
    worktreePath: string
    filePath: string
  }) => Promise<FormatOnSaveResult>
  readSavedContent: () => Promise<string | null>
}

/**
 * Runs the repo's formatter over a file the editor just wrote, and returns the
 * reformatted text when the formatter actually changed it. `null` means the
 * buffer should keep the content it saved.
 */
export async function formatSavedFile({
  repoId,
  worktreePath,
  filePath,
  savedContent,
  runFormat,
  readSavedContent
}: FormatSavedFileRequest): Promise<string | null> {
  let result: FormatOnSaveResult
  try {
    result = await runFormat({ repoId, worktreePath, filePath })
  } catch (error) {
    // Why: the file is already on disk; a broken format channel must not turn a
    // successful save into a failed one.
    console.error('[editor] format on save failed', error)
    return null
  }

  if (result.status === 'failed') {
    notifyFormatFailure(result.message)
    return null
  }

  if (result.status !== 'completed') {
    return null
  }

  try {
    const formatted = await readSavedContent()
    if (formatted === null || formatted === savedContent) {
      return null
    }
    return formatted
  } catch (error) {
    console.error('[editor] reading formatted file failed', error)
    return null
  }
}

type EditorFileOperationContext = {
  settings: unknown
  worktreeId: string
  worktreePath: string | null
  connectionId?: string
  expectedExecutionHostId: 'local' | `ssh:${string}`
}

type MaybeFormatSavedFileArgs = {
  file: OpenFile
  worktree: Worktree | null | undefined
  fileContext: EditorFileOperationContext
  savedContent: string
}

/**
 * Editor-side entry point: decides whether this save is even formattable, then
 * defers to the main process, which owns the configured command.
 */
export async function maybeFormatSavedFile({
  file,
  worktree,
  fileContext,
  savedContent
}: MaybeFormatSavedFileArgs): Promise<string | null> {
  // Why: SSH and runtime hosts expose no generic command channel, so there is
  // nothing to run there — skip before paying for an IPC round trip per save.
  if (
    !worktree?.path ||
    fileContext.connectionId ||
    file.runtimeEnvironmentId ||
    fileContext.expectedExecutionHostId !== 'local'
  ) {
    return null
  }

  return formatSavedFile({
    repoId: worktree.repoId,
    worktreePath: worktree.path,
    filePath: file.filePath,
    savedContent,
    runFormat: (args) => window.api.editor.formatOnSave(args),
    readSavedContent: async () => {
      const result = await readRuntimeFileContent({
        settings: fileContext.settings as Parameters<typeof readRuntimeFileContent>[0]['settings'],
        filePath: file.filePath,
        relativePath: file.relativePath,
        worktreeId: file.worktreeId
      })
      return typeof result.content === 'string' ? result.content : null
    }
  })
}

function notifyFormatFailure(message: string): void {
  toast.error(
    translate('auto.components.editor.formatOnSave.failure.notice.4f2b1c9a7d', 'Formatter failed'),
    {
      // Why: a formatter reports the offending line on stderr; truncate so a
      // stack-trace-sized failure cannot cover the workspace.
      description: message.length > 300 ? `${message.slice(0, 300)}…` : message
    }
  )
}
