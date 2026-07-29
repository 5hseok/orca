import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const tempRoots: string[] = []

const SCRATCH_BRANCH = 'fix/app-api/processing-lock-release'
const EXTERNAL_BRANCH = 'payments-refactor'

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

async function createFixture(): Promise<{
  mainPath: string
  scratchPath: string
  externalPath: string
}> {
  const rootPath = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'orca-hidden-import-')))
  tempRoots.push(rootPath)

  const mainPath = path.join(rootPath, 'orca')
  mkdirSync(mainPath, { recursive: true })
  git(mainPath, ['init'])
  git(mainPath, ['config', 'user.email', 'e2e@test.local'])
  git(mainPath, ['config', 'user.name', 'E2E Test'])
  writeFileSync(path.join(mainPath, 'README.md'), '# orca\n')
  git(mainPath, ['add', 'README.md'])
  git(mainPath, ['commit', '-m', 'Initial commit'])
  git(mainPath, ['branch', '-M', 'main'])

  const externalPath = path.join(rootPath, 'worktrees', EXTERNAL_BRANCH)
  git(mainPath, ['worktree', 'add', '-b', EXTERNAL_BRANCH, externalPath])

  // Why: sitting directly under a registered checkout is what makes this
  // agent-scratch rather than external — the case the repo-wide toggle never
  // reveals.
  const scratchPath = path.join(mainPath, '.claude', 'worktrees', 'processing-lock')
  git(mainPath, ['worktree', 'add', '-b', SCRATCH_BRANCH, scratchPath])

  return { mainPath, scratchPath, externalPath }
}

async function addProject(orcaPage: Page, mainPath: string): Promise<string> {
  await orcaPage.evaluate((folderPath) => {
    window.__store?.getState().openModal('confirm-add-project-from-folder', { folderPath })
  }, mainPath)
  const addProjectDialog = orcaPage.getByRole('dialog', { name: /^Add Project$/i })
  await expect(addProjectDialog).toBeVisible()
  await addProjectDialog.getByRole('button', { name: /^Add Project$/ }).click()
  await expect(addProjectDialog).toBeHidden()

  await expect
    .poll(
      () =>
        orcaPage.evaluate(
          (path) => window.__store?.getState().repos.find((repo) => repo.path === path)?.id ?? null,
          mainPath
        ),
      { timeout: 30_000, message: 'project was not added' }
    )
    .not.toBeNull()

  return orcaPage.evaluate(
    (path) => window.__store?.getState().repos.find((repo) => repo.path === path)?.id ?? '',
    mainPath
  )
}

test.afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

test.describe('Hidden worktree import', () => {
  test('imports an agent scratch worktree the repo-wide toggle cannot reveal', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)

    // Why: a fresh E2E profile follows the host locale, and this spec matches on
    // English control names.
    await orcaPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ uiLanguage: 'en' })
    })
    await expect(orcaPage.getByRole('button', { name: /Automations/i }).first()).toBeVisible()

    const fixture = await createFixture()
    const repoId = await addProject(orcaPage, fixture.mainPath)

    // Why: adding a project with linked worktrees flips the repo to `show`; park
    // it back on the default so both hidden ownerships are in play.
    await orcaPage.evaluate(async (repoId) => {
      await window.__store?.getState().updateRepo(repoId, { externalWorktreeVisibility: 'hide' })
      await window.__store?.getState().fetchWorktrees(repoId, { requireAuthoritative: true })
    }, repoId)

    const scratchRow = orcaPage.locator(`[data-worktree-id="${repoId}::${fixture.scratchPath}"]`)
    const externalRow = orcaPage.locator(`[data-worktree-id="${repoId}::${fixture.externalPath}"]`)
    await expect(scratchRow).toHaveCount(0)
    await expect(externalRow).toHaveCount(0)

    await orcaPage.evaluate((repoId) => {
      window.__store?.getState().openModal('worktree-visibility', { repoId })
    }, repoId)
    const dialog = orcaPage.getByRole('dialog', { name: /Non-Orca worktrees/i })
    await expect(dialog).toBeVisible()

    const rows = dialog.getByRole('listitem')
    await expect(rows.filter({ hasText: SCRATCH_BRANCH })).toHaveCount(1)
    await expect(rows.filter({ hasText: EXTERNAL_BRANCH })).toHaveCount(1)
    // Why: only the scratch row is badged, so the reason for hiding is legible.
    await expect(dialog.getByText('agent scratch')).toHaveCount(1)

    await rows.filter({ hasText: SCRATCH_BRANCH }).getByRole('button', { name: 'Import' }).click()

    await expect(dialog.getByText('Imported individually')).toBeVisible()
    await expect(scratchRow).toHaveCount(1)
    // Why: the import is per worktree, not a disguised repo-wide toggle.
    await expect(externalRow).toHaveCount(0)

    await rows.filter({ hasText: SCRATCH_BRANCH }).getByRole('button', { name: 'Hide' }).click()
    await expect(scratchRow).toHaveCount(0)
  })
})
