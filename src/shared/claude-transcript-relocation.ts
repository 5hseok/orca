// IPC payload for aiVault:relocateClaudeTranscript.
export type ClaudeTranscriptRelocationArgs = {
  transcriptPath: string
  targetCwd: string
}

export type ClaudeTranscriptRelocationResult =
  | { outcome: 'moved'; transcriptPath: string }
  | { outcome: 'unchanged'; transcriptPath: string }
  | { outcome: 'rejected'; reason: ClaudeTranscriptRelocationRejection }
  | { outcome: 'failed'; error: string }

export type ClaudeTranscriptRelocationRejection =
  | 'invalid-arguments'
  | 'non-local-host'
  | 'not-a-claude-transcript'
  | 'missing-transcript'
  | 'target-exists'
