// Screenshot & 120Hz Screen Recorder:
// - Screenshot: freezes display under pointer with `screencapture`, edits in transparent overlay,
//   copies/saves/OCR/beautifies/pins on screen/stores to Medeo Netdisk.
// - 120Hz Screen Recording: shares the same selection overlay (with mode switcher & 5-feature config),
//   shows click-through capture-excluded border + optional 3-2-1 countdown + non-activating HUD pill
//   (live timer, real FPS/drop badge, Mic VU & mute, System Audio mute, Pause/Resume, Stop),
//   and opens the post-recording Review & Quick Trim Studio (Save MP4, Export GIF, Copy File,
//   Medeo Netdisk, Issue Bundle for mearc/RTE).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { channel, definePlugin, events, i18n, launcher, notifications, plugins, shortcuts, tray } from '@one2x/medeo-plugin-sdk';
import type { Rect } from './src/geometry.ts';
import { expandHome, fileName, stamp } from './src/naming.ts';
import { captureV2, windowsV2, type CaptureDevicesResult, type CaptureRecordV2, type WindowBounds } from './src/platform.ts';
import {
  joinLines, split,
  type Action, type BorderState, type FromWindow, type HudState, type Mode,
  type PinPayload, type ReviewState, type SettingsState, type Shot, type ToWindow,
} from './src/protocol.ts';
import {
  buildIssueSummary, buildStartPayload, computeBorderBounds, computeHudBounds,
  formatDuration, normalizeRecordingConfig, type RecordingConfig,
} from './src/recording.ts';
import { DEFAULTS, normalize, type Settings, type ShortcutKey } from './src/settings.ts';

const OVERLAY = 'overlay', SETTINGS = 'settings', HUD = 'rec-hud', BORDER = 'rec-border', COUNTDOWN = 'rec-countdown', REVIEW = 'rec-review';
const OSASCRIPT = '/usr/bin/osascript', SCREENCAPTURE = '/usr/sbin/screencapture', OPEN = '/usr/bin/open';
const PRIVACY_URL: Record<'screen' | 'mic' | 'camera' | 'input', string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
};
const NETDISK = 'app.medeo.netdisk';

let root = '', dir = '', settingsFile = '';
let settings: Settings = DEFAULTS;
let errors: SettingsState['errors'] = {};
let registered: Record<string, string> = {};
let overlayReady = false;
let pending: { shot: Shot; chunks: string[] } | null = null;
let current: { seq: number; at: number; display: { x: number; y: number; width: number; height: number; scale: number; displayId: number; refreshRate: number } } | null = null;
let results: { seq: number; action: Action; mime: string; rect?: Rect; parts: string[]; total: number } | null = null;
let seq = 0;
let posts: Promise<unknown> = Promise.resolve();
let queue: Promise<unknown> = Promise.resolve();

let lastDevices: CaptureDevicesResult | null = null;
let ffmpegBin: string | null = null;
let pinSeq = 0;
const pins = new Map<string, { png: Buffer; payload: PinPayload }>();

// Active recording runtime state
interface ActiveRecording {
  id: string;
  config: RecordingConfig;
  issueMode: boolean;
  region: WindowBounds;
  display: WindowBounds;
  micMuted: boolean;
  sysMuted: boolean;
  paused: boolean;
  hudState: HudState;
  borderState: BorderState;
  pollTimer: ReturnType<typeof setInterval> | null;
}
let activeRec: ActiveRecording | null = null;
let countdownCancel: (() => void) | null = null;
let latestCountdown: { secondsLeft: number; fps: number } | null = null;
let reviewRecordId: string | null = null;
let reviewIssueMode = false;
let reviewBusy: string | null = null;

interface ExportJob {
  id: string;
  kind: 'save-mp4' | 'save-gif' | 'copy-file' | 'drive' | 'drive-to' | 'issue-pack';
  tempDir: string;
  rawFile: string;
  trimStart?: number;
  trimEnd?: number;
  telemetryText?: string;
  writes: Promise<void>;
}
const exportJobs = new Map<string, ExportJob>();

const run = (cmd: string, args: string[], timeout = 15_000) => new Promise<string>((ok, no) =>
  execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (error, stdout, stderr) => error ? no(new Error(String(stderr || error.message).trim())) : ok(String(stdout))));
const helper = (...args: string[]) => run(OSASCRIPT, ['-l', 'JavaScript', path.join(root, 'resources/helper.js'), ...args], 120_000);
/** Messages go out one at a time so chunks arrive in order. */
const post = (m: ToWindow) => { const next = posts.then(() => channel.post(m)).catch(error => console.warn('post failed:', String(error))); posts = next; return next; };
const serial = <T>(task: () => Promise<T>) => { const next = queue.then(task); queue = next.catch(error => console.error('screenshot failed:', error)); return next; };
const label = (key: string, params: Record<string, string | number> = {}) => i18n.t(key, params).catch(() => key);
const saveDir = () => expandHome(settings.saveDir, os.homedir(), expandHome(DEFAULTS.saveDir, os.homedir(), os.homedir()));

