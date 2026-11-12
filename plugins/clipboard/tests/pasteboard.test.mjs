// The real helper against the real macOS pasteboard; the user's clipboard is put back after.
// Everything copied starts with medeo-clip-, which the installed-app check sweeps from a running
// Clipboard plugin's history (it records these copies too).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pasteboard } from '../src/pasteboard.ts';

const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'pasteboard.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('watch reports copies and write puts entries back', { skip: process.platform !== 'darwin' }, async () => {
  const saved = execFileSync('/usr/bin/pbpaste');
  const dir = mkdtempSync(path.join(tmpdir(), 'clipboard-pb-')), copies = [];
  let ready = false;
  const pb = new Pasteboard(helper, dir, c => copies.push(c), r => { ready = r; });
  try {
    pb.start();
    for (let i = 0; i < 40 && !ready; i++) await sleep(100);
    assert.ok(ready, 'helper reported ready');
    execFileSync('/usr/bin/pbcopy', { input: 'medeo-clip-unit text' });
    await sleep(900);
    assert.equal(copies.at(-1)?.text, 'medeo-clip-unit text');
    assert.ok(await pb.write({ text: 'medeo-clip-unit plain', html: '<i>medeo-clip-unit rich</i>' }));
    await sleep(900);
    assert.equal(copies.at(-1)?.html, '<i>medeo-clip-unit rich</i>');
    assert.equal(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }), 'medeo-clip-unit plain');
    const file = path.join(dir, 'medeo-clip-unit.txt'); writeFileSync(file, 'x');
    assert.ok(await pb.write({ files: [file] }));
    await sleep(900);
    assert.match(copies.at(-1)?.files?.[0] ?? '', /medeo-clip-unit\.txt$/);
  } finally {
    pb.stop();
    execFileSync('/usr/bin/pbcopy', { input: saved });
  }
});
