// Calm Studio Hub / Launcher window (`manifest.ui`):
// Lets the user choose Screenshot vs 120Hz Screen Recording (or Issue Record) first,
// pre-configure the 5 core recording toggles, inspect macOS permissions, and jump to
// recent captures — instead of immediately freezing the screen on open.
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import { captureV2 } from '../platform.ts';
import type { FromHub, HubState, Mode, ToHub } from '../protocol.ts';
import type { CountdownSeconds, RecordingConfig, RecordingFps } from '../recording.ts';
import { formatBytes, formatDuration } from '../recording.ts';
import { symbols } from '../shortcuts.ts';
import { appMarkSvg, svgIcon, type IconName } from './icons.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromHub) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));

let state: HubState | null = null;
let osPerms: Record<string, string> = {
  screen_capture: 'not_checked',
  microphone: 'not_checked',
  camera: 'not_checked',
  input_monitoring: 'not_checked',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function patchRecording(patch: Partial<RecordingConfig>) {
  if (!state) return;
  // Optimistic local update for snappy toggles.
  state = {
    ...state,
    settings: {
      ...state.settings,
      recording: { ...state.settings.recording, ...patch },
    },
  };
  render();
  void post({ type: 'hub-update-recording', patch });
}

async function launchMode(mode: Mode) {
  const screen = osPerms.screen_capture;
  if (screen === 'denied' || screen === 'not_granted' || screen === 'restricted') {
    await post({ type: 'hub-open-settings' });
    return;
  }
  await post({ type: 'hub-shoot', mode });
  // Resident plugin keeps running in background; closing the Hub ensures it never appears in the shot/recording.
  window.close();
}

function shortcutTag(acc: string | null | undefined) {
  return acc ? el('kbd', 'hub-kbd', symbols(acc)) : null;
}

function render() {
  const root = $('hub');
  root.replaceChildren();
  if (!state) {
    root.append(el('div', 'hub-loading', tr('hub.loading')));
    return;
  }

  const { settings, displayRefreshRate, recordingActive, recentRecordings, recentScreenshots } = state;
  const rec = settings.recording;

  // ---- Header: App mark + title + live Hz badge + 4-permission pills + settings
  const header = el('header', 'hub-head');
  const brand = el('div', 'hub-brand');
  const titleBox = el('div', 'hub-brand-text');
  const titleRow = el('div', 'hub-title-row');
  titleRow.append(el('h1', 'hub-title', tr('plugin.name')));
  const hzText = displayRefreshRate >= 100
    ? `${Math.round(displayRefreshRate)}Hz ProMotion`
    : `${Math.round(displayRefreshRate || 60)}Hz`;
  titleRow.append(el('span', `hub-hz-pill${displayRefreshRate >= 100 ? ' hi' : ''}`, hzText));
  titleBox.append(titleRow, el('p', 'hub-sub', tr('hub.subtitle')));
  brand.append(appMarkSvg(38), titleBox);

  const headRight = el('div', 'hub-head-right');
  const permList = el('div', 'hub-perms');
  const perms: { key: string; label: string; pane: 'screen' | 'mic' | 'camera' | 'input' }[] = [
    { key: 'screen_capture', label: tr('hub.perm.screen'), pane: 'screen' },
    { key: 'microphone', label: tr('hub.perm.mic'), pane: 'mic' },
    { key: 'camera', label: tr('hub.perm.cam'), pane: 'camera' },
    { key: 'input_monitoring', label: tr('hub.perm.input'), pane: 'input' },
  ];
  for (const p of perms) {
    const val = osPerms[p.key] ?? 'not_checked';
    const granted = val === 'granted';
    const unknown = val === 'not_checked' || val === 'unknown';
    const btn = el('button', `hub-perm-pill ${granted ? 'ok' : unknown ? 'idle' : 'warn'}`);
    btn.dataset.testid = `screenshot.hub.perm.${p.pane}`;
    btn.title = granted
      ? `${p.label}: ${tr('perm.state.granted')}`
      : `${p.label}: ${tr(unknown ? 'perm.state.unknown' : 'perm.state.missing')} — ${tr('perm.open')}`;
    btn.append(el('span', 'hub-perm-dot'), el('span', '', p.label));
    btn.addEventListener('click', () => {
      if (p.pane === 'screen' && !granted) void post({ type: 'hub-open-settings' });
      else void post({ type: 'hub-open-privacy', pane: p.pane });
    });
    permList.append(btn);
  }

  const settingsBtn = el('button', 'hub-icon-btn');
  settingsBtn.dataset.testid = 'screenshot.hub.settings';
  settingsBtn.title = tr('settings.title');
  settingsBtn.setAttribute('aria-label', tr('settings.title'));
  settingsBtn.append(svgIcon('settings', 16));
  settingsBtn.addEventListener('click', () => void post({ type: 'hub-open-settings' }));

  headRight.append(permList, settingsBtn);
  header.append(brand, headRight);
  root.append(header);

  // ---- Active recording banner (if user opens Hub while recording)
  if (recordingActive) {
    const banner = el('div', 'hub-rec-banner');
    const info = el('div', 'hub-rec-banner-info');
    info.append(el('span', 'hud-dot'), el('strong', '', tr('hub.recordingActive')));
    const stopBtn = el('button', 'hub-btn-danger');
    stopBtn.dataset.testid = 'screenshot.hub.stopRecording';
    stopBtn.append(svgIcon('stop', 12), el('span', '', tr('tray.recStop')));
    stopBtn.addEventListener('click', () => void post({ type: 'hub-stop-recording' }));
    banner.append(info, stopBtn);
    root.append(banner);
  }

  // ---- Screen permission warning banner (only when explicitly missing)
  const screenPerm = osPerms.screen_capture;
  if (screenPerm === 'denied' || screenPerm === 'not_granted' || screenPerm === 'restricted') {
    const warn = el('div', 'hub-warn-banner');
    const left = el('div', 'hub-warn-left');
    left.append(svgIcon('shield', 16), el('span', '', tr('hub.permWarning')));
    const go = el('button', 'hub-btn-subtle', tr('perm.request'));
    go.addEventListener('click', () => void post({ type: 'hub-open-settings' }));
    warn.append(left, go);
    root.append(warn);
  }

  // ---- Dual primary mode cards: Screenshot vs 120Hz Screen Recording
  const grid = el('section', 'hub-grid');

  // Card 1: Screenshot
  const shotCard = el('div', 'hub-card hub-card-shot');
  const shotTop = el('div', 'hub-card-top');
  const shotBadge = el('span', 'hub-card-icon shot');
  shotBadge.append(svgIcon('crop', 18));
  const shotHeadText = el('div', 'hub-card-head-text');
  shotHeadText.append(
    el('h2', 'hub-card-title', tr('hub.shot.title')),
    el('p', 'hub-card-desc', tr('hub.shot.desc')),
  );
  shotTop.append(shotBadge, shotHeadText);

  const areaBtn = el('button', 'hub-cta shot');
  areaBtn.dataset.testid = 'screenshot.hub.area';
  const areaLeft = el('span', 'hub-cta-left');
  areaLeft.append(svgIcon('crop', 16), el('span', '', tr('action.capture')));
  areaBtn.append(areaLeft);
  const areaKbd = shortcutTag(settings.shortcutArea);
  if (areaKbd) areaBtn.append(areaKbd);
  areaBtn.addEventListener('click', () => void launchMode('area'));

  const shotSubs = el('div', 'hub-sub-grid');
  const subShotItems: { mode: Mode; icon: IconName; label: string; kbd: string | null; testid: string }[] = [
    { mode: 'full', icon: 'monitor', label: tr('tray.full'), kbd: settings.shortcutFull, testid: 'screenshot.hub.full' },
    { mode: 'quick', icon: 'bolt', label: tr('tray.quick'), kbd: settings.shortcutQuick, testid: 'screenshot.hub.quick' },
    { mode: 'ocr', icon: 'scan-text', label: tr('hub.shot.ocr'), kbd: settings.shortcutOcr, testid: 'screenshot.hub.ocr' },
  ];
  for (const item of subShotItems) {
    const b = el('button', 'hub-sub-btn');
    b.dataset.testid = item.testid;
    b.title = item.kbd ? `${item.label} (${symbols(item.kbd)})` : item.label;
    b.append(svgIcon(item.icon, 15), el('span', '', item.label));
    b.addEventListener('click', () => void launchMode(item.mode));
    shotSubs.append(b);
  }
  shotCard.append(shotTop, areaBtn, shotSubs);

  // Card 2: 120Hz Screen Recording
  const recCard = el('div', 'hub-card hub-card-rec');
  const recTop = el('div', 'hub-card-top');
  const recBadge = el('span', 'hub-card-icon rec');
  recBadge.append(svgIcon('record-dot', 18));
  const recHeadText = el('div', 'hub-card-head-text');
  recHeadText.append(
    el('h2', 'hub-card-title', tr('hub.rec.title')),
    el('p', 'hub-card-desc', tr('hub.rec.desc')),
  );
  recTop.append(recBadge, recHeadText);

  const recBtn = el('button', 'hub-cta rec');
  recBtn.dataset.testid = 'screenshot.hub.record';
  const recLeft = el('span', 'hub-cta-left');
  recLeft.append(svgIcon('record-dot', 16), el('span', '', tr('hub.rec.start')));
  recBtn.append(recLeft);
  const recKbd = shortcutTag(settings.shortcutRecord);
  if (recKbd) recBtn.append(recKbd);
  recBtn.addEventListener('click', () => void launchMode('record'));

  const recSubs = el('div', 'hub-sub-grid two');
  const issueBtn = el('button', 'hub-sub-btn issue');
  issueBtn.dataset.testid = 'screenshot.hub.recordIssue';
  issueBtn.title = settings.shortcutRecordIssue ? `${tr('mode.recordIssue')} (${symbols(settings.shortcutRecordIssue)})` : tr('mode.recordIssue');
  issueBtn.append(svgIcon('bug', 15), el('span', '', tr('mode.recordIssue')));
  issueBtn.addEventListener('click', () => void launchMode('record-issue'));

  const histBtn = el('button', 'hub-sub-btn');
  histBtn.dataset.testid = 'screenshot.hub.history';
  const histCount = recentRecordings.length ? ` (${recentRecordings.length})` : '';
  histBtn.append(svgIcon('film', 15), el('span', '', `${tr('command.screenshot.history')}${histCount}`));
  histBtn.addEventListener('click', () => void post({ type: 'hub-open-review' }));

  recSubs.append(issueBtn, histBtn);
  recCard.append(recTop, recBtn, recSubs);

  grid.append(shotCard, recCard);
  root.append(grid);

  // ---- Recording Pre-flight Strip (FPS + Countdown + 5 Core Feature Toggles with new SVG icons)
  const preflight = el('section', 'hub-preflight');
  const preHead = el('div', 'hub-pre-head');
  preHead.append(el('span', 'hub-sec-label', tr('hub.preflight.title')));

  const preMeta = el('div', 'hub-pre-meta');
  const fpsSeg = el('div', 'hub-seg');
  fpsSeg.dataset.testid = 'screenshot.hub.fps';
  for (const fps of [30, 60, 120] as RecordingFps[]) {
    const b = el('button', `hub-seg-item${rec.fps === fps ? ' on' : ''}`, fps === 120 ? '120Hz' : `${fps}`);
    b.addEventListener('click', () => patchRecording({ fps }));
    fpsSeg.append(b);
  }
  const cdBtn = el('button', `hub-chip compact${rec.countdown > 0 ? ' on' : ''}`);
  cdBtn.dataset.testid = 'screenshot.hub.countdown';
  cdBtn.title = tr('rec.countdown.title');
  cdBtn.append(svgIcon('timer', 14), el('span', '', rec.countdown ? `${rec.countdown}s` : tr('rec.countdown.off')));
  cdBtn.addEventListener('click', () => {
    const order: CountdownSeconds[] = [0, 3, 5];
    const next = order[(order.indexOf(rec.countdown) + 1) % order.length];
    patchRecording({ countdown: next });
  });
  preMeta.append(fpsSeg, cdBtn);
  preHead.append(preMeta);

  const chips = el('div', 'hub-chips');
  const mkToggle = (
    testid: string,
    iconOn: IconName,
    iconOff: IconName,
    label: string,
    enabled: boolean,
    onToggle: () => void,
  ) => {
    const b = el('button', `hub-chip${enabled ? ' on' : ''}`);
    b.dataset.testid = testid;
    b.setAttribute('aria-pressed', String(enabled));
    b.append(svgIcon(enabled ? iconOn : iconOff, 15), el('span', '', label));
    b.addEventListener('click', onToggle);
    return b;
  };
  chips.append(
    mkToggle('screenshot.hub.toggle.sys', 'volume', 'volume-off', tr('rec.sys'), rec.systemAudio.enabled, () =>
      patchRecording({ systemAudio: { ...rec.systemAudio, enabled: !rec.systemAudio.enabled } })),
    mkToggle('screenshot.hub.toggle.mic', 'mic', 'mic-off', tr('rec.mic'), rec.microphone.enabled, () =>
      patchRecording({ microphone: { ...rec.microphone, enabled: !rec.microphone.enabled } })),
    mkToggle('screenshot.hub.toggle.cam', 'camera', 'camera-off', tr('rec.cam'), rec.camera.enabled, () =>
      patchRecording({ camera: { ...rec.camera, enabled: !rec.camera.enabled } })),
    mkToggle('screenshot.hub.toggle.clicks', 'click-ripple', 'click-ripple', tr('rec.clicks'), rec.clicks.enabled, () =>
      patchRecording({ clicks: { ...rec.clicks, enabled: !rec.clicks.enabled } })),
    mkToggle('screenshot.hub.toggle.keys', 'keyboard', 'keyboard', tr('rec.keys'), rec.keystrokes.enabled, () =>
      patchRecording({ keystrokes: { ...rec.keystrokes, enabled: !rec.keystrokes.enabled } })),
  );
  preflight.append(preHead, chips);
  root.append(preflight);

  // ---- Recent Captures Shelf
  const recentSec = el('section', 'hub-recent');
  const recSecHead = el('div', 'hub-pre-head');
  recSecHead.append(el('span', 'hub-sec-label', tr('hub.recent.title')));
  const folderLink = el('button', 'hub-text-btn');
  folderLink.dataset.testid = 'screenshot.hub.folder';
  folderLink.append(svgIcon('folder', 14), el('span', '', tr('hub.recent.openFolder')));
  folderLink.addEventListener('click', () => void post({ type: 'hub-reveal-file' }));
  recSecHead.append(folderLink);
  recentSec.append(recSecHead);

  const items: { kind: 'rec' | 'shot'; title: string; meta: string; badge: string; onClick: () => void }[] = [];
  for (const r of recentRecordings.slice(0, 3)) {
    const parts = [formatDuration(r.duration_ms), formatBytes(r.bytes)];
    const badge = r.target_fps ? `${r.target_fps}Hz${r.codec ? ` · ${r.codec.toUpperCase()}` : ''}` : 'MP4';
    items.push({
      kind: 'rec',
      title: r.source_title || r.id.slice(0, 8),
      meta: parts.join(' · '),
      badge,
      onClick: () => void post({ type: 'hub-open-review', id: r.id }),
    });
  }
  for (const s of recentScreenshots.slice(0, Math.max(0, 4 - items.length))) {
    items.push({
      kind: 'shot',
      title: s.name,
      meta: formatBytes(s.size),
      badge: s.name.toLowerCase().endsWith('.jpg') || s.name.toLowerCase().endsWith('.jpeg') ? 'JPEG' : 'PNG',
      onClick: () => void post({ type: 'hub-reveal-file', filePath: s.path }),
    });
  }

  if (!items.length) {
    recentSec.append(el('div', 'hub-recent-empty', tr('hub.recent.empty')));
  } else {
    const list = el('div', 'hub-recent-grid');
    for (const it of items) {
      const card = el('button', 'hub-recent-item');
      const ic = el('span', `hub-recent-ic ${it.kind}`);
      ic.append(svgIcon(it.kind === 'rec' ? 'film' : 'crop', 15));
      const info = el('div', 'hub-recent-info');
      info.append(el('div', 'hub-recent-name', it.title), el('div', 'hub-recent-meta', it.meta));
      const badge = el('span', `hub-recent-badge ${it.kind}`, it.badge);
      card.append(ic, info, badge);
      card.addEventListener('click', it.onClick);
      list.append(card);
    }
    recentSec.append(list);
  }
  root.append(recentSec);

  // ---- Footer tips
  const foot = el('footer', 'hub-foot');
  foot.append(el('span', 'hub-foot-tip', tr('hub.foot.tip')));
  root.append(foot);
}

async function refreshPermissions(refresh = true) {
  let s = await captureV2.status(refresh).catch(() => null);
  for (let i = 0; i < 16 && s?.status === 'loading'; i++) {
    await new Promise(r => setTimeout(r, 200));
    s = await captureV2.status(false).catch(() => null);
  }
  if (s?.os) osPerms = { ...osPerms, ...s.os };
  render();
}

export async function startHub() {
  t = await i18n.catalog().catch(() => ({}));
  document.title = tr('plugin.name');
  i18n.onDidChangeLocale(async () => {
    t = await i18n.catalog().catch(() => t);
    document.title = tr('plugin.name');
    render();
  });
  channel.onMessage<ToHub>(m => {
    if (m?.type === 'hub-state') {
      state = m.state;
      if (m.state.devices?.os) osPerms = { ...osPerms, ...m.state.devices.os };
      render();
    }
  });
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') { e.preventDefault(); window.close(); }
    else if (e.key === '1' || e.key.toLowerCase() === 's') { e.preventDefault(); void launchMode('area'); }
    else if (e.key === '2' || e.key.toLowerCase() === 'r') { e.preventDefault(); void launchMode('record'); }
    else if (e.key.toLowerCase() === 'i') { e.preventDefault(); void launchMode('record-issue'); }
  });
  addEventListener('focus', () => {
    void post({ type: 'hub-ready' });
    void refreshPermissions(true);
  });
  render();
  await post({ type: 'hub-ready' });
  await refreshPermissions(true);
}