function detectFfmpeg(): string | null {
  for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------- capturing (screenshot + record entry)
async function permissionMissing(): Promise<boolean> {
  const status = await captureV2.status(false).catch(() => null);
  const value = status?.os?.screen_capture;
  return value === 'denied' || value === 'not_granted' || value === 'restricted';
}

async function fetchDevices(refresh = false): Promise<CaptureDevicesResult | null> {
  try {
    let res = await captureV2.devices(refresh);
    for (let i = 0; i < 20 && res?.status === 'loading'; i++) {
      await new Promise(r => setTimeout(r, 150));
      res = await captureV2.devices(false);
    }
    if (res?.status === 'ready') {
      lastDevices = res;
      void post({ type: 'devices', devices: res });
      return res;
    }
  } catch (error) {
    console.warn('capture.devices unavailable:', String(error));
  }
  return lastDevices;
}

async function shoot(mode: Mode, delay = 0) {
  if (activeRec) {
    // Pressing record shortcut while recording stops it gracefully.
    if (mode === 'record' || mode === 'record-issue') {
      await stopRecording(false);
      return;
    }
  }
  // A capture already on screen: a second press is ignored (Esc in the overlay cancels).
  if (current && Date.now() - current.at < 10 * 60_000) {
    const open = await windowsV2.list().catch(() => []);
    if (open.some(w => w.id === OVERLAY && w.visible)) return;
  }
  const t0 = Date.now();
  if (await permissionMissing()) { console.info('screen recording not granted: opening settings'); await openSettings(); return; }
  if (delay) await new Promise(r => setTimeout(r, delay));
  const info = JSON.parse(await helper('screen')) as {
    display: { x: number; y: number; width: number; height: number; scale: number; displayId?: number; refreshRate?: number };
    windows: Shot['windows'];
  };
  const d = {
    x: info.display.x,
    y: info.display.y,
    width: info.display.width,
    height: info.display.height,
    scale: info.display.scale,
    displayId: info.display.displayId ?? 0,
    refreshRate: info.display.refreshRate ?? 60,
  };
  const file = path.join(dir, `capture-${process.pid}.png`);
  try {
    await run(SCREENCAPTURE, ['-x', '-t', 'png', '-R', `${d.x},${d.y},${d.width},${d.height}`, file]);
  } catch (error) {
    console.error('screencapture failed:', error);
    if (/could not create image/i.test(String(error))) { await openSettings(); return; }
    await notify('error.capture');
    return;
  }
  const png = await readFile(file); await rm(file, { force: true });
  const t1 = Date.now();
  if (mode === 'record' || mode === 'record-issue') {
    void fetchDevices(true);
  }
  const shot: Shot = {
    seq: ++seq,
    mode,
    width: d.width,
    height: d.height,
    scale: d.scale,
    displayId: d.displayId,
    displayOrigin: { x: d.x, y: d.y },
    refreshRate: d.refreshRate,
    windows: info.windows,
    output: { format: settings.format, downscale: settings.downscale, enter: settings.enterAction, drive: settings.showDrive },
    recording: settings.recording,
    devices: lastDevices,
  };
  const chunks = split(png.toString('base64'));
  current = { seq: shot.seq, at: Date.now(), display: d };
  results = null;
  const open = await windowsV2.list().catch(() => []);
  if (!open.some(w => w.id === OVERLAY)) overlayReady = false;
  await windowsV2.open({ id: OVERLAY, entry: 'ui/index.html', title: await label('plugin.name'), width: d.width, height: d.height, overlay: true });
  if (overlayReady) await send(shot, chunks); else pending = { shot, chunks };
  console.info(`capture #${shot.seq} ${mode}: ${d.width}x${d.height}@${d.scale} ${d.refreshRate}Hz ${Math.round(png.length / 1024)} KiB, in ${t1 - t0 - delay} ms`);
}

async function send(shot: Shot, chunks: string[]) {
  await post({ type: 'shot', shot, parts: chunks.length });
  for (let i = 0; i < chunks.length; i++) await post({ type: 'chunk', seq: shot.seq, i, data: chunks[i] });
}

// ---------------------------------------------------------------- screenshot finish + Pin to Screen
async function finished(r: { seq: number; action: Action; mime: string; rect?: Rect; parts: string[] }) {
  const png = Buffer.from(r.parts.join(''), 'base64');
  console.info(`capture #${r.seq} ${r.action}: ${Math.round(png.length / 1024)} KiB ${r.mime}`);
  if (r.action === 'ocr') { await recognize(r.seq, png); return; }
  const display = current?.display;
  current = null;
  if (r.action === 'pin') {
    await openPinWindow(png, r.rect, display);
    return;
  }
  if (r.action === 'copy') {
    await copyPng(png);
    return;
  }
  if (r.action === 'drive' || r.action === 'drive-to') { void toDriveImage(png, r.action === 'drive-to'); return; }
  await saveImage(png, r.mime);
}

async function openPinWindow(
  png: Buffer,
  rect?: Rect,
  display?: { x: number; y: number; width: number; height: number },
) {
  const id = `pin-${++pinSeq}`;
  const w = Math.max(120, Math.min(1200, Math.round(rect?.w ?? 420)));
  const h = Math.max(80, Math.min(900, Math.round(rect?.h ?? 280)));
  const x = Math.round((display?.x ?? 100) + (rect?.x ?? 100));
  const y = Math.round((display?.y ?? 100) + (rect?.y ?? 100));
  const payload: PinPayload = { id, dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: w, height: h };
  pins.set(id, { png, payload });
  await windowsV2.open({
    id,
    entry: `ui/pin.html?id=${encodeURIComponent(id)}`,
    title: await label('action.pin'),
    width: w,
    height: h,
    panel: true,
    hide_on_blur: false,
    focusable: true,
    movable: true,
    resizable: true,
    bounds: { x, y, width: w, height: h },
    opacity: 1,
  });
}

async function copyPng(png: Buffer) {
  const file = path.join(dir, `copy-${process.pid}.png`);
  await writeFile(file, png);
  try {
    const out = (await helper('copy', file)).trim();
    if (out !== 'ok') throw new Error(out);
  } catch (error) { console.error('copy failed:', error); await notify('error.copy'); }
  finally { await rm(file, { force: true }); }
}

async function saveImage(png: Buffer, mime: string) {
  const target = saveDir();
  try {
    await mkdir(target, { recursive: true });
    const name = fileName('Medeo', new Date(), n => existsSync(path.join(target, n)), mime === 'image/jpeg' ? 'jpg' : 'png');
    const file = path.join(target, name);
    await writeFile(file, png, { flag: 'wx' });
    if (settings.openAfterSave) await run(OPEN, ['-R', file]).catch(() => {});
    await notifications.show('saved', await label('notify.saved.title'), await label('notify.saved.body', { name, folder: target })).catch(() => {});
  } catch (error) {
    console.error('save failed:', error);
    await notify('error.save', { folder: target });
  }
}

async function toDriveImage(png: Buffer, choose: boolean) {
  const folder = await mkdtemp(path.join(dir, 'drive-'));
  const name = fileName(await label('drive.prefix'), new Date(), () => false, 'png');
  const file = path.join(folder, name);
  try {
    await writeFile(file, png);
    const answer = await plugins.run<{ ok?: boolean; cancelled?: boolean; error?: string }>(NETDISK, choose ? 'netdisk.store-to' : 'netdisk.store', { input: { type: 'image', value: file, title: name } });
    if (!answer?.ok && !answer?.cancelled && !answer?.error) await notify('error.drive');
  } catch (error) {
    console.error('store to drive failed:', error);
    await notify('error.drive');
  } finally { await rm(folder, { recursive: true, force: true }); }
}

async function recognize(seqNo: number, png: Buffer) {
  const file = path.join(dir, `ocr-${process.pid}.png`);
  let result: { text: string; codes: string[] } | null = null;
  try {
    await writeFile(file, png);
    const raw = JSON.parse(await helper('ocr', file)) as { lines: { t: string; x: number; y: number; h: number }[]; codes: string[] };
    result = { text: joinLines(raw.lines), codes: raw.codes };
  } catch (error) { console.error('ocr failed:', error); }
  finally { await rm(file, { force: true }); }
  await post({ type: 'ocr', seq: seqNo, result });
}

async function copyText(text: string) {
  const file = path.join(dir, `text-${process.pid}.txt`);
  try { await writeFile(file, text.slice(0, 1 << 20)); if ((await helper('copy-text', file)).trim() !== 'ok') throw new Error('copy failed'); }
  catch (error) { console.error('copy text failed:', error); await notify('error.copy'); }
  finally { await rm(file, { force: true }); }
}

// ---------------------------------------------------------------- 120Hz Screen Recording lifecycle
async function runCountdown(seconds: number, fps: number, display: WindowBounds): Promise<boolean> {
  if (seconds <= 0) return true;
  let cancelled = false;
  const bounds: WindowBounds = {
    x: Math.round(display.x + display.width / 2 - 110),
    y: Math.round(display.y + display.height / 2 - 110),
    width: 220,
    height: 220,
  };
  latestCountdown = { secondsLeft: seconds, fps };
  await windowsV2.open({
    id: COUNTDOWN,
    entry: 'ui/countdown.html',
    title: await label('rec.countdown.title'),
    width: bounds.width,
    height: bounds.height,
    panel: true,
    transparent: true,
    hide_on_blur: false,
    exclude_from_capture: true,
    focusable: true,
    bounds,
  }).catch(() => {});

  const ok = await new Promise<boolean>(resolve => {
    let remaining = seconds;
    const finish = (v: boolean) => {
      clearInterval(timer);
      countdownCancel = null;
      latestCountdown = null;
      resolve(v);
    };
    countdownCancel = () => { cancelled = true; finish(false); };
    void post({ type: 'countdown-state', state: { secondsLeft: remaining, fps } });
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { finish(true); return; }
      latestCountdown = { secondsLeft: remaining, fps };
      void post({ type: 'countdown-state', state: { secondsLeft: remaining, fps } });
    }, 1000);
  });
  await windowsV2.close(COUNTDOWN).catch(() => {});
  return ok && !cancelled;
}

