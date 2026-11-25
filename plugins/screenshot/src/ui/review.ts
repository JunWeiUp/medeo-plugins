// Post-recording Review & Quick Trim Studio:
// Streams capture.mp4 via HTTP 206 Range URL, syncs optional camera.mp4 PiP and
// telemetry.jsonl (click ripples + keystroke HUD badges), provides In/Out trim,
// speed preview, local save / GIF export / clipboard file copy / Netdisk / Issue bundle,
// and recent recordings history.
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import { captureV2, type CaptureRecordV2 } from '../platform.ts';
import type { FromReview, ReviewState, ToReview } from '../protocol.ts';
import { detectFpsHealth, formatBytes, formatDuration } from '../recording.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromReview) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));

interface TelemetryEvent {
  t: number;
  kind: 'meta' | 'move' | 'click' | 'key';
  x?: number;
  y?: number;
  btn?: string;
  label?: string;
}

let state: ReviewState | null = null;
let trimStart = 0;
let trimEnd = 0;
let speed = 1;
let telemetry: TelemetryEvent[] = [];
let showTelemetry = true;
let loadedRecordId: string | null = null;
let rafId = 0;
let toastTimer = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(tone: 'success' | 'error', msg: string) {
  const box = $('review-toast');
  box.textContent = msg;
  box.className = `toast ${tone}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2600) as unknown as number;
}

async function loadTelemetry(record: CaptureRecordV2) {
  telemetry = [];
  if (!record.tracks?.['telemetry.jsonl']) return;
  try {
    const res = await fetch(captureV2.trackURL(record.id, 'telemetry.jsonl'));
    if (!res.ok) return;
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as TelemetryEvent;
        if (ev && typeof ev.t === 'number') telemetry.push(ev);
      } catch {}
    }
  } catch {}
}

function drawTelemetryOverlay(video: HTMLVideoElement, canvas: HTMLCanvasElement, keyBadge: HTMLElement) {
  const rect = video.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!showTelemetry || !telemetry.length || !state) {
    keyBadge.hidden = true;
    return;
  }
  const nowSec = video.currentTime;
  const color = state.config.clicks.color || '#FF3B30';
  const baseRadius = state.config.clicks.size === 'lg' ? 32 : state.config.clicks.size === 'sm' ? 18 : 24;

  // Click ripples within 450ms of currentTime.
  for (const ev of telemetry) {
    if (ev.kind === 'click' && ev.x !== undefined && ev.y !== undefined) {
      const age = nowSec - ev.t;
      if (age >= 0 && age <= 0.45) {
        const progress = age / 0.45;
        const alpha = 1 - progress;
        const r = 6 + baseRadius * progress;
        const cx = ev.x * rect.width;
        const cy = ev.y * rect.height;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * 0.9;
        ctx.lineWidth = 3 * (1 - progress * 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * 0.22;
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Latest keystroke within 1.4s.
  let latestKey: TelemetryEvent | null = null;
  for (let i = telemetry.length - 1; i >= 0; i--) {
    const ev = telemetry[i];
    if (ev.kind === 'key' && ev.label && nowSec >= ev.t && nowSec - ev.t <= 1.4) {
      latestKey = ev;
      break;
    }
  }
  if (latestKey?.label) {
    keyBadge.textContent = latestKey.label;
    keyBadge.hidden = false;
  } else {
    keyBadge.hidden = true;
  }
}

const RANGE_SLICE = 512 * 1024;
let exporting = false;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Streams capture.mp4 via sanctioned HTTP 206 Range requests to worker in 512 KiB slices (zero OOM). */
async function streamExport(
  rec: CaptureRecordV2,
  kind: 'save-mp4' | 'save-gif' | 'copy-file' | 'drive' | 'drive-to' | 'issue-pack',
  trim?: { trimStart?: number; trimEnd?: number },
) {
  if (exporting) return;
  exporting = true;
  render();
  const jobId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    let telemetryText: string | undefined;
    if (kind === 'issue-pack' && rec.tracks?.['telemetry.jsonl']) {
      const tres = await fetch(captureV2.trackURL(rec.id, 'telemetry.jsonl')).catch(() => null);
      if (tres?.ok) telemetryText = await tres.text();
    }
    await post({
      type: 'review-export-start',
      jobId,
      id: rec.id,
      kind,
      trimStart: trim?.trimStart,
      trimEnd: trim?.trimEnd,
      telemetryText,
    });
    const url = captureV2.trackURL(rec.id, 'capture.mp4');
    let offset = 0;
    let index = 0;
    let total = rec.bytes > 0 ? rec.bytes : Infinity;
    while (offset < total) {
      const end = Number.isFinite(total) ? Math.min(offset + RANGE_SLICE - 1, total - 1) : offset + RANGE_SLICE - 1;
      const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const cr = res.headers.get('content-range');
      if (cr) {
        const m = cr.match(/\/(\d+)$/);
        if (m) total = Number(m[1]);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) break;
      await post({ type: 'review-export-chunk', jobId, index: index++, data: bytesToBase64(buf) });
      offset += buf.length;
      if (res.status === 200) break;
    }
    await post({ type: 'review-export-end', jobId, ok: true });
  } catch (err) {
    console.error('review stream export failed:', err);
    await post({ type: 'review-export-end', jobId, ok: false }).catch(() => {});
    showToast('error', tr('review.exportFailed'));
  } finally {
    exporting = false;
    render();
  }
}

function render() {
  cancelAnimationFrame(rafId);
  const root = $('review');
  root.replaceChildren();
  if (!state) return;

  const rec = state.activeRecord;
  const header = el('header', 'review-header');
  const titleWrap = el('div', 'review-title-wrap');
  titleWrap.append(
    el('h2', 'review-title', tr('review.title')),
    el('span', 'review-sub', rec ? `${rec.source_title} · ${formatDuration(rec.duration_ms)}` : tr('review.empty')),
  );
  const topActions = el('div', 'review-top-actions');
  const newRec = el('button', 'pill', tr('review.newRecord'));
  newRec.dataset.testid = 'recorder.review.new';
  newRec.addEventListener('click', () => void post({ type: 'review-record-new', issueMode: false }));
  const newIssue = el('button', 'pill', tr('review.newIssue'));
  newIssue.dataset.testid = 'recorder.review.newIssue';
  newIssue.addEventListener('click', () => void post({ type: 'review-record-new', issueMode: true }));
  topActions.append(newRec, newIssue);
  header.append(titleWrap, topActions);

  const body = el('div', 'review-body');

  // Left: recent recordings history list
  const sidebar = el('aside', 'review-sidebar');
  sidebar.append(el('div', 'review-side-head', tr('review.history')));
  if (!state.history.length) {
    sidebar.append(el('p', 'review-muted', tr('review.historyEmpty')));
  } else {
    const list = el('div', 'review-history-list');
    for (const item of state.history) {
      const card = el('button', `review-hist-item${rec?.id === item.id ? ' on' : ''}`);
      card.dataset.testid = `recorder.review.history.${item.id}`;
      const row1 = el('div', 'review-hist-title', item.source_title || item.id.slice(0, 8));
      const metaParts = [formatDuration(item.duration_ms), formatBytes(item.bytes)];
      if (item.target_fps) metaParts.push(`${item.target_fps}Hz`);
      if (item.codec) metaParts.push(item.codec.toUpperCase());
      const row2 = el('div', 'review-hist-meta', metaParts.join(' · '));
      card.append(row1, row2);
      card.addEventListener('click', () => void post({ type: 'review-select', id: item.id }));
      list.append(card);
    }
    sidebar.append(list);
  }

  // Right: video stage + telemetry overlay + trim + export bar
  const main = el('main', 'review-main');
  if (!rec || !rec.playable) {
    const empty = el('div', 'review-empty-card');
    empty.append(
      el('p', '', rec?.error ? tr('review.failed', { error: rec.error }) : tr('review.emptyHint')),
    );
    main.append(empty);
  } else {
    const totalSec = Math.max(0.1, rec.duration_ms / 1000);
    if (loadedRecordId !== rec.id) {
      loadedRecordId = rec.id;
      trimStart = 0;
      trimEnd = totalSec;
      void loadTelemetry(rec);
    }

    const stage = el('div', 'review-stage');
    const videoWrap = el('div', 'review-video-wrap');
    const video = el('video', 'review-video') as HTMLVideoElement;
    video.src = captureV2.trackURL(rec.id, 'capture.mp4');
    video.controls = true;
    video.playsInline = true;
    video.playbackRate = speed;
    video.dataset.testid = 'recorder.review.video';

    const overlayCanvas = el('canvas', 'review-tel-canvas') as HTMLCanvasElement;
    const keyBadge = el('div', 'review-key-badge');
    keyBadge.hidden = true;
    videoWrap.append(video, overlayCanvas, keyBadge);

    let camVideo: HTMLVideoElement | null = null;
    if (rec.tracks?.['camera.mp4']) {
      camVideo = el('video', `review-cam-pip ${state.config.camera.shape} ${state.config.camera.position}`) as HTMLVideoElement;
      camVideo.src = captureV2.trackURL(rec.id, 'camera.mp4');
      camVideo.muted = true;
      camVideo.playsInline = true;
      if (state.config.camera.mirror) camVideo.classList.add('mirror');
      videoWrap.append(camVideo);
    }

    // Sync camera PiP + trim boundaries + telemetry canvas loop.
    video.addEventListener('play', () => {
      if (video.currentTime < trimStart || video.currentTime >= trimEnd - 0.05) {
        video.currentTime = trimStart;
      }
      if (camVideo) {
        camVideo.currentTime = video.currentTime;
        camVideo.playbackRate = video.playbackRate;
        void camVideo.play().catch(() => {});
      }
    });
    video.addEventListener('pause', () => { camVideo?.pause(); });
    video.addEventListener('seeked', () => {
      if (camVideo) camVideo.currentTime = video.currentTime;
    });
    video.addEventListener('ratechange', () => {
      if (camVideo) camVideo.playbackRate = video.playbackRate;
    });
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        if (trimEnd === 0 || Math.abs(trimEnd - totalSec) < 0.5) trimEnd = video.duration;
      }
    });

    const tick = () => {
      if (!video.paused && trimEnd > trimStart && video.currentTime >= trimEnd) {
        video.pause();
        video.currentTime = trimStart;
      }
      drawTelemetryOverlay(video, overlayCanvas, keyBadge);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    stage.append(videoWrap);

    // Metrics & tracks strip
    const badges = el('div', 'review-badges');
    const fpsHealth = detectFpsHealth(rec.target_fps ?? 60, rec.actual_fps, rec.dropped_frames ?? 0);
    if (rec.width && rec.height) badges.append(el('span', 'rbadge', `${rec.width}×${rec.height}`));
    const fpsStr = rec.actual_fps ? `${Math.round(rec.actual_fps)}/${rec.target_fps ?? 60}fps` : `${rec.target_fps ?? 60}Hz`;
    badges.append(el('span', `rbadge ${fpsHealth}`, fpsStr));
    if (rec.codec) badges.append(el('span', 'rbadge', rec.codec.toUpperCase()));
    if (rec.dropped_frames) badges.append(el('span', 'rbadge warn', tr('hud.dropped', { n: rec.dropped_frames })));
    badges.append(el('span', 'rbadge', formatBytes(rec.bytes)));
    for (const [trackName, present] of Object.entries(rec.tracks ?? {})) {
      if (!present || trackName === 'capture.mp4') continue;
      badges.append(el('span', 'rbadge track', trackName));
    }

    // Trim & speed bar
    const trimBar = el('div', 'review-trim-bar');
    const startLabel = el('span', 'trim-val', formatDuration(trimStart * 1000));
    const endLabel = el('span', 'trim-val', formatDuration(trimEnd * 1000));
    const startInput = el('input', 'trim-range') as HTMLInputElement;
    startInput.type = 'range'; startInput.min = '0'; startInput.max = String(totalSec.toFixed(2)); startInput.step = '0.05'; startInput.value = String(trimStart.toFixed(2));
    startInput.dataset.testid = 'recorder.review.trimStart';
    const endInput = el('input', 'trim-range') as HTMLInputElement;
    endInput.type = 'range'; endInput.min = '0'; endInput.max = String(totalSec.toFixed(2)); endInput.step = '0.05'; endInput.value = String(trimEnd.toFixed(2));
    endInput.dataset.testid = 'recorder.review.trimEnd';

    startInput.addEventListener('input', () => {
      trimStart = Math.min(Number(startInput.value), Math.max(0, trimEnd - 0.2));
      startInput.value = String(trimStart.toFixed(2));
      startLabel.textContent = formatDuration(trimStart * 1000);
      video.currentTime = trimStart;
    });
    endInput.addEventListener('input', () => {
      trimEnd = Math.max(Number(endInput.value), trimStart + 0.2);
      endInput.value = String(trimEnd.toFixed(2));
      endLabel.textContent = formatDuration(trimEnd * 1000);
    });

    const speedSeg = el('div', 'seg');
    for (const sp of [0.5, 1, 1.5, 2]) {
      const b = el('button', `seg-item${speed === sp ? ' on' : ''}`, `${sp}×`);
      b.addEventListener('click', () => { speed = sp; video.playbackRate = sp; render(); });
      speedSeg.append(b);
    }

    const telToggle = el('label', 'review-check');
    const telBox = el('input') as HTMLInputElement;
    telBox.type = 'checkbox';
    telBox.checked = showTelemetry;
    telBox.addEventListener('change', () => { showTelemetry = telBox.checked; });
    telToggle.append(telBox, el('span', '', tr('review.showTelemetry')));

    trimBar.append(
      el('span', 'trim-lbl', tr('review.trimIn')), startInput, startLabel,
      el('span', 'trim-lbl', tr('review.trimOut')), endInput, endLabel,
      speedSeg,
      ...(rec.tracks?.['telemetry.jsonl'] ? [telToggle] : []),
    );

    // Export & distribution bar
    const busy = Boolean(state.busyAction) || exporting;
    const exportBar = el('div', 'review-export-bar');
    const isTrimmed = trimStart > 0.05 || trimEnd < totalSec - 0.1;
    const trimArgs = isTrimmed ? { trimStart, trimEnd } : undefined;

    const saveMp4 = el('button', 'cta', state.busyAction === 'save-mp4' || exporting ? tr('review.working') : tr('review.saveMp4'));
    saveMp4.disabled = busy;
    saveMp4.dataset.testid = 'recorder.review.saveMp4';
    saveMp4.addEventListener('click', () => void streamExport(rec, 'save-mp4', trimArgs));

    const saveGif = el('button', 'pill', state.busyAction === 'save-gif' ? tr('review.working') : tr('review.exportGif'));
    saveGif.disabled = busy || !state.ffmpegAvailable;
    saveGif.title = state.ffmpegAvailable ? '' : tr('review.noFfmpeg');
    saveGif.dataset.testid = 'recorder.review.exportGif';
    saveGif.addEventListener('click', () => void streamExport(rec, 'save-gif', trimArgs));

    const copyBtn = el('button', 'pill', tr('review.copyFile'));
    copyBtn.disabled = busy;
    copyBtn.dataset.testid = 'recorder.review.copyFile';
    copyBtn.addEventListener('click', () => void streamExport(rec, 'copy-file'));

    const driveBtn = el('button', 'pill', tr('review.drive'));
    driveBtn.disabled = busy;
    driveBtn.dataset.testid = 'recorder.review.drive';
    driveBtn.addEventListener('click', e => void streamExport(rec, e.altKey ? 'drive-to' : 'drive'));

    const issueBtn = el('button', `pill${state.issueMode ? ' issue-cta' : ''}`, tr('review.packIssue'));
    issueBtn.disabled = busy;
    issueBtn.dataset.testid = 'recorder.review.packIssue';
    issueBtn.addEventListener('click', () => void streamExport(rec, 'issue-pack', trimArgs));

    const revealBtn = el('button', 'pill', tr('review.reveal'));
    revealBtn.dataset.testid = 'recorder.review.reveal';
    revealBtn.addEventListener('click', () => void captureV2.open(rec.id, 'reveal').catch(() => showToast('error', tr('review.exportFailed'))));

    exportBar.append(saveMp4, saveGif, copyBtn, driveBtn, issueBtn, revealBtn);
    main.append(stage, badges, trimBar, exportBar);
  }

  body.append(sidebar, main);
  root.append(header, body);
}

export async function startReview() {
  t = await i18n.catalog().catch(() => ({}));
  document.title = tr('review.title');
  i18n.onDidChangeLocale(async () => {
    t = await i18n.catalog().catch(() => t);
    document.title = tr('review.title');
    render();
  });
  channel.onMessage<ToReview>(m => {
    if (m?.type === 'review-state') {
      state = m.state;
      render();
    } else if (m?.type === 'review-toast') {
      showToast(m.tone, m.message);
    }
  });
  await post({ type: 'review-ready' });
}
