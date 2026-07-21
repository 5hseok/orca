import { spawn, type ChildProcess } from 'node:child_process'

type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: 'ignore'; windowsHide: true }
) => ChildProcess

/**
 * Force-kills a Windows PTY's entire process tree with `taskkill /t /f`.
 *
 * Why: closing the ConPTY only sends CTRL_CLOSE to console members and relies on
 * them cooperating. A wedged descendant — e.g. a hung `git.exe` during a
 * source-control operation — ignores it and keeps the pseudoconsole open, so
 * node-pty's `onExit` never fires. That is fatal for Orca specifically because
 * destructive worktree removal is fail-closed: it refuses to delete the worktree
 * directory until every PTY is proven physically stopped (#7991). node-pty's own
 * child reap does not save us here — the daemon opts into `useConptyDll: true`,
 * the backend that skips the console-process-list termination the classic ConPTY
 * backend performs. `taskkill /f` is `TerminateProcess`, which needs no
 * cooperation, and `/t` walks the tree — enough to reap the process holding the
 * console open. (A Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE would be
 * the atomic gold standard, but node-pty exposes no spawn-time job assignment and
 * anything taskkill's parent walk misses has detached from this console and so
 * is not what blocks physical exit — that is orphan cleanup, handled elsewhere.)
 *
 * Best-effort and non-blocking: the caller still closes the ConPTY handle and
 * the PTY's own physical-exit wait owns completion, so a missing/failed
 * `taskkill` degrades to today's shell-only behavior rather than throwing.
 */
export function forceKillWindowsProcessTree(
  pid: number,
  deps: { spawnProcess?: SpawnFn } = {}
): void {
  // Why: after a reap proc.pid can be recycled; never taskkill an invalid pid.
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }
  const spawnProcess = deps.spawnProcess ?? (spawn as unknown as SpawnFn)
  try {
    const killer = spawnProcess('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
    // Why: an async spawn failure (taskkill unavailable) must not surface as an
    // unhandled 'error' and crash the daemon; completion is proven by exit, not here.
    killer?.on?.('error', () => {})
    killer?.unref?.()
  } catch {
    /* taskkill could not start — caller's ConPTY close remains the fallback. */
  }
}