async function resolveDisplaySourceId(displayId: number): Promise<string | null> {
  let src = await captureV2.sources(true, false);
  for (let i = 0; i < 30 && src.status === 'loading'; i++) {
    await new Promise(r => setTimeout(r, 150));
    src = await captureV2.sources(false, false);
  }
  if (src.status !== 'ready' || !src.sources.length) return null;
  const exact = src.sources.find(s => s.display_id && s.display_id === displayId);
  if (exact) return exact.id;
  // Fallback to first display source (or first source)
  const firstDisplay = src.sources.find(s => s.display_id !== undefined);
  return (firstDisplay ?? src.sources[0]).id;
}

async function startRecording(localRect: Rect, rawConfig: RecordingConfig, issueMode: boolean) {
  if (activeRec) return;
  const displayInfo = current?.display ?? { x: 0, y: 0, width: 1440, height: 900, scale: 2, displayId: 0, refreshRate: 60 };
  current = null;
  const cfg = normalizeRecordingConfig(rawConfig);
  await setSettings({ recording: cfg });

  const displayBounds: WindowBounds = {
    x: displayInfo.x,
    y: displayInfo.y,
    width: displayInfo.width,
    height: displayInfo.height,
  };
  const globalRegion: WindowBounds = {
    x: Math.round(displayInfo.x + localRect.x),
    y: Math.round(displayInfo.y + localRect.y),
    width: Math.max(16, Math.round(localRect.w)),
    height: Math.max(16, Math.round(localRect.h)),
  };

  // Show click-through, capture-excluded border frame around selection during countdown & recording.
  const borderBounds = computeBorderBounds(globalRegion, displayBounds, 4);
  const initialBorder: BorderState = {
    status: cfg.countdown > 0 ? 'countdown' : 'recording',
    label: cfg.countdown > 0 ? await label('rec.countdown.title') : 'REC',
    fps: cfg.fps,
    width: globalRegion.width,
    height: globalRegion.height,
  };
  await windowsV2.open({
    id: BORDER,
    entry: 'ui/border.html',
    title: 'Recording Border',
    width: borderBounds.width,
    height: borderBounds.height,
    panel: true,
    transparent: true,
    click_through: true,
    focusable: false,
    hide_on_blur: false,
    exclude_from_capture: true,
    movable: false,
    resizable: false,
    bounds: borderBounds,
  }).catch(err => console.warn('border window open failed:', String(err)));
  await post({ type: 'border-state', state: initialBorder });

  if (cfg.countdown > 0) {
    const proceed = await runCountdown(cfg.countdown, cfg.fps, displayBounds);
    if (!proceed) {
      await windowsV2.close(BORDER).catch(() => {});
      return;
    }
  }

  try {
    const sourceId = await resolveDisplaySourceId(displayInfo.displayId);
    if (!sourceId) {
      await windowsV2.close(BORDER).catch(() => {});
      await notify('rec.error.noSource');
      return;
    }
    const startArgs = buildStartPayload(sourceId, localRect, displayInfo, cfg);
    const res = await captureV2.start(startArgs);
    if (!res?.id || res.cancelled) {
      await windowsV2.close(BORDER).catch(() => {});
      return;
    }

    const hudState: HudState = {
      id: res.id,
      status: 'starting',
      paused: false,
      durationMs: 0,
      bytes: 0,
      targetFps: cfg.fps,
      droppedFrames: 0,
      micLevel: 0,
      sysLevel: 0,
      micEnabled: cfg.microphone.enabled,
      sysEnabled: cfg.systemAudio.enabled,
      micMuted: false,
      sysMuted: false,
      cameraEnabled: cfg.camera.enabled,
      cameraFallback: false,
      clicksEnabled: cfg.clicks.enabled,
      keystrokesEnabled: cfg.keystrokes.enabled,
      telemetryEvents: 0,
      issueMode,
    };
    const borderState: BorderState = {
      status: 'recording',
      label: issueMode ? 'ISSUE REC' : 'REC',
      fps: cfg.fps,
      width: globalRegion.width,
      height: globalRegion.height,
    };

    activeRec = {
      id: res.id,
      config: cfg,
      issueMode,
      region: globalRegion,
      display: displayBounds,
      micMuted: false,
      sysMuted: false,
      paused: false,
      hudState,
      borderState,
      pollTimer: null,
    };

    const hudBounds = computeHudBounds(globalRegion, displayBounds);
    await windowsV2.open({
      id: HUD,
      entry: 'ui/hud.html',
      title: 'Recording HUD',
      width: hudBounds.width,
      height: hudBounds.height,
      panel: true,
      transparent: true,
      focusable: false,
      hide_on_blur: false,
      exclude_from_capture: true,
      movable: true,
      resizable: false,
      bounds: hudBounds,
    }).catch(err => console.warn('hud window open failed:', String(err)));

    await post({ type: 'border-state', state: borderState });
    await post({ type: 'hud-state', state: hudState });
    await showTray().catch(() => {});

    activeRec.pollTimer = setInterval(() => {
      void pollActiveRecording();
    }, 300);
  } catch (error) {
    console.error('capture.start failed:', error);
    await windowsV2.close(BORDER).catch(() => {});
    await windowsV2.close(HUD).catch(() => {});
    await notify('rec.error.start', { error: String(error) });
  }
}

