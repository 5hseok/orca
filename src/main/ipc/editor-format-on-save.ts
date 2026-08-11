import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import { runFormatOnSave } from '../format-on-save-runner'
import {
  isFormatOnSaveConfigured,
  normalizeRepoFormatOnSaveSettings,
  type FormatOnSaveResult
} from '../../shared/format-on-save-command'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import { resolveRegisteredWorktreePath } from './filesystem-auth'

type FormatOnSaveArgs = {
  repoId: string
  worktreePath: string
  filePath: string
}

export function registerEditorFormatOnSaveHandlers(store: Store): void {
  ipcMain.removeHandler('editor:formatOnSave')

  ipcMain.handle(
    'editor:formatOnSave',
    async (_event, rawArgs: unknown): Promise<FormatOnSaveResult> => {
      const args = parseFormatOnSaveArgs(rawArgs)
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return { status: 'skipped', reason: 'not-configured' }
      }

      // Why: the command is read from the repo record, never from the renderer —
      // otherwise this handler would be an arbitrary-command-execution channel.
      const settings = normalizeRepoFormatOnSaveSettings(repo.formatOnSave)
      if (!isFormatOnSaveConfigured(settings)) {
        return { status: 'skipped', reason: 'not-configured' }
      }

      const host = parseExecutionHostId(getRepoExecutionHostId(repo))
      if (repo.connectionId || (host && host.kind !== 'local')) {
        return { status: 'skipped', reason: 'unsupported-host' }
      }

      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      return runFormatOnSave({
        settings,
        worktreePath,
        absoluteFilePath: args.filePath
      })
    }
  )
}

function parseFormatOnSaveArgs(rawArgs: unknown): FormatOnSaveArgs {
  const args = (rawArgs ?? {}) as Partial<FormatOnSaveArgs>
  const repoId = typeof args.repoId === 'string' ? args.repoId : ''
  const worktreePath = typeof args.worktreePath === 'string' ? args.worktreePath : ''
  const filePath = typeof args.filePath === 'string' ? args.filePath : ''

  if (!repoId || !worktreePath || !filePath) {
    throw new Error('Format on save requires a repo, worktree, and file path.')
  }
  if (filePath.includes('\0')) {
    throw new Error('Access denied: invalid file path')
  }

  return { repoId, worktreePath, filePath }
}
