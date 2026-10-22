import { mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { encodeClaudeProjectPath } from '../ai-vault/claude-project-dir-encoding'
import type {
  ClaudeTranscriptRelocationArgs,
  ClaudeTranscriptRelocationResult
} from '../../shared/claude-transcript-relocation'

type RelocationPlan = {
  sourceTranscript: string
  targetTranscript: string
  sourceSidecar: string
  targetSidecar: string
}

// Claude lists a session in /resume only from the cwd-encoded bucket its transcript lives in.
export function planClaudeTranscriptRelocation(
  transcriptPath: string,
  targetCwd: string
): RelocationPlan | null {
  const bucketDir = path.dirname(transcriptPath)
  const projectsDir = path.dirname(bucketDir)
  if (path.basename(projectsDir) !== 'projects' || path.extname(transcriptPath) !== '.jsonl') {
    return null
  }
  const fileName = path.basename(transcriptPath)
  const sidecarName = path.basename(transcriptPath, '.jsonl')
  const targetBucket = path.join(projectsDir, encodeClaudeProjectPath(targetCwd))
  return {
    sourceTranscript: transcriptPath,
    targetTranscript: path.join(targetBucket, fileName),
    sourceSidecar: path.join(bucketDir, sidecarName),
    targetSidecar: path.join(targetBucket, sidecarName)
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export async function relocateClaudeTranscript(
  args: ClaudeTranscriptRelocationArgs | undefined
): Promise<ClaudeTranscriptRelocationResult> {
  const transcriptPath = args?.transcriptPath
  const targetCwd = args?.targetCwd
  if (
    typeof transcriptPath !== 'string' ||
    typeof targetCwd !== 'string' ||
    !path.isAbsolute(transcriptPath) ||
    !path.isAbsolute(targetCwd)
  ) {
    return { outcome: 'rejected', reason: 'invalid-arguments' }
  }
  const plan = planClaudeTranscriptRelocation(transcriptPath, targetCwd)
  if (!plan) {
    return { outcome: 'rejected', reason: 'not-a-claude-transcript' }
  }
  if (plan.sourceTranscript === plan.targetTranscript) {
    return { outcome: 'unchanged', transcriptPath }
  }
  if (!(await pathExists(plan.sourceTranscript))) {
    return { outcome: 'rejected', reason: 'missing-transcript' }
  }
  const moveSidecar = await pathExists(plan.sourceSidecar)
  if (
    (await pathExists(plan.targetTranscript)) ||
    (moveSidecar && (await pathExists(plan.targetSidecar)))
  ) {
    return { outcome: 'rejected', reason: 'target-exists' }
  }
  try {
    await mkdir(path.dirname(plan.targetTranscript), { recursive: true })
    if (moveSidecar) {
      await rename(plan.sourceSidecar, plan.targetSidecar)
    }
    try {
      await rename(plan.sourceTranscript, plan.targetTranscript)
    } catch (error) {
      if (moveSidecar) {
        await rename(plan.targetSidecar, plan.sourceSidecar).catch(() => undefined)
      }
      throw error
    }
    return { outcome: 'moved', transcriptPath: plan.targetTranscript }
  } catch (error) {
    return { outcome: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}
