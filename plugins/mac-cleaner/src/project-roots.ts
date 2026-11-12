import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { expandHome } from './env.ts';

export const COMMON_ROOTS = ['~/Projects', '~/Developer', '~/Development', '~/Code', '~/code', '~/dev', '~/workspace', '~/Workspaces',
  '~/Documents/GitHub', '~/Documents/GitLab', '~/Documents/code', '~/Documents/Projects',
  '~/IdeaProjects', '~/StudioProjects', '~/ReactNativeProjects'];
export interface RootSuggestion { path: string; available: boolean; added: boolean }
/** Newline is the only separator: commas are valid in directory names. */
export const parseRoots = (value: unknown): string[] => typeof value === 'string' ? value.split('\n').map(s => s.trim()).filter(Boolean) : [];
export async function normalizeRoot(value: string, home: string): Promise<string> {
  const expanded = expandHome(value.trim(), home);
  if (!path.isAbsolute(expanded) || /[\n\r\0]/.test(expanded)) throw new Error('invalid-directory');
  const resolved = await realpath(expanded);
  if (!(await stat(resolved)).isDirectory()) throw new Error('invalid-directory');
  await access(resolved, constants.R_OK | constants.X_OK);
  return resolved;
}
/** Keep unavailable configured folders so users can reconnect a volume or remove them. */
export async function rootIdentity(value: string, home: string): Promise<string> {
  return realpath(expandHome(value, home)).catch(() => path.normalize(expandHome(value, home)));
}
export async function suggestions(roots: string[], home: string): Promise<RootSuggestion[]> {
  const added = new Set(await Promise.all(roots.map(r => rootIdentity(r, home))));
  const seen = new Set<string>(), result: RootSuggestion[] = [];
  for (const candidate of COMMON_ROOTS) {
    let resolved: string | undefined;
    try { resolved = await normalizeRoot(candidate, home); } catch { /* unavailable chip */ }
    const key = resolved ?? expandHome(candidate, home);
    if (seen.has(key)) continue;
    seen.add(key); result.push({ path: candidate, available: !!resolved, added: added.has(key) });
  }
  return result;
}

// A Node plugin already has full machine access. Use a native macOS panel without
// adding a sandbox resource grant whose opaque ID cannot be used by Node's scanner.
// No user-supplied script/shell text; paths return as JSON (spaces/commas/quotes safe).
export const PICK_DIRECTORIES_SCRIPT = `ObjC.import('AppKit');
const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
app.activateIgnoringOtherApps(true);
const panel = $.NSOpenPanel.openPanel;
panel.canChooseFiles = false;
panel.canChooseDirectories = true;
panel.allowsMultipleSelection = true;
panel.canCreateDirectories = false;
const result = [];
if (panel.runModal === $.NSModalResponseOK) {
  const urls = panel.URLs;
  for (let i = 0; i < urls.count; i++) result.push(ObjC.unwrap(urls.objectAtIndex(i).path));
}
JSON.stringify(result);`;
export function chooseDirectories(): Promise<string[]> {
  return new Promise((resolve, reject) => execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', PICK_DIRECTORIES_SCRIPT],
    { timeout: 300_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const paths: unknown = JSON.parse(stdout);
        if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string')) throw new Error('invalid-picker-result');
        resolve(paths);
      } catch (e) { reject(e); }
    }));
}
