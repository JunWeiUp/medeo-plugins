// Studio 3-Pane Non-Destructive Dark Video Editor (`#cap6` + `#cap7` Export Modal):
// - Left rail & inspector: Background, Cursor/Clicks, Zoom, Keystrokes, Camera PiP, Clip Info
// - Center stage: live composited preview (wallpaper/aspect/radius/shadow, smooth Zoom,
//   live synced camera.mp4 PiP, 240Hz click ripples & keystroke HUD via sanctioned capture.readTrack,
//   and live AudioMerge playback for mic.m4a + system.m4a)
// - Bottom multi-track timeline: trim In/Out, Cut, Zoom, Speed, Freeze, Auto-Zoom
// - Top AudioMerge popover + Export & Save modal (`capture.export` native VideoToolbox / ImageIO)
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import { captureV2, type CaptureRecordV2 } from '../platform.ts';
import type { FromReview, ReviewExportDone, ReviewState, ToReview } from '../protocol.ts';
import { detectFpsHealth, formatBytes, formatDuration, type CameraCorner, type CameraShape, type ClickSize, type KeystrokePosition, type RecordingCodec, type RecordingFps } from '../recording.ts';
import {
  STUDIO_BACKGROUNDS,
  autoGenerateZooms,
  buildExportRecipe,
  createDefaultStudioProject,
  evaluateZoom,
  parseTelemetryJsonl,
  type ParsedTelemetryEvent,
  type StudioAspect,
  type StudioProject,
  type StudioTab,
} from '../studio.ts';
import { svgIcon, type IconName } from './icons.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromReview) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));

let state: ReviewState | null = null;
let project: StudioProject | null = null;
let loadedRecordId: string | null = null;
let totalDuration = 0.1;
let telemetry: ParsedTelemetryEvent[] = [];
let activeTab: StudioTab = 'bg';
let selectedZoomId: string | null = null;
let historyOpen = false;
let audioPopOpen = false;
let exportModalOpen = false;
let exportFormat: 'mp4' | 'gif' | 'issue_bundle' = 'mp4';
let exportCopyFile = false;
let exportSendDrive = false;
let lastExportResult: ReviewExportDone | null = null;
let previewSpeed = 1;
let rafId = 0;
let toastTimer = 0;

// Persistent mounted media elements (never destroyed on slider drag / tab switch)
let screenVideo: HTMLVideoElement | null = null;
let camVideo: HTMLVideoElement | null = null;
let micAudio: HTMLAudioElement | null = null;
let sysAudio: HTMLAudioElement | null = null;
let telCanvas: HTMLCanvasElement | null = null;
let keyBadgeEl: HTMLElement | null = null;
let stageWallEl: HTMLElement | null = null;
let stageFrameEl: HTMLElement | null = null;
let zoomFocusDot: HTMLElement | null = null;
let playBtnEl: HTMLButtonElement | null = null;
let timecodeEl: HTMLElement | null = null;
let playheadEl: HTMLElement | null = null;

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
  toastTimer = setTimeout(() => { box.hidden = true; }, 3200) as unknown as number;
}

function iconBtn(cls: string, iconName: IconName, text: string, testid: string, onClick: (e: MouseEvent) => void) {
  const b = el('button', `${cls} ic-btn`);
  b.dataset.testid = testid;
  b.append(svgIcon(iconName, 14), el('span', '', text));
  b.addEventListener('click', onClick);
  return b;
}

async function loadTelemetryViaHost(rec: CaptureRecordV2) {
  telemetry = [];
  if (!rec.tracks?.['telemetry.jsonl']) return;
  try {
    const res = await captureV2.readTrack(rec.id, 'telemetry.jsonl');
    if (res?.content) {
      telemetry = parseTelemetryJsonl(res.content);
      // Auto-populate smart zooms on Issue mode or when user hasn't edited yet? Keep clean and offer 1-click Auto Zoom!
      renderInspector();
    }
  } catch (err) {
    console.warn('capture.readTrack telemetry failed:', String(err));
  }
}

function applyAudioVolumes() {
  if (!project) return;
  if (micAudio) micAudio.volume = Math.max(0, Math.min(1, project.audio.micVolume));
  if (sysAudio) sysAudio.volume = Math.max(0, Math.min(1, project.audio.systemVolume));
}

function applyStageStyles() {
  if (!project || !stageWallEl || !stageFrameEl) return;
  const bg = project.background;
  if (bg.type === 'gradient') {
    stageWallEl.style.background = `linear-gradient(135deg, ${bg.colors[0]}, ${bg.colors[1]})`;
  } else if (bg.type === 'solid') {
    stageWallEl.style.background = bg.colors[0];
  } else {
    stageWallEl.style.background = '#000';
  }
  const pad = bg.type === 'none' ? 0 : Math.round(bg.padding * 0.42);
  stageWallEl.style.padding = `${pad}px`;
  stageWallEl.dataset.aspect = bg.aspect;

  stageFrameEl.style.borderRadius = `${bg.type === 'none' ? 0 : bg.radius}px`;
  stageFrameEl.style.boxShadow = bg.shadow && bg.type !== 'none'
    ? '0 22px 54px rgba(0, 0, 0, .58), 0 0 0 1px rgba(255, 255, 255, .12)'
    : 'none';

  if (camVideo) {
    const c = project.camera;
    camVideo.hidden = !c.enabled;
    camVideo.className = `st-cam-pip ${c.shape} ${c.position}${c.mirror ? ' mirror' : ''}`;
    const pct = Math.round(c.size * 100);
    camVideo.style.width = `${pct}%`;
    camVideo.style.aspectRatio = '1 / 1';
  }

  if (keyBadgeEl) {
    keyBadgeEl.dataset.pos = project.cursor.keyPosition;
  }

  // Show draggable/clickable focus indicator when Zoom tab is active with a selected zoom
  if (zoomFocusDot) {
    const selZ = activeTab === 'zoom' ? project.zooms.find(z => z.id === selectedZoomId) : null;
    if (selZ) {
      zoomFocusDot.hidden = false;
      zoomFocusDot.style.left = `${(selZ.x * 100).toFixed(1)}%`;
      zoomFocusDot.style.top = `${(selZ.y * 100).toFixed(1)}%`;
    } else {
      zoomFocusDot.hidden = true;
    }
  }
}

