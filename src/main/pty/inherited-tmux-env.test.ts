import { describe, expect, it } from 'vitest'
import { stripInheritedTmuxEnv } from './inherited-tmux-env'

describe('stripInheritedTmuxEnv', () => {
  it('drops the tmux socket and pane Orca inherited', () => {
    const env = stripInheritedTmuxEnv({
      TMUX: '/private/tmp/tmux-501/default,2368,0',
      TMUX_PANE: '%0',
      PATH: '/usr/bin'
    })

    expect(env.TMUX).toBeUndefined()
    expect(env.TMUX_PANE).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('does not mutate the source environment', () => {
    const source = { TMUX: '/tmp/tmux,1,0', TMUX_PANE: '%3' }

    stripInheritedTmuxEnv(source)

    expect(source).toEqual({ TMUX: '/tmp/tmux,1,0', TMUX_PANE: '%3' })
  })
})
