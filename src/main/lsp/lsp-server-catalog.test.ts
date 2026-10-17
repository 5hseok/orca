import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetLspServerAvailabilityForTests,
  resolveLspServerForLanguage,
  toLspDocumentLanguageId
} from './lsp-server-catalog'

describe('toLspDocumentLanguageId', () => {
  it('maps react dialects by extension and passes everything else through', () => {
    expect(toLspDocumentLanguageId('typescript', '/a/App.tsx')).toBe('typescriptreact')
    expect(toLspDocumentLanguageId('typescript', '/a/app.ts')).toBe('typescript')
    expect(toLspDocumentLanguageId('javascript', '/a/App.JSX')).toBe('javascriptreact')
    expect(toLspDocumentLanguageId('python', '/a/x.py')).toBe('python')
  })
})

describe('resolveLspServerForLanguage', () => {
  beforeEach(() => resetLspServerAvailabilityForTests())

  it('prefers tsgo for typescript when installed', async () => {
    const resolved = await resolveLspServerForLanguage('typescript', (command) =>
      Promise.resolve(`/bin/${command}`)
    )
    expect(resolved?.serverId).toBe('tsgo')
    expect(resolved?.args).toEqual(['--lsp', '--stdio'])
    expect(resolved?.program).toBe('/bin/tsgo')
  })

  it('falls back to typescript-language-server when tsgo is missing', async () => {
    const resolved = await resolveLspServerForLanguage('typescript', (command) =>
      Promise.resolve(command === 'tsgo' ? null : `/bin/${command}`)
    )
    expect(resolved?.serverId).toBe('typescript-language-server')
  })

  it('returns null for unknown languages and when nothing is installed', async () => {
    expect(
      await resolveLspServerForLanguage('plaintext', (command) =>
        Promise.resolve(`/bin/${command}`)
      )
    ).toBeNull()
    expect(await resolveLspServerForLanguage('go', () => Promise.resolve(null))).toBeNull()
  })

  it('caches probe verdicts per command', async () => {
    let probes = 0
    const probe = (command: string): Promise<string | null> => {
      probes++
      return Promise.resolve(`/bin/${command}`)
    }
    await resolveLspServerForLanguage('typescript', probe)
    await resolveLspServerForLanguage('javascript', probe)
    expect(probes).toBe(1)
  })
})
