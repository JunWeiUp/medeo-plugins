// Installed apps and what the junk cleanup takes from them, after Mackit's
// AppScanner and LanguageFileScanner: regenerable leftovers under ~/Library, and
// localizations nobody on this Mac can select. App data (preferences, containers,
// application support) is never offered here.
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { entries } from './files.ts';

export interface App { name: string; id: string; path: string; developmentRegion: string | null }
export const APP_ROOTS = ['/Applications', '~/Applications'];

const run = (exe: string, args: string[]) => new Promise<string | null>(resolve =>
  execFile(exe, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, out) => resolve(error ? null : out)));
const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** String values of a plist's top-level keys (binary or XML; `plutil` reads both). */
export function plistStrings(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g)) if (!(m[1] in out)) out[xmlText(m[1])] = xmlText(m[2]);
  return out;
}
async function readApp(bundle: string): Promise<App | null> {
  const xml = await run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', path.join(bundle, 'Contents/Info.plist')]);
  if (!xml) return null;
  const info = plistStrings(xml), id = info.CFBundleIdentifier?.trim();
  if (!id || id.startsWith('com.apple.')) return null;
  const name = [info.CFBundleDisplayName, info.CFBundleName].find(v => v?.trim())?.trim() ?? path.basename(bundle, '.app');
  return { name, id, path: bundle, developmentRegion: info.CFBundleDevelopmentRegion?.trim() || null };
}
/** Apps directly inside the roots, by name. */
export async function discoverApps(roots: string[], home: string): Promise<App[]> {
  const seen = new Set<string>(), apps: App[] = [];
  for (const root of roots) {
    for (const e of (await entries(root, home)) ?? []) {
      if (!e.directory || e.link || !e.name.toLowerCase().endsWith('.app') || seen.has(e.path)) continue;
      seen.add(e.path);
      const app = await readApp(e.path);
      if (app) apps.push(app);
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}
/** A name usable as one path component. */
const component = (v: string) => !!v && v !== '.' && v !== '..' && !v.includes('/') && !/[\u0000-\u001f]/.test(v);
const exists = (p: string) => stat(p).then(() => true, () => false);

/** An app's regenerable leftovers: caches, HTTP storages, WebKit data, logs and crash reports. */
export async function appJunk(app: App, home: string): Promise<string[]> {
  const lib = path.join(home, 'Library'), ids = [app.id, app.name].filter(component);
  const found: string[] = [];
  for (const dir of ['Caches', 'HTTPStorages', 'WebKit', 'Logs']) for (const id of ids) {
    const p = path.join(lib, dir, id);
    if (!found.includes(p) && await exists(p)) found.push(p);
  }
  if (component(app.name)) {
    const isReport = (n: string) => n === app.name || n.startsWith(`${app.name}-`) || n.startsWith(`${app.name}.`);
    // Crash reports, not DiagnosticReports: that folder sits inside ~/Library/Logs, which the logs
    // row lists as a whole, so taking files from it would count them twice.
    for (const name of await readdir(path.join(lib, 'Application Support/CrashReporter')).catch(() => [] as string[]))
      if (isReport(name)) found.push(path.join(lib, 'Application Support/CrashReporter', name));
  }
  return found;
}

export const primary = (language: string) => language.replace(/_/g, '-').split('-')[0].toLowerCase();
/** Languages from `defaults read … AppleLanguages`, or [] when unset. */
export async function appleLanguages(domain: string): Promise<string[]> {
  const out = await run('/usr/bin/defaults', ['read', domain, 'AppleLanguages']);
  return out ? [...out.matchAll(/"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?\s*[,)]/g)].map(m => m[1]) : [];
}
/**
 * Localizations of an app no one here can select. Only whole `.lproj` directories:
 * they are sealed as optional, so removing one keeps the signature valid. Kept:
 * Base, English, Chinese, the system's languages, the app's own override and its
 * development region; an app that would lose every localization is skipped.
 */
export async function unusedLocalizations(app: App, systemLanguages: string[], appLanguages: (id: string) => Promise<string[]>): Promise<{ path: string; language: string }[]> {
  const resources = path.join(app.path, 'Contents/Resources');
  const lproj = (await readdir(resources, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory() && e.name.toLowerCase().endsWith('.lproj')).map(e => e.name).sort();
  if (!lproj.length) return [];
  const keep = new Set(['en', 'zh', 'base', ...systemLanguages.map(primary)]);
  if (app.developmentRegion) keep.add(primary(app.developmentRegion));
  let removable = lproj.filter(n => !keep.has(primary(n.slice(0, -6))));
  if (!removable.length) return [];
  const own = new Set((await appLanguages(app.id)).map(primary));
  removable = removable.filter(n => !own.has(primary(n.slice(0, -6))));
  if (removable.length === lproj.length) return [];
  return removable.map(n => ({ path: path.join(resources, n), language: n.slice(0, -6) }));
}
