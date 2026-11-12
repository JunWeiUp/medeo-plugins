#!/usr/bin/env node
// Publish signed official plugins to npm; preserve original GitHub assets on migration.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, README, INDEX_ENTRY, MEDIA } from '@medeo-plugin/cli/pack';
import { unzip } from '@medeo-plugin/cli/zip';
import { check } from '@medeo-plugin/cli/tooling';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The Medeo plugin key: installed copies only upgrade, and keep their data, under
// the same publisher. A different key in the secret must fail instead of shipping.
export const PUBLISHER = '6ac813f5c19a51d6fea83a03fa1306e1d0e88c80f5af3a2000ff80a0e2f116f9';

const parse = version => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
export function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) throw Error(`Expected stable x.y.z versions: ${a}, ${b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Every plugin under `root`/plugins with its release state against `tags`. */
export async function plan(root, tags) {
  const items = [];
  for (const name of (await readdir(path.join(root, 'plugins'))).sort()) {
    const dir = path.join(root, 'plugins', name);
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => 'null'));
    if (!manifest) continue;
    const previous = tags.filter(tag => tag.startsWith(name + '-v')).map(tag => tag.slice(name.length + 2))
      .filter(parse).sort(compare).at(-1) ?? null;
    items.push({ name, dir, id: manifest.id, version: manifest.version, tag: `${name}-v${manifest.version}`, previous,
      npmName: npmName(name), migrate: tags.includes(`${name}-v${manifest.version}`),
      released: previous !== null && parse(manifest.version) !== undefined && compare(manifest.version, previous) <= 0 });
  }
  return items;
}

export function gitTags(cwd = repo) {
  const local = execFileSync('git', ['tag', '-l', '*-v*'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
  // Shallow/local checkouts can have no tags. A failed remote lookup is fatal, never “new version”.
  const remote = execFileSync('git', ['ls-remote', '--tags', 'origin'], { cwd, encoding: 'utf8', timeout: 60_000 })
    .split('\n').map(line => line.split('refs/tags/')[1]?.replace(/\^\{\}$/, '')).filter(Boolean);
  return [...new Set([...local, ...remote])];
}

/** Packs, verifies and describes one plugin into `out`/<name>-<version>/: the package and its release notes. */
export async function build(item, key, out, { publisher = PUBLISHER } = {}) {
  if (!parse(item.version)) throw Error(`${item.name}: release version must be x.y.z, got ${item.version}`);
  if (item.previous && compare(item.version, item.previous) <= 0)
    throw Error(`${item.name}: ${item.version} is not newer than the released ${item.previous}; bump manifest.json`);
  const base = `${item.name}-${item.version}`, dir = path.join(out, base), file = path.join(dir, base + '.medeoplugin');
  await mkdir(dir, { recursive: true });
  await pack(item.dir, key, file);
  return describe(item, file, path.join(dir, 'notes.md'), { publisher });
}

/** Verifies a built `file` of `item` and writes its release notes (also used to refresh a published release). */
export async function describe(item, file, output, { publisher = PUBLISHER } = {}) {
  const result = await check(file);
  if (result.manifest.id !== item.id) throw Error(`${item.name}: packed ID ${result.manifest.id} differs from manifest`);
  if (result.manifest.version !== item.version) throw Error(`${item.name}: packed version ${result.manifest.version} differs from manifest`);
  if (publisher && result.publisher !== publisher) throw Error(`${item.name}: signed by publisher ${result.publisher}, expected ${publisher}`);
  const bytes = await readFile(file), sha256 = createHash('sha256').update(bytes).digest('hex');
  // Users read the release page in Chinese: the plugin's own zh-CN catalog names it there.
  const zh = JSON.parse(await readFile(path.join(item.dir, 'locales/zh-CN.json'), 'utf8').catch(() => '{}'));
  await writeFile(output, notes({ ...result, item, sha256, size: bytes.length, zh }));
  return { ...item, file, sha256, publisher: result.publisher };
}

const REPOSITORY = process.env.GITHUB_REPOSITORY ?? 'JunWeiUp/medeo-plugins';
const PLATFORMS = { macos: 'macOS', windows: 'Windows' };
// shields.io path segments: `-` and `_` are doubled, spaces become `_`.
const badge = text => encodeURIComponent(text.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_'));
const kib = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

/** The release page: one download button for the package; the details fold away. */
function notes({ manifest, publisher, digest, item, sha256, size, zh }) {
  const asset = `${item.name}-${manifest.version}.medeoplugin`;
  const url = `https://github.com/${REPOSITORY}/releases/download/${item.tag}/${asset}`;
  const name = zh['plugin.name'] ?? manifest.name, description = zh['plugin.description'] ?? manifest.description ?? '';
  const platforms = (manifest.platforms ?? Object.keys(PLATFORMS)).map(p => PLATFORMS[p] ?? p).join(' · ');
  const image = `https://img.shields.io/badge/${badge('⬇ 下载插件')}-${badge(`${name} ${manifest.version}`)}-7c3aed?style=for-the-badge`;
  return [
    '<p align="center">',
    `<a href="${url}"><img alt="下载 ${asset}" src="${image}" height="56"></a>`,
    '</p>',
    `<p align="center"><a href="${url}"><code>${asset}</code></a> · ${kib(size)} · ${platforms}</p>`,
    '',
    description && `> ${description}`,
    '',
    '### 安装',
    '',
    '1. 点上面的按钮，下载 `.medeoplugin` 文件（下方 Assets 里的 Source code 是源码，不用下）。',
    '2. 打开 Medeo → 插件中心 → **安装插件**，选择刚下载的文件。',
    `3. 核对发布者以 \`${publisher.slice(0, 8)}\` 开头，再批准它申请的权限。已装旧版本时直接覆盖安装，插件数据会保留。`,
    '',
    '<details><summary>包信息（插件 ID、权限、校验值）</summary>',
    '',
    '| | |', '| --- | --- |',
    `| 插件 ID | \`${manifest.id}\` |`,
    `| 版本 | ${manifest.version} |`,
    `| 运行时 | ${manifest.runtime === 'node' ? 'Node（需单独确认）' : '沙盒'} |`,
    `| 权限 | ${manifest.permissions.map(p => '`' + p + '`').join(' ') || '—'} |`,
    `| 发布者 | \`${publisher}\` |`,
    `| SHA-256 | \`${sha256}\` |`,
    `| 签名索引摘要 | \`${digest}\` |`,
    '',
    '</details>',
    '',
  ].join('\n');
}

