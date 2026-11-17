#!/usr/bin/env node
// README screenshots of an official plugin's UI, with made-up demo data: the UI is
// bundled as `pack` does, `globalThis.medeoPlugin` (everything the SDK talks to) is
// replaced by the plugin's scenario in scripts/screenshots/<plugin>.js, and Electron
// (ELECTRON, default: the medeo-desktop checkout next to this one) renders it. Nothing touches the real clipboard, files or Medeo.
//   npm run screenshots -- <plugin>   → plugins/<plugin>/media/<locale>/*.png (en, zh-CN)
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = process.env.ELECTRON ?? path.join(repo, '../medeo-desktop/apps/electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const THEME = process.env.MEDEO_THEME ?? path.join(repo, '../medeo-desktop/packages/plugin-ui');
const name = process.argv[2];
if (!name) { console.error('Usage: node scripts/plugin-screenshots.mjs <plugin>'); process.exit(1); }
const plugin = path.join(repo, 'plugins', name), scenarioFile = path.join(repo, 'scripts/screenshots', name + '.js');
const { shots } = JSON.parse((await readFile(scenarioFile, 'utf8')).match(/\/\*shots(.*?)\*\//s)[1]);
// One set of shots per language: English alone, and Chinese over English as Medeo falls back.
const LOCALES = ['en', 'zh-CN'];
const read = async file => JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
const en = await read(path.join(plugin, 'locales/en.json'));
const catalogs = Object.fromEntries(await Promise.all(LOCALES.map(async locale =>
  [locale, locale === 'en' ? en : { ...en, ...await read(path.join(plugin, `locales/${locale}.json`)) }])));

const work = await mkdtemp(path.join(tmpdir(), 'medeo-shots-'));
try {
  await cp(path.join(plugin, 'ui'), work, { recursive: true });
  const entry = ['entry.tsx', 'entry.ts'].map(f => path.join(plugin, 'ui', f)).find(f => existsSync(f));
  await build({ entryPoints: [entry], bundle: true, outfile: path.join(work, 'index.js'), format: 'esm', platform: 'browser', target: 'es2022',
    loader: { '.css': 'text' }, jsx: 'automatic', logLevel: 'silent', absWorkingDir: plugin,
    alias: { '@one2x/medeo-plugin-sdk': path.join(repo, 'node_modules/@one2x/medeo-plugin-sdk/src/index.ts') } });
  // The stand-in Host: i18n from the plugin's own catalogs in the page's `locale`, everything
  // else from the scenario, which reads that locale as `demoLocale` to pick its demo data.
  await writeFile(path.join(work, 'demo-host.js'), `globalThis.demoLocale=new URLSearchParams(location.search).get('locale')??'en';
globalThis.demoCatalog=${JSON.stringify(catalogs)}[demoLocale];
${await readFile(scenarioFile, 'utf8')}
(()=>{const listeners=[],shot=new URLSearchParams(location.search).get('shot');const emit=m=>setTimeout(()=>listeners.forEach(l=>l(m)),0);
const localeState={preference:'system',locale:demoLocale,system_locale:demoLocale,direction:'ltr',supported_locales:[demoLocale]};
globalThis.medeoPlugin={post:m=>{demo.post?.(m,emit,shot);return Promise.resolve()},onMessage:cb=>{listeners.push(cb);return()=>{}},
 invoke:async(method,args)=>method==='i18n.catalog'?demoCatalog:method==='i18n.state'?localeState:method==='i18n.t'?(demoCatalog[args.key]??args.key):(demo.invoke?await demo.invoke(method,args,emit,shot):null),
 run:async()=>null,onEvent:()=>()=>{},onLocaleChanged:()=>()=>{}};
addEventListener('load',()=>setTimeout(()=>demo.after?.(shot),300));})();`);
  // Every page of the plugin gets the stand-in Host; a shot names its page (default index.html).
  for (const page of new Set(['index.html', ...shots.map(shot => shot.page).filter(Boolean)])) {
    const html = await readFile(path.join(work, page), 'utf8');
    await writeFile(path.join(work, page), html.replace('<script', '<script src="demo-host.js"></script><script'));
  }
  const server = createServer(async (request, response) => {
    // `/_medeo/*` is the Host's shared theme (theme.css, tokens, fonts), as the runtime serves it.
    const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname), dir = pathname.startsWith('/_medeo/') ? THEME : work;
    const file = path.join(dir, pathname.replace(/^\/_medeo\//, '/'));
    if (!file.startsWith(dir)) { response.writeHead(403).end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'application/octet-stream';
    readFile(file).then(body => response.writeHead(200, { 'content-type': type }).end(body), () => response.writeHead(404).end());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const out = path.join(plugin, 'media');
  for (const locale of LOCALES) await mkdir(path.join(out, locale), { recursive: true });
  const runs = LOCALES.flatMap(locale => shots.map(shot => ({ ...shot, locale })));
  // Electron renders each shot in a hidden window of the plugin's real size, in the
  // shot's colour scheme, and captures exactly that window.
  await writeFile(path.join(work, 'capture.mjs'), `import { app, BrowserWindow, nativeTheme } from 'electron';
import { writeFileSync } from 'node:fs';
const [base, list, out] = process.argv.slice(-3), pause = ms => new Promise(r => setTimeout(r, ms));
// Shots are taken one window at a time; closing one must not quit the app.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const shot of JSON.parse(list)) {
    nativeTheme.themeSource = shot.dark ? 'dark' : 'light';
    const win = new BrowserWindow({ show: false, width: shot.width, height: shot.height, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL(base.replace(/index\\.html$/, shot.page ?? 'index.html') + '?shot=' + shot.name + '&locale=' + shot.locale); await pause(shot.wait ?? 1500);
    win.webContents.invalidate(); await pause(200);
    writeFileSync(out + '/' + shot.locale + '/' + shot.name + '.png', (await win.webContents.capturePage()).toPNG());
    win.destroy(); console.log(shot.locale + '/' + shot.name);
  }
  app.exit(0);
});`);
  await promisify(execFile)(ELECTRON, [path.join(work, 'capture.mjs'), `http://127.0.0.1:${server.address().port}/index.html`, JSON.stringify(runs), out], { timeout: 240_000 });
  for (const shot of runs) console.log(path.relative(repo, path.join(out, shot.locale, shot.name + '.png')));
  server.close();
} finally { await rm(work, { recursive: true, force: true }); }
