// Single-item actions from the list's context menu, after Mackit: show in Finder,
// open a Terminal there, copy the path. Plain `open` and `pbcopy`: no Apple Events.
import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const run = (exe: string, args: string[]) => new Promise<boolean>(resolve => execFile(exe, args, { timeout: 10_000 }, error => resolve(!error)));
export const reveal = (target: string) => run('/usr/bin/open', ['-R', target]);
/** A folder opens as itself; a file opens its folder. */
export async function terminal(target: string): Promise<boolean> {
  const dir = (await stat(target).catch(() => null))?.isDirectory() ? target : path.dirname(target);
  return run('/usr/bin/open', ['-a', 'Terminal', dir]);
}
export function copy(text: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn('/usr/bin/pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
    child.stdin.end(text);
  });
}
