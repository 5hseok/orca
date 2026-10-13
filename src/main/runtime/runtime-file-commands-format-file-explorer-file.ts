import type { FormatOnSaveResult } from '../../shared/format-on-save-command'
import { runRepoFormatOnSave } from '../format-on-save-repo'
import { RuntimeFileCommandsWithCreateFileExplorerDirNoClobber } from './runtime-file-commands-create-file-explorer-dir-no-clobber'
import { assertRuntimeFileMutationExpectation } from './runtime-file-commands-mobile-file-list-limit'
import { requireLocalRuntimeFileRoute } from './runtime-file-command-target'

export class RuntimeFileCommandsWithFormatFileExplorerFile extends RuntimeFileCommandsWithCreateFileExplorerDirNoClobber {
  /**
   * Formats a file the client just wrote, with the formatter command this server holds for the
   * repo. The command is never taken from the caller, and it runs on this host only.
   */
  async formatFileExplorerFile(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<FormatOnSaveResult> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    // Why: an `ssh:`/`runtime:` target throws here instead of running the command on this host.
    requireLocalRuntimeFileRoute(target)
    const repo = this.host.requireStore().getRepo(target.worktree.repoId)
    if (!repo) {
      return { status: 'skipped', reason: 'not-configured' }
    }
    return runRepoFormatOnSave({
      repo,
      worktreePath: target.worktree.path,
      absoluteFilePath: target.path
    })
  }
}