function drawFrameLoop() {
  if (screenVideo && project) {
    const now = screenVideo.currentTime || 0;
    const dur = Math.max(0.1, Number.isFinite(screenVideo.duration) && screenVideo.duration > 0 ? screenVideo.duration : totalDuration);

    // Skip over Cut segments during live playback + respect Trim Out
    if (!screenVideo.paused) {
      if (now >= project.trimEnd - 0.03) {
        screenVideo.pause();
        screenVideo.currentTime = project.trimStart;
      } else {
        const hitCut = project.cuts.find(c => now >= c.start && now < c.end - 0.04);
        if (hitCut) {
          screenVideo.currentTime = Math.min(project.trimEnd, hitCut.end);
          if (camVideo) camVideo.currentTime = screenVideo.currentTime;
          if (micAudio) micAudio.currentTime = screenVideo.currentTime;
          if (sysAudio) sysAudio.currentTime = screenVideo.currentTime;
        }
        const hitSpeed = project.speeds.find(s => now >= s.start && now <= s.end);
        const targetRate = (hitSpeed?.rate ?? 1) * previewSpeed;
        if (Math.abs(screenVideo.playbackRate - targetRate) > 0.05) {
          screenVideo.playbackRate = targetRate;
          if (camVideo) camVideo.playbackRate = targetRate;
          if (micAudio) micAudio.playbackRate = targetRate;
          if (sysAudio) sysAudio.playbackRate = targetRate;
        }
      }
    }

    // Live CSS Zoom preview matching Swift StudioExporter curve
    const z = evaluateZoom(now, project.zooms);
    if (z.scale > 1.005) {
      screenVideo.style.transformOrigin = `${(z.x * 100).toFixed(2)}% ${(z.y * 100).toFixed(2)}%`;
      screenVideo.style.transform = `scale(${z.scale.toFixed(4)})`;
    } else {
      screenVideo.style.transform = '';
    }

    // Update playhead & timecode
    if (timecodeEl) {
      timecodeEl.textContent = `${formatDuration(now * 1000)} / ${formatDuration(dur * 1000)}`;
    }
    if (playheadEl) {
      const pct = Math.max(0, Math.min(100, (now / dur) * 100));
      playheadEl.style.left = `${pct.toFixed(2)}%`;
    }

    // Draw 240Hz click ripples & keystroke pill HUD
    if (telCanvas && keyBadgeEl) {
      const rect = screenVideo.getBoundingClientRect();
      if (rect.width > 4 && rect.height > 4) {
        const dpr = devicePixelRatio || 1;
        const cw = Math.round(rect.width * dpr);
        const ch = Math.round(rect.height * dpr);
        if (telCanvas.width !== cw || telCanvas.height !== ch) {
          telCanvas.width = cw;
          telCanvas.height = ch;
        }
        const ctx = telCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, rect.width, rect.height);
          if (project.cursor.clicks && telemetry.length) {
            const color = project.cursor.clickColor || '#FF3B30';
            const baseR = project.cursor.clickSize === 'lg' ? 32 : project.cursor.clickSize === 'sm' ? 18 : 24;
            for (const ev of telemetry) {
              if (ev.kind === 'click' && ev.x !== undefined && ev.y !== undefined) {
                const age = now - ev.t;
                if (age >= 0 && age <= 0.45) {
                  const p = age / 0.45;
                  const a = 1 - p;
                  const r = 6 + baseR * p;
                  const cx = ev.x * rect.width;
                  const cy = ev.y * rect.height;
                  ctx.save();
                  ctx.strokeStyle = color;
                  ctx.globalAlpha = a * 0.92;
                  ctx.lineWidth = 3 * (1 - p * 0.45);
                  ctx.beginPath();
                  ctx.arc(cx, cy, r, 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.fillStyle = color;
                  ctx.globalAlpha = a * 0.24;
                  ctx.fill();
                  ctx.restore();
                }
              }
            }
          }
        }
      }

      if (project.cursor.keystrokes && telemetry.length) {
        let latestKey: ParsedTelemetryEvent | null = null;
        for (let i = telemetry.length - 1; i >= 0; i--) {
          const ev = telemetry[i];
          if (ev.kind === 'key' && ev.label && now >= ev.t && now - ev.t <= 1.35) {
            latestKey = ev;
            break;
          }
        }
        if (latestKey?.label) {
          keyBadgeEl.textContent = latestKey.label;
          keyBadgeEl.hidden = false;
        } else {
          keyBadgeEl.hidden = true;
        }
      } else {
        keyBadgeEl.hidden = true;
      }
    }
  }
  rafId = requestAnimationFrame(drawFrameLoop);
}

function togglePlayback() {
  if (!screenVideo || !project) return;
  if (screenVideo.paused) {
    if (screenVideo.currentTime < project.trimStart || screenVideo.currentTime >= project.trimEnd - 0.05) {
      screenVideo.currentTime = project.trimStart;
    }
    void screenVideo.play().catch(() => {});
  } else {
    screenVideo.pause();
  }
}

function syncPlayButton() {
  if (!playBtnEl || !screenVideo) return;
  playBtnEl.replaceChildren(svgIcon(screenVideo.paused ? 'play' : 'pause', 14));
}

function seekTo(sec: number) {
  if (!screenVideo) return;
  const clamped = Math.max(0, Math.min(totalDuration, sec));
  screenVideo.currentTime = clamped;
  if (camVideo) camVideo.currentTime = clamped;
  if (micAudio) micAudio.currentTime = clamped;
  if (sysAudio) sysAudio.currentTime = clamped;
}

