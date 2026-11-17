/*shots {"shots":[{"name":"editor","width":1200,"height":760,"dark":true,"wait":2600},{"name":"settings","page":"settings.html","width":720,"height":900,"dark":true}]} */
// Made-up captures for the README screenshots: no screen is captured, nothing is saved or copied.
// The editor gets a drawn "desktop" as its shot, then a selection and a few annotations are made
// with the same pointer and key events a person would use.
(() => {
  const settings = { shortcutArea: 'Command+Shift+X', shortcutFull: null, shortcutQuick: 'Command+Shift+Z', shortcutOcr: null,
    enterAction: 'copy', format: 'png', downscale: false, saveDir: '~/Pictures/Medeo Screenshots', openAfterSave: false };
  const output = { format: 'png', downscale: false, enter: 'copy' };
  const desktop = () => {
    const w = 1200, h = 760, canvas = new OffscreenCanvas(w * 2, h * 2), c = canvas.getContext('2d');
    c.scale(2, 2);
    const sky = c.createLinearGradient(0, 0, w, h); sky.addColorStop(0, '#3b2a6b'); sky.addColorStop(1, '#0f1d3a');
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, w, 26);
    // A window with a small dashboard, the thing being captured.
    const win = (x, y, ww, wh) => {
      c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 40; c.shadowOffsetY = 16;
      c.fillStyle = '#f7f7fa'; c.beginPath(); c.roundRect(x, y, ww, wh, 12); c.fill(); c.restore();
      c.fillStyle = '#ececf1'; c.beginPath(); c.roundRect(x, y, ww, 38, [12, 12, 0, 0]); c.fill();
      ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(x + 20 + i * 20, y + 19, 6, 0, 7); c.fill(); });
    };
    win(170, 110, 860, 540);
    c.fillStyle = '#1d1d1f'; c.font = '600 22px -apple-system, "PingFang SC", sans-serif';
    c.fillText(demoLocale === 'zh-CN' ? '本周数据' : 'This week', 210, 190);
    const bars = [120, 180, 150, 230, 200, 260, 210];
    bars.forEach((v, i) => { c.fillStyle = i === 5 ? '#863dfb' : '#c9b6ff'; c.beginPath(); c.roundRect(220 + i * 62, 560 - v, 38, v, 6); c.fill(); });
    c.fillStyle = '#6e6e73'; c.font = '14px -apple-system, "PingFang SC", sans-serif';
    const rows = demoLocale === 'zh-CN' ? [['访问量', '12,480'], ['转化率', '4.8%']] : [['Visits', '12,480'], ['Conversion', '4.8%']];
    rows.forEach(([label, value], i) => {
      c.fillStyle = '#6e6e73'; c.font = '14px -apple-system, "PingFang SC", sans-serif'; c.fillText(label, 700 + i * 150, 240);
      c.fillStyle = '#1d1d1f'; c.font = '600 24px -apple-system, sans-serif'; c.fillText(value, 700 + i * 150, 272);
    });
    c.fillStyle = '#6e6e73'; c.font = '14px -apple-system, "PingFang SC", sans-serif';
    c.fillText((demoLocale === 'zh-CN' ? '客户邮箱：' : 'Customer: ') + 'ada.lovelace@example.com', 700, 330);
    return canvas;
  };
  const toBase64 = async canvas => {
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  const pointer = (type, x, y, extra = {}) => document.getElementById('ui').dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra }));
  const drag = async (from, to) => {
    pointer('pointerdown', ...from); for (let i = 1; i <= 8; i++) pointer('pointermove', from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8);
    pointer('pointerup', ...to); await new Promise(r => setTimeout(r, 60));
  };
  const key = k => dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  globalThis.demo = {
    invoke(method) {
      if (method === 'capture.status' || method === 'capture.sources') return { status: 'ready', os: { screen_capture: 'granted' }, sources: [] };
      return null;
    },
    async post(message, emit, shot) {
      if (message.type === 'settings-ready') emit({ type: 'settings', state: { settings, saveDir: settings.saveDir, errors: {} } });
      if (message.type !== 'overlay-ready' || shot !== 'editor') return;
      const data = await toBase64(desktop());
      emit({ type: 'shot', shot: { seq: 1, mode: 'area', width: innerWidth, height: innerHeight, scale: 2, windows: [{ x: 170, y: 110, w: 860, h: 540 }], output }, parts: 1 });
      emit({ type: 'chunk', seq: 1, i: 0, data });
    },
    async after(shot) {
      if (shot !== 'editor') return;
      await new Promise(r => setTimeout(r, 700));
      await drag([190, 150], [1010, 600]);          // the selection
      key('r'); await drag([684, 216], [920, 286]);  // a box around the numbers
      key('b'); await drag([694, 314], [990, 338]);  // censor the e-mail address
      key('a'); await drag([700, 470], [580, 330]);  // an arrow at the best day
      key('n'); await drag([540, 290], [540, 290]);  // a step number
      key('s');
    },
  };
})();
