import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const VENV_DIR_NAMES = ['.venv', 'venv', 'env'] as const

/** The workspace's own virtualenv interpreter, as VS Code's Python extension
 *  would pick it; null leaves pyright on the PATH python. */
export function findWorkspacePythonInterpreter(rootPath: string): string | null {
  for (const dirName of VENV_DIR_NAMES) {
    const candidate =
      process.platform === 'win32'
        ? join(rootPath, dirName, 'Scripts', 'python.exe')
        : join(rootPath, dirName, 'bin', 'python')
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/** Local path dependencies declared in the root pyproject.toml (Poetry/uv
 *  monorepos). Why: editable installs in a worktree's venv can still point at
 *  the primary checkout, so resolve these packages from this workspace first. */
export function findPyprojectLocalPackagePaths(rootPath: string): string[] {
  let pyproject: string
  try {
    pyproject = readFileSync(join(rootPath, 'pyproject.toml'), 'utf8')
  } catch {
    return []
  }
  const paths = new Set<string>()
  for (const match of pyproject.matchAll(/\bpath\s*=\s*["']([^"']+)["']/g)) {
    const packagePath = resolve(rootPath, match[1])
    try {
      if (packagePath !== resolve(rootPath) && statSync(packagePath).isDirectory()) {
        paths.add(packagePath)
      }
    } catch {
      // Missing path dependency: nothing to add.
    }
  }
  return [...paths]
}

/** site-packages of a package-local virtualenv (per-app Poetry venvs in monorepos
 *  whose root venv holds no third-party deps). */
function findVenvSitePackages(packagePath: string): string | null {
  for (const dirName of VENV_DIR_NAMES) {
    const venv = join(packagePath, dirName)
    if (process.platform === 'win32') {
      const sitePackages = join(venv, 'Lib', 'site-packages')
      if (existsSync(sitePackages)) {
        return sitePackages
      }
      continue
    }
    try {
      const python = readdirSync(join(venv, 'lib')).find((name) => name.startsWith('python'))
      if (python && existsSync(join(venv, 'lib', python, 'site-packages'))) {
        return join(venv, 'lib', python, 'site-packages')
      }
    } catch {
      // No venv under this name.
    }
  }
  return null
}

// Why: imprecise third-party annotations (e.g. redis-py's `eval`) and mocks trip
// these rules; a warning keeps them visible without red errors.
// A project's own pyright config still overrides them.
const PYRIGHT_SEVERITY_OVERRIDES = {
  reportGeneralTypeIssues: 'warning',
  reportArgumentType: 'warning',
  reportAttributeAccessIssue: 'warning',
  reportAssignmentType: 'warning',
  reportReturnType: 'warning'
} as const

export function buildPyrightAnalysisSettings(rootPath: string): {
  extraPaths: string[]
  autoSearchPaths: boolean
  useLibraryCodeForTypes: boolean
  diagnosticSeverityOverrides: typeof PYRIGHT_SEVERITY_OVERRIDES
} {
  const packagePaths = findPyprojectLocalPackagePaths(rootPath)
  const sitePackages = packagePaths
    .map(findVenvSitePackages)
    .filter((path): path is string => path !== null)
  // Why: workspace sources first so a worktree's own packages win over
  // editable installs that point back at the primary checkout.
  return {
    extraPaths: [...packagePaths, ...new Set(sitePackages)],
    autoSearchPaths: true,
    useLibraryCodeForTypes: true,
    diagnosticSeverityOverrides: PYRIGHT_SEVERITY_OVERRIDES
  }
}

/** Answers pyright's workspace/configuration pull, one entry per requested item. */
export function resolvePyrightConfiguration(
  rootPath: string,
  params: unknown
): unknown[] | undefined {
  const items = (params as { items?: { section?: unknown }[] } | null)?.items
  if (!Array.isArray(items)) {
    return undefined
  }
  const pythonPath = findWorkspacePythonInterpreter(rootPath)
  const analysis = buildPyrightAnalysisSettings(rootPath)
  return items.map((item) => {
    // Why: pyright reads analysis settings nested under `python`; older
    // builds and basedpyright also ask for `python.analysis` directly.
    if (item?.section === 'python') {
      return { ...(pythonPath ? { pythonPath } : {}), analysis }
    }
    if (item?.section === 'python.analysis') {
      return analysis
    }
    return null
  })
}