export const KEYWORDS = ['medeo-plugin', 'medeo-official-plugin'];
export const REGISTRY = 'https://registry.npmjs.org';
export function npmName(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw Error(`Invalid plugin slug: ${slug}`);
  return `@medeo-plugin/plugin-${slug}`;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Only an explicit registry 404 means absent. Auth, timeout and transport errors stop release. */
export async function registryPackage(name, fetcher = fetch, { timeout = 30_000 } = {}) {
  const response = await fetcher(`${REGISTRY}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(timeout) });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`npm metadata ${name}: HTTP ${response.status}`);
  const value = await response.json();
  if (value.name !== name || !value.versions || !value['dist-tags']) throw Error(`Invalid npm metadata for ${name}`);
  return value;
}

export const MAX_CARD = 1024 * 1024;
/** Screenshots ride in the card only up to this many raw bytes: npm's version document must stay
 * well under the 8 MiB Medeo reads, or every Medeo would fall back to downloading the package. */
export const MAX_CARD_MEDIA = 4 * 1024 * 1024;
/** What Medeo's plugin center shows without downloading the package: the signed
 * `_package.json` and, as base64, the files a card uses (icon, catalogs, README*.md) and, under
 * `media`, the README's screenshots so a detail page downloads nothing either.
 * Medeo checks every file against the signed index, so npm cannot alter them. */
export async function catalogCard(file) {
  const entries = unzip(await readFile(file));
  const signed = entries.get(INDEX_ENTRY)?.toString('utf8');
  if (!signed) throw Error('Package has no signed index');
  const { manifest } = JSON.parse(JSON.parse(signed).index);
  // about.json stays out of the card: older Medeo reject a card with files they do not know.
  const shown = new Set([manifest.icon, ...Object.values(manifest.localization?.catalogs ?? {})].filter(Boolean));
  const files = {}, media = {};
  let mediaBytes = 0;
  for (const [name, data] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    if (shown.has(name) || README.test(name)) files[name] = data.toString('base64');
    // A separate field: Medeo before it reject a card whose `files` hold anything else, and ignore `media`.
    else if (MEDIA.test(name)) { media[name] = data.toString('base64'); mediaBytes += data.length; }
  }
  if (Buffer.byteLength(JSON.stringify({ signed, files })) > MAX_CARD) throw Error(`${manifest.id}: catalog card exceeds 1 MiB; shrink the README or icon`);
  if (!mediaBytes) return { signed, files };
  if (mediaBytes > MAX_CARD_MEDIA) {
    console.warn(`${manifest.id}: screenshots exceed ${MAX_CARD_MEDIA >> 20} MiB; the detail page will download the package to show them`);
    return { signed, files };
  }
  return { signed, files, media };
}

export function packageMetadata(item, catalog) {
  if (!parse(item.version)) throw Error('Release version must be x.y.z');
  return {
    name: npmName(item.name), version: item.version,
    description: `Official Medeo ${item.name} plugin (signed package)`,
    keywords: KEYWORDS, files: ['plugin.medeoplugin', 'src'],
    // `medeo.source` names the plugin project sources inside this package, so a
    // Medeo can pull them for its AI edit workspace; `repository.directory` is
    // the same project in this repository for people.
    medeo: { plugin: 'plugin.medeoplugin', source: 'src', ...(catalog ? { catalog } : {}) },
    repository: { type: 'git', url: `git+https://github.com/${REPOSITORY}.git`, directory: `plugins/${item.name}` },
    publishConfig: { access: 'public', registry: REGISTRY },
  };
}

const sorted = value => JSON.stringify(Object.entries(value ?? {}).sort());
const sameCard = (a, b) => a.signed === b?.signed && sorted(a.files) === sorted(b?.files) && sorted(a.media) === sorted(b?.media);
export function assertMetadata(actual, expected) {
  // Versions published before cards existed have none; a card that is present must be this package's.
  if (actual.medeo?.catalog !== undefined && expected.medeo.catalog && !sameCard(actual.medeo.catalog, expected.medeo.catalog))
    throw Error(`npm package metadata conflict: ${expected.name}@${expected.version}`);
  // Versions published before sources shipped have none; a declared path must be ours.
  if (actual.medeo?.source !== undefined && actual.medeo.source !== expected.medeo.source)
    throw Error(`npm package metadata conflict: ${expected.name}@${expected.version}`);
  if (actual.name !== expected.name || actual.version !== expected.version ||
      actual.medeo?.plugin !== expected.medeo.plugin ||
      JSON.stringify([...(actual.keywords ?? [])].sort()) !== JSON.stringify([...KEYWORDS].sort()) ||
      actual.scripts || Object.keys(actual.dependencies ?? {}).length)
    throw Error(`npm package metadata conflict: ${expected.name}@${expected.version}`);
}

/** Downloads into a fresh directory; reads individual members without extracting untrusted paths. */
export async function verifyPublished(metadata, expected, digest, { fetcher = fetch, inspectFile = check } = {}) {
  assertMetadata(metadata, expected);
  const url = new URL(metadata.dist?.tarball);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw Error('Unexpected npm tarball origin');
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw Error(`npm tarball HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = metadata.dist.integrity;
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-') ||
      integrity !== `sha512-${createHash('sha512').update(bytes).digest('base64')}`)
    throw Error('npm tarball integrity mismatch');
  const dir = await mkdtemp(path.join(tmpdir(), 'medeo-npm-verify-'));
  try {
    const archive = path.join(dir, 'package.tgz');
    await writeFile(archive, bytes);
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').sort();
    const fixed = ['package/README.md', 'package/package.json', 'package/plugin.medeoplugin'];
    // Beyond the fixed envelope only the declared sources ride along, with safe relative paths.
    const extras = entries.filter(entry => !fixed.includes(entry));
    if (!fixed.every(entry => entries.includes(entry)) ||
        extras.some(entry => !entry.startsWith('package/src/') || entry.endsWith('/') || entry.slice('package/'.length).split('/').some(part => part === '' || part === '.' || part === '..')))
      throw Error('npm tarball file whitelist mismatch');
    const member = name => execFileSync('tar', ['-xOzf', archive, `package/${name}`], { maxBuffer: 128 * 1024 * 1024 });
    assertMetadata(JSON.parse(member('package.json')), expected);
    const plugin = member('plugin.medeoplugin');
    if (sha(plugin) !== digest) throw Error('Published plugin digest conflict; bump manifest.version');
    const file = path.join(dir, 'verified.medeoplugin');
    await writeFile(file, plugin);
    const result = await inspectFile(file);
    if (result.publisher !== PUBLISHER || result.manifest.version !== expected.version || result.manifest.id !== expected.pluginId)
      throw Error('Published plugin identity mismatch');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Pure decisions are shared by dry-run and publish. Never move latest backwards. */
export function needsLatest(document, version) {
  const latest = document?.['dist-tags']?.latest;
  return !latest || compare(version, latest) > 0;
}

export async function prepare(item, key, out, { download = downloadOriginal, publisher = PUBLISHER } = {}) {
  const work = await mkdtemp(path.join(out, `${item.name}-`));
  let built;
  if (item.migrate) {
    const file = path.join(work, 'original.medeoplugin');
    // A missing original is fatal. Rebuilding an already released version changes its identity/digest.
    await download(item, file);
    built = await describe(item, file, path.join(work, 'notes.md'), { publisher });
  } else {
    if (!key) throw Error(`${item.name}: signing key required for a new version`);
    built = await build(item, key, work, { publisher });
  }
  const dir = path.join(work, 'npm');
  await mkdir(dir);
  const catalog = await catalogCard(built.file);
  const metadata = packageMetadata(item, catalog);
  await copyFile(built.file, path.join(dir, metadata.medeo.plugin));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  // The project sources ride in the package (`medeo.source`), so a Medeo can
  // open an AI edit workspace without this repository; keys and builds stay out.
  await cp(item.dir, path.join(dir, metadata.medeo.source), { recursive: true, filter: file => {
    const name = path.basename(file);
    return !['node_modules', 'dist', 'build', '.git', '.DS_Store'].includes(name) && !name.endsWith('.pem') && !name.endsWith('.medeoplugin');
  } });
  // npm's page shows the plugin's own introduction (the signed README.md), then how to verify the package.
  const intro = catalog.files['README.md'] ? Buffer.from(catalog.files['README.md'], 'base64').toString('utf8').trimEnd() + '\n\n---\n\n' : `# ${metadata.name}\n\n`;
  await writeFile(path.join(dir, 'README.md'), `${intro}Install from npm in Medeo's plugin center, or use Discover.\n\nPlugin ID: ${item.id}\nVersion: ${item.version}\nPublisher: ${built.publisher}\nSHA-256: ${built.sha256}\n\nApprove permissions in Medeo before use.\n`);
  return { ...built, dir, metadata };
}

function downloadOriginal(item, file) {
  const asset = `${item.name}-${item.version}.medeoplugin`;
  execFileSync('gh', ['release', 'download', item.tag, '--repo', REPOSITORY, '--pattern', asset, '--output', file], { stdio: 'inherit' });
}

// npm can acknowledge publication while its public metadata is still processing.
// Only a missing exact version is retryable; lookup errors (auth, rate limit, network) propagate.
export async function waitForPublished(name, version, lookup, delay) {
  // First publication of a new package can remain in npm's processing queue beyond 3 minutes.
  const deadline = performance.now() + 600_000;
  const backoff = [1_000, 2_000, 4_000, 8_000, 15_000, ...Array(19).fill(30_000)];
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) break;
    const document = await lookup(name, undefined, { timeout: Math.min(30_000, remaining) });
    if (document?.versions?.[version]) return document;
    if (attempt === backoff.length) break;
    const pause = Math.min(backoff[attempt], Math.max(0, deadline - performance.now()));
    await delay(pause);
  }
  throw Error(`${name}@${version}: registry has not propagated within 10 minutes; rerun safely`);
}