async function pollActiveRecording() {
  const rec = activeRec;
  if (!rec) return;
  const st = await captureV2.state().catch(() => null);
  const row = st?.records?.find(r => r.id === rec.id);
  if (!row) return;

  rec.paused = Boolean(row.paused);
  rec.hudState = {
    ...rec.hudState,
    status: row.status,
    paused: rec.paused,
    durationMs: row.duration_ms ?? 0,
    bytes: row.bytes ?? 0,
    targetFps: row.target_fps ?? rec.config.fps,
    actualFps: row.actual_fps,
    droppedFrames: row.dropped_frames ?? 0,
    codec: row.codec,
    micLevel: row.mic_level ?? 0,
    sysLevel: row.sys_level ?? 0,
    cameraFallback: Boolean(row.camera_fallback),
    telemetryEvents: row.telemetry_events ?? 0,
  };
  rec.borderState = {
    ...rec.borderState,
    status: rec.paused ? 'paused' : 'recording',
    label: rec.paused ? 'PAUSED' : rec.issueMode ? 'ISSUE REC' : 'REC',
  };
  void post({ type: 'hud-state', state: rec.hudState });
  void post({ type: 'border-state', state: rec.borderState });

  if (!row.active && row.status !== 'starting' && row.status !== 'recording' && row.status !== 'stopping') {
    await teardownActiveRecording(row, rec.issueMode);
  }
}