// ---- Section renderers (only re-render inspector/timeline/overlays without disturbing <video>!)
function renderInspector() {
  const panel = document.getElementById('st-inspector');
  if (!panel || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  panel.replaceChildren();

  const rowSlider = (lbl: string, val: number, min: number, max: number, step: number, unit: string, onChange: (v: number) => void) => {
    const wrap = el('div', 'st-field');
    const top = el('div', 'st-field-top');
    const valEl = el('span', 'st-field-val', `${Math.round(val * 100) / 100}${unit}`);
    top.append(el('span', 'st-field-lbl', lbl), valEl);
    const inp = el('input', 'st-range') as HTMLInputElement;
    inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      valEl.textContent = `${Math.round(v * 100) / 100}${unit}`;
      onChange(v);
    });
    wrap.append(top, inp);
    return wrap;
  };

  const rowSwitch = (lbl: string, checked: boolean, onChange: (v: boolean) => void) => {
    const wrap = el('label', 'st-switch-row');
    const cb = el('input', 'switch') as HTMLInputElement;
    cb.type = 'checkbox'; cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    wrap.append(el('span', '', lbl), cb);
    return wrap;
  };

  if (activeTab === 'bg') {
    panel.append(el('div', 'st-panel-title', tr('studio.tab.bg')));
    const swatches = el('div', 'st-bg-grid');
    for (const bg of STUDIO_BACKGROUNDS) {
      const b = el('button', `st-bg-swatch${project.background.presetId === bg.id ? ' on' : ''}`);
      b.title = tr(bg.labelKey);
      if (bg.type === 'gradient') b.style.background = `linear-gradient(135deg, ${bg.colors[0]}, ${bg.colors[1]})`;
      else if (bg.type === 'solid') b.style.background = bg.colors[0];
      else b.classList.add('none');
      b.addEventListener('click', () => {
        project!.background.presetId = bg.id;
        project!.background.type = bg.type;
        project!.background.colors = [...bg.colors] as [string, string];
        applyStageStyles();
        renderInspector();
      });
      swatches.append(b);
    }
    panel.append(swatches);

    const aspectLbl = el('div', 'st-field-lbl', tr('studio.bg.aspect'));
    const aspectSeg = el('div', 'st-seg');
    for (const asp of ['auto', '16:9', '9:16', '1:1'] as StudioAspect[]) {
      const b = el('button', `st-seg-item${project.background.aspect === asp ? ' on' : ''}`, asp === 'auto' ? tr('studio.bg.auto') : asp);
      b.addEventListener('click', () => {
        project!.background.aspect = asp;
        applyStageStyles();
        renderInspector();
      });
      aspectSeg.append(b);
    }
    panel.append(
      aspectLbl,
      aspectSeg,
      rowSlider(tr('studio.bg.padding'), project.background.padding, 0, 120, 4, 'px', v => { project!.background.padding = v; applyStageStyles(); }),
      rowSlider(tr('studio.bg.radius'), project.background.radius, 0, 36, 2, 'px', v => { project!.background.radius = v; applyStageStyles(); }),
      rowSwitch(tr('studio.bg.shadow'), project.background.shadow, v => { project!.background.shadow = v; applyStageStyles(); }),
    );
  } else if (activeTab === 'cursor') {
    panel.append(el('div', 'st-panel-title', tr('studio.tab.cursor')));
    panel.append(rowSwitch(tr('rec.clicks.enable'), project.cursor.clicks, v => { project!.cursor.clicks = v; }));
    const colLbl = el('div', 'st-field-lbl', tr('option.color'));
    const cols = el('div', 'st-color-row');
    for (const c of ['#FF3B30', '#FF9500', '#34C759', '#0A84FF', '#AF52DE', '#FFFFFF']) {
      const sw = el('button', `st-color-dot${project.cursor.clickColor === c ? ' on' : ''}`);
      sw.style.background = c;
      sw.addEventListener('click', () => { project!.cursor.clickColor = c; renderInspector(); });
      cols.append(sw);
    }
    const sizeSeg = el('div', 'st-seg');
    for (const sz of ['sm', 'md', 'lg'] as ClickSize[]) {
      const b = el('button', `st-seg-item${project.cursor.clickSize === sz ? ' on' : ''}`, sz.toUpperCase());
      b.addEventListener('click', () => { project!.cursor.clickSize = sz; renderInspector(); });
      sizeSeg.append(b);
    }
    const clickCount = telemetry.filter(e => e.kind === 'click').length;
    panel.append(colLbl, cols, el('div', 'st-field-lbl', tr('option.width')), sizeSeg, el('p', 'st-note', tr('studio.cursor.count', { n: clickCount })));
  } else if (activeTab === 'zoom') {
    panel.append(el('div', 'st-panel-title', tr('studio.tab.zoom')));
    const actions = el('div', 'st-btn-row');
    actions.append(
      iconBtn('st-btn primary', 'sparkles', tr('studio.zoom.auto'), 'studio.zoom.auto', () => {
        const gen = autoGenerateZooms(telemetry, totalDuration);
        if (!gen.length) { showToast('error', tr('studio.zoom.noClicks')); return; }
        project!.zooms = gen;
        selectedZoomId = gen[0].id;
        applyStageStyles();
        renderInspector();
        renderTimeline();
        showToast('success', tr('studio.zoom.autoDone', { n: gen.length }));
      }),
      iconBtn('st-btn', 'plus', tr('studio.zoom.add'), 'studio.zoom.add', () => addZoomAtPlayhead()),
    );
    panel.append(actions);

    if (!project.zooms.length) {
      panel.append(el('p', 'st-note', tr('studio.zoom.empty')));
    } else {
      const list = el('div', 'st-item-list');
      for (const z of project.zooms) {
        const row = el('div', `st-list-item${selectedZoomId === z.id ? ' on' : ''}`);
        const main = el('button', 'st-list-main', `${z.scale.toFixed(1)}× · ${formatDuration(z.start * 1000)}–${formatDuration(z.end * 1000)}`);
        main.addEventListener('click', () => {
          selectedZoomId = z.id;
          seekTo((z.start + z.end) * 0.5);
          applyStageStyles();
          renderInspector();
          renderTimeline();
        });
        const del = el('button', 'st-list-del');
        del.append(svgIcon('trash', 13));
        del.addEventListener('click', () => {
          project!.zooms = project!.zooms.filter(x => x.id !== z.id);
          if (selectedZoomId === z.id) selectedZoomId = project!.zooms[0]?.id ?? null;
          applyStageStyles();
          renderInspector();
          renderTimeline();
        });
        row.append(main, del);
        list.append(row);
      }
      panel.append(list);

      const selZ = project.zooms.find(z => z.id === selectedZoomId) ?? project.zooms[0];
      if (selZ) {
        selectedZoomId = selZ.id;
        panel.append(
          rowSlider(tr('studio.zoom.scale'), selZ.scale, 1.2, 2.6, 0.1, '×', v => { selZ.scale = v; renderTimeline(); }),
          rowSlider('X', Math.round(selZ.x * 100), 0, 100, 1, '%', v => { selZ.x = v / 100; applyStageStyles(); }),
          rowSlider('Y', Math.round(selZ.y * 100), 0, 100, 1, '%', v => { selZ.y = v / 100; applyStageStyles(); }),
          el('p', 'st-note', tr('studio.zoom.clickStage')),
        );
      }
    }
  } else if (activeTab === 'keys') {
    panel.append(el('div', 'st-panel-title', tr('studio.tab.keys')));
    panel.append(rowSwitch(tr('rec.keys.enable'), project.cursor.keystrokes, v => { project!.cursor.keystrokes = v; }));
    const posSeg = el('div', 'st-seg');
    const positions: [KeystrokePosition, string][] = [
      ['bottom-left', tr('align.left')],
      ['bottom-center', tr('align.center')],
      ['bottom-right', tr('align.right')],
    ];
    for (const [pos, lbl] of positions) {
      const b = el('button', `st-seg-item${project.cursor.keyPosition === pos ? ' on' : ''}`, lbl);
      b.addEventListener('click', () => { project!.cursor.keyPosition = pos; applyStageStyles(); renderInspector(); });
      posSeg.append(b);
    }
    const keyCount = telemetry.filter(e => e.kind === 'key').length;
    panel.append(el('div', 'st-field-lbl', tr('studio.keys.position')), posSeg, el('p', 'st-note', tr('studio.keys.count', { n: keyCount })));
  } else if (activeTab === 'cam') {
    panel.append(el('div', 'st-panel-title', tr('studio.tab.cam')));
    const hasCam = Boolean(rec.tracks?.['camera.mp4']);
    if (!hasCam) {
      panel.append(el('p', 'st-note', tr('studio.cam.none')));
    } else {
      panel.append(rowSwitch(tr('studio.cam.show'), project.camera.enabled, v => { project!.camera.enabled = v; applyStageStyles(); }));
      const shapeSeg = el('div', 'st-seg');
      for (const [sh, lbl] of [['circle', tr('rec.cam.circle')], ['rounded', tr('rec.cam.rounded')], ['rect', tr('rec.cam.rect')]] as [CameraShape, string][]) {
        const b = el('button', `st-seg-item${project.camera.shape === sh ? ' on' : ''}`, lbl);
        b.addEventListener('click', () => { project!.camera.shape = sh; applyStageStyles(); renderInspector(); });
        shapeSeg.append(b);
      }
      const posSeg = el('div', 'st-seg');
      for (const [corner, lbl] of [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']] as [CameraCorner, string][]) {
        const b = el('button', `st-seg-item${project.camera.position === corner ? ' on' : ''}`, lbl);
        b.addEventListener('click', () => { project!.camera.position = corner; applyStageStyles(); renderInspector(); });
        posSeg.append(b);
      }
      panel.append(
        el('div', 'st-field-lbl', tr('studio.cam.shape')), shapeSeg,
        el('div', 'st-field-lbl', tr('studio.cam.corner')), posSeg,
        rowSlider(tr('studio.cam.size'), Math.round(project.camera.size * 100), 12, 34, 1, '%', v => { project!.camera.size = v / 100; applyStageStyles(); }),
        rowSwitch(tr('rec.cam.mirror'), project.camera.mirror, v => { project!.camera.mirror = v; applyStageStyles(); }),
      );
    }
  } else {
    panel.append(el('div', 'st-panel-title', tr('studio.tab.info')));
    const meta = el('div', 'st-info-list');
    const fpsHealth = detectFpsHealth(rec.target_fps ?? 60, rec.actual_fps, rec.dropped_frames ?? 0);
    const fpsStr = rec.actual_fps ? `${Math.round(rec.actual_fps)}/${rec.target_fps ?? 60}fps` : `${rec.target_fps ?? 60}Hz`;
    const rows: [string, string, string?][] = [
      [tr('studio.info.resolution'), rec.width && rec.height ? `${rec.width}×${rec.height}` : '—'],
      [tr('studio.info.fps'), fpsStr, fpsHealth],
      [tr('studio.info.codec'), (rec.codec ?? 'auto').toUpperCase()],
      [tr('studio.info.size'), formatBytes(rec.bytes)],
      [tr('studio.info.tracks'), Object.entries(rec.tracks ?? {}).filter(([, ok]) => ok).map(([k]) => k).join(', ') || 'capture.mp4'],
    ];
    for (const [k, v, cls] of rows) {
      const r = el('div', 'st-info-row');
      r.append(el('span', 'st-info-k', k), el('span', `st-info-v${cls ? ` ${cls}` : ''}`, v));
      meta.append(r);
    }
    const revealBtn = iconBtn('st-btn', 'folder', tr('review.reveal'), 'recorder.review.reveal', () =>
      void captureV2.open(rec.id, 'reveal').catch(() => showToast('error', tr('review.exportFailed'))));
    panel.append(meta, revealBtn);
  }
}

