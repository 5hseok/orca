import type { RepoFormatOnSaveSettings } from './types'
import { normalizeRuntimePathSeparators } from './cross-platform-path'

/** Shown in Settings as placeholders; these are command/glob syntax, not UI copy. */
export const SUGGESTED_FORMAT_ON_SAVE_INCLUDE = '**/*.{ts,tsx,js,jsx,json,css,md}'
export const SUGGESTED_FORMAT_ON_SAVE_COMMAND = 'npx prettier --write ${file}'

export const FORMAT_ON_SAVE_FILE_TOKEN = '${file}'
export const FORMAT_ON_SAVE_RELATIVE_FILE_TOKEN = '${relativeFile}'

export type FormatOnSaveSkipReason =
  | 'not-configured'
  | 'not-included'
  | 'outside-worktree'
  | 'already-running'
  /** SSH and runtime hosts expose no generic command channel, so the file is saved unformatted. */
  | 'unsupported-host'

export type FormatOnSaveResult =
  | { status: 'completed' }
  | { status: 'skipped'; reason: FormatOnSaveSkipReason }
  | { status: 'failed'; message: string }

export function getDefaultRepoFormatOnSaveSettings(): RepoFormatOnSaveSettings {
  return { enabled: false, command: '', include: [] }
}

export function normalizeRepoFormatOnSaveSettings(value: unknown): RepoFormatOnSaveSettings {
  const raw = (value ?? {}) as Partial<RepoFormatOnSaveSettings>
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  const include = Array.isArray(raw.include)
    ? raw.include
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : []

  return {
    // Why: a command-less config would run nothing every save; treat it as off so callers can skip work early.
    enabled: raw.enabled === true && command.length > 0,
    command,
    include
  }
}

/** Settings shows the globs as one comma-separated line; newlines are accepted for pasted lists. */
export function parseFormatOnSaveIncludeInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function formatOnSaveIncludeToInput(include: string[]): string {
  return include.join(', ')
}

export function isFormatOnSaveConfigured(
  settings: RepoFormatOnSaveSettings | undefined | null
): boolean {
  return settings?.enabled === true && settings.command.trim().length > 0
}

/**
 * `include` semantics: empty list matches every saved file. A pattern without a
 * `/` matches the basename in any directory, which is what users reach for when
 * they type `*.ts`.
 */
export function matchesFormatOnSaveInclude(relativePath: string, include: string[]): boolean {
  if (include.length === 0) {
    return true
  }

  const normalized = normalizeRuntimePathSeparators(relativePath).replace(/^\.?\//, '')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)

  return include.some((pattern) => {
    const normalizedPattern = normalizeRuntimePathSeparators(pattern).replace(/^\.?\//, '')
    const target = normalizedPattern.includes('/') ? normalized : basename
    return globToRegExp(normalizedPattern).test(target)
  })
}

const globRegExpCache = new Map<string, RegExp>()
const GLOB_CACHE_LIMIT = 256

function globToRegExp(pattern: string): RegExp {
  const cached = globRegExpCache.get(pattern)
  if (cached) {
    return cached
  }

  const compiled = new RegExp(`^${compileGlobBody(pattern)}$`)
  if (globRegExpCache.size >= GLOB_CACHE_LIMIT) {
    globRegExpCache.clear()
  }
  globRegExpCache.set(pattern, compiled)
  return compiled
}

function compileGlobBody(pattern: string): string {
  let source = ''

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]

    if (char === '*') {
      const isDoubleStar = pattern[index + 1] === '*'
      if (isDoubleStar) {
        index++
        if (pattern[index + 1] === '/') {
          index++
          // Why: `**/x` must also match a root-level `x`, so the directory prefix is optional.
          source += '(?:.*/)?'
          continue
        }
        source += '.*'
        continue
      }
      source += '[^/]*'
      continue
    }

    if (char === '?') {
      source += '[^/]'
      continue
    }

    if (char === '{') {
      const closingIndex = pattern.indexOf('}', index)
      if (closingIndex !== -1) {
        const alternatives = pattern.slice(index + 1, closingIndex).split(',')
        source += `(?:${alternatives.map((alternative) => compileGlobBody(alternative)).join('|')})`
        index = closingIndex
        continue
      }
    }

    source += escapeRegExpChar(char)
  }

  return source
}

function escapeRegExpChar(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}

type FormatOnSaveCommandExpansion = {
  command: string
  absolutePath: string
  relativePath: string
  platform: NodeJS.Platform
}

/**
 * Substitutes the path tokens with shell-quoted values. A command without any
 * token is left alone — some formatters take the whole project.
 */
export function expandFormatOnSaveCommand({
  command,
  absolutePath,
  relativePath,
  platform
}: FormatOnSaveCommandExpansion): string {
  const quotedAbsolute = quoteForShell(absolutePath, platform)
  const quotedRelative = quoteForShell(relativePath, platform)

  return command
    .split(FORMAT_ON_SAVE_RELATIVE_FILE_TOKEN)
    .join(quotedRelative)
    .split(FORMAT_ON_SAVE_FILE_TOKEN)
    .join(quotedAbsolute)
}

export function quoteForShell(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    // Why: `"` and `<>|&` are already illegal in Windows paths, so wrapping is
    // enough; a lone `%` only expands as part of a defined `%VAR%` pair.
    return `"${value}"`
  }

  return `'${value.split("'").join(`'\\''`)}'`
}
