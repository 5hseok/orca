import { describe, expect, it } from 'vitest'
import {
  expandFormatOnSaveCommand,
  isFormatOnSaveConfigured,
  matchesFormatOnSaveInclude,
  normalizeRepoFormatOnSaveSettings,
  quoteForShell
} from './format-on-save-command'

describe('format-on-save settings normalization', () => {
  it('treats an enabled config with a blank command as off', () => {
    expect(normalizeRepoFormatOnSaveSettings({ enabled: true, command: '   ' })).toEqual({
      enabled: false,
      command: '',
      include: []
    })
  })

  it('drops non-string and blank include entries from persisted state', () => {
    const settings = normalizeRepoFormatOnSaveSettings({
      enabled: true,
      command: 'prettier --write ${file}',
      include: ['**/*.ts', '', '   ', 7, null, '**/*.md']
    })

    expect(settings.include).toEqual(['**/*.ts', '**/*.md'])
    expect(settings.enabled).toBe(true)
  })

  it('reads a missing config as disabled defaults', () => {
    expect(normalizeRepoFormatOnSaveSettings(undefined)).toEqual({
      enabled: false,
      command: '',
      include: []
    })
    expect(isFormatOnSaveConfigured(undefined)).toBe(false)
  })
})

describe('format-on-save include matching', () => {
  it('matches every saved file when no globs are configured', () => {
    expect(matchesFormatOnSaveInclude('src/a.ts', [])).toBe(true)
  })

  it('matches nested and root files for a leading double star', () => {
    expect(matchesFormatOnSaveInclude('src/deep/nested/a.ts', ['**/*.ts'])).toBe(true)
    expect(matchesFormatOnSaveInclude('a.ts', ['**/*.ts'])).toBe(true)
  })

  it('expands brace alternatives', () => {
    const include = ['**/*.{ts,tsx,json}']
    expect(matchesFormatOnSaveInclude('src/a.tsx', include)).toBe(true)
    expect(matchesFormatOnSaveInclude('src/a.json', include)).toBe(true)
    expect(matchesFormatOnSaveInclude('src/a.css', include)).toBe(false)
  })

  it('keeps a single star from crossing directory boundaries', () => {
    expect(matchesFormatOnSaveInclude('src/deep/a.ts', ['src/*.ts'])).toBe(false)
    expect(matchesFormatOnSaveInclude('src/a.ts', ['src/*.ts'])).toBe(true)
  })

  it('matches a slashless pattern against the basename in any directory', () => {
    expect(matchesFormatOnSaveInclude('deep/nested/a.ts', ['*.ts'])).toBe(true)
  })

  it('normalizes windows separators before matching', () => {
    expect(matchesFormatOnSaveInclude('src\\deep\\a.ts', ['src/**/*.ts'])).toBe(true)
  })

  it('does not let glob metacharacters in a path widen the match', () => {
    expect(matchesFormatOnSaveInclude('src/a.ts', ['src/a.t?'])).toBe(true)
    expect(matchesFormatOnSaveInclude('src/reportx2026.ts', ['src/report.2026.ts'])).toBe(false)
  })
})

describe('format-on-save command expansion', () => {
  it('substitutes absolute and relative tokens', () => {
    expect(
      expandFormatOnSaveCommand({
        command: 'prettier --write ${file} # ${relativeFile}',
        absolutePath: '/repo/src/a.ts',
        relativePath: 'src/a.ts',
        platform: 'darwin'
      })
    ).toBe("prettier --write '/repo/src/a.ts' # 'src/a.ts'")
  })

  it('leaves a token-free command untouched', () => {
    expect(
      expandFormatOnSaveCommand({
        command: 'pnpm format',
        absolutePath: '/repo/src/a.ts',
        relativePath: 'src/a.ts',
        platform: 'linux'
      })
    ).toBe('pnpm format')
  })

  it('quotes paths that would otherwise break out of the argument', () => {
    expect(
      expandFormatOnSaveCommand({
        command: 'prettier --write ${file}',
        absolutePath: "/repo/a b/it's; rm -rf ~.ts",
        relativePath: "a b/it's; rm -rf ~.ts",
        platform: 'darwin'
      })
    ).toBe(`prettier --write '/repo/a b/it'\\''s; rm -rf ~.ts'`)
  })

  it('wraps windows paths in double quotes', () => {
    expect(quoteForShell('C:\\repo\\a b.ts', 'win32')).toBe('"C:\\repo\\a b.ts"')
  })
})
