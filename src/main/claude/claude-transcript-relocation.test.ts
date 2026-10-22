import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { relocateClaudeTranscript } from './claude-transcript-relocation'
import { encodeClaudeProjectPath } from '../ai-vault/claude-project-dir-encoding'

let roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

async function seedTranscript(withSidecar: boolean): Promise<{
  projectsDir: string
  transcriptPath: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-claude-relocate-'))
  roots.push(root)
  const projectsDir = path.join(root, 'projects')
  const bucket = path.join(projectsDir, encodeClaudeProjectPath('/repo'))
  await mkdir(bucket, { recursive: true })
  const transcriptPath = path.join(bucket, 'session-1.jsonl')
  await writeFile(transcriptPath, '{}\n')
  if (withSidecar) {
    await mkdir(path.join(bucket, 'session-1', 'subagents'), { recursive: true })
  }
  return { projectsDir, transcriptPath }
}

describe('relocateClaudeTranscript', () => {
  it('moves the transcript and its sidecar into the target cwd bucket', async () => {
    const { projectsDir, transcriptPath } = await seedTranscript(true)
    const targetBucket = path.join(
      projectsDir,
      encodeClaudeProjectPath('/repo/.claude/worktrees/feature')
    )

    const result = await relocateClaudeTranscript({
      transcriptPath,
      targetCwd: '/repo/.claude/worktrees/feature'
    })

    expect(result).toEqual({
      outcome: 'moved',
      transcriptPath: path.join(targetBucket, 'session-1.jsonl')
    })
    expect((await readdir(targetBucket)).sort()).toEqual(['session-1', 'session-1.jsonl'])
    expect(await readdir(path.dirname(transcriptPath))).toEqual([])
  })

  it('leaves a transcript already in the target bucket untouched', async () => {
    const { transcriptPath } = await seedTranscript(false)

    await expect(relocateClaudeTranscript({ transcriptPath, targetCwd: '/repo' })).resolves.toEqual(
      { outcome: 'unchanged', transcriptPath }
    )
  })

  it('refuses to overwrite a transcript with the same name in the target bucket', async () => {
    const { projectsDir, transcriptPath } = await seedTranscript(false)
    const targetBucket = path.join(projectsDir, encodeClaudeProjectPath('/other'))
    await mkdir(targetBucket, { recursive: true })
    await writeFile(path.join(targetBucket, 'session-1.jsonl'), '{}\n')

    await expect(
      relocateClaudeTranscript({ transcriptPath, targetCwd: '/other' })
    ).resolves.toEqual({ outcome: 'rejected', reason: 'target-exists' })
  })

  it('rejects paths outside a Claude projects directory', async () => {
    await expect(
      relocateClaudeTranscript({ transcriptPath: '/tmp/session.jsonl', targetCwd: '/repo' })
    ).resolves.toEqual({ outcome: 'rejected', reason: 'not-a-claude-transcript' })
  })
})
