import { exec, execFile } from 'node:child_process'
import {
  expandFormatOnSaveCommand,
  isFormatOnSaveConfigured,
  matchesFormatOnSaveInclude,
  type FormatOnSaveResult
} from '../shared/format-on-save-command'
import {
  normalizeRuntimePathForComparison,
  normalizeRuntimePathSeparators,
  relativePathInsideRoot
} from '../shared/cross-platform-path'
import { parseWslPath, toLinuxPath } from './wsl'
import type { RepoFormatOnSaveSettings } from '../shared/types'

/** Long enough for a cold `npx prettier`, short enough that a hung formatter frees the file quickly. */
export const FORMAT_ON_SAVE_TIMEOUT_MS = 20_000

// Why: node's 1 MB default turns a chatty-but-successful formatter (`black
// --verbose`, `prettier --loglevel debug`) into a reported failure even though
// the file was rewritten correctly. The output is discarded on success, so the
// only thing a larger cap costs is a transient buffer.
const FORMAT_ON_SAVE_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export type FormatOnSaveRequest = {
  settings: RepoFormatOnSaveSettings | undefined | null
  worktreePath: string
  absoluteFilePath: string
}

// Why: autosave fires on a short debounce and a formatter rewrites the file it
// is reading; overlapping runs on one path race each other's output.
const inFlightPaths = new Set<string>()

export async function runFormatOnSave({
  settings,
  worktreePath,
  absoluteFilePath
}: FormatOnSaveRequest): Promise<FormatOnSaveResult> {
  if (!isFormatOnSaveConfigured(settings) || !settings) {
    return { status: 'skipped', reason: 'not-configured' }
  }

  const relativePath = getWorktreeRelativePath(worktreePath, absoluteFilePath)
  if (relativePath === null) {
    // Why: the command runs with the worktree as cwd, so a file outside it has no meaningful ${relativeFile}.
    return { status: 'skipped', reason: 'outside-worktree' }
  }

  if (!matchesFormatOnSaveInclude(relativePath, settings.include)) {
    return { status: 'skipped', reason: 'not-included' }
  }

  // Why: use the comparison form so Windows' case-insensitive paths share one
  // in-flight slot. POSIX paths are left case-sensitive on purpose — folding them
  // would treat two genuinely different files as one.
  const inFlightKey = normalizeRuntimePathForComparison(absoluteFilePath)
  if (inFlightPaths.has(inFlightKey)) {
    return { status: 'skipped', reason: 'already-running' }
  }

  inFlightPaths.add(inFlightKey)
  try {
    return await executeFormatCommand({
      command: settings.command,
      worktreePath,
      absoluteFilePath,
      relativePath
    })
  } finally {
    inFlightPaths.delete(inFlightKey)
  }
}

export function getWorktreeRelativePath(
  worktreePath: string,
  absoluteFilePath: string
): string | null {
  // Why: node's `path.relative` resolves against the host platform, so a WSL UNC
  // worktree only parses correctly on Windows. This comparison is platform-free,
  // which also lets CI cover the WSL branch.
  const relativePath = relativePathInsideRoot(worktreePath, absoluteFilePath)
  if (!relativePath) {
    return null
  }

  return normalizeRuntimePathSeparators(relativePath)
}

type FormatCommandExecution = {
  command: string
  worktreePath: string
  absoluteFilePath: string
  relativePath: string
}

async function executeFormatCommand({
  command,
  worktreePath,
  absoluteFilePath,
  relativePath
}: FormatCommandExecution): Promise<FormatOnSaveResult> {
  const wslInfo = parseWslPath(worktreePath)

  if (wslInfo) {
    // Why: the worktree lives on the WSL filesystem, so the formatter and the
    // paths it receives must both be Linux-side; a Windows-native run would
    // either miss the toolchain or crawl over the 9P bridge.
    const wslCommand = expandFormatOnSaveCommand({
      command,
      absolutePath: toLinuxPath(absoluteFilePath),
      relativePath,
      platform: 'linux'
    })
    return runWslFormatCommand(wslInfo.distro, wslInfo.linuxPath, wslCommand)
  }

  const expanded = expandFormatOnSaveCommand({
    command,
    absolutePath: absoluteFilePath,
    relativePath,
    platform: process.platform
  })

  return new Promise<FormatOnSaveResult>((resolve) => {
    exec(
      expanded,
      {
        cwd: worktreePath,
        timeout: FORMAT_ON_SAVE_TIMEOUT_MS,
        maxBuffer: FORMAT_ON_SAVE_MAX_BUFFER_BYTES,
        shell: getFormatShell(),
        encoding: 'utf-8'
      },
      (error, stdout, stderr) => {
        resolve(toFormatResult(error, stdout, stderr))
      }
    )
  })
}

function runWslFormatCommand(
  distro: string | null,
  linuxCwd: string,
  expandedCommand: string
): Promise<FormatOnSaveResult> {
  // Why: execFile avoids cmd.exe, which mangles the quoting the expansion just applied.
  const escapedCwd = linuxCwd.split("'").join(`'\\''`)
  const bashCommand = `cd '${escapedCwd}' && ${expandedCommand}`
  const distroArgs = distro ? ['-d', distro] : []

  return new Promise<FormatOnSaveResult>((resolve) => {
    let child: ReturnType<typeof execFile> | null = null
    let settled = false

    const finish = (error: Error | null, stdout = '', stderr = ''): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(toFormatResult(error, stdout, stderr))
    }

    // Why: execFile's own timeout only signals wsl.exe, which can outlive the guest command.
    const timeout = setTimeout(() => {
      child?.kill()
      finish(new Error(`Formatter timed out after ${FORMAT_ON_SAVE_TIMEOUT_MS}ms.`))
    }, FORMAT_ON_SAVE_TIMEOUT_MS)

    try {
      child = execFile(
        'wsl.exe',
        [...distroArgs, '--', 'bash', '-c', bashCommand],
        {
          timeout: FORMAT_ON_SAVE_TIMEOUT_MS,
          maxBuffer: FORMAT_ON_SAVE_MAX_BUFFER_BYTES,
          encoding: 'utf-8'
        },
        (error, stdout, stderr) => {
          finish(error ?? null, stdout, stderr)
        }
      )
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function toFormatResult(
  error: Error | null,
  stdout: string | Buffer,
  stderr: string | Buffer
): FormatOnSaveResult {
  if (!error) {
    return { status: 'completed' }
  }

  // Why: a killed process reports the same "Command failed" as a parse error,
  // and its stderr is usually empty — name the timeout so the user knows to look
  // at the command rather than at their file.
  if ((error as { killed?: boolean }).killed) {
    return {
      status: 'failed',
      message: `Formatter timed out after ${FORMAT_ON_SAVE_TIMEOUT_MS}ms.`
    }
  }

  // Why: formatters put the actionable parse error on stderr and exit non-zero;
  // the Node error message alone ("Command failed") tells the user nothing.
  const message = [String(stderr).trim(), String(stdout).trim(), error.message.trim()].find(
    (candidate) => candidate.length > 0
  )

  return { status: 'failed', message: message ?? 'Formatter failed.' }
}

function getFormatShell(): string | undefined {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe'
  }

  return '/bin/bash'
}

export function _resetFormatOnSaveInFlightForTests(): void {
  inFlightPaths.clear()
}
