import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPyprojectLocalPackagePaths,
  findWorkspacePythonInterpreter,
  resolvePyrightConfiguration
} from './lsp-python-workspace-settings'

function createMonorepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-pyright-'))
  mkdirSync(join(root, 'cores', 'db'), { recursive: true })
  mkdirSync(join(root, 'apps', 'api', '.venv', 'lib', 'python3.12', 'site-packages'), {
    recursive: true
  })
  writeFileSync(
    join(root, 'pyproject.toml'),
    [
      '[tool.poetry.dependencies]',
      'db = { path = "./cores/db", develop = true }',
      "api = {path = './apps/api', develop = true}",
      'gone = { path = "./cores/missing" }'
    ].join('\n')
  )
  return root
}

describe.skipIf(process.platform === 'win32')('lsp-python-workspace-settings', () => {
  it('finds the workspace .venv interpreter', () => {
    const root = createMonorepo()
    expect(findWorkspacePythonInterpreter(root)).toBeNull()
    mkdirSync(join(root, '.venv', 'bin'), { recursive: true })
    writeFileSync(join(root, '.venv', 'bin', 'python'), '')
    expect(findWorkspacePythonInterpreter(root)).toBe(join(root, '.venv', 'bin', 'python'))
  })

  it('collects existing local path dependencies from pyproject.toml', () => {
    const root = createMonorepo()
    expect(findPyprojectLocalPackagePaths(root)).toEqual([
      join(root, 'cores', 'db'),
      join(root, 'apps', 'api')
    ])
  })

  it('nests analysis settings under the python section, as pyright reads them', () => {
    const root = createMonorepo()
    const [python, pyright] = resolvePyrightConfiguration(root, {
      items: [{ section: 'python' }, { section: 'pyright' }]
    }) as [{ analysis: { extraPaths: string[] } }, unknown]
    expect(python.analysis.extraPaths).toEqual([
      join(root, 'cores', 'db'),
      join(root, 'apps', 'api'),
      join(root, 'apps', 'api', '.venv', 'lib', 'python3.12', 'site-packages')
    ])
    expect(pyright).toBeNull()
  })

  it('sends the same severity overrides for python and python.analysis requests', () => {
    type Overrides = { diagnosticSeverityOverrides: Record<string, string> }
    const [python, analysis] = resolvePyrightConfiguration(createMonorepo(), {
      items: [{ section: 'python' }, { section: 'python.analysis' }]
    }) as [{ analysis: Overrides }, Overrides]
    expect(python.analysis.diagnosticSeverityOverrides).toEqual(
      analysis.diagnosticSeverityOverrides
    )
    expect(analysis.diagnosticSeverityOverrides.reportArgumentType).toBe('warning')
    // Why: likely-real bugs (None access, unbound names) must stay errors.
    expect(analysis.diagnosticSeverityOverrides.reportOptionalMemberAccess).toBeUndefined()
    expect(analysis.diagnosticSeverityOverrides.reportPossiblyUnboundVariable).toBeUndefined()
  })

  it('ignores malformed configuration requests', () => {
    expect(resolvePyrightConfiguration('/nowhere', null)).toBeUndefined()
  })
})
