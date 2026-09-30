import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'

// Why: the editor's own save path writes to disk, which fans out as an
// fs:changed event back to useEditorExternalWatch a few ms later. Treating
// our own write as an "external" change schedules a setContent reload that
// resets the TipTap selection to the end of the document mid-typing — and,
// because the RichMarkdownEditor guards (lastCommittedMarkdownRef + current
// getMarkdown() round-trip) can drift by a trailing newline or soft-break,
// the reload can silently drop unsaved keystrokes as well. Stamping a path
// right before writeFile lets the watch hook ignore the echo event without
// touching the editor at all. Keyed by runtime owner + normalized absolute
// path, bounded by a short TTL so a genuinely external edit that lands after
// the window still gets picked up.
const SELF_WRITE_TTL_MS = 750
// Why: SSH/runtime watcher echoes travel a poll-plus-network path and can
// land seconds after the write. A local-sized TTL lets the echo arrive after
// the stamp expired, which raises a false changed-on-disk banner on remote
// tabs while typing with autosave on.
export const SELF_WRITE_REMOTE_TTL_MS = 3000
const SELF_WRITE_MAX_STAMPS = 256

// Why: a formatter can rewrite the file for as long as its own timeout, and its
// output is unknown until it exits, so its echoes cannot be matched by content.
export const SELF_WRITE_FORMATTER_PENDING_TTL_MS = 30_000

export type RecentSelfWrite = {
  content: string | null
  /** A format-on-save run may still rewrite the file; any content on disk is Orca's own. */
  formatterPending?: boolean
}

type SelfWriteStamp = RecentSelfWrite & {
  expiresAt: number
}

const stamps = new Map<string, SelfWriteStamp>()

function selfWriteKey(absolutePath: string, runtimeEnvironmentId?: string | null): string {
  return `${runtimeEnvironmentId?.trim() || 'client'}::${normalizeAbsolutePathForComparison(absolutePath)}`
}

function pruneExpiredSelfWrites(now = Date.now()): void {
  for (const [key, stamp] of stamps) {
    if (now > stamp.expiresAt) {
      stamps.delete(key)
    }
  }
}

function enforceSelfWriteStampLimit(): void {
  while (stamps.size > SELF_WRITE_MAX_STAMPS) {
    const oldest = stamps.keys().next().value
    if (oldest === undefined) {
      break
    }
    stamps.delete(oldest)
  }
}

export function recordSelfWrite(
  absolutePath: string,
  content?: string,
  runtimeEnvironmentId?: string | null,
  ttlMs: number = SELF_WRITE_TTL_MS
): void {
  const now = Date.now()
  pruneExpiredSelfWrites(now)
  const key = selfWriteKey(absolutePath, runtimeEnvironmentId)
  // Why: a missing watcher echo should not leave stale path/content stamps in
  // memory for the whole renderer session.
  stamps.delete(key)
  stamps.set(key, {
    content: content ?? null,
    expiresAt: now + ttlMs
  })
  enforceSelfWriteStampLimit()
}

export function recordFormatterPendingSelfWrite(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): void {
  const now = Date.now()
  pruneExpiredSelfWrites(now)
  const key = selfWriteKey(absolutePath, runtimeEnvironmentId)
  stamps.delete(key)
  stamps.set(key, {
    content: null,
    formatterPending: true,
    expiresAt: now + SELF_WRITE_FORMATTER_PENDING_TTL_MS
  })
  enforceSelfWriteStampLimit()
}

export function clearSelfWrite(absolutePath: string, runtimeEnvironmentId?: string | null): void {
  stamps.delete(selfWriteKey(absolutePath, runtimeEnvironmentId))
}

export function getRecentSelfWrite(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): RecentSelfWrite | null {
  const key = selfWriteKey(absolutePath, runtimeEnvironmentId)
  const stamp = stamps.get(key)
  if (!stamp) {
    return null
  }
  if (Date.now() > stamp.expiresAt) {
    stamps.delete(key)
    return null
  }
  return stamp.formatterPending
    ? { content: stamp.content, formatterPending: true }
    : { content: stamp.content }
}

/**
 * Judged against the stamp as it is now, not as it was when a verification read
 * began: a read that straddles the formatter's rewrite must not flag Orca's own output.
 */
export function isDiskContentExpectedBySelfWrite(
  absolutePath: string,
  runtimeEnvironmentId: string | null | undefined,
  diskContent: string | null | undefined
): boolean {
  const stamp = getRecentSelfWrite(absolutePath, runtimeEnvironmentId)
  if (!stamp) {
    return false
  }
  return stamp.formatterPending === true || (diskContent != null && stamp.content === diskContent)
}

export function hasRecentSelfWrite(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): boolean {
  return getRecentSelfWrite(absolutePath, runtimeEnvironmentId) !== null
}

export function __clearSelfWriteRegistryForTests(): void {
  stamps.clear()
}

export function __getSelfWriteRegistrySizeForTests(): number {
  return stamps.size
}
