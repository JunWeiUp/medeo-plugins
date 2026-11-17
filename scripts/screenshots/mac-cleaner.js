/*shots {"shots":[{"name":"overview","width":1180,"height":760,"dark":true},{"name":"cleanup","width":1180,"height":760,"dark":true}]} */
// A made-up finished scan for the README screenshots (nothing is read from this Mac).
(() => {
  // Paths are the same in every language; app names follow the shot's language.
  const zh = globalThis.demoLocale === 'zh-CN';
  const home = '/Users/demo', now = Date.now(), day = 86_400_000, GB = 1e9, MB = 1e6;
  let n = 0;
  const item = (rule, category, risk, path, name, bytes, ago, extra = {}) =>
    ({ id: `${rule}:${path}${extra.command ?? ''}#${n++}`, rule, category, risk, kind: 'path', path: path.replace('~', home), name, bytes: Math.round(bytes), modified: ago === null ? null : now - ago * day, ...extra });
  const command = (rule, category, executable, line, bytes) => item(rule, category, 'safe', executable, '', bytes, null, { kind: 'command', command: line });
  const developer = [
    item('projects.target', 'projects', 'review', '~/Projects/sync-engine/target', 'sync-engine/target', 6.12 * GB, 3),
    item('projects.node_modules', 'projects', 'safe', '~/Projects/medeo-web/node_modules', 'medeo-web/node_modules', 2.84 * GB, 1),
    item('projects.node_modules', 'projects', 'safe', '~/Projects/landing-page/node_modules', 'landing-page/node_modules', 913 * MB, 21),
    item('projects.build', 'projects', 'safe', '~/Projects/ios-app/build', 'ios-app/build', 1.31 * GB, 9),
    item('projects..next', 'projects', 'safe', '~/Projects/landing-page/.next', 'landing-page/.next', 412 * MB, 21),
    item('xcode.deriveddata', 'xcode', 'safe', '~/Library/Developer/Xcode/DerivedData/MedeoDrive-fqzkxbtwloyhmn', 'MedeoDrive-fqzkxbtwloyhmn', 4.71 * GB, 2),
    item('xcode.deriveddata', 'xcode', 'safe', '~/Library/Developer/Xcode/DerivedData/Notes-gbwhrkpduzqaxe', 'Notes-gbwhrkpduzqaxe', 1.06 * GB, 40),
    item('xcode.devicesupport', 'xcode', 'review', '~/Library/Developer/Xcode/iOS DeviceSupport/iPhone15,2 17.4 (21E219)', 'iPhone15,2 17.4 (21E219)', 3.92 * GB, 190),
    item('sim.coresimulator-caches', 'simulator', 'safe', '~/Library/Developer/CoreSimulator/Caches/dyld', 'dyld', 1.84 * GB, 12),
    item('node.npm-cacache', 'node', 'safe', '~/.npm/_cacache/content-v2', 'content-v2', 2.13 * GB, 1),
    item('node.npm-cacache', 'node', 'safe', '~/.npm/_cacache/index-v5', 'index-v5', 184 * MB, 1),
    item('node.pnpm-store', 'node', 'review', '~/Library/pnpm/store', '', 5.38 * GB, 4),
    command('cli.npm-cache', 'node', '/opt/homebrew/bin/npm', 'npm cache clean --force', 2.31 * GB),
    item('rust.registry-src', 'rust', 'safe', '~/.cargo/registry/src/index.crates.io-6f17d22bba15001f', 'index.crates.io-6f17d22bba15001f', 1.12 * GB, 6),
    item('brew.cache', 'homebrew', 'safe', '~/Library/Caches/Homebrew', '', 1.27 * GB, 5),
    item('ide.jetbrains', 'ide', 'safe', '~/Library/Caches/JetBrains/WebStorm2025.2', 'WebStorm2025.2', 864 * MB, 14),
    item('codex.logs', 'codex', 'safe', '~/.codex/log/2026/09/18', '2026-09-18', 286 * MB, 46),
    item('codex.update', 'codex', 'safe', '~/Library/Caches/com.openai.codex/0.41.0', '0.41.0', 392 * MB, 30),
    item('claude.cli-versions', 'claude', 'review', '~/.local/share/claude/versions/2.0.14', '2.0.14', 214 * MB, 25),
    item('claude.desktop-cache', 'claude', 'safe', '~/Library/Application Support/Claude/Cache', 'Claude/Cache', 538 * MB, 2),
  ];
  const general = [
    item('system.logs', 'system', 'safe', '~/Library/Logs/DiagnosticReports', 'DiagnosticReports', 642 * MB, 3),
    item('system.crashreporter', 'system', 'safe', '~/Library/Application Support/CrashReporter', '', 38 * MB, 11),
    item('system.saved-state', 'system', 'safe', '~/Library/Saved Application State', '', 96 * MB, 2),
    item('language.lproj', 'language', 'review', '/Applications/Keynote.app/Contents/Resources/fr.lproj', 'fr.lproj', 84 * MB, 60, { app: 'Keynote', language: 'fr' }),
    item('language.lproj', 'language', 'review', '/Applications/Pages.app/Contents/Resources/de.lproj', 'de.lproj', 61 * MB, 60, { app: 'Pages', language: 'de' }),
    item('downloads.installer', 'downloads', 'caution', '~/Downloads/Xcode_16.4.dmg', 'Xcode_16.4.dmg', 3.48 * GB, 72),
    item('downloads.archive', 'downloads', 'caution', '~/Downloads/design-assets.zip', 'design-assets.zip', 726 * MB, 33),
    item('trash.home', 'trash', 'caution', '~/.Trash', '', 1.62 * GB, 1),
    item('app.junk', 'appJunk', 'safe', '~/Library/Caches/com.tencent.xinWeChat', 'com.tencent.xinWeChat', 1.94 * GB, 1, { app: zh ? '微信' : 'WeChat' }),
    item('app.junk', 'appJunk', 'safe', '~/Library/Caches/com.spotify.client', 'com.spotify.client', 812 * MB, 2, { app: 'Spotify' }),
    item('app.junk', 'appJunk', 'safe', '~/Library/Caches/com.figma.Desktop', 'com.figma.Desktop', 437 * MB, 4, { app: 'Figma' }),
    item('browser.chrome-cache', 'browser', 'safe', '~/Library/Caches/Google/Chrome/Default/Cache', 'Default/Cache', 1.47 * GB, 1),
    item('browser.chrome-code-cache', 'browser', 'safe', '~/Library/Application Support/Google/Chrome/Default/Code Cache', 'Default/Code Cache', 318 * MB, 1),
    item('browser.arc-cache', 'browser', 'safe', '~/Library/Caches/Arc/Default/Cache', 'Default/Cache', 702 * MB, 1),
    item('browser.firefox-cache', 'browser', 'safe', '~/Library/Caches/Firefox/Profiles/x3k9q.default-release/cache2', 'x3k9q.default-release/cache2', 455 * MB, 2),
  ];
  const state = (status, scope) => ({ status, home, scope, scanned: { developer: now - 4 * 60_000, general: status === 'done' ? now - 60_000 : null },
    roots: [`${home}/Projects`], suggestions: [], picking: false, method: 'trash', commands: true, sessionDays: 90,
    progress: { done: 0, total: 0 }, outcomes: [], free: 41.6 * GB, capacity: 494.38 * GB });
  globalThis.demo = {
    post(message, emit) {
      if (message.type !== 'hello') return;
      emit({ type: 'items', reset: 'all', items: [...developer, ...general] });
      // Scanning then done: the junk page ticks its default rows, as after a real scan.
      emit({ type: 'state', state: state('scanning', 'general') });
      emit({ type: 'state', state: state('done', 'general') });
    },
    invoke(method) { if (method === 'storage.get') return null; return null; },
    after(shot) {
      if (shot === 'cleanup') { document.querySelector('[data-testid="cleaner.nav.general"]')?.click(); return; }
      // Tick the safe, rebuildable rows a user would pick first.
      const pick = ['medeo-web/node_modules', 'MedeoDrive-fqzkxbtwloyhmn', 'content-v2', 'dyld', 'ios-app/build', 'Homebrew'];
      for (const row of document.querySelectorAll('#rows .row')) if (pick.some(p => row.querySelector('b')?.textContent?.includes(p))) row.click();
      document.activeElement?.blur?.();
    },
  };
})();