function addZoomAtPlayhead() {
  if (!project) return;
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart, Math.min(totalDuration - 0.8, t0));
  const end = Math.min(project.trimEnd, start + 1.8);
  const id = `zoom-${Date.now().toString(36)}`;
  project.zooms.push({ id, start, end, scale: 1.6, x: 0.5, y: 0.5 });
  selectedZoomId = id;
  activeTab = 'zoom';
  renderRail();
  applyStageStyles();
  renderInspector();
  renderTimeline();
}

function addCutAtPlayhead() {
  if (!project) return;
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart + 0.05, Math.min(project.trimEnd - 0.5, t0));
  const end = Math.min(project.trimEnd - 0.05, start + Math.min(1.0, totalDuration * 0.18));
  if (end - start < 0.15) return;
  project.cuts.push({ id: `cut-${Date.now().toString(36)}`, start, end });
  renderTimeline();
}

function addSpeedAtPlayhead() {
  if (!project) return;
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart, Math.min(project.trimEnd - 0.6, t0));
  const end = Math.min(project.trimEnd, start + Math.min(1.8, totalDuration * 0.25));
  if (end - start < 0.2) return;
  project.speeds.push({ id: `spd-${Date.now().toString(36)}`, start, end, rate: 0.5 });
  renderTimeline();
}

function addFreezeAtPlayhead() {
  if (!project) return;
  const t0 = Math.max(project.trimStart, Math.min(project.trimEnd, screenVideo?.currentTime ?? 0));
  project.freezes.push({ id: `frz-${Date.now().toString(36)}`, at: t0, duration: 1.2 });
  renderTimeline();
}

function renderRail() {
  const rail = document.getElementById('st-rail');
  if (!rail) return;
  rail.replaceChildren();
  const tabs: { id: StudioTab; icon: IconName; label: string }[] = [
    { id: 'bg', icon: 'sparkles', label: tr('studio.tab.bg') },
    { id: 'cursor', icon: 'click-ripple', label: tr('studio.tab.cursor') },
    { id: 'zoom', icon: 'zoom-in', label: tr('studio.tab.zoom') },
    { id: 'keys', icon: 'keyboard', label: tr('studio.tab.keys') },
    { id: 'cam', icon: 'camera', label: tr('studio.tab.cam') },
    { id: 'info', icon: 'info', label: tr('studio.tab.info') },
  ];
  for (const tb of tabs) {
    const b = el('button', `st-rail-btn${activeTab === tb.id ? ' on' : ''}`);
    b.title = tb.label;
    b.dataset.testid = `studio.tab.${tb.id}`;
    b.append(svgIcon(tb.icon, 16), el('span', '', tb.label));
    b.addEventListener('click', () => {
      activeTab = tb.id;
      renderRail();
      applyStageStyles();
      renderInspector();
    });
    rail.append(b);
  }
}

