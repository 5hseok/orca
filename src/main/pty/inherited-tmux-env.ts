/** Orca's own tmux session is not where its terminals live; explicit caller env still wins. */
export function stripInheritedTmuxEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Why: launching Orca from a tmux pane leaks TMUX into every terminal, so tools such as
  // Claude agent teams split that outer tmux and their panes never reach Orca.
  const next = { ...env }
  delete next.TMUX
  delete next.TMUX_PANE
  return next
}