/** Injectable I/O keeps retries, partial success, and latest recovery testable offline. */
export async function releaseOne(item, { key, out, dryRun = true, migrationOnly = false,
  lookup = registryPackage, preparePackage = prepare, verify = verifyPublished,
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  publish = dir => execFileSync('npm', ['publish', dir, '--access', 'public', '--ignore-scripts', '--tag', 'medeo-release', '--registry', REGISTRY], { stdio: 'inherit', cwd: repo }),
  tagLatest = (name, version) => execFileSync('npm', ['dist-tag', 'add', `${name}@${version}`, 'latest', '--registry', REGISTRY], { stdio: 'inherit', cwd: repo }),
} = {}) {
  if (migrationOnly && !item.migrate) throw Error(`${item.name}: no original GitHub tag; migration cannot rebuild`);
  const name = npmName(item.name);
  const document = await lookup(name);
  const built = await preparePackage(item, key, out);
  const expected = { ...built.metadata, pluginId: item.id };
  const existing = document?.versions?.[item.version];
  if (existing) await verify(existing, expected, built.sha256);
  if (dryRun) return { name, version: item.version, action: existing ? 'verified-existing' : item.migrate ? 'migrate' : 'publish', latest: needsLatest(document, item.version), sha256: built.sha256 };
  let publishedNow = false;
  if (!existing) {
    try { await publish(built.dir); publishedNow = true; }
    catch (publishError) {
      // A concurrent publisher or lost acknowledgement may have completed this version.
      // Accept only the exact verified bytes; otherwise retain the original publication error.
      const raced = await lookup(name).catch(() => null);
      const candidate = raced?.versions?.[item.version];
      // npm already holds this version but is still processing it (an earlier run published it).
      if (!candidate && /previously published|cannot publish over/i.test(String(publishError?.stderr ?? publishError?.message ?? '')))
        return { name, version: item.version, action: 'pending', sha256: built.sha256 };
      if (!candidate) throw publishError;
      try { await verify(candidate, expected, built.sha256); }
      catch (verificationError) { throw new AggregateError([publishError, verificationError], 'npm publish failed and existing version did not match'); }
    }
  }
  // Fresh read also recovers a publish that succeeded before a previous run failed updating latest.
  let current;
  try { current = publishedNow ? await waitForPublished(name, item.version, lookup, delay) : await lookup(name); }
  catch (error) {
    // npm acknowledged the publish but can keep a package "being processed" for up to an
    // hour (security scanning). That is not a failure: the workflow's await-npm job waits,
    // then an idempotent re-run verifies the published bytes and moves latest.
    if (publishedNow && /has not propagated/.test(error.message)) return { name, version: item.version, action: 'pending', sha256: built.sha256 };
    throw error;
  }
  const published = current?.versions?.[item.version];
  if (!published) throw Error(`${name}@${item.version}: registry has not propagated; rerun safely`);
  await verify(published, expected, built.sha256);
  if (needsLatest(current, item.version)) await tagLatest(name, item.version);
  return { name, version: item.version, action: existing ? 'verified-existing' : 'published', sha256: built.sha256 };
}

