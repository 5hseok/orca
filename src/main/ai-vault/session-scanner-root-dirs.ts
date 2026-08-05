import { join } from 'node:path'

// How an agent's host root expands into the local root plus one per WSL distro
// home. Shared by the scanners and the deletion validator so a deletion root
// can never drift from the scanner's own construction.
export function sessionRootDirs(
  hostRootDir: string,
  wslHomeDirs: readonly string[],
  segments: readonly string[]
): string[] {
  return [hostRootDir, ...wslHomeDirs.map((homeDir) => join(homeDir, ...segments))]
}
