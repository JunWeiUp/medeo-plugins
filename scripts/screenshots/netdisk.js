/*shots {"shots":[{"name":"browse","width":1100,"height":720},{"name":"details","width":1100,"height":720,"dark":true},{"name":"pick","width":1100,"height":720}]} */
// Made-up Medeo Drive for the README screenshots: no account, engine, file or folder is touched.
(() => {
  const zh = demoLocale.startsWith('zh');
  const L = (en, cn) => (zh ? cn : en);
  const day = 86_400_000, now = Date.parse('2026-11-14T10:30:00Z');
  const folders = [
    { id: 'f-projects', name: L('Projects', '项目'), state: 'syncing', files: 128, bytes: 7.4e9, failed: 0, progress: 0.82, paused: false, cloudOnly: false },
    { id: 'f-assets', name: L('Brand assets', '品牌素材'), state: 'synced', files: 342, bytes: 2.1e9, failed: 0, progress: 1, paused: false, cloudOnly: false },
    { id: 'f-team', name: L('Team share', '团队共享'), state: 'synced', files: 56, bytes: 6.3e8, failed: 0, progress: 1, paused: false, cloudOnly: false },
    { id: 'f-footage', name: L('Raw footage', '原始素材'), state: 'synced', files: 911, bytes: 4.8e10, failed: 0, progress: 1, paused: false, cloudOnly: true },
    { id: 'f-archive', name: L('Archive 2025', '2025 归档'), state: 'synced', files: 1460, bytes: 1.9e10, failed: 0, progress: 1, paused: false, cloudOnly: true },
  ];
  const file = (name, size, ago, state, progress) => ({ name, size, ago, state, progress });
  const contents = [
    { name: L('Storyboards', '分镜'), dir: true, ago: 2 },
    { name: L('Voice-over', '配音'), dir: true, ago: 5 },
    file(L('Launch film v3.mp4', '发布会短片 v3.mp4'), 1.24e9, 0.1, 'uploading', 0.64),
    file(L('Launch film v2.mp4', '发布会短片 v2.mp4'), 1.18e9, 3, 'synced'),
    file(L('Cover.png', '封面.png'), 3.2e6, 0.4, 'synced'),
    file(L('Script.pdf', '脚本.pdf'), 8.6e5, 1, 'synced'),
    file(L('Music bed.m4a', '背景音乐.m4a'), 9.4e6, 6, 'cloud'),
    file(L('Shot list.xlsx', '镜头清单.xlsx'), 4.1e4, 2, 'synced'),
    file(L('Notes.md', '会议记录.md'), 6.2e3, 0.05, 'pending'),
    file(L('Title card.psd', '片头字卡.psd'), 6.8e7, 9, 'cloud'),
  ];
  const entries = contents.map((c, i) => ({
    path: c.name, name: c.name, kind: c.dir ? 'directory' : 'file', size: c.dir ? 0 : c.size,
    revision: 'r' + i, accessible: true, modified_ms: now - c.ago * day,
  }));
  const states = Object.fromEntries(contents.filter(c => !c.dir).map(c => [c.name, c.progress === undefined ? { state: c.state } : { state: c.state, progress: c.progress }]));
  const job = result => ({ id: 'job', status: 'completed', result, error: null, released: true });
  globalThis.demo = {
    async invoke(method, args, _emit, shot) {
      const pick = shot === 'pick';
      switch (method) {
        case 'drive.state': return { signedIn: true, engine: 'ready', generation: 1,
          status: { state: 'syncing', paused: false, totalFiles: 2897, syncedFiles: 2894, pendingFiles: 1, uploadingFiles: 2, errorFiles: 0, totalBytes: 7.7e10, syncedBytes: 7.6e10 } };
        case 'drive.folders': return folders;
        case 'drive.fileStates': return Object.fromEntries(args.paths.map(p => [p, states[p] ?? { state: 'synced' }]));
        case 'drive.transfers': return { uploadBytesPerSec: 3.4e6, downloadBytesPerSec: 0, active: [], recent: [] };
        case 'drive.failed': return [];
        // Picking: nothing added yet. Otherwise three folders were added earlier.
        case 'files.roots': return job(pick ? [] : folders.slice(0, 3).map((f, i) => ({ id: 'root-' + i, name: f.name, available: true })));
        case 'files.list': return job(args.root === 'root-0' && !args.path ? entries : []);
        case 'files.watch': return { id: 'watch', status: 'watching', cursor: 0 };
        case 'storage.get':
          if (args.key === 'layouts') return shot === 'details' ? { [folders[0].name]: 'list' } : null;
          if (args.key === 'recent') return [folders[0].name];
          return null;
        default: return null;
      }
    },
    after(shot) {
      if (shot === 'details') {
        // One file selected with its details open (⌘I).
        const video = contents[2].name;
        setTimeout(() => {
          document.querySelector(`[data-path="${CSS.escape(video)}"]`)?.click();
          document.querySelector('[data-testid="netdisk.info-toggle"]')?.click();
        }, 200);
      }
      if (shot === 'pick') {
        // Two folders ticked: the footer's «Add 2» is live.
        // Each tick re-renders the list: look the box up again every time.
        const tick = i => document.querySelectorAll('[data-testid="netdisk.pick-list"] input[type="checkbox"]')[i]?.click();
        setTimeout(() => { tick(1); setTimeout(() => tick(3), 100); }, 200);
      }
      document.body.dataset.viewport = innerWidth + 'x' + innerHeight + '@' + devicePixelRatio;
    },
  };
})();
