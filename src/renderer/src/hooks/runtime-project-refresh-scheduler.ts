import { toRuntimeExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'

export type RuntimeProjectRefreshSchedulerDeps = {
  refresh: (environmentId: string, repoIds: ReadonlySet<string> | null) => Promise<void>
  debounceMs?: number
  minIntervalMs?: number
  now?: () => number
  onError?: (error: unknown) => void
}

export type RuntimeProjectRefreshScheduler = {
  request: (environmentId: string, repoId?: string) => void
  stop: () => void
}

type RefreshEntry = {
  inFlight: boolean
  lastStartedAt: number
  pending: boolean
  refreshAll: boolean
  pendingRepoIds: Set<string>
  timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_DEBOUNCE_MS = 250
const DEFAULT_MIN_INTERVAL_MS = 5_000
const DEFAULT_REFRESH_CONCURRENCY = 5

export async function refreshRuntimeProjectWorktrees(
  environmentId: string,
  repos: readonly { id: string }[],
  fetchWorktrees: (
    repoId: string,
    options: { executionHostId: ExecutionHostId; suppressLineageRefresh: true }
  ) => Promise<unknown>,
  repoIds?: ReadonlySet<string>,
  concurrency = DEFAULT_REFRESH_CONCURRENCY
): Promise<void> {
  const reposToRefresh = repoIds ? repos.filter((repo) => repoIds.has(repo.id)) : repos
  let nextIndex = 0
  const failures: { repoId: string; error: unknown }[] = []
  const workerCount = Math.min(concurrency, reposToRefresh.length)
  const executionHostId = toRuntimeExecutionHostId(environmentId)

  // Why: one coalesced event can represent many repos; bound probes without dropping host identity.
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < reposToRefresh.length) {
        const index = nextIndex
        nextIndex += 1
        const repoId = reposToRefresh[index].id
        try {
          await fetchWorktrees(repoId, { executionHostId, suppressLineageRefresh: true })
        } catch (error) {
          failures.push({ repoId, error })
        }
      }
    })
  )
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Failed to refresh ${failures.length} runtime project worktree(s): ${failures
        .map((failure) => failure.repoId)
        .join(', ')}`
    )
  }
}

export function createRuntimeProjectRefreshScheduler(
  deps: RuntimeProjectRefreshSchedulerDeps
): RuntimeProjectRefreshScheduler {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = deps.now ?? Date.now
  const entries = new Map<string, RefreshEntry>()
  let stopped = false

  const getEntry = (environmentId: string): RefreshEntry => {
    let entry = entries.get(environmentId)
    if (!entry) {
      entry = {
        inFlight: false,
        lastStartedAt: 0,
        pending: false,
        refreshAll: false,
        pendingRepoIds: new Set(),
        timer: null
      }
      entries.set(environmentId, entry)
    }
    return entry
  }

  const schedule = (environmentId: string, entry: RefreshEntry): void => {
    if (stopped || entry.inFlight || entry.timer) {
      return
    }
    const elapsed = entry.lastStartedAt > 0 ? now() - entry.lastStartedAt : minIntervalMs
    const throttleDelay = Math.max(0, minIntervalMs - elapsed)
    const delay = Math.max(debounceMs, throttleDelay)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void run(environmentId, entry)
    }, delay)
  }

  const run = async (environmentId: string, entry: RefreshEntry): Promise<void> => {
    if (stopped || !entry.pending) {
      return
    }
    entry.pending = false
    entry.inFlight = true
    entry.lastStartedAt = now()
    const repoIds = entry.refreshAll ? null : new Set(entry.pendingRepoIds)
    entry.refreshAll = false
    entry.pendingRepoIds.clear()
    try {
      await deps.refresh(environmentId, repoIds)
    } catch (error) {
      deps.onError?.(error)
    } finally {
      entry.inFlight = false
      if (entry.pending) {
        // Why: runtime repo events can be noisy while a remote server is merely
        // connected; keep discovery live without letting it drive the renderer.
        schedule(environmentId, entry)
      }
    }
  }

  const request = (environmentId: string, repoId?: string): void => {
    const trimmedEnvironmentId = environmentId.trim()
    if (!trimmedEnvironmentId || stopped) {
      return
    }
    const entry = getEntry(trimmedEnvironmentId)
    if (!entry.pending) {
      entry.refreshAll = false
      entry.pendingRepoIds.clear()
    }
    const trimmedRepoId = repoId?.trim()
    if (trimmedRepoId && !entry.refreshAll) {
      entry.pendingRepoIds.add(trimmedRepoId)
    } else if (!trimmedRepoId) {
      entry.refreshAll = true
      entry.pendingRepoIds.clear()
    }
    entry.pending = true
    schedule(trimmedEnvironmentId, entry)
  }

  const stop = (): void => {
    stopped = true
    for (const entry of entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
    }
    entries.clear()
  }

  return { request, stop }
}
