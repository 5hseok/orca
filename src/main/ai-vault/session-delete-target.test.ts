import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateAiVaultSessionDeleteTarget } from './session-delete-target'
import { isOpenClawSessionFilePath, openClawAgentsRootDir } from './session-scanner-discovery'

// All roots are supplied via rootOptions so these tests never touch the real
// home directory or filesystem — validation is pure string-path judgement.
const HOME = join('/tmp', 'orca-ai-vault-delete-fixture-home')
const GEMINI_ROOT = join(HOME, '.gemini', 'tmp')
const CURSOR_ROOT = join(HOME, '.cursor', 'projects')
const HERMES_ROOT = join(HOME, '.hermes', 'sessions')
const OPENCLAW_ROOT = join(HOME, '.openclaw')
const COPILOT_ROOT = join(HOME, '.copilot', 'session-state')
const DEVIN_ROOT = join(HOME, '.local', 'share', 'devin', 'cli', 'transcripts')
const PI_ROOT = join(HOME, '.pi', 'agent', 'sessions')
const OMP_ROOT = join(HOME, '.omp', 'agent', 'sessions')

describe('validateAiVaultSessionDeleteTarget', () => {
  it('allows a supported agent whose file resolves inside its known root', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(GEMINI_ROOT, 'project-a', 'session-1.json'),
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result).toEqual({
      allowed: true,
      agent: 'gemini',
      resolvedPath: join(GEMINI_ROOT, 'project-a', 'session-1.json')
    })
  })

  it('allows gemini .jsonl files too, since discovery accepts both extensions', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(GEMINI_ROOT, 'project-a', 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('rejects a path that escapes its root via ..', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(GEMINI_ROOT, '..', '..', '..', 'etc', 'passwd.json'),
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'gemini', reason: 'path-outside-known-roots' })
  })

  it('rejects a path entirely outside the known roots', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(HOME, 'Documents', 'notes.json'),
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'gemini', reason: 'path-outside-known-roots' })
  })

  it('rejects a file whose extension the agent never discovers', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'cursor',
      filePath: join(CURSOR_ROOT, 'proj', 'agent-transcripts', 'session-1.txt'),
      executionHostId: 'local',
      rootOptions: { cursorProjectsDir: CURSOR_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'cursor', reason: 'invalid-extension' })
  })

  it('rejects a cursor path missing the agent-transcripts segment', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'cursor',
      filePath: join(CURSOR_ROOT, 'proj', 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { cursorProjectsDir: CURSOR_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'cursor', reason: 'file-predicate-mismatch' })
  })

  it('allows a cursor path that does carry the agent-transcripts segment', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'cursor',
      filePath: join(CURSOR_ROOT, 'proj', 'agent-transcripts', 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { cursorProjectsDir: CURSOR_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('rejects a hermes file whose basename is missing the session_ prefix', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'hermes',
      filePath: join(HERMES_ROOT, 'not-a-session.json'),
      executionHostId: 'local',
      rootOptions: { hermesSessionsDir: HERMES_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'hermes', reason: 'file-predicate-mismatch' })
  })

  it('allows a hermes file whose basename carries the session_ prefix', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'hermes',
      filePath: join(HERMES_ROOT, 'session_abc123.json'),
      executionHostId: 'local',
      rootOptions: { hermesSessionsDir: HERMES_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('allows an openclaw path under <stateDir>/agents/.../sessions/...', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'openclaw',
      filePath: join(OPENCLAW_ROOT, 'agents', 'agent-1', 'sessions', 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { openclawStateDir: OPENCLAW_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('rejects an openclaw path missing the sessions segment', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'openclaw',
      filePath: join(OPENCLAW_ROOT, 'agents', 'agent-1', 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { openclawStateDir: OPENCLAW_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'openclaw', reason: 'file-predicate-mismatch' })
  })

  it('rejects an unsupported agent', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'claude',
      filePath: join(HOME, '.claude', 'projects', 'proj', 'session-1.jsonl'),
      executionHostId: 'local'
    })
    expect(result).toEqual({ allowed: false, agent: 'claude', reason: 'unsupported-agent' })
  })

  it('rejects a non-local execution host', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(GEMINI_ROOT, 'project-a', 'session-1.json'),
      executionHostId: 'ssh:some-host',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'gemini', reason: 'non-local-host' })
  })

  // A real OpenCode SQLite-row session (the `<dbPath>#<sessionId>` identity)
  // reaches the validator as agent 'opencode', which is stopped at the agent
  // gate — so this is how such a session actually enters judgement.
  it('rejects a real opencode session as an unsupported agent', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'opencode',
      filePath: join(HOME, '.local', 'share', 'opencode', 'db.sqlite#session-1'),
      executionHostId: 'local'
    })
    expect(result).toEqual({ allowed: false, agent: 'opencode', reason: 'unsupported-agent' })
  })

  // Defense-in-depth: even for a deletable agent, any '#'-bearing path is
  // treated as a synthetic SQLite identity rather than a real file to delete.
  it('rejects a deletable-agent path bearing a synthetic # marker', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(GEMINI_ROOT, 'project-a', 'db.sqlite#session-1'),
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'gemini', reason: 'synthetic-path' })
  })

  it('rejects a blank filePath', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: '   ',
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result).toEqual({ allowed: false, agent: 'gemini', reason: 'invalid-path' })
  })

  it('allows a droid path under either of its .factory roots', () => {
    const sessionsRoot = join(HOME, '.factory', 'sessions')
    const projectsRoot = join(HOME, '.factory', 'projects')
    const underSessions = validateAiVaultSessionDeleteTarget({
      agent: 'droid',
      filePath: join(sessionsRoot, 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { droidSessionsDir: sessionsRoot, droidProjectsDir: projectsRoot }
    })
    expect(underSessions.allowed).toBe(true)
    const underProjects = validateAiVaultSessionDeleteTarget({
      agent: 'droid',
      filePath: join(projectsRoot, 'proj-a', 'session-2.jsonl'),
      executionHostId: 'local',
      rootOptions: { droidSessionsDir: sessionsRoot, droidProjectsDir: projectsRoot }
    })
    expect(underProjects.allowed).toBe(true)
  })

  it('allows a copilot .jsonl file under its known root', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'copilot',
      filePath: join(COPILOT_ROOT, 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { copilotSessionsDir: COPILOT_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('allows a devin .json file under its known root', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'devin',
      filePath: join(DEVIN_ROOT, 'session-1.json'),
      executionHostId: 'local',
      rootOptions: { devinTranscriptsDir: DEVIN_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('allows a pi .jsonl file under its known root', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'pi',
      filePath: join(PI_ROOT, 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { piSessionsDir: PI_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('allows an omp .jsonl file under its known root', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'omp',
      filePath: join(OMP_ROOT, 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { ompSessionsDir: OMP_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  // Discovery matches extensions case-insensitively (walkSessionFiles folds via
  // toLowerCase); the validator must accept the same uppercase-extension file.
  it('allows an uppercase extension since discovery folds extension case', () => {
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(GEMINI_ROOT, 'project-a', 'session-1.JSON'),
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  it('allows a gemini file under a WSL-expanded root', () => {
    const wslHome = join('/tmp', 'orca-ai-vault-delete-fixture-wsl-home')
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'gemini',
      filePath: join(wslHome, '.gemini', 'tmp', 'project-a', 'session-1.json'),
      executionHostId: 'local',
      wslHomeDirs: [wslHome],
      rootOptions: { geminiSessionsDir: GEMINI_ROOT }
    })
    expect(result.allowed).toBe(true)
  })

  // A stateDir that already ends in `agents` must not be doubled to
  // `agents/agents`; openClawAgentsRootDir uses it as-is.
  it('allows an openclaw path whose stateDir already ends in agents', () => {
    const agentsRoot = join(OPENCLAW_ROOT, 'agents')
    const result = validateAiVaultSessionDeleteTarget({
      agent: 'openclaw',
      filePath: join(agentsRoot, 'agent-1', 'sessions', 'session-1.jsonl'),
      executionHostId: 'local',
      rootOptions: { openclawStateDir: agentsRoot }
    })
    expect(result.allowed).toBe(true)
  })
})

// The validator reuses these exact scanner helpers for openclaw, so locking
// their behavior here is what keeps deletion from drifting off discovery.
describe('openclaw scanner/deletion shared path rules', () => {
  it('openClawAgentsRootDir appends agents unless already present', () => {
    expect(openClawAgentsRootDir(OPENCLAW_ROOT)).toBe(join(OPENCLAW_ROOT, 'agents'))
    expect(openClawAgentsRootDir(join(OPENCLAW_ROOT, 'agents'))).toBe(join(OPENCLAW_ROOT, 'agents'))
  })

  it('isOpenClawSessionFilePath requires a sessions path segment', () => {
    expect(isOpenClawSessionFilePath(join('agent-1', 'sessions', 'session-1.jsonl'))).toBe(true)
    expect(isOpenClawSessionFilePath(join('agent-1', 'session-1.jsonl'))).toBe(false)
  })
})