function renderTimeline() {
  const host = document.getElementById('st-timeline');
  if (!host || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  const dur = Math.max(0.1, totalDuration);
  host.replaceChildren();

  // Timeline quick toolbar
  const tb = el('div', 'st-tl-bar');
  const left = el('div', 'st-tl-tools');
  left.append(
    iconBtn('st-tl-btn', 'scissors', tr('studio.tl.cut'), 'studio.tl.cut', addCutAtPlayhead),
    iconBtn('st-tl-btn', 'zoom-in', tr('studio.tl.zoom'), 'studio.tl.zoom', addZoomAtPlayhead),
    iconBtn('st-tl-btn', 'gauge', tr('studio.tl.speed'), 'studio.tl.speed', addSpeedAtPlayhead),
    iconBtn('st-tl-btn', 'snowflake', tr('studio.tl.freeze'), 'studio.tl.freeze', addFreezeAtPlayhead),
    iconBtn('st-tl-btn ghost', 'rotate-ccw', tr('studio.tl.reset'), 'studio.tl.reset', () => {
      project = createDefaultStudioProject(dur, state!.config, Boolean(rec.tracks?.['camera.mp4']));
      selectedZoomId = null;
      applyStageStyles();
      applyAudioVolumes();
      renderInspector();
      renderTimeline();
    }),
  );

  // Trim In/Out compact controls on right side of timeline toolbar
  const trimWrap = el('div', 'st-trim-inline');
  const inVal = el('span', 'st-trim-val', formatDuration(project.trimStart * 1000));
  const outVal = el('span', 'st-trim-val', formatDuration(project.trimEnd * 1000));
  const inRange = el('input', 'st-range mini') as HTMLInputElement;
  inRange.type = 'range'; inRange.min = '0'; inRange.max = dur.toFixed(2); inRange.step = '0.05'; inRange.value = project.trimStart.toFixed(2);
  inRange.dataset.testid = 'recorder.review.trimStart';
  inRange.addEventListener('input', () => {
    project!.trimStart = Math.min(Number(inRange.value), Math.max(0, project!.trimEnd - 0.2));
    inRange.value = project!.trimStart.toFixed(2);
    inVal.textContent = formatDuration(project!.trimStart * 1000);
    seekTo(project!.trimStart);
    renderTimelineTracks();
  });
  const outRange = el('input', 'st-range mini') as HTMLInputElement;
  outRange.type = 'range'; outRange.min = '0'; outRange.max = dur.toFixed(2); outRange.step = '0.05'; outRange.value = project.trimEnd.toFixed(2);
  outRange.dataset.testid = 'recorder.review.trimEnd';
  outRange.addEventListener('input', () => {
    project!.trimEnd = Math.max(Number(outRange.value), project!.trimStart + 0.2);
    outRange.value = project!.trimEnd.toFixed(2);
    outVal.textContent = formatDuration(project!.trimEnd * 1000);
    renderTimelineTracks();
  });
  trimWrap.append(
    el('span', 'st-trim-lbl', tr('review.trimIn')), inRange, inVal,
    el('span', 'st-trim-lbl', tr('review.trimOut')), outRange, outVal,
  );

  tb.append(left, trimWrap);
  host.append(tb);

  const tracksHost = el('div', 'st-tracks-wrap');
  tracksHost.id = 'st-tracks-wrap';
  host.append(tracksHost);
  renderTimelineTracks();
}

function renderTimelineTracks() {
  const wrap = document.getElementById('st-tracks-wrap');
  if (!wrap || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  const dur = Math.max(0.1, totalDuration);
  wrap.replaceChildren();

  const pct = (sec: number) => `${Math.max(0, Math.min(100, (sec / dur) * 100)).toFixed(2)}%`;

  // Click/scrub anywhere on tracks area to move playhead
  const lanes = el('div', 'st-lanes');
  lanes.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.st-seg-chip')) return;
    const r = lanes.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    seekTo(frac * dur);
  });

  // Lane 1: Screen + Trim + Cuts + Speeds + Freezes
  const screenLane = el('div', 'st-lane');
  screenLane.append(el('span', 'st-lane-tag', tr('studio.lane.screen')));
  const activeClip = el('div', 'st-clip-bar');
  activeClip.style.left = pct(project.trimStart);
  activeClip.style.width = pct(Math.max(0.05, project.trimEnd - project.trimStart));
  screenLane.append(activeClip);

  for (const c of project.cuts) {
    const chip = el('button', 'st-seg-chip cut', tr('studio.tl.cut'));
    chip.style.left = pct(c.start);
    chip.style.width = `max(36px, ${pct(c.end - c.start)})`;
    chip.title = `${formatDuration(c.start * 1000)}–${formatDuration(c.end * 1000)} (${tr('studio.tl.clickRemove')})`;
    chip.addEventListener('click', e => {
      e.stopPropagation();
      project!.cuts = project!.cuts.filter(x => x.id !== c.id);
      renderTimelineTracks();
    });
    screenLane.append(chip);
  }
  for (const sp of project.speeds) {
    const chip = el('button', 'st-seg-chip speed', `${sp.rate}×`);
    chip.style.left = pct(sp.start);
    chip.style.width = `max(38px, ${pct(sp.end - sp.start)})`;
    chip.title = tr('studio.tl.speedHint');
    chip.addEventListener('click', e => {
      e.stopPropagation();
      if (e.shiftKey || e.altKey) {
        project!.speeds = project!.speeds.filter(x => x.id !== sp.id);
      } else {
        const order: (0.5 | 1.5 | 2)[] = [0.5, 1.5, 2];
        sp.rate = order[(order.indexOf(sp.rate) + 1) % order.length];
      }
      renderTimelineTracks();
    });
    screenLane.append(chip);
  }
  for (const fr of project.freezes) {
    const chip = el('button', 'st-seg-chip freeze', `${fr.duration}s`);
    chip.style.left = pct(fr.at);
    chip.style.width = '38px';
    chip.title = tr('studio.tl.clickRemove');
    chip.addEventListener('click', e => {
      e.stopPropagation();
      project!.freezes = project!.freezes.filter(x => x.id !== fr.id);
      renderTimelineTracks();
    });
    screenLane.append(chip);
  }
  lanes.append(screenLane);

  // Lane 2: Zoom track
  const zoomLane = el('div', 'st-lane');
  zoomLane.append(el('span', 'st-lane-tag', tr('studio.lane.zoom')));
  for (const z of project.zooms) {
    const chip = el('button', `st-seg-chip zoom${selectedZoomId === z.id ? ' on' : ''}`, `${z.scale.toFixed(1)}×`);
    chip.style.left = pct(z.start);
    chip.style.width = `max(44px, ${pct(z.end - z.start)})`;
    chip.addEventListener('click', e => {
      e.stopPropagation();
      selectedZoomId = z.id;
      activeTab = 'zoom';
      seekTo((z.start + z.end) * 0.5);
      renderRail();
      applyStageStyles();
      renderInspector();
      renderTimelineTracks();
    });
    zoomLane.append(chip);
  }
  lanes.append(zoomLane);

  // Lane 3: Camera & Audio indicators
  if (rec.tracks?.['camera.mp4'] || rec.tracks?.['mic.m4a'] || rec.tracks?.['system.m4a']) {
    const mediaLane = el('div', 'st-lane compact');
    const parts: string[] = [];
    if (rec.tracks?.['camera.mp4']) parts.push('camera.mp4');
    if (rec.tracks?.['mic.m4a']) parts.push(`mic ${Math.round(project.audio.micVolume * 100)}%`);
    if (rec.tracks?.['system.m4a']) parts.push(`sys ${Math.round(project.audio.systemVolume * 100)}%`);
    mediaLane.append(el('span', 'st-lane-tag', tr('studio.lane.tracks')));
    const bar = el('div', 'st-media-bar', parts.join('  ·  '));
    bar.style.left = pct(project.trimStart);
    bar.style.width = pct(Math.max(0.05, project.trimEnd - project.trimStart));
    mediaLane.append(bar);
    lanes.append(mediaLane);
  }

  // Playhead needle
  playheadEl = el('div', 'st-playhead');
  const cur = screenVideo?.currentTime ?? 0;
  playheadEl.style.left = pct(cur);
  lanes.append(playheadEl);

  wrap.append(lanes);
}

