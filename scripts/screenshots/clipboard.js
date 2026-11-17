/*shots {"shots":[{"name":"panel","width":360,"height":600,"dark":true}]} */
// Made-up history for the README screenshots (nothing is read from this Mac).
(() => {
  const now = Date.now(), min = 60_000;
  const row = (id, kind, text, ago, extra = {}) => ({ id, kind, hash: id, text, size: text.length, app: null, bundle: null, createdAt: now - ago * min, copiedAt: now - ago * min, ...extra });
  // Chinese rows for the zh-CN shot, English ones for every other language.
  const zh = globalThis.demoLocale === 'zh-CN';
  const rows = zh ? [
    row('1', 'text', '周五下午 3 点评审新版插件中心，地点：3 号会议室', 1, { app: '备忘录', bundle: 'com.apple.Notes' }),
    row('2', 'html', 'Medeo 插件开发指南 — 用 TypeScript 写一个插件，签名后在插件中心安装', 4, { app: 'Safari', bundle: 'com.apple.Safari' }),
    row('3', 'image', '', 9, { size: 482_000, width: 1440, height: 900, app: '截屏', bundle: 'com.apple.screenshot' }),
    row('4', 'text', 'npm create @one2x/medeo-plugin@latest my-plugin -- --id com.example.my-plugin', 18, { app: '终端', bundle: 'com.apple.Terminal', favorite: true, note: '新建插件' }),
    row('5', 'files', '/Users/demo/Desktop/发布清单.pdf\n/Users/demo/Desktop/截图.png', 35, { size: 2, files: ['/Users/demo/Desktop/发布清单.pdf', '/Users/demo/Desktop/截图.png'], app: '访达', bundle: 'com.apple.finder' }),
    row('6', 'text', 'https://medeo.app/plugins', 62, { app: 'Safari', bundle: 'com.apple.Safari' }),
    row('7', 'rtf', '感谢大家的反馈！新版本已经修复了粘贴时丢失格式的问题。', 140, { app: 'Pages', bundle: 'com.apple.iWork.Pages' }),
  ] : [
    // English meta lines are longer; hours and days keep each row's ⌘ index in view.
    row('1', 'text', 'Plugin center review on Friday at 3 pm, meeting room 3', 1, { app: 'Notes', bundle: 'com.apple.Notes' }),
    row('2', 'html', 'Medeo plugin guide: write, sign and install a plugin', 60, { app: 'Safari', bundle: 'com.apple.Safari' }),
    row('3', 'image', '', 65, { size: 96_000, width: 1440, height: 900, app: 'Preview', bundle: 'com.apple.Preview' }),
    row('4', 'text', 'npm create @one2x/medeo-plugin@latest my-plugin -- --id com.example.my-plugin', 1440, { app: 'iTerm', bundle: 'com.googlecode.iterm2', favorite: true, note: 'New plugin' }),
    row('5', 'files', '/Users/demo/Desktop/Release checklist.pdf\n/Users/demo/Desktop/Screenshot.png', 2880, { size: 2, files: ['/Users/demo/Desktop/Release checklist.pdf', '/Users/demo/Desktop/Screenshot.png'], app: 'Finder', bundle: 'com.apple.finder' }),
    row('6', 'text', 'https://medeo.app/plugins', 4320, { app: 'Safari', bundle: 'com.apple.Safari' }),
    row('7', 'rtf', 'Thanks for the feedback! The new version keeps formatting when you paste.', 5760, { app: 'Pages', bundle: 'com.apple.iWork.Pages' }),
  ];
  const thumb = () => { const c = document.createElement('canvas'); c.width = 96; c.height = 60; const g = c.getContext('2d'), s = g.createLinearGradient(0, 0, 96, 60); s.addColorStop(0, '#7c5cff'); s.addColorStop(1, '#2bc4a8'); g.fillStyle = s; g.fillRect(0, 0, 96, 60); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(10, 12, 50, 6); g.fillRect(10, 24, 76, 4); g.fillRect(10, 32, 64, 4); return c.toDataURL('image/png'); };
  globalThis.demo = {
    post(message, emit) {
      if (message.type === 'hello') {
        emit({ type: 'state', state: { ready: true, error: null, settings: { paused: false, shortcut: 'Alt+C', autoPaste: true, maxItems: 1000, retentionDays: 30 }, trusted: true, shortcutError: null } });
        emit({ type: 'rows', reset: true, rows });
      }
      if (message.type === 'thumbs') for (const id of message.ids) emit({ type: 'thumb', id, url: thumb() });
    },
    after() { document.activeElement?.blur?.(); document.body.dataset.viewport = innerWidth + 'x' + innerHeight + '@' + devicePixelRatio; },
  };
})();
