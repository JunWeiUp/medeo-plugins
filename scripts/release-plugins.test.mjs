import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { noteRelease, releaseNotes, changes, catalogCard, build, compare, plan, PUBLISHER, prepare, packageMetadata, registryPackage, releaseOne, needsLatest, verifyPublished, describe } from './release-plugins.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('versions compare numerically', () => {
  assert.ok(compare('1.10.0', '1.9.9') > 0);
  assert.equal(compare('2.0.0', '2.0.0'), 0);
});

test('plan, build and the release guards', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'medeo-release-'));
  try {
    await cp(path.join(repo, 'scripts/fixtures/hello'), path.join(root, 'plugins/hello'), { recursive: true });
    await writeFile(path.join(root, 'plugins/hello/README.md'), '# Hello\n\nSays hello.\n\n![shot](media/shot.png)\n');
    const shot = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('shot')]);
    await mkdir(path.join(root, 'plugins/hello/media'), { recursive: true });
    await writeFile(path.join(root, 'plugins/hello/media/shot.png'), shot);
    const key = path.join(root, 'key.pem'), out = path.join(root, 'out');
    await writeFile(key, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const { version } = JSON.parse(await readFile(path.join(root, 'plugins/hello/manifest.json'), 'utf8'));

    const [fresh] = await plan(root, ['other-v9.0.0']);
    assert.deepEqual([fresh.tag, fresh.previous, fresh.released], [`hello-v${version}`, null, false]);
    assert.equal((await plan(root, [`hello-v${version}`]))[0].released, true);
    assert.equal((await plan(root, ['hello-v0.0.1']))[0].released, false);

    // A key that is not Medeo's must never ship as a release.
    await assert.rejects(build(fresh, key, out), /expected 6ac813f5/);
    const built = await build(fresh, key, out, { publisher: null });
    assert.notEqual(built.publisher, PUBLISHER);
    await assert.rejects(describe({ ...fresh, id: 'other.plugin' }, built.file, path.join(out, 'wrong.md'), { publisher: null }), /packed ID/);
    await assert.rejects(describe({ ...fresh, version: '99.0.0' }, built.file, path.join(out, 'wrong.md'), { publisher: null }), /packed version/);
    const migrated = await prepare({ ...fresh, migrate: true }, null, out, {
      publisher: null, download: async (_, file) => cp(built.file, file),
    });
    assert.equal(migrated.sha256, built.sha256);
    assert.deepEqual(await readFile(path.join(migrated.dir, 'plugin.medeoplugin')), await readFile(built.file));
    // The npm envelope also carries the project sources under `medeo.source`.
    assert.deepEqual((await readdir(migrated.dir)).sort(), ['README.md', 'package.json', 'plugin.medeoplugin', 'src']);
    assert.equal(migrated.metadata.medeo.source, 'src');
    assert.equal(migrated.metadata.repository.directory, 'plugins/hello');
    assert.ok((await readdir(path.join(migrated.dir, 'src'))).includes('manifest.json'));
    assert.equal(migrated.metadata.name, '@medeo-plugin/plugin-hello');
    // The card in package.json is the signed index plus the files Medeo shows, never the worker.
    const card = migrated.metadata.medeo.catalog;
    assert.deepEqual(card, await catalogCard(built.file));
    assert.equal(JSON.parse(JSON.parse(card.signed).index).manifest.id, fresh.id);
    assert.ok(Object.keys(card.files).length && Object.keys(card.files).every(name => /^(icon\.(svg|png)|locales\/.+\.json|README(\..+)?\.md)$/.test(name)));
    assert.deepEqual(JSON.parse(await readFile(path.join(migrated.dir, 'package.json'), 'utf8')).medeo.catalog, card);
    assert.equal(Buffer.from(card.files['README.md'], 'base64').toString(), '# Hello\n\nSays hello.\n\n![shot](media/shot.png)\n');
    // Screenshots ride beside `files`, so Medeo that predates them still accepts the card.
    assert.deepEqual(card.media, { 'media/shot.png': shot.toString('base64') });
    assert.ok((await readFile(path.join(migrated.dir, 'README.md'), 'utf8')).startsWith('# Hello\n\nSays hello.\n\n![shot](media/shot.png)\n\n---'));
    await assert.rejects(prepare({ ...fresh, migrate: true }, key, out, {
      download: async () => { throw Error('original unavailable'); },
    }), /original unavailable/);

    const dir = path.join(out, `hello-${version}`), notes = await readFile(path.join(dir, 'notes.md'), 'utf8');
    // The release carries the package alone; checksum and identity live in the notes.
    assert.deepEqual((await readdir(dir)).sort(), [`hello-${version}.medeoplugin`, 'notes.md']);
    assert.ok(notes.includes(`/releases/download/hello-v${version}/hello-${version}.medeoplugin`));
    assert.ok(notes.includes(built.sha256) && notes.includes(built.publisher));
    const [stale] = await plan(root, [`hello-v${version}`]);
    await assert.rejects(build(stale, key, out, { publisher: null }), /not newer/);
    await assert.rejects(build({ ...fresh, version: '1.0.0-dev.h1' }, key, out, { publisher: null }), /must be x\.y\.z/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const item = { name: 'hello', version: '1.0.0', id: 'org.example.hello', migrate: true };
const metadata = packageMetadata(item);
const doc = (versions = {}, latest) => ({ name: metadata.name, versions, 'dist-tags': latest ? { latest } : {} });

test('registry only treats an explicit 404 as absent', async () => {
  assert.equal(await registryPackage(metadata.name, async () => ({ status: 404 })), null);
  for (const status of [401, 403, 429, 500])
    await assert.rejects(registryPackage(metadata.name, async () => ({ status })), /HTTP/);
  await assert.rejects(registryPackage(metadata.name, async () => { throw Error('offline'); }), /offline/);
  await assert.rejects(registryPackage(metadata.name, async () => ({ ok: true, json: async () => ({}) })), /Invalid npm/);
});

test('migration dry-run and existing package comparison do not publish', async () => {
  const calls = [];
  const deps = {
    lookup: async () => doc(), preparePackage: async () => ({ metadata, sha256: 'digest' }),
    publish: async () => { throw Error('must not publish'); }, tagLatest: async () => { throw Error('must not tag'); },
    verify: async (...args) => calls.push(args),
  };
  assert.equal((await releaseOne(item, deps)).action, 'migrate');
  assert.equal((await releaseOne(item, { ...deps, lookup: async () => doc({ '1.0.0': metadata }) })).action, 'verified-existing');
  assert.equal(calls.length, 1);
  await assert.rejects(releaseOne({ ...item, migrate: false }, { ...deps, migrationOnly: true }), /cannot rebuild/);
});

test('retry after a partial publish verifies the existing version and repairs latest', async () => {
  let document = doc(), publishes = 0, tags = 0;
  const deps = {
    dryRun: false, lookup: async () => document,
    preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
    publish: async () => { publishes++; document = doc({ '1.0.0': metadata }); },
    verify: async () => {},
    tagLatest: async () => { if (++tags === 1) throw Error('network interrupted'); document['dist-tags'].latest = '1.0.0'; },
  };
  await assert.rejects(releaseOne(item, deps), /network interrupted/);
  assert.equal((await releaseOne(item, deps)).action, 'verified-existing');
  assert.equal(publishes, 1);
  assert.equal(document['dist-tags'].latest, '1.0.0');
  document['dist-tags'].latest = '2.0.0';
  await releaseOne(item, deps);
  assert.equal(tags, 2);
  assert.equal(document['dist-tags'].latest, '2.0.0');
});

test('existing content conflict stops publish and latest changes', async () => {
  let writes = 0;
  await assert.rejects(releaseOne(item, {
    dryRun: false, lookup: async () => doc({ '1.0.0': metadata }),
    preparePackage: async () => ({ metadata, sha256: 'changed' }),
    verify: async () => { throw Error('digest conflict'); },
    publish: async () => writes++, tagLatest: async () => writes++,
  }), /digest conflict/);
  assert.equal(writes, 0);
  assert.equal(needsLatest(doc({}, '1.10.0'), '1.9.0'), false);
  assert.throws(() => needsLatest(doc({}, '2.0.0-beta'), '1.0.0'), /stable/);
});

test('published tarball verifies whitelist, metadata, integrity and plugin digest without executing scripts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'medeo-npm-test-'));
  try {
    const dir = path.join(root, 'package');
    // Prepare an isolated npm envelope, never include the source tree.
    await mkdir(dir);
    const plugin = Buffer.from('signed fixture');
    await writeFile(path.join(dir, 'plugin.medeoplugin'), plugin);
    await writeFile(path.join(dir, 'README.md'), 'Fixture');
    const archive = path.join(root, 'fixture.tgz');
    const make = async (meta = metadata, extra = []) => {
      await writeFile(path.join(dir, 'package.json'), JSON.stringify(meta));
      execFileSync('tar', ['-czf', archive, '-C', root, 'package/README.md', 'package/package.json', 'package/plugin.medeoplugin', ...extra]);
      const bytes = await readFile(archive);
      return { bytes, remote: { ...metadata, dist: { tarball: 'https://registry.npmjs.org/fixture.tgz', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } } };
    };
    const run = async (fixture, digest = createHash('sha256').update(plugin).digest('hex')) => verifyPublished(fixture.remote, { ...metadata, pluginId: item.id }, digest, {
      fetcher: async () => ({ ok: true, arrayBuffer: async () => fixture.bytes }),
      inspectFile: async () => ({ publisher: PUBLISHER, manifest: { version: item.version, id: item.id } }),
    });
    await run(await make());
    const wrongId = await make();
    await assert.rejects(verifyPublished(wrongId.remote, { ...metadata, pluginId: 'wrong.plugin' }, createHash('sha256').update(plugin).digest('hex'), {
      fetcher: async () => ({ ok: true, arrayBuffer: async () => wrongId.bytes }),
      inspectFile: async () => ({ publisher: PUBLISHER, manifest: { version: item.version, id: item.id } }),
    }), /identity mismatch/);
    await assert.rejects(run(await make(), 'wrong'), /digest conflict/);
    const integrity = await make(); integrity.remote.dist.integrity = 'sha512-wrong';
    await assert.rejects(run(integrity), /integrity mismatch/);
    await assert.rejects(run(await make({ ...metadata, version: '2.0.0' })), /metadata conflict/);
    await assert.rejects(run(await make({ ...metadata, scripts: { preinstall: 'bad' } })), /metadata conflict/);
    await assert.rejects(run(await make({ ...metadata, medeo: { plugin: '../secret' } })), /metadata conflict/);
    // A published card must be the one this package produces; versions without a card stay valid.
    const carded = { ...metadata, medeo: { ...metadata.medeo, catalog: { signed: 'index', files: { 'icon.svg': 'PHN2Zy8+' } } } };
    const cardRun = async remote => verifyPublished(remote.remote, { ...carded, pluginId: item.id }, createHash('sha256').update(plugin).digest('hex'), {
      fetcher: async () => ({ ok: true, arrayBuffer: async () => remote.bytes }),
      inspectFile: async () => ({ publisher: PUBLISHER, manifest: { version: item.version, id: item.id } }),
    });
    await cardRun(await make(carded));
    await cardRun(await make(metadata));
    await assert.rejects(cardRun(await make({ ...carded, medeo: { ...carded.medeo, catalog: { signed: 'index', files: { 'icon.svg': 'ZmFrZQ==' } } } })), /metadata conflict/);
    await assert.rejects(cardRun(await make({ ...carded, medeo: { ...carded.medeo, catalog: { ...carded.medeo.catalog, media: { 'media/a.png': 'ZmFrZQ==' } } } })), /metadata conflict/);
    await writeFile(path.join(dir, 'source.ts'), 'private source');
    await assert.rejects(run(await make(metadata, ['package/source.ts'])), /whitelist/);
    // Declared sources under src/ are the one allowed addition.
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'worker.ts'), 'sources ride along');
    await run(await make(metadata, ['package/src/worker.ts']));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('a batch resumes after its second plugin fails without republishing the first', async () => {
  const documents = new Map(), counts = new Map();
  let failSecond = true;
  const items = [item, { ...item, name: 'second' }];
  const deps = {
    dryRun: false,
    lookup: async name => documents.get(name) ?? null,
    preparePackage: async entry => ({ metadata: packageMetadata(entry), sha256: 'digest', dir: entry.name }),
    verify: async () => {},
    publish: async name => {
      if (name === 'second' && failSecond) { failSecond = false; throw Error('interrupted'); }
      const meta = packageMetadata({ ...item, name });
      documents.set(meta.name, { name: meta.name, versions: { '1.0.0': meta }, 'dist-tags': {} });
      counts.set(name, (counts.get(name) ?? 0) + 1);
    },
    tagLatest: async (name, version) => { documents.get(name)['dist-tags'].latest = version; },
  };
  const batch = async () => { for (const entry of items) await releaseOne(entry, deps); };
  await assert.rejects(batch(), /interrupted/);
  await batch();
  assert.deepEqual([...counts], [['hello', 1], ['second', 1]]);
});

test('CI throwaway-key build does not consult release tags or require a network', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'medeo-ci-pack-'));
  try {
    const key = path.join(root, 'key.pem');
    await writeFile(key, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    // With an unusable Git SSH command, a remote tag lookup would fail.
    execFileSync(process.execPath, [path.join(repo, 'scripts/release-plugins.mjs'), 'build', 'all', key, path.join(root, 'out'), '--any-publisher'], {
      cwd: repo, env: { ...process.env, GIT_SSH_COMMAND: '/usr/bin/false' }, timeout: 60_000,
    });
    assert.equal((await readdir(path.join(root, 'out'))).length, (await plan(repo, [])).length);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('publish conflict accepts only a concurrently published matching version', async () => {
  const publishError = Error('409 version exists');
  for (const outcome of ['matching', 'conflict', 'absent', 'offline']) {
    let attempted = false, tags = 0, verifies = 0;
    const deps = {
      dryRun: false,
      lookup: async () => {
        if (!attempted) return null;
        if (outcome === 'offline') throw Error('network');
        return outcome === 'absent' ? null : doc({ '1.0.0': metadata });
      },
      preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
      publish: async () => { attempted = true; throw publishError; },
      verify: async (_, expected) => {
        verifies++;
        assert.equal(expected.pluginId, item.id);
        if (outcome === 'conflict') throw Error('digest conflict');
      },
      tagLatest: async () => tags++,
    };
    if (outcome === 'matching') {
      assert.equal((await releaseOne(item, deps)).action, 'published');
      assert.equal(tags, 1);
      assert.equal(verifies, 2);
    } else {
      await assert.rejects(releaseOne(item, deps), error =>
        outcome === 'conflict' ? error instanceof AggregateError && error.errors[0] === publishError : error === publishError);
      assert.equal(tags, 0);
    }
  }
});


test('successful publication waits for exact-version propagation, then verifies and tags', async () => {
  let reads = 0, publishes = 0, verified = 0, tagged = 0;
  const delays = [];
  const result = await releaseOne(item, {
    dryRun: false,
    lookup: async () => {
      reads++;
      if (reads <= 2) return null;
      if (reads === 3) return doc({ '0.9.0': { version: '0.9.0' } }, '0.9.0');
      return doc({ '1.0.0': metadata }, '0.9.0');
    },
    preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
    publish: async () => publishes++, verify: async () => verified++, tagLatest: async () => tagged++,
    delay: async ms => delays.push(ms),
  });
  assert.equal(result.action, 'published');
  assert.deepEqual(delays, [1_000, 2_000]);
  assert.deepEqual([publishes, verified, tagged], [1, 1, 1]);
});

test('propagation wait is finite and never retries authentication or network failures', async () => {
  for (const failure of [null, Error('HTTP 401'), Error('HTTP 429'), Error('offline')]) {
    let reads = 0, publishes = 0;
    const delays = [];
    const run = releaseOne(item, {
      dryRun: false,
      lookup: async () => { if (++reads > 1 && failure) throw failure; return null; },
      preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
      publish: async () => publishes++,
      verify: async () => { throw Error('must not verify absent version'); },
      tagLatest: async () => { throw Error('must not tag absent version'); },
      delay: async ms => delays.push(ms),
    });
    // npm still processing after 10 minutes is "pending" (the workflow waits longer); real errors fail.
    if (failure) await assert.rejects(run, error => error === failure);
    else assert.equal((await run).action, 'pending');
    assert.equal(publishes, 1);
    assert.equal(delays.length, failure ? 0 : 24);
    if (!failure) assert.equal(delays.reduce((a, b) => a + b, 0), 600_000);
  }
});

test('a re-run while npm still processes the version reports it pending, not failed', async () => {
  const refused = Object.assign(Error('Command failed: npm publish'), { stderr: 'npm error 403 You cannot publish over the previously published versions: 1.0.0.' });
  const result = await releaseOne(item, {
    dryRun: false, lookup: async () => null,
    preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
    publish: async () => { throw refused; }, delay: async () => { throw Error('must not wait'); },
    verify: async () => { throw Error('must not verify'); }, tagLatest: async () => { throw Error('must not tag'); },
  });
  assert.equal(result.action, 'pending');
  // Any other refusal still fails.
  await assert.rejects(releaseOne(item, {
    dryRun: false, lookup: async () => null, preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
    publish: async () => { throw Error('E401 unauthorized'); },
  }), /E401/);
});

test('failed publication does not enter propagation polling', async () => {
  const error = Error('publish rejected');
  let reads = 0;
  await assert.rejects(releaseOne(item, {
    dryRun: false, lookup: async () => { reads++; return null; },
    preparePackage: async () => ({ metadata, sha256: 'digest', dir: '/fixture' }),
    publish: async () => { throw error; }, delay: async () => { throw Error('must not wait'); },
  }), actual => actual === error);
  assert.equal(reads, 2);
});

test('GitHub releases are notes only: once per published version, never a package', async () => {
  const item = (await plan(repo, []))[0];
  const published = { versions: { [item.version]: { medeo: {} } } };
  const calls = [];
  const gh = (args) => { calls.push(args); if (args[1] === 'view') throw Error('release not found'); return ''; };
  const git = args => args[0] === 'tag' ? `${item.name}-v0.0.1\n` : 'fix: one\nfeat: two\nfix: one\n';
  assert.deepEqual(await noteRelease(item, { lookup: async () => null, gh, git }), { tag: `${item.name}@${item.version}`, action: 'not-published' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await noteRelease(item, { lookup: async () => published, gh, git }), { tag: `${item.name}@${item.version}`, action: 'created' });
  const create = calls.find(args => args[1] === 'create');
  assert.ok(create.includes('--notes-file'));
  assert.ok(!create.some(arg => /\.medeoplugin$/.test(arg)), 'no package is attached');
  // Already there: nothing is created again.
  const again = []; const exists = args => { again.push(args); return '{}'; };
  assert.equal((await noteRelease(item, { lookup: async () => published, gh: exists, git })).action, 'exists');
  assert.ok(!again.some(args => args[1] === 'create'));
  // Changes since the previous tag of this plugin only, deduplicated.
  const seen = [];
  const history = changes(item, { git: args => { seen.push(args); return args[0] === 'tag' ? `${item.name}-v0.0.1\n${item.name}@99.0.0\n` : 'fix: one\nfix: one\n'; } });
  assert.deepEqual(history, { since: `${item.name}-v0.0.1`, subjects: ['fix: one'] });
  assert.ok(seen[1].includes(`${item.name}-v0.0.1..HEAD`) && seen[1].at(-1) === `plugins/${item.name}`);
  const notes = releaseNotes({ manifest: { id: 'a.b', name: 'A', version: '1.0.0', permissions: ['storage'] }, item: { name: 'a' }, zh: { 'plugin.name': '甲' }, en: {}, history, publisher: 'p', digest: 'd' });
  assert.ok(notes.includes('插件中心') && notes.includes('- fix: one') && notes.includes('@medeo-plugin/plugin-a@1.0.0') && !/medeoplugin/.test(notes));
});