function renderPopovers() {
  const layer = document.getElementById('st-overlays');
  if (!layer || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  layer.replaceChildren();

  // AudioMerge popover
  if (audioPopOpen) {
    const pop = el('div', 'st-audio-pop');
    const hd = el('div', 'st-pop-hd');
    hd.append(el('strong', '', tr('studio.audio.title')));
    const close = el('button', 'st-icon-x');
    close.append(svgIcon('close', 14));
    close.addEventListener('click', () => { audioPopOpen = false; renderPopovers(); });
    hd.append(close);

    const mkMix = (iconName: IconName, lbl: string, vol: number, present: boolean, onChange: (v: number) => void) => {
      const box = el('div', `st-mix-row${present ? '' : ' off'}`);
      const top = el('div', 'st-field-top');
      const left = el('span', 'st-mix-lbl');
      left.append(svgIcon(iconName, 14), el('span', '', lbl));
      const valEl = el('span', 'st-field-val', present ? `${Math.round(vol * 100)}%` : tr('studio.audio.absent'));
      top.append(left, valEl);
      const inp = el('input', 'st-range') as HTMLInputElement;
      inp.type = 'range'; inp.min = '0'; inp.max = '2'; inp.step = '0.05'; inp.value = String(vol);
      inp.disabled = !present;
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        valEl.textContent = `${Math.round(v * 100)}%`;
        onChange(v);
        applyAudioVolumes();
        renderTimelineTracks();
      });
      box.append(top, inp);
      return box;
    };

    pop.append(
      hd,
      mkMix('mic', tr('studio.audio.mic'), project.audio.micVolume, Boolean(rec.tracks?.['mic.m4a']), v => { project!.audio.micVolume = v; }),
      mkMix('volume', tr('studio.audio.sys'), project.audio.systemVolume, Boolean(rec.tracks?.['system.m4a']), v => { project!.audio.systemVolume = v; }),
    );
    layer.append(pop);
  }

  // Export Modal (`#cap7`)
  if (exportModalOpen) {
    const backdrop = el('div', 'st-modal-backdrop');
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop && !state?.busyAction) {
        exportModalOpen = false;
        renderPopovers();
      }
    });
    const modal = el('div', 'st-modal');
    modal.dataset.testid = 'studio.export.modal';

    const hd = el('div', 'st-modal-hd');
    hd.append(el('h3', '', tr('studio.export.title')));
    const close = el('button', 'st-icon-x');
    close.append(svgIcon('close', 15));
    close.disabled = Boolean(state.busyAction);
    close.addEventListener('click', () => { exportModalOpen = false; renderPopovers(); });
    hd.append(close);

    // Format tabs
    const fmtRow = el('div', 'st-fmt-grid');
    const fmts: { id: 'mp4' | 'gif' | 'issue_bundle'; icon: IconName; title: string; note: string }[] = [
      { id: 'mp4', icon: 'save', title: 'MP4', note: tr('studio.export.mp4Note') },
      { id: 'gif', icon: 'film', title: 'GIF', note: tr('studio.export.gifNote') },
      { id: 'issue_bundle', icon: 'bug', title: tr('studio.export.issue'), note: tr('studio.export.issueNote') },
    ];
    for (const f of fmts) {
      const card = el('button', `st-fmt-card${exportFormat === f.id ? ' on' : ''}`);
      card.dataset.testid = `studio.export.fmt.${f.id}`;
      card.append(svgIcon(f.icon, 16), el('b', '', f.title), el('small', '', f.note));
      card.addEventListener('click', () => { exportFormat = f.id; lastExportResult = null; renderPopovers(); });
      fmtRow.append(card);
    }

    // FPS & Codec (for MP4 / Issue)
    const opts = el('div', 'st-modal-opts');
    if (exportFormat !== 'gif') {
      const fpsRow = el('div', 'st-opt-line');
      fpsRow.append(el('span', 'st-field-lbl', tr('studio.export.fps')));
      const seg = el('div', 'st-seg');
      for (const fps of [30, 60, 120] as RecordingFps[]) {
        const b = el('button', `st-seg-item${project.exportFps === fps ? ' on' : ''}`, fps === 120 ? '120Hz' : `${fps}`);
        b.addEventListener('click', () => { project!.exportFps = fps; renderPopovers(); });
        seg.append(b);
      }
      fpsRow.append(seg);

      const codecRow = el('div', 'st-opt-line');
      codecRow.append(el('span', 'st-field-lbl', tr('studio.export.codec')));
      const cseg = el('div', 'st-seg');
      for (const [c, lbl] of [['auto', tr('studio.bg.auto')], ['h264', 'H.264'], ['hevc', 'HEVC']] as [RecordingCodec, string][]) {
        const b = el('button', `st-seg-item${project.exportCodec === c ? ' on' : ''}`, lbl);
        b.addEventListener('click', () => { project!.exportCodec = c; renderPopovers(); });
        cseg.append(b);
      }
      codecRow.append(cseg);
      opts.append(fpsRow, codecRow);
    }

    // Destination checkboxes
    const dests = el('div', 'st-dest-list');
    const saveItem = el('div', 'st-dest-fixed');
    saveItem.append(svgIcon('check', 14), el('span', '', tr('studio.export.saveDir', { dir: state.saveDir })));
    dests.append(saveItem);

    if (exportFormat !== 'issue_bundle') {
      const mkCheck = (iconName: IconName, label: string, checked: boolean, onChange: (v: boolean) => void) => {
        const l = el('label', 'st-dest-check');
        const cb = el('input', 'switch') as HTMLInputElement;
        cb.type = 'checkbox'; cb.checked = checked;
        cb.addEventListener('change', () => onChange(cb.checked));
        l.append(cb, svgIcon(iconName, 14), el('span', '', label));
        return l;
      };
      dests.append(
        mkCheck('copy', tr('studio.export.copyClipboard'), exportCopyFile, v => { exportCopyFile = v; }),
        mkCheck('cloud', tr('studio.export.sendDrive'), exportSendDrive, v => { exportSendDrive = v; }),
      );
    }

    // Result banner if just finished
    if (lastExportResult) {
      const resBox = el('div', `st-export-res ${lastExportResult.ok ? 'ok' : 'err'}`);
      if (lastExportResult.ok) {
        const left = el('div', 'st-export-res-info');
        left.append(
          el('strong', '', lastExportResult.name ?? ''),
          el('small', '', `${lastExportResult.width ?? ''}×${lastExportResult.height ?? ''} · ${formatBytes(lastExportResult.bytes ?? 0)}`),
        );
        const reveal = iconBtn('st-btn', 'folder', tr('studio.export.reveal'), 'studio.export.reveal', () => {
          if (lastExportResult?.path) void post({ type: 'review-reveal-path', filePath: lastExportResult.path });
        });
        resBox.append(left, reveal);
      } else {
        resBox.append(el('span', '', tr('review.exportFailed')));
      }
      dests.append(resBox);
    }

    // Footer button
    const busy = Boolean(state.busyAction);
    const foot = el('div', 'st-modal-foot');
    const cancelBtn = el('button', 'st-btn', tr('action.close'));
    cancelBtn.disabled = busy;
    cancelBtn.addEventListener('click', () => { exportModalOpen = false; renderPopovers(); });
    const goBtn = iconBtn('st-btn primary', 'save', busy ? tr('review.working') : tr('studio.export.run'), 'studio.export.run', () => {
      lastExportResult = null;
      const recipe = buildExportRecipe(project!, exportFormat);
      void post({
        type: 'review-studio-export',
        id: rec.id,
        format: exportFormat,
        recipe,
        copyFile: exportCopyFile,
        sendDrive: exportSendDrive,
      });
      renderPopovers();
    });
    goBtn.disabled = busy;
    foot.append(cancelBtn, goBtn);

    modal.append(hd, fmtRow, opts, dests, foot);
    backdrop.append(modal);
    layer.append(backdrop);
  }
}

