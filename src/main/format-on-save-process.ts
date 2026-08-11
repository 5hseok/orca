import { execFile, spawn, type ChildProcess } from 'node:child_process'
import {
  expandFormatOnSaveCommand,
  type FormatOnSaveResult
} from '../shared/format-on-save-command'
import { getCmdExePath } from '../shared/windows-batch-spawn'
import { parseWslPath, toLinuxPath } from './wsl'
import { FORMAT_ON_SAVE_TIMEOUT_MS } from './format-on-save-timeout'

// Why: a chatty-but-successful formatter (`black --verbose`, `prettier
// --loglevel debug`) must not be reported as a failure just for talking. Output
// is only read to explain a non-zero exit, so past this cap it is truncated
// rather than turned into an error.
const FORMAT_ON_SAVE_OUTPUT_CAP_BYTES = 1024 * 1024

export type FormatCommandExecution = {
  command: string
  worktreePath: string
  absoluteFilePath: string
  relativePath: string
}

export async function executeFormatCommand({
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

  const isWindows = process.platform === 'win32'
  const shell = getFormatShell()
  const shellArgs = isWindows ? ['/d', '/s', '/c', expanded] : ['-c', expanded]

  return new Promise<FormatOnSaveResult>((resolve) => {
    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''

    // Why: `exec`'s timeout signals the shell only. A formatter it started
    // (`npx prettier` and friends) survives, and since the in-flight slot is
    // released when the callback fires, that orphan can rewrite the file on top
    // of a later save — a lost edit rather than a reported failure. Run the
    // shell in its own process group so the whole group can be killed.
    let child: ChildProcess
    try {
      child = spawn(shell, shellArgs, {
        cwd: worktreePath,
        detached: !isWindows,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const finish = (result: FormatOnSaveResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      killFormatterProcessTree(child)
    }, FORMAT_ON_SAVE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (stdout.length < FORMAT_ON_SAVE_OUTPUT_CAP_BYTES) {
        stdout += String(chunk)
      }
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < FORMAT_ON_SAVE_OUTPUT_CAP_BYTES) {
        stderr += String(chunk)
      }
    })

    child.on('error', (error) => {
      finish({ status: 'failed', message: error.message })
    })

    child.on('close', (code) => {
      if (timedOut) {
        finish({
          status: 'failed',
          message: `Formatter timed out after ${FORMAT_ON_SAVE_TIMEOUT_MS}ms.`
        })
        return
      }
      if (code === 0) {
        finish({ status: 'completed' })
        return
      }
      const message = [stderr.trim(), stdout.trim()].find((candidate) => candidate.length > 0)
      finish({ status: 'failed', message: message ?? `Formatter exited with code ${code}.` })
    })
  })
}

function killFormatterProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) {
    return
  }

  if (process.platform === 'win32') {
    // Why: Windows has no process groups to signal; taskkill /T walks the tree.
    try {
      execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => undefined)
    } catch {
      child.kill()
    }
    return
  }

  try {
    // Why: `detached` above made the shell a group leader, so the negative pid
    // reaches the formatter it spawned as well.
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
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
          maxBuffer: FORMAT_ON_SAVE_OUTPUT_CAP_BYTES,
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

function getFormatShell(): string {
  return process.platform === 'win32' ? getCmdExePath() : '/bin/bash'
}
