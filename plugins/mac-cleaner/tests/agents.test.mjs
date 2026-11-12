// Codex and Claude rules against a synthetic home with real git worktrees.
// Run: node --test plugins/mac-cleaner/tests/agents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan } from '../src/scan.ts';
import { clean } from '../src/clean.ts';
import { git } from '../src/agents.ts';

const DAY = 86_400_000, now = Date.now();
const day = (ms, sep = '/') => { const d = new Date(ms); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join(sep); };
const plist = (id, build) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleVersion</key><string>${build}</string></dict></plist>`;

function home() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mac-cleaner-agents-')));
  const file = (rel, text = 'x'.repeat(5000), ageDays = 0) => {
    const p = path.join(root, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text);
    if (ageDays) { const t = (now - ageDays * DAY) / 1000; utimesSync(p, t, t); }
    return p;
  };
  const old = (rel, ageDays) => { const t = (now - ageDays * DAY) / 1000; utimesSync(path.join(root, rel), t, t); };
  // Codex
  file('Library/Caches/Codex/Default/Cache/data_0');
  file('Library/Caches/Codex/Default/Partitions/codex-browser-app/Code Cache/js/a');
  file('Library/Caches/Codex/Default/Local Storage/keep');
  file(`Library/Logs/com.openai.codex/${day(now - 20 * DAY)}/a.log`);
  file(`Library/Logs/com.openai.codex/${day(now)}/today.log`);
  file('.cache/codex-runtimes/codex-primary-runtime/runtime.json'); file('.cache/codex-runtimes/codex-primary-runtime/dependencies/node/x');
  file('.cache/codex-runtimes/codex-runtime-install-QLNWmi/node-runtime.tar.xz');
  file('Library/Caches/com.openai.codex/org.sparkle-project.Sparkle/Installation/old/ChatGPT.app/Contents/Info.plist', plist('com.openai.codex', 100));
  file('Library/Caches/com.openai.codex/org.sparkle-project.Sparkle/Installation/next/ChatGPT.app/Contents/Info.plist', plist('com.openai.codex', 200));
  file('Library/Application Support/Codex/Crashpad/pending/old.dmp', 'x', 40);
  file('Library/Application Support/Codex/Crashpad/pending/new.dmp');
  file('Library/Application Support/Codex/Local Storage/leveldb/keep');
  file('.codex/.tmp/bundled-marketplaces/openai-bundled.staging-abc/x'); old('.codex/.tmp/bundled-marketplaces/openai-bundled.staging-abc', 40);
  for (const v of ['1.0', '1.1', '1.2']) file(`.codex/packages/app-server-daemon/releases/${v}/bin`);
  symlinkSync(path.join(root, '.codex/packages/app-server-daemon/releases/1.2'), path.join(root, '.codex/packages/app-server-daemon/current'));
  file('.codex/packages/app-server-daemon/auto-update-version', '1.1');
  file(`.codex/sessions/${day(now - 120 * DAY)}/rollout-a.jsonl`); file(`.codex/sessions/${day(now)}/rollout-b.jsonl`);
  file(`.codex/archived_sessions/rollout-${day(now - 120 * DAY, '-')}T10-00-00-x.jsonl.zst`); file(`.codex/archived_sessions/rollout-${day(now, '-')}T10-00-00-y.jsonl.zst`);
  for (const keep of ['.codex/auth.json', '.codex/config.toml', '.codex/history.jsonl', '.codex/session_index.jsonl', '.codex/state_5.sqlite', '.codex/logs_2.sqlite', '.codex/generated_images/a.png', '.codex/skills/s/SKILL.md', '.codex/memories_1.sqlite'])
    file(keep, 'x', 400);
  // Claude
  file('Library/Application Support/Claude/Cache/data_0');
  file('Library/Application Support/Claude/Local Storage/keep');
  for (const v of ['2.1.1', '2.1.2', '2.1.3']) { file(`Library/Application Support/Claude-3p/claude-code/${v}/claude`); file(`Library/Application Support/Claude-3p/claude-code-vm/${v}/claude`); }
  file('Library/Application Support/Claude-3p/claude-code-vm/.sdk-version', '2.1.3\n');
  file('Library/Application Support/Claude-3p/vm_bundles/claudevm.bundle/rootfs.img');
  file('Library/Application Support/Claude-3p/vm_bundles/claudevm.bundle/rootfs.img.zst');
  file('Library/Caches/claude-cli-nodejs/mcp-logs/x');
  for (const v of ['1.0.0', '1.0.1', '1.0.2']) file(`.local/share/claude/versions/${v}`);
  mkdirSync(path.join(root, '.local/bin'), { recursive: true });
  symlinkSync('../share/claude/versions/1.0.2', path.join(root, '.local/bin/claude'));
  for (const keep of ['.claude/settings.json', '.claude/history.jsonl', '.claude/projects/p/s.jsonl', '.claude/CLAUDE.md']) file(keep, 'x', 400);
  // Worktrees: a repository and four Codex worktrees of it.
  const repo = path.join(root, 'repo'), g = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: new Date(now - 60 * DAY).toISOString(), GIT_COMMITTER_DATE: new Date(now - 60 * DAY).toISOString() } });
  mkdirSync(repo); g(repo, 'init', '-q', '-b', 'main'); writeFileSync(path.join(repo, 'a.txt'), 'a'); g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'a');
  const wt = name => path.join(root, '.codex/worktrees', name, 'repo');
  for (const name of ['idle', 'unmerged', 'dirty', 'recent']) { mkdirSync(path.dirname(wt(name)), { recursive: true }); g(repo, 'worktree', 'add', '-q', '--detach', wt(name)); }
  writeFileSync(path.join(wt('unmerged'), 'b.txt'), 'b'); g(wt('unmerged'), 'add', '.'); g(wt('unmerged'), 'commit', '-qm', 'b');
  writeFileSync(path.join(wt('dirty'), 'a.txt'), 'changed');
  mkdirSync(path.join(wt('recent'), 'node_modules/x'), { recursive: true }); writeFileSync(path.join(wt('recent'), 'node_modules/x/i.js'), 'x'.repeat(5000));
  writeFileSync(path.join(wt('recent'), 'package.json'), '{}');
  // Old index everywhere but in "recent".
  for (const name of ['idle', 'unmerged', 'dirty']) {
    const gitDir = execFileSync('git', ['-C', wt(name), 'rev-parse', '--path-format=absolute', '--git-dir']).toString().trim();
    const t = (now - 60 * DAY) / 1000; utimesSync(path.join(gitDir, 'index'), t, t);
  }
  return { root, repo };
}
const run = async (root, running = new Set()) => {
  const items = [];
  await scan({ scope: 'developer', home: root, env: {}, projectRoots: [], commands: false, cancelled: () => false,
    agents: { codexBuild: 150, sessionDays: 90, running } }, i => items.push(i));
  return items.filter(i => i.category === 'codex' || i.category === 'claude');
};

test('Codex and Claude: caches, logs, leftovers, versions, sessions, worktrees', async () => {
  const { root } = home(), items = await run(root, new Set(['codex-app']));
  const rel = i => path.relative(root, i.path), by = Object.fromEntries(items.map(i => [rel(i), i]));
  const list = items.map(i => `${i.rule} ${rel(i)}`).sort();
  assert.deepEqual(list, [
    `claude.bundled Library/Application Support/Claude-3p/claude-code-vm/2.1.1`,
    `claude.bundled Library/Application Support/Claude-3p/claude-code/2.1.1`,
    'claude.cli-cache Library/Caches/claude-cli-nodejs',
    'claude.cli-versions .local/share/claude/versions/1.0.0',
    'claude.desktop-cache Library/Application Support/Claude/Cache',
    'claude.vm Library/Application Support/Claude-3p/vm_bundles/claudevm.bundle/rootfs.img',
    `codex.archived .codex/archived_sessions/rollout-${day(now - 120 * DAY, '-')}T10-00-00-x.jsonl.zst`,
    'codex.artifacts .codex/worktrees/recent/repo/node_modules',
    'codex.browser-cache Library/Caches/Codex/Default/Cache',
    'codex.browser-cache Library/Caches/Codex/Default/Partitions/codex-browser-app/Code Cache',
    'codex.crash Library/Application Support/Codex/Crashpad/pending/old.dmp',
    'codex.daemon .codex/packages/app-server-daemon/releases/1.0',
    `codex.logs Library/Logs/com.openai.codex/${day(now - 20 * DAY)}`,
    'codex.marketplace .codex/.tmp/bundled-marketplaces/openai-bundled.staging-abc',
    'codex.runtime-partial .cache/codex-runtimes/codex-runtime-install-QLNWmi',
    `codex.sessions .codex/sessions/${day(now - 120 * DAY)}`,
    'codex.update Library/Caches/com.openai.codex/org.sparkle-project.Sparkle/Installation/old',
    'codex.worktree .codex/worktrees/idle',
  ]);
  // Risk: caches safe, versions and build output review, the user's things caution.
  assert.equal(by['Library/Caches/Codex/Default/Cache'].risk, 'safe');
  assert.equal(by['.codex/packages/app-server-daemon/releases/1.0'].risk, 'review');
  for (const r of ['.codex/worktrees/idle', `.codex/sessions/${day(now - 120 * DAY)}`, 'Library/Application Support/Claude-3p/vm_bundles/claudevm.bundle/rootfs.img']) assert.equal(by[r].risk, 'caution', r);
  // The running Codex app is flagged on its caches; Claude is not running.
  assert.deepEqual([by['Library/Caches/Codex/Default/Cache'].running, by['Library/Application Support/Claude/Cache'].running], [true, false]);
  assert.ok(by['.codex/worktrees/idle'].prune.endsWith('/repo/.git'));
});
test('clean skips what a running app uses and prunes removed worktrees', async () => {
  const { root, repo } = home(), items = await run(root);
  const pick = r => items.find(i => path.relative(root, i.path) === r);
  const cache = pick('Library/Caches/Codex/Default/Cache'), worktree = pick('.codex/worktrees/idle');
  const outcomes = await clean([cache, worktree], 'delete', { home: root, trash: async () => [], running: async () => new Set(['codex-app']) });
  assert.deepEqual(outcomes.map(o => [o.ok, o.error ?? null]).sort(), [[false, 'running'], [true, null]]);
  assert.ok(existsSync(cache.path) && !existsSync(worktree.path));
  const listed = execFileSync('git', ['-C', repo, 'worktree', 'list']).toString();
  assert.ok(!listed.includes('/idle/'), listed);
});
test('without git every worktree stays', async () => {
  const { root } = home(), items = [];
  await scan({ scope: 'developer', home: root, env: {}, projectRoots: [], commands: false, cancelled: () => false,
    agents: { codexBuild: 150, sessionDays: 90, running: new Set(), git: async () => null } }, i => items.push(i));
  assert.ok(!items.some(i => i.rule === 'codex.worktree'));
  assert.ok(typeof (await git(['--version'])) === 'string');
});
