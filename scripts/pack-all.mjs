#!/usr/bin/env node
// Packs and verifies every plugin under plugins/ into dist/.
// Signing key: --key <file> or MEDEO_PLUGIN_KEY; without one a throwaway key is generated
// (fine for local testing and CI, never for releases — keep release keys outside the repo).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules', '.bin', 'medeo-plugin');
const arg = process.argv.indexOf('--key');
let key = arg > 0 ? path.resolve(process.argv[arg + 1]) : process.env.MEDEO_PLUGIN_KEY;
if (!key) {
  key = path.join(mkdtempSync(path.join(tmpdir(), 'medeo-plugins-key-')), 'dev.pem');
  execFileSync(cli, ['keygen', key], { stdio: 'inherit' });
}
const only = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--key');
const run = (args) => execFileSync(cli, args, { cwd: root, stdio: 'inherit' });
let count = 0;
for (const name of readdirSync(path.join(root, 'plugins')).sort()) {
  const dir = path.join(root, 'plugins', name);
  if (!existsSync(path.join(dir, 'manifest.json')) || (only.length && !only.includes(name))) continue;
  const { version } = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const out = path.join(root, 'dist', `${name}-${version}.medeoplugin`);
  console.log(`\n== ${name} ${version}`);
  run(['pack', dir, '--key', key, '--out', out]);
  run(['check', out]);
  count++;
}
console.log(`\nPacked and checked ${count} plugin(s) into dist/`);
