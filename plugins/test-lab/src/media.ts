// Camera, microphone and system audio as one recorder: live levels (or the
// camera picture) while recording, then a waveform player for each take.
import css from './media.css';
import { useStyle } from './style';
import { bytes, card, clock, css$, empty, explain, h, page, pill, segmented, t, time } from './kit';
import { icon } from './icons';
import { normalize, resample } from './pure';
import { camera, microphone, operations, systemAudio, type MediaRecord } from '@medeo-plugin/sdk';

type Kind = 'camera' | 'microphone' | 'system_audio';
const PROVIDERS = { camera, microphone, system_audio: systemAudio };
const BAR = 3, GAP = 2, RATE = 20; // live bars: px, px, levels per second (the helper samples every 50 ms)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const finished = (r: MediaRecord) => ['completed', 'failed', 'interrupted'].includes(r.status);

/** Sizes a canvas to its box at device resolution and returns its 2D context in CSS pixels. */
function fit(canvas: HTMLCanvasElement) {
  const ratio = devicePixelRatio || 1, w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(hgt * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(hgt * ratio); }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, hgt);
  return { ctx, w, h: hgt };
}
function bars(ctx: CanvasRenderingContext2D, values: number[], x0: number, mid: number, height: number, step: number, width: number) {
  values.forEach((v, i) => {
    const half = Math.max(1, v * height / 2);
    ctx.beginPath(); ctx.roundRect(x0 + i * step, mid - half, width, half * 2, width / 2); ctx.fill();
  });
}