function renderShell() {
  cancelAnimationFrame(rafId);
  const root = $('review');
  root.replaceChildren();
  if (!state) return;

  const rec = state.activeRecord;
  const isNewRec = Boolean(rec && loadedRecordId !== rec.id);
  if (rec && isNewRec) {
    loadedRecordId = rec.id;
    totalDuration = Math.max(0.1, rec.duration_ms / 1000);
    project = createDefaultStudioProject(totalDuration, state.config, Boolean(rec.tracks?.['camera.mp4']));
    selectedZoomId = null;
    lastExportResult = null;
    exportFormat = state.issueMode ? 'issue_bundle' : 'mp4';
    void loadTelemetryViaHost(rec);
  }

  // ---- Top Studio Header
  const header = el('header', 'st-header');
  const hLeft = el('div', 'st-head-left');
  const histToggle = iconBtn(`st-btn${historyOpen ? ' on' : ''}`, 'sidebar', `${tr('review.history')} (${state.history.length})`, 'studio.history.toggle', () => {
    historyOpen = !historyOpen;
    const sb = document.getElementById('st-history-drawer');
    if (sb) sb.hidden = !historyOpen;
    histToggle.classList.toggle('on', historyOpen);
  });
  const titleBlock = el('div', 'st-head-title');
  titleBlock.append(
    el('strong', '', rec ? rec.source_title : tr('studio.title')),
    el('span', 'st-head-meta', rec ? `${formatDuration(rec.duration_ms)} · ${rec.target_fps ?? 60}Hz · ${(rec.codec ?? 'auto').toUpperCase()}` : tr('review.empty')),
  );
  hLeft.append(histToggle, titleBlock);

  const hRight = el('div', 'st-head-right');
  const mixBtn = iconBtn(`st-btn${audioPopOpen ? ' on' : ''}`, 'sliders', tr('studio.audio.btn'), 'studio.audio.btn', () => {
    audioPopOpen = !audioPopOpen;
    renderPopovers();
  });
  const newRecBtn = iconBtn('st-btn', 'record-dot', tr('review.newRecord'), 'recorder.review.new', () =>
    void post({ type: 'review-record-new', issueMode: false }));
  const issueExportBtn = iconBtn('st-btn issue', 'bug', tr('studio.export.issueBtn'), 'recorder.review.packIssue', () => {
    exportFormat = 'issue_bundle';
    exportModalOpen = true;
    audioPopOpen = false;
    lastExportResult = null;
    renderPopovers();
  });
  const exportBtn = iconBtn('st-btn primary', 'save', state.busyAction ? tr('review.working') : tr('studio.export.btn'), 'studio.export.open', () => {
    exportModalOpen = true;
    audioPopOpen = false;
    lastExportResult = null;
    renderPopovers();
  });
  exportBtn.disabled = !rec || !rec.playable;
  issueExportBtn.disabled = !rec || !rec.playable;
  mixBtn.disabled = !rec || !rec.playable;

  hRight.append(mixBtn, newRecBtn, issueExportBtn, exportBtn);
  header.append(hLeft, hRight);

  // ---- Workspace body (Optional History Drawer + Left Rail + Inspector + Center Stage)
  const workspace = el('div', 'st-workspace');

  // Collapsible History drawer
  const histDrawer = el('aside', 'st-history');
  histDrawer.id = 'st-history-drawer';
  histDrawer.hidden = !historyOpen;
  histDrawer.append(el('div', 'st-side-head', tr('review.history')));
  if (!state.history.length) {
    histDrawer.append(el('p', 'st-note', tr('review.historyEmpty')));
  } else {
    const list = el('div', 'review-history-list');
    for (const item of state.history) {
      const card = el('button', `review-hist-item${rec?.id === item.id ? ' on' : ''}`);
      card.dataset.testid = `recorder.review.history.${item.id}`;
      const metaParts = [formatDuration(item.duration_ms), formatBytes(item.bytes)];
      if (item.target_fps) metaParts.push(`${item.target_fps}Hz`);
      if (item.codec) metaParts.push(item.codec.toUpperCase());
      card.append(
        el('div', 'review-hist-title', item.source_title || item.id.slice(0, 8)),
        el('div', 'review-hist-meta', metaParts.join(' · ')),
      );
      card.addEventListener('click', () => {
        historyOpen = false;
        void post({ type: 'review-select', id: item.id });
      });
      list.append(card);
    }
    histDrawer.append(list);
  }

  if (!rec || !rec.playable || !project) {
    const empty = el('div', 'review-empty-card', rec?.error ? tr('review.failed', { error: rec.error }) : tr('review.emptyHint'));
    workspace.append(histDrawer, empty);
    root.append(header, workspace);
    return;
  }

  // Left icon rail + Inspector panel
  const rail = el('nav', 'st-rail');
  rail.id = 'st-rail';
  const inspector = el('aside', 'st-inspector');
  inspector.id = 'st-inspector';

  // Center Stage + Transport + Bottom Timeline
  const center = el('div', 'st-center');
  const stage = el('div', 'st-stage');
  stageWallEl = el('div', 'st-wallpaper');
  stageFrameEl = el('div', 'st-frame');

  screenVideo = el('video', 'st-video') as HTMLVideoElement;
  screenVideo.src = captureV2.trackURL(rec.id, 'capture.mp4');
  screenVideo.playsInline = true;
  screenVideo.preload = 'auto';
  screenVideo.dataset.testid = 'recorder.review.video';

  telCanvas = el('canvas', 'review-tel-canvas') as HTMLCanvasElement;
  keyBadgeEl = el('div', 'review-key-badge');
  keyBadgeEl.hidden = true;
  zoomFocusDot = el('div', 'st-zoom-dot');
  zoomFocusDot.hidden = true;

  // Clicking on the video stage sets Zoom focus (when on Zoom tab) or toggles playback
  stageFrameEl.addEventListener('click', e => {
    if (!screenVideo || !project) return;
    if (activeTab === 'zoom') {
      const selZ = project.zooms.find(z => z.id === selectedZoomId);
      if (selZ) {
        const r = screenVideo.getBoundingClientRect();
        selZ.x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
        selZ.y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)));
        applyStageStyles();
        renderInspector();
        return;
      }
    }
    togglePlayback();
  });

  stageFrameEl.append(screenVideo, telCanvas, keyBadgeEl, zoomFocusDot);

  camVideo = null;
  if (rec.tracks?.['camera.mp4']) {
    camVideo = el('video', 'st-cam-pip') as HTMLVideoElement;
    camVideo.src = captureV2.trackURL(rec.id, 'camera.mp4');
    camVideo.muted = true;
    camVideo.playsInline = true;
    camVideo.preload = 'auto';
    // Skip any dark warmup frame 0 on older recordings so preview immediately shows the speaker clearly.
    camVideo.addEventListener('loadedmetadata', () => {
      if (camVideo && screenVideo && screenVideo.currentTime < 0.05 && Number.isFinite(camVideo.duration) && camVideo.duration > 0.25) {
        camVideo.currentTime = 0.2;
      }
    });
    stageFrameEl.append(camVideo);
  }

  // Dual audio preview elements for AudioMerge
  micAudio = null;
  sysAudio = null;
  if (rec.tracks?.['mic.m4a']) {
    micAudio = el('audio') as HTMLAudioElement;
    micAudio.src = captureV2.trackURL(rec.id, 'mic.m4a');
    micAudio.preload = 'auto';
    stage.append(micAudio);
  }
  if (rec.tracks?.['system.m4a']) {
    sysAudio = el('audio') as HTMLAudioElement;
    sysAudio.src = captureV2.trackURL(rec.id, 'system.m4a');
    sysAudio.preload = 'auto';
    stage.append(sysAudio);
  }
  applyAudioVolumes();

  screenVideo.addEventListener('loadedmetadata', () => {
    if (screenVideo && Number.isFinite(screenVideo.duration) && screenVideo.duration > 0.05) {
      totalDuration = screenVideo.duration;
      if (project && Math.abs(project.trimEnd - rec.duration_ms / 1000) < 0.5) {
        project.trimEnd = totalDuration;
        renderTimeline();
      }
    }
  });
  screenVideo.addEventListener('play', () => {
    syncPlayButton();
    const cur = screenVideo!.currentTime;
    for (const m of [camVideo, micAudio, sysAudio]) {
      if (!m) continue;
      m.currentTime = cur;
      m.playbackRate = screenVideo!.playbackRate;
      void m.play().catch(() => {});
    }
  });
  screenVideo.addEventListener('pause', () => {
    syncPlayButton();
    camVideo?.pause();
    micAudio?.pause();
    sysAudio?.pause();
  });
  screenVideo.addEventListener('seeked', () => {
    const cur = screenVideo!.currentTime;
    for (const m of [camVideo, micAudio, sysAudio]) {
      if (m) m.currentTime = cur;
    }
  });

  stageWallEl.append(stageFrameEl);
  stage.append(stageWallEl);

  // Transport bar
  const transport = el('div', 'st-transport');
  playBtnEl = el('button', 'st-play-btn') as HTMLButtonElement;
  playBtnEl.dataset.testid = 'studio.transport.play';
  playBtnEl.append(svgIcon('play', 14));
  playBtnEl.addEventListener('click', togglePlayback);

  timecodeEl = el('span', 'st-timecode', `00:00 / ${formatDuration(totalDuration * 1000)}`);

  const speedSeg = el('div', 'st-seg');
  for (const sp of [0.5, 1, 1.5, 2]) {
    const b = el('button', `st-seg-item${previewSpeed === sp ? ' on' : ''}`, `${sp}×`);
    b.addEventListener('click', () => {
      previewSpeed = sp;
      if (screenVideo) screenVideo.playbackRate = sp;
      for (const btn of speedSeg.querySelectorAll('button')) btn.classList.toggle('on', btn.textContent === `${sp}×`);
    });
    speedSeg.append(b);
  }

  transport.append(playBtnEl, timecodeEl, speedSeg);

  // Bottom Multi-Track Timeline
  const timeline = el('section', 'st-timeline');
  timeline.id = 'st-timeline';

  center.append(stage, transport, timeline);
  workspace.append(histDrawer, rail, inspector, center);

  const overlays = el('div', 'st-overlays');
  overlays.id = 'st-overlays';

  root.append(header, workspace, overlays);

  renderRail();
  applyStageStyles();
  renderInspector();
  renderTimeline();
  renderPopovers();
  rafId = requestAnimationFrame(drawFrameLoop);
}

