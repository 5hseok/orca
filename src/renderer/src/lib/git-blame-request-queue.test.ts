import { describe, expect, it } from 'vitest'
import type { GitBlameResult } from '../../../shared/git-blame'
import { enqueueGitBlameRequest } from './git-blame-request-queue'

const READY: GitBlameResult = { status: 'ready', lines: [] }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<GitBlameResult>((res) => {
    resolve = () => res(READY)
  })
  return { promise, resolve }
}

describe('enqueueGitBlameRequest', () => {
  it('runs at most two requests at once and drops cancelled queued ones', async () => {
    const started: string[] = []
    const gates = { a: deferred(), b: deferred(), c: deferred(), d: deferred() }
    const run = (name: keyof typeof gates) => () => {
      started.push(name)
      return gates[name].promise
    }
    const a = enqueueGitBlameRequest(run('a'))
    const b = enqueueGitBlameRequest(run('b'))
    const c = enqueueGitBlameRequest(run('c'))
    const d = enqueueGitBlameRequest(run('d'))
    expect(started).toEqual(['a', 'b'])

    c.cancel()
    await expect(c.promise).resolves.toBeNull()

    gates.a.resolve()
    await a.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual(['a', 'b', 'd'])

    gates.b.resolve()
    gates.d.resolve()
    await Promise.all([b.promise, d.promise])
    expect(started).toEqual(['a', 'b', 'd'])
  })
})