async function stopRecording(cancel: boolean) {
  const rec = activeRec;
  if (!rec) return;
  try {
    if (cancel) await captureV2.cancel(rec.id);
    else await captureV2.stop(rec.id);
  } catch (error) {
    console.error('capture stop/cancel failed:', error);
  }
}

async function teardownActiveRecording(finalRow: CaptureRecordV2, issueMode: boolean) {
  const rec = activeRec;
  if (!rec) return;
  if (rec.pollTimer) clearInterval(rec.pollTimer);
  activeRec = null;
  await windowsV2.close(HUD).catch(() => {});
  await windowsV2.close(BORDER).catch(() => {});
  await showTray().catch(() => {});

  if (finalRow.status === 'cancelled') return;
  if (!finalRow.playable) {
    await notify('rec.error.failed', { error: finalRow.error ?? 'unknown' });
    return;
  }
  reviewRecordId = finalRow.id;
  reviewIssueMode = issueMode;
  await openReview(finalRow.id);
}

// ---------------------------------------------------------------- Post-recording Review & Export
async function openReview(recordId?: string) {
  if (recordId) reviewRecordId = recordId;
  await windowsV2.open({
    id: REVIEW,
    entry: 'ui/review.html',
    title: await label('review.title'),
    width: 980,
    height: 680,
    resizable: true,
    movable: true,
  });
  await windowsV2.focus(REVIEW).catch(() => {});
  await pushReviewState();
}

async function pushReviewState() {
  const st = await captureV2.state().catch(() => ({ records: [] as CaptureRecordV2[] }));
  const playable = (st.records ?? []).filter(r => r.playable);
  const active = (reviewRecordId ? playable.find(r => r.id === reviewRecordId) : null) ?? playable[0] ?? null;
  reviewRecordId = active?.id ?? null;
  const reviewState: ReviewState = {
    activeRecord: active,
    history: playable.slice(0, 30),
    config: settings.recording,
    issueMode: reviewIssueMode,
    saveDir: saveDir(),
    ffmpegAvailable: Boolean(ffmpegBin),
    busyAction: reviewBusy,
  };
  await post({ type: 'review-state', state: reviewState });
}

