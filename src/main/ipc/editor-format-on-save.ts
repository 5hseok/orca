import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import { runFormatOnSave } from '../format-on-save-runner'
import {
  isFormatOnSaveConfigured,
  normalizeRepoFormatOnSaveSettings,
  type FormatOnSaveResult
} from '../../shared/format-on-save-command'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { resolveRegisteredWorktreePath } from './filesystem-auth'
import type { RemoteFormatExecutor } from '../format-on-save-runner'

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
      // Why: runtime hosts have no non-interactive exec channel of their own, so
      // the formatter can't reach the file. SSH does, via agent.execNonInteractive.
      if (!repo.connectionId && host && host.kind !== 'local') {
        return { status: 'skipped', reason: 'unsupported-host' }
      }

      if (repo.connectionId) {
        const remoteExec = createRemoteFormatExecutor(repo.connectionId)
        if (!remoteExec) {
          // Why: a disconnected SSH host isn't a formatter failure — the save
          // already landed, so stay quiet and let the next save format.
          return { status: 'skipped', reason: 'unsupported-host' }
        }
        return runFormatOnSave({
          settings,
          // Why: remote paths are the remote host's to validate; the local
          // registered-root check would reject or rewrite them.
          worktreePath: args.worktreePath,
          absoluteFilePath: args.filePath,
          remoteExec,
          hostScope: repo.connectionId
        })
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

function createRemoteFormatExecutor(connectionId: string): RemoteFormatExecutor | null {
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    return null
  }

  return ({ binary, args, cwd, timeoutMs }) =>
    provider.execNonInteractive(binary, args, cwd, timeoutMs)
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