export async function mountMedia(kind: Kind) {
  useStyle(css);
  const api = PROVIDERS[kind], audio = kind !== 'camera', area = 'drive.media.';
  const call = async <T>(operation: Promise<{ id: string; status: string }>) => operations.wait<T>(await operation);
  const p = await page(kind, { wide: true, system: async () => (await call<{ authorization: string }>(api.status())).authorization });
  const osNote = h('p', { class: 'kit-note', hidden: true, testid: area + 'os_note' });
  const showOs = (state?: string) => { osNote.hidden = !state || state === 'granted'; osNote.textContent = state === 'not_determined' ? t('media.os_first') : t('media.os_denied'); };
  showOs(await p.systemState());

  // ── Recorder ──
  let maxSeconds = 10, active: string | undefined, phase: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle';
  const live = h('canvas', { class: 'media-live', testid: area + 'live', 'aria-label': t('media.live') });
  const frame = h('img', { class: 'media-frame', alt: '', testid: area + 'frame', hidden: true });
  const placeholder = h('div', { class: 'media-placeholder' }, icon(kind, 40), h('span', { text: t(kind === 'camera' ? 'media.camera_idle' : kind === 'system_audio' ? 'media.system_idle' : 'media.mic_idle') }));
  const stageState = pill(t('media.ready'), 'info', area + 'state');
  const stage = h('div', { class: 'media-stage ' + kind }, audio ? live : frame, placeholder, h('div', { class: 'media-stage-top' }, stageState));
  const record = h('button', { class: 'media-record', testid: area + 'record', 'aria-label': t('media.start') }, h('span'));
  const ring = h('div', { class: 'media-ring' }, record);
  const timer = h('b', { class: 'media-timer', testid: area + 'timer', text: '00:00' });
  const limit = h('small', { text: '/ ' + clock(maxSeconds * 1000) });
  const fill = h('span', { class: 'fill' }), peak = h('span', { class: 'peak' }), db = h('small', { class: 'media-db', text: '−∞ dB', testid: area + 'db' });
  const meter = h('div', { class: 'media-meter', hidden: !audio }, h('div', { class: 'track' }, fill, peak), db);
  const durations = segmented([5, 10, 30, 60].map(v => ({ value: v, label: v + 's' })), maxSeconds, v => { maxSeconds = v; limit.textContent = '/ ' + clock(v * 1000); }, area + 'duration');
  const controls = h('div', { class: 'media-controls' }, ring, h('div', { class: 'media-clock' }, h('div', {}, timer, limit), meter), h('div', { class: 'grow' }), h('div', { class: 'media-duration' }, h('small', { text: t('media.length') }), durations));
  const recorder = card(t('media.record_title'), t(kind + '.hint'), stage, controls, osNote);

  // ── Takes ──
  const list = h('div', { class: 'media-list', testid: area + 'list' });
  const count = h('small', { class: 'media-count' });
  const takes = card(t('media.takes'), undefined, list);
  takes.querySelector('.kit-card-head')!.append(count);

  // ── Player ──
  const element = audio ? h('audio', { preload: 'metadata', testid: area + 'audio' }) : h('video', { preload: 'metadata', controls: true, playsInline: true, class: 'media-video', testid: area + 'video' });
  const wave = h('canvas', { class: 'media-wave', testid: area + 'wave' });
  const play = h('button', { class: 'primary media-play', testid: area + 'play', 'aria-label': t('media.play'), disabled: true }, icon('play'));
  const position = h('span', { class: 'media-position kit-mono', text: '00:00 / 00:00', testid: area + 'position' });
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '1', class: 'media-volume', 'aria-label': t('media.volume') });
  const speed = segmented([1, 1.5, 2].map(v => ({ value: v, label: v + '×' })), 1, v => { element.playbackRate = v; }, area + 'speed');
  const title = h('h2', { text: t('media.player') }), meta = h('p', { text: t('media.pick') });
  const playerBody = audio
    ? h('div', { class: 'media-player' }, wave, h('div', { class: 'media-transport' }, play, position, h('div', { class: 'grow' }), speed, h('label', { class: 'media-vol' }, icon('volume'), volume)), element)
    : h('div', { class: 'media-player' }, element);
  const player = h('section', { class: 'kit-card media-player-card' }, h('div', { class: 'kit-card-head' }, title, meta), playerBody);
  const noTake = empty(t('media.pick'), kind);
  playerBody.hidden = true; player.append(noTake);

  p.body.append(h('div', { class: 'kit-grid split' }, h('div', { class: 'media-col' }, recorder, player), takes));

  // ── Live drawing ──
  let levels: number[] = [], seen = 0, cursor = 0, last = performance.now(), level = 0, peakLevel = 0;
  const accent = () => css$('--color-schemes-primary') || '#863dfb';
  const ink = () => css$('--color-surface-on-surface') || '#888';
  function drawLive(now: number) {
    if (!audio) return;
    const { ctx, w, h: height } = fit(live), step = BAR + GAP, n = Math.floor(w / step) + 1, mid = height / 2;
    // A cursor that advances at the sampling rate keeps scrolling smooth between polls.
    cursor = Math.min(levels.length, Math.max(cursor + (now - last) / 1000 * RATE * (phase === 'recording' ? 1 : 0), levels.length - 6));
    last = now;
    const whole = Math.floor(cursor), frac = cursor - whole, start = Math.max(0, whole - n);
    const shown = levels.slice(start, whole);
    ctx.fillStyle = ink(); ctx.globalAlpha = .12; ctx.fillRect(0, mid - .5, w, 1);
    if (!shown.length) {
      // Idle: a slow breathing line so the stage reads as "ready".
      ctx.globalAlpha = .35; ctx.fillStyle = accent();
      for (let i = 0; i < n; i++) { const v = .04 + .03 * Math.sin(now / 600 + i / 3); ctx.beginPath(); ctx.roundRect(i * step, mid - v * height / 2, BAR, v * height, 1.5); ctx.fill(); }
      ctx.globalAlpha = 1; return;
    }
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, accent() + '22'); grad.addColorStop(.7, accent() + 'aa'); grad.addColorStop(1, accent());
    ctx.fillStyle = grad; ctx.globalAlpha = 1;
    const x0 = w - shown.length * step - frac * step;
    // Gentle auto gain: a quiet room still shows a readable wave, loud input is not clipped.
    const gain = 0.95 / Math.max(0.45, ...shown);
    bars(ctx, shown.map(v => Math.min(1, v * gain)), x0, mid, height * .92, step, BAR);
  }
  function drawMeter() {
    fill.style.width = (level * 100).toFixed(1) + '%';
    peak.style.left = (peakLevel * 100).toFixed(1) + '%';
    db.textContent = level > 0 ? Math.round(level * 60 - 60) + ' dB' : '−∞ dB';
  }
  let raf = 0;
  const loop = (now: number) => { drawLive(now); if (phase !== 'idle' || audio) raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  p.onLeave(() => { cancelAnimationFrame(raf); element.pause(); });

  function setPhase(next: typeof phase) {
    phase = next;
    record.classList.toggle('on', next === 'recording' || next === 'starting');
    record.setAttribute('aria-label', next === 'idle' ? t('media.start') : t('media.stop'));
    record.disabled = next === 'starting' || next === 'stopping';
    durations.disabled = next !== 'idle';
    const labels = { idle: [t('media.ready'), 'info'], starting: [t('media.starting'), 'info'], recording: [t('media.recording'), 'live'], stopping: [t('media.processing'), 'info'] } as const;
    stageState.className = 'kit-pill ' + labels[next][1]; stageState.replaceChildren(h('i'), labels[next][0]);
    stage.classList.toggle('active', next !== 'idle');
    if (next === 'idle') { level = 0; peakLevel = 0; drawMeter(); ring.style.setProperty('--progress', '0'); }
  }
  function apply(rec: MediaRecord) {
    const elapsed = rec.elapsed_ms ?? rec.duration_ms ?? 0;
    timer.textContent = clock(elapsed);
    ring.style.setProperty('--progress', String(Math.min(1, elapsed / (maxSeconds * 1000))));
    if (rec.status === 'recording' && phase === 'starting') setPhase('recording');
    if (rec.status === 'stopping' && phase !== 'stopping') setPhase('stopping');
    if (rec.levels && rec.levels_seq !== undefined && rec.levels_seq > seen) {
      const fresh = Math.min(rec.levels_seq - seen, rec.levels.length);
      levels.push(...rec.levels.slice(-fresh)); seen = rec.levels_seq;
      if (levels.length > 2000) { const drop = levels.length - 1000; levels = levels.slice(drop); cursor -= drop; }
      placeholder.hidden = true;
    }
    if (rec.level !== undefined) { level = rec.level; peakLevel = Math.max(rec.peak ?? 0, level); drawMeter(); }
    if (rec.frame) { frame.src = 'data:image/jpeg;base64,' + rec.frame; frame.hidden = false; placeholder.hidden = true; }
  }
  async function follow(id: string) {
    active = id;
    try {
      for (;;) {
        if (p.left || active !== id) return;
        const rec = await call<MediaRecord>(api.state(id));
        apply(rec);
        if (finished(rec)) {
          active = undefined; setPhase('idle');
          if (rec.status === 'completed') { p.toast(t('media.saved', { duration: clock(rec.duration_ms ?? 0) }), 'ok'); await refresh(); await select(rec.id); }
          else { p.toast(rec.error ? explain(rec.error) : t('media.failed'), 'error'); await refresh(); }
          return;
        }
        await sleep(rec.status === 'stopping' ? 300 : 90);
      }
    } catch (error) {
      if (active === id) { active = undefined; setPhase('idle'); p.toast(explain(error), 'error'); }
    }
  }
  record.onclick = async () => {
    if (phase === 'recording' && active) {
      const id = active; setPhase('stopping');
      await p.act(null, kind + '.stop', () => call(api.stop(id)));
      return;
    }
    if (phase !== 'idle') return;
    if (!await p.ensure()) return;
    setPhase('starting'); levels = []; seen = 0; cursor = 0; timer.textContent = '00:00';
    if (!audio) { frame.hidden = true; placeholder.hidden = false; }
    const started = await p.act(null, kind + '.start', () => call<{ id: string; status: string }>(api.start(maxSeconds)));
    showOs(await p.systemState());
    if (!started) { setPhase('idle'); return; }
    void follow(started.id);
  };

  // ── Takes and player ──
  let records: MediaRecord[] = [], selected: MediaRecord | undefined, peaks: number[] = [];
  const full = new Map<string, number[]>();
  function mini(values: number[] | undefined) {
    const c = h('canvas', { class: 'media-mini' });
    requestAnimationFrame(() => {
      if (!values?.length) return;
      const { ctx, w, h: height } = fit(c), shown = normalize(resample(values, Math.floor(w / 3)));
      ctx.fillStyle = accent(); ctx.globalAlpha = .8; bars(ctx, shown, 0, height / 2, height, 3, 2);
    });
    return c;
  }
  async function refresh() {
    try { records = await call<MediaRecord[]>(api.state()); } catch (error) { p.raw(kind + '.state', String(error), true); return; }
    count.textContent = records.length ? t('media.count', { n: records.length }) : '';
    list.replaceChildren();
    if (!records.length) { list.append(empty(t('media.none'), kind)); return; }
    for (const rec of records) {
      const ok = rec.status === 'completed';
      const item = h('button', { class: 'media-item' + (rec.id === selected?.id ? ' selected' : ''), testid: area + 'take.' + rec.id, disabled: !ok },
        audio ? mini(rec.waveform_preview) : h('span', { class: 'media-thumb' }, icon('camera', 20)),
        h('span', { class: 'grow' }, h('b', { text: time(rec.created_ms) }), h('small', { text: ok ? clock(rec.duration_ms ?? 0) + ' · ' + bytes(rec.bytes ?? 0) : t('media.status.' + rec.status) })),
        ok ? null : pill(t('media.status.' + rec.status), rec.status === 'failed' ? 'error' : 'warn'));
      item.onclick = () => void select(rec.id);
      list.append(item);
    }
    if (!active) { const busy = records.find(r => ['starting', 'recording', 'stopping'].includes(r.status)); if (busy) { setPhase(busy.status === 'stopping' ? 'stopping' : 'recording'); void follow(busy.id); } }
  }
  async function select(id: string) {
    const rec = records.find(r => r.id === id);
    if (!rec || rec.status !== 'completed') return;
    selected = rec; element.pause();
    for (const item of list.querySelectorAll('.media-item')) item.classList.toggle('selected', (item as HTMLElement).dataset.testid === area + 'take.' + id);
    noTake.hidden = true; playerBody.hidden = false; play.disabled = false;
    title.textContent = time(rec.created_ms); meta.textContent = clock(rec.duration_ms ?? 0) + ' · ' + bytes(rec.bytes ?? 0);
    element.src = api.previewURL(rec); element.load();
    if (audio) {
      if (!full.has(id)) { try { full.set(id, (await call<MediaRecord>(api.state(id))).waveform ?? []); } catch { full.set(id, rec.waveform_preview ?? []); } }
      peaks = full.get(id)!; drawWave();
    }
  }
  let hover = -1;
  function drawWave() {
    if (!audio || playerBody.hidden) return;
    const { ctx, w, h: height } = fit(wave), step = 4, shown = normalize(resample(peaks, Math.floor(w / step))), mid = height / 2;
    const duration = element.duration || (selected?.duration_ms ?? 0) / 1000, progress = duration ? element.currentTime / duration : 0;
    const split = progress * w;
    ctx.fillStyle = ink(); ctx.globalAlpha = .22; bars(ctx, shown, 0, mid, height * .9, step, 2.5);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, split, height); ctx.clip(); ctx.fillStyle = accent(); ctx.globalAlpha = 1; bars(ctx, shown, 0, mid, height * .9, step, 2.5); ctx.restore();
    if (hover >= 0) { ctx.globalAlpha = .35; ctx.fillStyle = ink(); ctx.fillRect(hover, 0, 1, height); }
    ctx.globalAlpha = 1; ctx.fillStyle = accent(); ctx.fillRect(Math.max(0, split - 1), 0, 2, height);
    position.textContent = clock(element.currentTime * 1000) + ' / ' + clock(duration * 1000);
  }
  if (audio) {
    let drag = false;
    const seek = (event: PointerEvent) => { const r = wave.getBoundingClientRect(), d = element.duration || (selected?.duration_ms ?? 0) / 1000; if (!d) return; element.currentTime = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * d; drawWave(); };
    wave.onpointerdown = e => { drag = true; wave.setPointerCapture(e.pointerId); seek(e); };
    wave.onpointermove = e => { hover = e.clientX - wave.getBoundingClientRect().left; if (drag) seek(e); else drawWave(); };
    wave.onpointerup = () => { drag = false; };
    wave.onpointerleave = () => { hover = -1; drawWave(); };
    play.onclick = () => { if (element.paused) void element.play().catch(error => p.toast(explain(error), 'error')); else element.pause(); };
    volume.oninput = () => { element.volume = Number(volume.value); };
    let tick = 0;
    const animate = () => { drawWave(); if (!element.paused) tick = requestAnimationFrame(animate); };
    element.onplay = () => { play.replaceChildren(icon('pause')); play.setAttribute('aria-label', t('media.pause')); tick = requestAnimationFrame(animate); };
    element.onpause = element.onended = () => { play.replaceChildren(icon('play')); play.setAttribute('aria-label', t('media.play')); cancelAnimationFrame(tick); drawWave(); };
    element.onloadedmetadata = element.onseeked = () => drawWave();
    new ResizeObserver(() => drawWave()).observe(wave);
  }
  element.onerror = () => { if (selected) p.toast(t('media.play_failed'), 'error'); };

  setPhase('idle');
  await refresh();
}