export async function startReview() {
  t = await i18n.catalog().catch(() => ({}));
  document.title = tr('studio.title');
  i18n.onDidChangeLocale(async () => {
    t = await i18n.catalog().catch(() => t);
    document.title = tr('studio.title');
    renderShell();
  });
  addEventListener('keydown', e => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayback();
    } else if (e.key === 'Escape') {
      if (exportModalOpen && !state?.busyAction) { exportModalOpen = false; renderPopovers(); }
      else if (audioPopOpen) { audioPopOpen = false; renderPopovers(); }
    }
  });
  channel.onMessage<ToReview>(m => {
    if (m?.type === 'review-state') {
      const prevRecId = state?.activeRecord?.id ?? null;
      const nextRecId = m.state.activeRecord?.id ?? null;
      state = m.state;
      // Avoid rebuilding <video> when only busyAction changed during export!
      if (prevRecId === nextRecId && screenVideo && project) {
        renderPopovers();
        const openBtn = document.querySelector<HTMLButtonElement>('[data-testid="studio.export.open"] span');
        if (openBtn) openBtn.textContent = state.busyAction ? tr('review.working') : tr('studio.export.btn');
      } else {
        renderShell();
      }
    } else if (m?.type === 'review-export-done') {
      lastExportResult = m.result;
      renderPopovers();
    } else if (m?.type === 'review-toast') {
      showToast(m.tone, m.message);
    }
  });
  await post({ type: 'review-ready' });
}