async function finalizeReviewExport(job: ExportJob, ok: boolean) {
  try {
    await job.writes;
    if (!ok) return;
    reviewBusy = job.kind;
    await pushReviewState();

    const st = await captureV2.state().catch(() => ({ records: [] as CaptureRecordV2[] }));
    const rec = st.records.find(r => r.id === job.id);
    const targetDir = saveDir();
    await mkdir(targetDir, { recursive: true });

    const needsTrim = job.trimStart !== undefined && job.trimEnd !== undefined && job.trimEnd > job.trimStart + 0.1;
    let outputFile = job.rawFile;

    if (job.kind === 'save-gif') {
      if (!ffmpegBin) throw new Error('ffmpeg_unavailable');
      const gifName = fileName('Medeo_Rec', new Date(), n => existsSync(path.join(targetDir, n)), 'gif');
      const gifPath = path.join(targetDir, gifName);
      const trimArgs = needsTrim ? ['-ss', String(job.trimStart!.toFixed(2)), '-to', String(job.trimEnd!.toFixed(2))] : [];
      const vf = 'fps=20,scale=min(1280\\,iw):-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer';
      await run(ffmpegBin, ['-y', ...trimArgs, '-i', job.rawFile, '-vf', vf, gifPath], 180_000);
      if (settings.openAfterSave) await run(OPEN, ['-R', gifPath]).catch(() => {});
      await post({ type: 'review-toast', tone: 'success', message: await label('review.toast.saved', { name: gifName }) });
      return;
    }

    if (needsTrim && ffmpegBin) {
      const trimmed = path.join(job.tempDir, 'trimmed.mp4');
      await run(ffmpegBin, [
        '-y',
        '-ss', String(job.trimStart!.toFixed(2)),
        '-to', String(job.trimEnd!.toFixed(2)),
        '-i', job.rawFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        trimmed,
      ], 120_000);
      outputFile = trimmed;
    }

    if (job.kind === 'save-mp4') {
      const name = fileName('Medeo_Rec', new Date(), n => existsSync(path.join(targetDir, n)), 'mp4');
      const dest = path.join(targetDir, name);
      await copyFile(outputFile, dest);
      if (settings.openAfterSave) await run(OPEN, ['-R', dest]).catch(() => {});
      await post({ type: 'review-toast', tone: 'success', message: await label('review.toast.saved', { name }) });
    } else if (job.kind === 'copy-file') {
      const name = fileName('Medeo_Rec', new Date(), n => existsSync(path.join(targetDir, n)), 'mp4');
      const dest = path.join(targetDir, name);
      await copyFile(outputFile, dest);
      const res = (await helper('copy-file', dest)).trim();
      if (res !== 'ok') throw new Error(res);
      await post({ type: 'review-toast', tone: 'success', message: await label('review.toast.copiedFile') });
    } else if (job.kind === 'drive' || job.kind === 'drive-to') {
      const name = fileName('Medeo_Rec', new Date(), () => false, 'mp4');
      const staged = path.join(job.tempDir, name);
      if (outputFile !== staged) await copyFile(outputFile, staged);
      const answer = await plugins.run<{ ok?: boolean; cancelled?: boolean; error?: string }>(
        NETDISK,
        job.kind === 'drive-to' ? 'netdisk.store-to' : 'netdisk.store',
        { input: { type: 'file', value: staged, title: name } },
      );
      if (answer?.ok) {
        await post({ type: 'review-toast', tone: 'success', message: await label('review.toast.driveOk') });
      } else if (!answer?.cancelled) {
        await post({ type: 'review-toast', tone: 'error', message: await label('error.drive') });
      }
    } else if (job.kind === 'issue-pack') {
      const bundleName = `Medeo_Issue_${stamp(new Date())}`;
      const bundleDir = path.join(targetDir, bundleName);
      await mkdir(bundleDir, { recursive: true });
      const mp4Dest = path.join(bundleDir, 'capture.mp4');
      await copyFile(outputFile, mp4Dest);
      if (job.telemetryText) {
        await writeFile(path.join(bundleDir, 'telemetry.jsonl'), job.telemetryText, 'utf8');
      }
      if (rec) {
        const summary = buildIssueSummary(rec, settings.recording);
        await writeFile(path.join(bundleDir, 'issue-meta.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
        const md = [
          `### Medeo Issue Recording (${bundleName})`,
          `- **Duration**: ${formatDuration(rec.duration_ms)}`,
          `- **Video**: ${rec.width ?? '?'}×${rec.height ?? '?'} @ ${rec.actual_fps ? Math.round(rec.actual_fps) : rec.target_fps ?? settings.recording.fps}fps (${(rec.codec ?? 'auto').toUpperCase()}, dropped: ${rec.dropped_frames ?? 0})`,
          `- **Telemetry**: ${rec.telemetry_events ?? 0} events (clicks=${settings.recording.clicks.enabled}, keystrokes=${settings.recording.keystrokes.enabled})`,
          `- **Local bundle**: \`${bundleDir}\``,
        ].join('\n');
        await copyText(md);
      }
      await run(OPEN, ['-R', bundleDir]).catch(() => {});
      await post({ type: 'review-toast', tone: 'success', message: await label('review.toast.issuePacked', { name: bundleName }) });
    }
  } catch (error) {
    console.error('review export failed:', error);
    await post({ type: 'review-toast', tone: 'error', message: await label('review.exportFailed') });
  } finally {
    reviewBusy = null;
    await rm(job.tempDir, { recursive: true, force: true }).catch(() => {});
    await pushReviewState();
  }
}

async function notify(key: string, params: Record<string, string | number> = {}) {
  await notifications.show('error', await label('notify.error.title'), await label(key, params)).catch(() => {});
}

// ---------------------------------------------------------------- settings, shortcuts, menu bar
async function loadSettings() {
  try { settings = normalize(JSON.parse(await readFile(settingsFile, 'utf8'))); } catch { settings = DEFAULTS; }
}

async function setSettings(patch: Partial<Settings>) {
  settings = normalize({ ...settings, ...patch });
  await writeFile(settingsFile, JSON.stringify(settings));
  await registerShortcuts();
  await pushSettings();
}

const pushSettings = () => post({ type: 'settings', state: { settings, saveDir: saveDir(), errors } });

/** Shortcut id (as registered) ↔ settings key ↔ capture mode. */
const MODES: Record<string, { key: ShortcutKey; mode: Mode }> = {
  area: { key: 'shortcutArea', mode: 'area' },
  record: { key: 'shortcutRecord', mode: 'record' },
  'record-issue': { key: 'shortcutRecordIssue', mode: 'record-issue' },
  full: { key: 'shortcutFull', mode: 'full' },
  quick: { key: 'shortcutQuick', mode: 'quick' },
  ocr: { key: 'shortcutOcr', mode: 'ocr' },
};

async function registerShortcuts() {
  const wanted: Record<string, string | null> = Object.fromEntries(Object.entries(MODES).map(([id, m]) => [id, settings[m.key]]));
  errors = {};
  for (const old of ['capture', 'save']) if (registered[old]) { await shortcuts.unregister(old).catch(() => {}); delete registered[old]; }
  for (const [id, accelerator] of Object.entries(wanted)) {
    if (registered[id] && registered[id] !== accelerator) { await shortcuts.unregister(id).catch(() => {}); delete registered[id]; }
    if (!accelerator || registered[id] === accelerator) continue;
    try { await shortcuts.register(id, accelerator, false); registered[id] = accelerator; }
    catch (error) {
      console.error(`shortcut ${accelerator} failed:`, error);
      errors[MODES[id].key] = /permission/.test(String(error)) ? 'permission' : 'taken';
    }
  }
}

async function showTray() {
  if (activeRec) {
    await tray.set('●', [
      { id: 'tray.rec-stop', title: await label('tray.recStop') },
      { id: 'tray.rec-pause', title: await label(activeRec.paused ? 'hud.resume' : 'hud.pause') },
      { separator: true },
      { id: 'tray.rec-cancel', title: await label('hud.cancel') },
    ], { icon: 'resources/trayTemplate.png', click: 'tray.rec-stop' });
    return;
  }
  await tray.set('', [
    { id: 'tray.area', title: await label('tray.area') },
    { id: 'tray.record', title: await label('tray.record') },
    { id: 'tray.record-issue', title: await label('tray.recordIssue') },
    { separator: true },
    { id: 'tray.full', title: await label('tray.full') },
    { id: 'tray.quick', title: await label('tray.quick') },
    { id: 'tray.ocr', title: await label('tray.ocr') },
    { separator: true },
    { id: 'tray.history', title: await label('tray.history') },
    { id: 'tray.folder', title: await label('tray.folder') },
    { id: 'tray.settings', title: await label('tray.settings') },
  ], { icon: 'resources/trayTemplate.png', click: 'tray.area' });
}

async function openSettings() {
  await windowsV2.open({ id: SETTINGS, entry: 'ui/settings.html', title: await label('settings.title'), width: 600, height: 680 });
  await windowsV2.focus(SETTINGS).catch(() => {});
  await pushSettings();
}

async function revealFolder() {
  const target = saveDir();
  await mkdir(target, { recursive: true }).catch(() => {});
  await run(OPEN, [target]).catch(error => console.error('open folder failed:', error));
}

async function chooseFolder() {
  const picked = (await helper('choose-folder', await label('save.choose'), saveDir()).catch(() => '')).trim();
  if (!picked) return;
  const home = os.homedir();
  await setSettings({ saveDir: picked === home || picked.startsWith(home + '/') ? '~' + picked.slice(home.length).replace(/\/$/, '') : picked.replace(/\/$/, '') });
  await post({ type: 'toast', tone: 'success', key: 'save.changed' });
}

// ---------------------------------------------------------------- messages from windows
function onMessage(m: FromWindow) {
  switch (m?.type) {
    case 'overlay-ready':
      console.info('overlay ready');
      overlayReady = true;
      if (pending) { const p = pending; pending = null; void send(p.shot, p.chunks); }
      break;
    case 'result': {
      if (!current || m.seq !== current.seq) return;
      if (!results || results.seq !== m.seq || results.action !== m.action) {
        results = { seq: m.seq, action: m.action, mime: m.mime, rect: m.rect, parts: [], total: m.parts };
      }
      if (m.rect && !results.rect) results.rect = m.rect;
      results.parts[m.i] = m.data;
      if (results.parts.filter(p => p !== undefined).length === results.total) {
        const r = results; results = null;
        void serial(() => finished(r));
      }
      break;
    }
    case 'cancel':
      console.info(`capture #${m.seq} cancelled`);
      if (current && m.seq === current.seq) { current = null; pending = null; }
      break;
    case 'copy-text': if (typeof m.text === 'string') void serial(() => copyText(m.text)); break;
    case 'open-url': if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) void run(OPEN, [m.url]).catch(() => {}); break;
    case 'hide-drive': void serial(() => setSettings({ showDrive: false })); break;
    case 'refresh-devices': void fetchDevices(true); break;
    case 'update-recording-config': void serial(() => setSettings({ recording: normalizeRecordingConfig(m.config) })); break;
    case 'open-privacy-pane': void run(OPEN, [PRIVACY_URL[m.pane] ?? PRIVACY_URL.screen]).catch(() => {}); break;
    case 'start-recording': void serial(() => startRecording(m.rect, m.config, m.issueMode)); break;

    // HUD controls
    case 'hud-ready':
      if (activeRec) void post({ type: 'hud-state', state: activeRec.hudState });
      break;
    case 'hud-pause':
      if (activeRec) void captureV2.pause(activeRec.id).then(() => { if (activeRec) { activeRec.paused = true; void showTray(); } }).catch(() => {});
      break;
    case 'hud-resume':
      if (activeRec) void captureV2.resume(activeRec.id).then(() => { if (activeRec) { activeRec.paused = false; void showTray(); } }).catch(() => {});
      break;
    case 'hud-stop': void stopRecording(false); break;
    case 'hud-cancel': void stopRecording(true); break;
    case 'hud-toggle-mic':
      if (activeRec) {
        activeRec.micMuted = !activeRec.micMuted;
        activeRec.hudState.micMuted = activeRec.micMuted;
        void captureV2.setAudio(activeRec.id, { microphoneMuted: activeRec.micMuted }).catch(() => {});
        void post({ type: 'hud-state', state: activeRec.hudState });
      }
      break;
    case 'hud-toggle-sys':
      if (activeRec) {
        activeRec.sysMuted = !activeRec.sysMuted;
        activeRec.hudState.sysMuted = activeRec.sysMuted;
        void captureV2.setAudio(activeRec.id, { systemAudioMuted: activeRec.sysMuted }).catch(() => {});
        void post({ type: 'hud-state', state: activeRec.hudState });
      }
      break;

    // Border & Countdown
    case 'border-ready':
      if (activeRec) void post({ type: 'border-state', state: activeRec.borderState });
      break;
    case 'countdown-ready':
      if (latestCountdown) void post({ type: 'countdown-state', state: latestCountdown });
      break;
    case 'countdown-cancel':
      countdownCancel?.();
      break;

    // Pin window
    case 'pin-ready': {
      const entry = pins.get(m.id);
      if (entry) void post({ type: 'pin-data', pin: entry.payload });
      break;
    }
    case 'pin-close':
      pins.delete(m.id);
      void windowsV2.close(m.id).catch(() => {});
      break;
    case 'pin-copy': {
      const entry = pins.get(m.id);
      if (entry) void serial(() => copyPng(entry.png));
      break;
    }
    case 'pin-save': {
      const entry = pins.get(m.id);
      if (entry) void serial(() => saveImage(entry.png, 'image/png'));
      break;
    }

    // Review studio
    case 'review-ready': void pushReviewState(); break;
    case 'review-select': reviewRecordId = m.id; void pushReviewState(); break;
    case 'review-reveal': void captureV2.open(m.id, 'reveal').catch(() => {}); break;
    case 'review-record-new':
      void serial(async () => {
        await windowsV2.hide(REVIEW).catch(() => {});
        await shoot(m.issueMode ? 'record-issue' : 'record', 250);
      });
      break;
    case 'review-export-start': {
      const p = (async () => {
        const tempDir = await mkdtemp(path.join(dir, 'export-'));
        const rawFile = path.join(tempDir, 'capture.mp4');
        await writeFile(rawFile, Buffer.alloc(0));
        exportJobs.set(m.jobId, {
          id: m.id,
          kind: m.kind,
          tempDir,
          rawFile,
          trimStart: m.trimStart,
          trimEnd: m.trimEnd,
          telemetryText: m.telemetryText,
          writes: Promise.resolve(),
        });
      })();
      void p.catch(err => console.error('export start failed:', err));
      break;
    }
    case 'review-export-chunk': {
      const job = exportJobs.get(m.jobId);
      if (job) {
        const buf = Buffer.from(m.data, 'base64');
        job.writes = job.writes.then(() => appendFile(job.rawFile, buf));
      }
      break;
    }
    case 'review-export-end': {
      const job = exportJobs.get(m.jobId);
      exportJobs.delete(m.jobId);
      if (job) void serial(() => finalizeReviewExport(job, m.ok));
      break;
    }

    // Settings
    case 'settings-ready': void pushSettings(); break;
    case 'set': void serial(() => setSettings(m.patch)); break;
    case 'choose-folder': void serial(chooseFolder); break;
    case 'reveal-folder': void revealFolder().catch(() => {}); break;
    case 'open-privacy': void run(OPEN, [PRIVACY_URL[m.pane ?? 'screen']]).catch(() => {}); break;
    case 'capture': void serial(async () => { await windowsV2.hide(SETTINGS).catch(() => {}); await shoot('area', 250); }); break;
    case 'record': void serial(async () => { await windowsV2.hide(SETTINGS).catch(() => {}); await shoot('record', 250); }); break;
  }
}

export const { activate, deactivate } = definePlugin({
  activate(context) {
    root = context.extensionPath!; dir = context.storagePath!; settingsFile = path.join(dir, 'settings.json');
    ffmpegBin = detectFfmpeg();
    let started: Promise<void> | null = null;
    const ready = () => started ??= (async () => {
      await mkdir(dir, { recursive: true });
      await loadSettings();
      await shortcuts.list();
      await registerShortcuts();
      await showTray().catch(error => console.error('tray failed:', error));
      void fetchDevices(false);
    })().catch(error => { started = null; throw error; });
    const later = (task: () => unknown) => { void ready().then(task).catch(error => console.warn('screenshot:', String(error))); };
    context.subscriptions.push({ dispose: channel.onMessage<FromWindow>(m => later(() => onMessage(m))) });
    context.subscriptions.push({ dispose: events.onSignal('shortcuts', () => later(async () => {
      const pressed = await shortcuts.events().catch(() => []) as { id: string }[];
      for (const p of pressed) if (MODES[p.id]) void serial(() => shoot(MODES[p.id].mode));
    })) });
    context.subscriptions.push({ dispose: events.onSignal('tray', () => later(async () => {
      const pressed = await tray.events().catch(() => []) as { id: string }[];
      for (const { id } of pressed) {
        const mode = ({
          'tray.area': 'area',
          'tray.record': 'record',
          'tray.record-issue': 'record-issue',
          'tray.full': 'full',
          'tray.quick': 'quick',
          'tray.ocr': 'ocr',
        } as Record<string, Mode>)[id];
        if (mode) void serial(() => shoot(mode, 200));
        else if (id === 'tray.rec-stop') void stopRecording(false);
        else if (id === 'tray.rec-cancel') void stopRecording(true);
        else if (id === 'tray.rec-pause' && activeRec) {
          void (activeRec.paused ? captureV2.resume(activeRec.id) : captureV2.pause(activeRec.id)).catch(() => {});
        }
        else if (id === 'tray.history') void openReview().catch(() => {});
        else if (id === 'tray.folder') void revealFolder().catch(() => {});
        else if (id === 'tray.settings') void openSettings().catch(() => {});
      }
    })) });
    context.subscriptions.push({ dispose: events.onSignal('permissions', () => later(async () => {
      await registerShortcuts();
      await showTray().catch(() => {});
      await pushSettings();
    })) });
    context.subscriptions.push({ dispose: i18n.onDidChangeLocale(() => later(() => showTray().catch(() => {}))) });

    const command = (mode: Mode) => async (args?: unknown) => {
      await ready();
      void serial(() => shoot(mode, launcher.session(args) ? 750 : 250));
      return { started: true };
    };
    context.commands.register('screenshot.capture', command('area'));
    context.commands.register('screenshot.record', command('record'));
    context.commands.register('screenshot.record-issue', command('record-issue'));
    context.commands.register('screenshot.record-stop', async () => {
      await ready();
      if (!activeRec) return { stopped: false };
      await stopRecording(false);
      return { stopped: true };
    });
    context.commands.register('screenshot.history', async () => { await ready(); await openReview(); return { opened: true }; });
    context.commands.register('screenshot.capture-full', command('full'));
    context.commands.register('screenshot.capture-quick', command('quick'));
    context.commands.register('screenshot.capture-ocr', command('ocr'));
    context.commands.register('screenshot.settings', async () => { await ready(); await openSettings(); return { opened: true }; });
    context.commands.register('screenshot.folder', async () => { await ready(); await revealFolder(); return { opened: true }; });

    void (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(r => setTimeout(r, attempt ? 1000 : 50));
        try { await ready(); return; } catch (error) { if (/denied|invalid|unsupported/.test(String(error))) { console.error('screenshot start failed:', error); return; } }
      }
    })();
  },
  deactivate() {
    if (activeRec?.pollTimer) clearInterval(activeRec.pollTimer);
    countdownCancel?.();
  },
});