/** GitHub Releases are release notes only: plugins install and update through npm
 * in Medeo's plugin center, so a release carries no package. Tags are `<name>@<version>`
 * (the older `<name>-v<version>` tags mark the original GitHub downloads `prepare` migrates). */
export const notesTag = item => `${item.name}@${item.version}`;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: repo, encoding: 'utf8', ...options });

/** Commit subjects that touched the plugin since its previous release (either tag style). */
export function changes(item, { git = args => run('git', args) } = {}) {
  const tags = git(['tag', '-l', `${item.name}@*`, `${item.name}-v*`]).split('\n').filter(Boolean)
    .map(tag => ({ tag, version: tag.slice(item.name.length + (tag.includes('@') ? 1 : 2)) }))
    .filter(t => parse(t.version) && compare(t.version, item.version) < 0).sort((a, b) => compare(a.version, b.version));
  const since = tags.at(-1)?.tag;
  const log = git(['log', '--no-merges', '--format=%s', ...(since ? [`${since}..HEAD`] : ['-n', '20']), '--', `plugins/${item.name}`]);
  return { since: since ?? null, subjects: [...new Set(log.split('\n').map(line => line.trim()).filter(Boolean))].slice(0, 30) };
}

export function releaseNotes({ manifest, publisher, digest, item, zh, en, history }) {
  const name = zh['plugin.name'] ?? manifest.name, english = en['plugin.name'] ?? manifest.name;
  const description = zh['plugin.description'] ?? manifest.description ?? '', summary = en['plugin.description'] ?? manifest.description ?? '';
  const npm = `https://www.npmjs.com/package/${npmName(item.name)}/v/${manifest.version}`;
  return [
    description && `> ${description}`,
    summary && summary !== description ? `> ${summary}` : '',
    '',
    `**安装 / 更新**：在 Medeo → 插件中心 → 发现插件 中找到「${name}」安装；已安装的会在「检查更新」时收到这个版本。`,
    `**Install / update**: Medeo → Plugin Center → Discover → ${english}. Installed copies get this version from Check for Updates.`,
    '',
    '### 更新内容 · Changes',
    '',
    ...(history.subjects.length ? history.subjects.map(subject => `- ${subject}`) : ['- 维护更新 · Maintenance release']),
    '',
    '<details><summary>包信息 · Package</summary>',
    '',
    '| | |', '| --- | --- |',
    `| npm | [\`${npmName(item.name)}@${manifest.version}\`](${npm}) |`,
    `| 插件 ID | \`${manifest.id}\` |`,
    `| 运行时 | ${manifest.runtime === 'node' ? 'Node（需单独确认）' : '沙盒'} |`,
    `| 权限 | ${manifest.permissions.map(p => '`' + (typeof p === 'string' ? p : Object.keys(p)[0]) + '`').join(' ') || '—'} |`,
    `| 发布者 | \`${publisher}\` |`,
    `| 签名索引摘要 | \`${digest}\` |`,
    '',
    '</details>',
    '',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
}

/** After an npm release: the notes-only GitHub release for each plugin's published
 * version. Idempotent; never uploads a package. The newest release notes carry GitHub's
 * "Latest" badge, whichever plugin they belong to. */
export async function noteRelease(item, { lookup = registryPackage, gh = (args, options) => run('gh', args, options), git } = {}) {
  const tag = notesTag(item);
  const document = await lookup(npmName(item.name));
  if (!document?.versions?.[item.version]) return { tag, action: 'not-published' };
  try { gh(['release', 'view', tag, '--json', 'tagName'], { stdio: 'pipe' }); return { tag, action: 'exists' }; } catch { /* create it */ }
  const manifest = JSON.parse(await readFile(path.join(item.dir, 'manifest.json'), 'utf8'));
  const catalog = async locale => JSON.parse(await readFile(path.join(item.dir, `locales/${locale}.json`), 'utf8').catch(() => '{}'));
  const card = document.versions[item.version].medeo?.catalog;
  const signed = card?.signed ? JSON.parse(card.signed) : null;
  const notes = releaseNotes({ manifest, item, zh: await catalog('zh-CN'), en: await catalog('en'), history: changes(item, git ? { git } : {}),
    publisher: signed ? sha(Buffer.from(signed.public_key, 'hex')) : PUBLISHER, digest: signed ? sha(Buffer.from(signed.index)) : '—' });
  const dir = await mkdtemp(path.join(tmpdir(), 'medeo-notes-'));
  try {
    const file = path.join(dir, 'notes.md');
    await writeFile(file, notes);
    gh(['release', 'create', tag, '--target', process.env.GITHUB_SHA ?? run('git', ['rev-parse', 'HEAD']).trim(),
      '--title', `${manifest.name} ${item.version}`, '--notes-file', file]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  return { tag, action: 'created' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  // CI's throwaway build checks sources, not release history, and must work offline.
  const items = await plan(repo, command === 'build' && args.includes('--any-publisher') ? [] : gitTags());
  const select = name => {
    const chosen = name === 'all' ? items : items.filter(item => item.name === name);
    if (!chosen.length) throw Error('No plugin named ' + name);
    return chosen;
  };
  if (command === 'publish') {
    const flags = new Set(args.slice(1));
    for (const flag of flags) if (!['--execute', '--dry-run', '--migration-only'].includes(flag)) throw Error(`Unknown flag ${flag}`);
    if (flags.has('--execute') && flags.has('--dry-run')) throw Error('Choose execute or dry-run');
    const out = path.join(repo, 'build/npm-plugins');
    await mkdir(out, { recursive: true });
    const pending = [];
    for (const item of select(args[0] ?? 'all')) {
      const result = await releaseOne(item, { key: process.env.MEDEO_PLUGIN_KEY_FILE, out, dryRun: !flags.has('--execute'), migrationOnly: flags.has('--migration-only') });
      console.log(JSON.stringify(result));
      if (result.action === 'pending') pending.push(`${item.name}@${item.version}`);
    }
    // The workflow's await-npm job finishes these once npm has processed them.
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `pending=${pending.join(' ')}\n`, { flag: 'a' });
  } else if (command === 'notes-release') {
    // After `publish --execute`: release notes on GitHub for what npm now serves.
    for (const item of select(args[0] ?? 'all')) console.log(JSON.stringify(await noteRelease(item)));
  } else if (command === 'list') {
    // `list --pending`: what the release workflow should publish (its matrix).
    const shown = [];
    for (const item of items) {
      const document = await registryPackage(item.npmName);
      const npmPublished = Boolean(document?.versions?.[item.version]);
      if (args[0] !== '--pending' || !npmPublished) shown.push({ ...item, npmPublished });
    }
    console.log(JSON.stringify(shown.map(({ dir, ...item }) => item)));
  } else if (command === 'build' && (args.length === 3 || (args.length === 4 && args[3] === '--any-publisher'))) {
    // `--any-publisher`: CI's pull-request dry run with a throwaway key.
    for (const item of select(args[0])) {
      const built = await build(item, args[1], args[2], { publisher: args[3] ? null : PUBLISHER });
      console.log(`${built.tag}  ${path.relative(process.cwd(), built.file)}  ${built.sha256}`);
    }
  } else if (command === 'notes' && args.length === 3) {
    // Rewrites the notes of the release whose package is PACKAGE (checked out at that release's tag).
    const [item] = select(args[0]);
    await describe(item, args[1], args[2]);
  } else {
    console.error('Usage: node scripts/release-plugins.mjs publish <name|all> [--dry-run|--execute] [--migration-only] | notes-release <name|all> | list [--pending] | build <name|all> KEY.pem OUTDIR [--any-publisher] | notes <name> PACKAGE NOTES.md');
    process.exitCode = 1;
  }
}
