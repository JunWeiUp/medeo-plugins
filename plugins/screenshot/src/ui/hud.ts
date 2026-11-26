// Non-activating floating Recording HUD pill: live timer, real FPS / drop badge,
// Mic VU meter + mute toggle, System Audio mute toggle, Pause/Resume, Stop & Cancel.
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import type { FromHud, HudState, ToHud } from '../protocol.ts';
import { detectFpsHealth, formatDuration } from '../recording.ts';
import { svgIcon } from './icons.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromHud) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
let state: HudState | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render() {
  const root = $('hud');
  if (!state) return;
  const s = state;
  root.replaceChildren();

  const statusWrap = el('div', 'hud-status');
  const dot = el('span', `hud-dot${s.paused ? ' paused' : ''}`);
  const time = el('span', 'hud-time', formatDuration(s.durationMs));
  time.dataset.testid = 'recorder.hud.time';
  statusWrap.append(dot, time);

  if (s.issueMode) {
    statusWrap.append(el('span', 'hud-pill issue', 'ISSUE'));
  }

  const fpsHealth = detectFpsHealth(s.targetFps, s.actualFps, s.droppedFrames);
  const fpsLabel = s.actualFps && s.actualFps > 0
    ? `${Math.round(s.actualFps)}/${s.targetFps}fps`
    : `${s.targetFps}Hz`;
  const fpsPill = el('span', `hud-pill fps ${fpsHealth}`, fpsLabel);
  fpsPill.dataset.testid = 'recorder.hud.fps';
  fpsPill.title = s.droppedFrames > 0
    ? tr('hud.dropped', { n: s.droppedFrames })
    : `${s.codec ? s.codec.toUpperCase() + ' · ' : ''}${fpsLabel}`;
  statusWrap.append(fpsPill);

  if (s.codec) {
    statusWrap.append(el('span', 'hud-pill codec', s.codec.toUpperCase()));
  }

  const meters = el('div', 'hud-meters');
  if (s.micEnabled) {
    const micBtn = el('button', `hud-icon-btn${s.micMuted ? ' muted' : ' active'}`);
    micBtn.dataset.testid = 'recorder.hud.mic';
    micBtn.title = tr(s.micMuted ? 'hud.mic.unmute' : 'hud.mic.mute');
    micBtn.setAttribute('aria-label', micBtn.title);
    const vu = el('span', 'hud-vu');
    const fill = el('span', 'hud-vu-fill');
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, s.micMuted ? 0 : s.micLevel * 2.2)) * 100)}%`;
    vu.append(fill);
    micBtn.append(svgIcon(s.micMuted ? 'mic-off' : 'mic', 14), vu);
    micBtn.addEventListener('click', () => void post({ type: 'hud-toggle-mic' }));
    meters.append(micBtn);
  }
  if (s.sysEnabled) {
    const sysBtn = el('button', `hud-icon-btn${s.sysMuted ? ' muted' : ' active'}`);
    sysBtn.dataset.testid = 'recorder.hud.sys';
    sysBtn.title = tr(s.sysMuted ? 'hud.sys.unmute' : 'hud.sys.mute');
    sysBtn.setAttribute('aria-label', sysBtn.title);
    sysBtn.append(svgIcon(s.sysMuted ? 'volume-off' : 'volume', 14));
    sysBtn.addEventListener('click', () => void post({ type: 'hud-toggle-sys' }));
    meters.append(sysBtn);
  }
  if (s.cameraEnabled) {
    const camTag = el('span', `hud-pill hud-cam-pill${s.cameraFallback ? ' warn' : ' ok'}`);
    camTag.title = tr(s.cameraFallback ? 'hud.camera.fallback' : 'hud.camera.active');
    camTag.append(svgIcon(s.cameraFallback ? 'camera-off' : 'camera', 12), el('span', '', s.cameraFallback ? 'CAM!' : 'CAM'));
    meters.append(camTag);
  }

  const controls = el('div', 'hud-controls');
  const pauseBtn = el('button', 'hud-btn');
  pauseBtn.dataset.testid = 'recorder.hud.pause';
  pauseBtn.title = tr(s.paused ? 'hud.resume' : 'hud.pause');
  pauseBtn.setAttribute('aria-label', pauseBtn.title);
  pauseBtn.append(svgIcon(s.paused ? 'play' : 'pause', 13));
  pauseBtn.addEventListener('click', () => void post({ type: s.paused ? 'hud-resume' : 'hud-pause' }));

  const stopBtn = el('button', 'hud-stop');
  stopBtn.dataset.testid = 'recorder.hud.stop';
  stopBtn.title = tr('hud.stop');
  stopBtn.setAttribute('aria-label', tr('hud.stop'));
  stopBtn.append(svgIcon('stop', 11), el('span', 'hud-stop-label', tr('hud.stop')));
  stopBtn.addEventListener('click', () => void post({ type: 'hud-stop' }));

  const cancelBtn = el('button', 'hud-btn ghost');
  cancelBtn.dataset.testid = 'recorder.hud.cancel';
  cancelBtn.title = tr('hud.cancel');
  cancelBtn.setAttribute('aria-label', cancelBtn.title);
  cancelBtn.append(svgIcon('close', 13));
  cancelBtn.addEventListener('click', () => void post({ type: 'hud-cancel' }));

  controls.append(pauseBtn, stopBtn, cancelBtn);
  if (meters.childElementCount > 0) {
    root.append(statusWrap, el('span', 'hud-sep'), meters, el('span', 'hud-sep'), controls);
  } else {
    root.append(statusWrap, el('span', 'hud-sep'), controls);
  }
}

export async function startHud() {
  t = await i18n.catalog().catch(() => ({}));
  i18n.onDidChangeLocale(async () => {
    t = await i18n.catalog().catch(() => t);
    render();
  });
  channel.onMessage<ToHud>(m => {
    if (m?.type === 'hud-state') {
      state = m.state;
      render();
    }
  });
  await post({ type: 'hud-ready' });
}
