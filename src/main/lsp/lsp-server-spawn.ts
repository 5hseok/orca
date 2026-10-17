import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import { signalProcessTree } from '@orca/process-host/process-tree-termination'
import type { ResolvedLspServer } from './lsp-server-catalog'

export type LspServerProcess = PipedChildProcess

export type SpawnLspServer = (server: ResolvedLspServer, rootPath: string) => LspServerProcess

export const spawnLspServer: SpawnLspServer = (server, rootPath) => {
  // Why: spawnProcess resolves npm .cmd shims and Windows quoting; it wants the
  // absolute program path, which the PATH probe already produced.
  const child = spawnProcess({
    program: server.program,
    args: [...server.args],
    cwd: rootPath,
    // Why: hydrateShellPath already merged the login-shell PATH into process.env.
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  // Why: nothing reads stderr; an undrained pipe blocks the server once the OS
  // buffer fills (rust-analyzer and gopls log there routinely).
  child.stderr.resume()
  return child
}

export function terminateLspServer(child: LspServerProcess): void {
  if (process.platform === 'win32') {
    // Why: npm-installed servers (tsserver, pyright) run under a cmd.exe shim; kill the tree.
    void signalProcessTree(child)
    return
  }
  child.kill()
}
