// Command-line tools. A GUI-started Medeo does not see the login shell's PATH, so
// tools are looked up in their usual install locations, and the same list is put in
// front of PATH for the child (a shim found here must find its interpreter too).
import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { expandHome } from './env.ts';

const SEARCH = ['~/Library/pnpm', '~/.cargo/bin', '~/go/bin', '~/.pub-cache/bin', '~/.deno/bin', '~/.bun/bin', '~/.local/bin',
  '~/.rbenv/shims', '~/.pyenv/shims', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
export const searchPath = (home: string) => SEARCH.map(p => expandHome(p, home));

export function locate(name: string, home: string): string | null {
  for (const directory of searchPath(home)) {
    const candidate = `${directory}/${name}`;
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  return null;
}
export interface RunResult { code: number; output: string }
/** Runs a tool with its own clean command; output is kept short for the result note. */
export function run(executable: string, args: string[], home: string, timeoutMs = 15 * 60_000): Promise<RunResult> {
  const env = { ...process.env, PATH: [...searchPath(home), process.env.PATH ?? ''].filter(Boolean).join(':'), HOME: home };
  return new Promise(resolve => {
    execFile(executable, args, { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, output: `${stdout}${stderr}`.trim().slice(-2000) });
    });
  });
}
