// Studio 3-Pane Non-Destructive Dark Video Editor (`#cap6` + `#cap7`):
// - Exact dark palette (#131316 / #1b1b1e / #0e0e10) & violet accent (#6d5efc)
// - Topbar with 120fps Master & 240Hz Cursor pills, 50-step Undo/Redo, AudioMerge popover,
//   warm-amber Submit Issue, and violet Export button
// - 52px Icon Rail + 268px Contextual Inspector (6 global panels + per-segment editor)
// - Live Stage with floating status/zoom badges, wallpaper, synced camera.mp4 (auto-shrink on zoom),
//   draggable Text/Censor overlays, Captions, 240Hz left/right click ripples, and filtered Keystroke HUD
// - Integrated 5-Lane Timeline (Clip with draggable In/Out trim handles, Zoom, Edits, Overlays, Captions)
// - Two-column `#cap7` Hardware Export Modal with 4 presets, multi-select destinations, and live spec estimator
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import { captureV2, type CaptureRecordV2 } from '../platform.ts';
import type { FromReview, ReviewExportDone, ReviewState, ToReview } from '../protocol.ts';
import {
  detectFpsHealth,
  formatBytes,
  formatDuration,
  type CameraCorner,
  type CameraShape,
  type ClickSize,
  type KeystrokePosition,
} from '../recording.ts';
import {
  STUDIO_BACKGROUNDS,
  activeKeystrokes,
  autoGenerateZooms,
  buildExportRecipe,
  createDefaultStudioProject,
  estimateExportSpec,
  evaluateZoom,
  parseTelemetryJsonl,
  type ParsedTelemetryEvent,
  type StudioAspect,
  type StudioExportPresetId,
  type StudioProject,
  type StudioTab,
} from '../studio.ts';
import { svgIcon, type IconName } from './icons.ts';

type SelectedSeg =
  | { kind: 'zoom'; id: string }
  | { kind: 'cut'; id: string }
  | { kind: 'speed'; id: string }
  | { kind: 'freeze'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'caption'; id: string }
  | null;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromReview) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));

let state: ReviewState | null = null;
let project: StudioProject | null = null;
let undoStack: StudioProject[] = [];
let redoStack: StudioProject[] = [];
let loadedRecordId: string | null = null;
let totalDuration = 0.1;
let telemetry: ParsedTelemetryEvent[] = [];
let activeTab: StudioTab = 'bg';
let selectedSeg: SelectedSeg = null;
let zoomPreviewLocked = false;
let historyOpen = false;
let audioPopOpen = false;
let exportModalOpen = false;
let exportPreset: StudioExportPresetId = 'hevc120';
let exportCopyFile = true;
let exportSendDrive = false;
let exportRevealAfter = false;
let exportProgress = 0;
let lastExportResult: ReviewExportDone | null = null;
let previewSpeed = 1;
let rafId = 0;
let toastTimer = 0;

// Persistent mounted media elements (never destroyed on slider drag / tab switch)
let screenVideo: HTMLVideoElement | null = null;
let camWrapEl: HTMLElement | null = null;
let camVideo: HTMLVideoElement | null = null;
let micAudio: HTMLAudioElement | null = null;
let sysAudio: HTMLAudioElement | null = null;
let telCanvas: HTMLCanvasElement | null = null;
let stageOverlaysEl: HTMLElement | null = null;
let keyBadgeEl: HTMLElement | null = null;
let captionBarEl: HTMLElement | null = null;
let stageWallEl: HTMLElement | null = null;
let stageFrameEl: HTMLElement | null = null;
let stageZoomBadgeEl: HTMLElement | null = null;
let zoomFocusDot: HTMLElement | null = null;
let playBtnEl: HTMLButtonElement | null = null;
let timecodeEl: HTMLElement | null = null;
let playheadEl: HTMLElement | null = null;
let tlTipEl: HTMLElement | null = null;
let undoBtnEl: HTMLButtonElement | null = null;
let redoBtnEl: HTMLButtonElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtPrecise(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

function showToast(tone: 'success' | 'error', msg: string) {
  const box = $('review-toast');
  box.textContent = msg;
  box.className = `toast ${tone}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 3000) as unknown as number;
}

function iconBtn(cls: string, iconName: IconName, text: string, testid: string, onClick: (e: MouseEvent) => void) {
  const b = el('button', `${cls} ic-btn`);
  b.dataset.testid = testid;
  if (text) b.append(svgIcon(iconName, 14), el('span', '', text));
  else b.append(svgIcon(iconName, 14));
  b.addEventListener('click', onClick);
  return b;
}

function pushUndo() {
  if (!project) return;
  undoStack.push(structuredClone(project));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  syncUndoButtons();
}

function doUndo() {
  if (!project || !undoStack.length) return;
  redoStack.push(structuredClone(project));
  project = undoStack.pop()!;
  selectedSeg = null;
  syncUndoButtons();
  applyStageStyles();
  applyAudioVolumes();
  renderInspector();
  renderTimeline();
}

function doRedo() {
  if (!project || !redoStack.length) return;
  undoStack.push(structuredClone(project));
  project = redoStack.pop()!;
  selectedSeg = null;
  syncUndoButtons();
  applyStageStyles();
  applyAudioVolumes();
  renderInspector();
  renderTimeline();
}

function syncUndoButtons() {
  if (undoBtnEl) undoBtnEl.disabled = undoStack.length === 0;
  if (redoBtnEl) redoBtnEl.disabled = redoStack.length === 0;
}

async function loadTelemetryViaHost(rec: CaptureRecordV2) {
  telemetry = [];
  if (!rec.tracks?.['telemetry.jsonl']) return;
  try {
    const res = await captureV2.readTrack(rec.id, 'telemetry.jsonl');
    if (res?.content) {
      telemetry = parseTelemetryJsonl(res.content);
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

function currentSelectedZoom() {
  if (!project) return null;
  if (selectedSeg?.kind === 'zoom') return project.zooms.find(z => z.id === selectedSeg!.id) ?? null;
  return null;
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

  if (camWrapEl && camVideo) {
    const c = project.camera;
    camWrapEl.hidden = !c.enabled;
    camWrapEl.className = `st-cam-wrap ${c.shape} ${c.position}${activeTab === 'cam' ? ' active' : ''}`;
    const pct = Math.round(c.size * 100);
    camWrapEl.style.width = `${pct}%`;
    camWrapEl.style.aspectRatio = '1 / 1';
    camVideo.className = `st-cam-pip ${c.shape}${c.mirror ? ' mirror' : ''}`;
  }

  if (keyBadgeEl) {
    keyBadgeEl.dataset.pos = project.cursor.keyPosition;
  }

  if (zoomFocusDot) {
    const selZ = (activeTab === 'zoom' || selectedSeg?.kind === 'zoom') ? currentSelectedZoom() : null;
    if (selZ && zoomPreviewLocked) {
      zoomFocusDot.hidden = false;
      zoomFocusDot.style.left = `${(selZ.x * 100).toFixed(1)}%`;
      zoomFocusDot.style.top = `${(selZ.y * 100).toFixed(1)}%`;
    } else {
      zoomFocusDot.hidden = true;
    }
  }
  renderStageOverlays();
}

type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function renderStageOverlays() {
  if (!stageOverlaysEl || !project) return;
  const now = screenVideo?.currentTime ?? 0;
  const frameH = stageFrameEl?.clientHeight || 420;
  stageOverlaysEl.replaceChildren();

  // Interactive Zoom framing box on Stage when a Zoom segment is selected (and not zoom-locked)
  const selZ = currentSelectedZoom();
  if (selZ && !zoomPreviewLocked) {
    const zBox = el('div', 'st-zoom-box');
    const applyZoomBoxRect = () => {
      const bw = 1 / Math.max(1.05, selZ.scale);
      const bh = 1 / Math.max(1.05, selZ.scale);
      const bx = Math.max(0, Math.min(1 - bw, selZ.x - bw * 0.5));
      const by = Math.max(0, Math.min(1 - bh, selZ.y - bh * 0.5));
      zBox.style.left = `${(bx * 100).toFixed(2)}%`;
      zBox.style.top = `${(by * 100).toFixed(2)}%`;
      zBox.style.width = `${(bw * 100).toFixed(2)}%`;
      zBox.style.height = `${(bh * 100).toFixed(2)}%`;
    };
    applyZoomBoxRect();
    const tag = el('span', 'st-zoom-box-tag', `Zoom ${selZ.scale.toFixed(1)}×`);
    zBox.append(tag);
    for (const dir of ['nw', 'ne', 'sw', 'se'] as ResizeDir[]) {
      const h = el('div', `st-ov-hdl ${dir}`);
      h.addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (!stageFrameEl) return;
        pushUndo();
        const rect = stageFrameEl.getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const origScale = selZ.scale;
        const signX = dir.includes('e') ? 1 : -1;
        const signY = dir.includes('s') ? 1 : -1;
        const onMove = (ev: PointerEvent) => {
          const dx = ((ev.clientX - startX) / Math.max(1, rect.width)) * signX;
          const dy = ((ev.clientY - startY) / Math.max(1, rect.height)) * signY;
          const delta = (dx + dy) * 0.5;
          const origW = 1 / origScale;
          const newW = Math.max(1 / 2.6, Math.min(1 / 1.2, origW + delta * 2));
          selZ.scale = Math.round((1 / newW) * 10) / 10;
          tag.textContent = `Zoom ${selZ.scale.toFixed(1)}×`;
          applyZoomBoxRect();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          renderInspector();
          renderTimelineTracks();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      zBox.append(h);
    }
    zBox.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('.st-ov-hdl')) return;
      e.stopPropagation();
      if (!stageFrameEl) return;
      const rect = stageFrameEl.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const origX = selZ.x, origY = selZ.y;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) { pushUndo(); moved = true; }
        if (!moved) return;
        selZ.x = Math.max(0.05, Math.min(0.95, origX + (ev.clientX - startX) / Math.max(1, rect.width)));
        selZ.y = Math.max(0.05, Math.min(0.95, origY + (ev.clientY - startY) / Math.max(1, rect.height)));
        applyZoomBoxRect();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) renderInspector();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    stageOverlaysEl.append(zBox);
  }

  for (const ov of project.overlays) {
    const visible = now >= ov.start && now <= ov.end;
    const isSel = selectedSeg?.kind === 'overlay' && selectedSeg.id === ov.id;
    if (!visible && !isSel) continue;

    if (ov.kind === 'censor') {
      const box = el('div', `st-ov-censor${isSel ? ' on' : ''}`);
      box.style.left = `${(ov.x * 100).toFixed(2)}%`;
      box.style.top = `${(ov.y * 100).toFixed(2)}%`;
      box.style.width = `${(ov.w * 100).toFixed(2)}%`;
      box.style.height = `${(ov.h * 100).toFixed(2)}%`;
      if (!visible) box.style.opacity = '0.45';
      const tag = el('span', 'st-ov-censor-tag', tr('studio.tl.censor'));
      box.append(tag);
      for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeDir[]) {
        const h = el('div', `st-ov-hdl ${dir}`);
        wireOverlayResize(h, box, tag, ov.id, 'censor', dir);
        box.append(h);
      }
      wireStageDrag(box, ov.id, 'censor');
      stageOverlaysEl.append(box);
    } else {
      const pill = el('div', `st-ov-text${isSel ? ' on' : ''}`);
      pill.style.left = `${(ov.x * 100).toFixed(2)}%`;
      pill.style.top = `${(ov.y * 100).toFixed(2)}%`;
      pill.style.minWidth = `${(ov.w * 100).toFixed(2)}%`;
      pill.style.minHeight = `${(ov.h * 100).toFixed(2)}%`;
      pill.style.fontSize = `${Math.max(11, Math.min(34, Math.round(frameH * ov.h * 0.42)))}px`;
      pill.style.background = ov.color || '#6D5EFC';
      if (!visible) pill.style.opacity = '0.45';
      const txtSpan = el('span', 'st-ov-text-lbl', ov.text || tr('studio.cap.defaultText'));
      pill.append(txtSpan);
      for (const dir of ['nw', 'ne', 'sw', 'se', 'w', 'e'] as ResizeDir[]) {
        const h = el('div', `st-ov-hdl ${dir}`);
        wireOverlayResize(h, pill, txtSpan, ov.id, 'text', dir);
        pill.append(h);
      }
      wireStageDrag(pill, ov.id, 'text');
      stageOverlaysEl.append(pill);
    }
  }
}

function wireOverlayResize(
  handle: HTMLElement,
  node: HTMLElement,
  labelNode: HTMLElement,
  ovId: string,
  kind: 'text' | 'censor',
  dir: ResizeDir,
) {
  handle.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (!project || !stageFrameEl) return;
    selectedSeg = { kind: 'overlay', id: ovId };
    const ov = project.overlays.find(o => o.id === ovId);
    if (!ov) return;
    pushUndo();
    const rect = stageFrameEl.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const ox = ov.x, oy = ov.y, ow = ov.w, oh = ov.h;
    const origText = labelNode.textContent ?? '';

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / Math.max(1, rect.width);
      const dy = (ev.clientY - startY) / Math.max(1, rect.height);
      if (kind === 'censor') {
        let nx = ox, ny = oy, nw = ow, nh = oh;
        if (dir.includes('e')) nw = Math.max(0.04, Math.min(1 - ox, ow + dx));
        if (dir.includes('s')) nh = Math.max(0.03, Math.min(1 - oy, oh + dy));
        if (dir.includes('w')) {
          const maxShift = ow - 0.04;
          const shift = Math.max(-ox, Math.min(maxShift, dx));
          nx = ox + shift;
          nw = ow - shift;
        }
        if (dir.includes('n')) {
          const maxShift = oh - 0.03;
          const shift = Math.max(-oy, Math.min(maxShift, dy));
          ny = oy + shift;
          nh = oh - shift;
        }
        ov.x = nx; ov.y = ny; ov.w = nw; ov.h = nh;
        node.style.left = `${(nx * 100).toFixed(2)}%`;
        node.style.top = `${(ny * 100).toFixed(2)}%`;
        node.style.width = `${(nw * 100).toFixed(2)}%`;
        node.style.height = `${(nh * 100).toFixed(2)}%`;
        labelNode.textContent = `${Math.round(nw * 100)}% × ${Math.round(nh * 100)}%`;
      } else {
        // Text pill is centered at (ov.x, ov.y), so dragging either side resizes symmetrically
        let nw = ow, nh = oh;
        if (dir.includes('e')) nw = Math.max(0.08, Math.min(0.92, ow + dx * 2));
        if (dir.includes('w')) nw = Math.max(0.08, Math.min(0.92, ow - dx * 2));
        if (dir.includes('s')) nh = Math.max(0.04, Math.min(0.32, oh + dy * 2));
        if (dir.includes('n')) nh = Math.max(0.04, Math.min(0.32, oh - dy * 2));
        ov.w = nw; ov.h = nh;
        node.style.minWidth = `${(nw * 100).toFixed(2)}%`;
        node.style.minHeight = `${(nh * 100).toFixed(2)}%`;
        node.style.fontSize = `${Math.max(11, Math.min(34, Math.round(rect.height * nh * 0.42)))}px`;
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (kind === 'censor') labelNode.textContent = origText;
      renderStageOverlays();
      renderInspector();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function wireStageDrag(node: HTMLElement, ovId: string, kind: 'text' | 'censor') {
  node.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.st-ov-hdl')) return;
    e.stopPropagation();
    if (!project || !stageFrameEl) return;
    selectedSeg = { kind: 'overlay', id: ovId };
    renderInspector();
    renderTimelineTracks();
    const ov = project.overlays.find(o => o.id === ovId);
    if (!ov) return;
    const rect = stageFrameEl.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const origX = ov.x, origY = ov.y;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / Math.max(1, rect.width);
      const dy = (ev.clientY - startY) / Math.max(1, rect.height);
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) {
        pushUndo();
        moved = true;
      }
      if (!moved) return;
      if (kind === 'censor') {
        ov.x = Math.max(0, Math.min(1 - ov.w, origX + dx));
        ov.y = Math.max(0, Math.min(1 - ov.h, origY + dy));
      } else {
        ov.x = Math.max(0.05, Math.min(0.95, origX + dx));
        ov.y = Math.max(0.06, Math.min(0.94, origY + dy));
      }
      node.style.left = `${(ov.x * 100).toFixed(2)}%`;
      node.style.top = `${(ov.y * 100).toFixed(2)}%`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) { renderStageOverlays(); renderInspector(); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

let lastOverlayTickBucket = -1;

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

    // Live CSS Zoom preview matching Swift StudioExporter curve (plus lock-preview option)
    const selZ = currentSelectedZoom();
    const z = zoomPreviewLocked && selZ
      ? { scale: selZ.scale, x: selZ.x, y: selZ.y }
      : evaluateZoom(now, project.zooms);
    if (z.scale > 1.005) {
      screenVideo.style.transformOrigin = `${(z.x * 100).toFixed(2)}% ${(z.y * 100).toFixed(2)}%`;
      screenVideo.style.transform = `scale(${z.scale.toFixed(4)})`;
      if (stageZoomBadgeEl) {
        if (z.scale >= 1.05) {
          stageZoomBadgeEl.hidden = false;
          stageZoomBadgeEl.textContent = `Zoom ${z.scale.toFixed(1)}×`;
        } else {
          stageZoomBadgeEl.hidden = true;
        }
      }
    } else {
      screenVideo.style.transform = '';
      if (stageZoomBadgeEl) stageZoomBadgeEl.hidden = true;
    }

    // Camera auto-shrink during zoom (`avoidZoom`) — apply positive scale on outer wrapper so mirror never clips!
    if (camWrapEl && project.camera.enabled) {
      const zoomFactor = Math.max(0, Math.min(1, (z.scale - 1) / 0.5));
      const shrink = project.camera.avoidZoom ? 1 - 0.28 * zoomFactor : 1;
      camWrapEl.style.transform = shrink < 0.999 ? `scale(${shrink.toFixed(3)})` : '';
    }

    // Update timecode & playhead
    if (timecodeEl) {
      timecodeEl.textContent = `${fmtPrecise(now)} / ${fmtPrecise(dur)}`;
    }
    if (playheadEl) {
      const pct = Math.max(0, Math.min(100, (now / dur) * 100));
      playheadEl.style.left = `${pct.toFixed(2)}%`;
    }

    // Refresh timed overlays at ~15Hz
    const bucket = Math.floor(now * 15);
    if (bucket !== lastOverlayTickBucket) {
      lastOverlayTickBucket = bucket;
      renderStageOverlays();
    }

    // Active caption bar
    let captionActive = false;
    if (captionBarEl) {
      const cap = project.showCaptions
        ? project.captions.find(c => now >= c.start && now <= c.end)
        : undefined;
      if (cap && cap.text.trim()) {
        captionBarEl.textContent = cap.text;
        captionBarEl.hidden = false;
        captionActive = true;
      } else {
        captionBarEl.hidden = true;
      }
    }

    // Draw 240Hz click ripples (left/right button colors) & filtered Keystroke HUD
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
            const leftCol = project.cursor.clickColor || '#8B7DFF';
            const rightCol = project.cursor.rightClickColor || '#FFB833';
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
                  const col = ev.btn === 'right' ? rightCol : leftCol;
                  ctx.save();
                  ctx.strokeStyle = col;
                  ctx.globalAlpha = a * 0.92;
                  ctx.lineWidth = 3 * (1 - p * 0.45);
                  ctx.beginPath();
                  ctx.arc(cx, cy, r, 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.fillStyle = col;
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
        const validKeys = activeKeystrokes(telemetry, project);
        let latestKey: ParsedTelemetryEvent | null = null;
        for (let i = validKeys.length - 1; i >= 0; i--) {
          const ev = validKeys[i];
          if (now >= ev.t && now - ev.t <= 1.35) {
            latestKey = ev;
            break;
          }
        }
        if (latestKey?.label) {
          keyBadgeEl.textContent = latestKey.label;
          keyBadgeEl.style.bottom = captionActive ? '54px' : '16px';
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
  playBtnEl.replaceChildren(
    svgIcon(screenVideo.paused ? 'play' : 'pause', 12),
    el('span', '', tr(screenVideo.paused ? 'hud.resume' : 'hud.pause')),
  );
}

function seekTo(sec: number) {
  if (!screenVideo) return;
  const clamped = Math.max(0, Math.min(totalDuration, sec));
  screenVideo.currentTime = clamped;
  if (camVideo) camVideo.currentTime = clamped;
  if (micAudio) micAudio.currentTime = clamped;
  if (sysAudio) sysAudio.currentTime = clamped;
  lastOverlayTickBucket = -1;
}

// ---- Reusable sleek dark controls
function rowSlider(
  lbl: string,
  val: number,
  min: number,
  max: number,
  step: number,
  unit: string,
  onChange: (v: number) => void,
  onCommit?: () => void,
) {
  const wrap = el('div', 'st-field');
  const top = el('div', 'st-field-top');
  const valEl = el('span', 'st-field-val', `${Math.round(val * 100) / 100}${unit}`);
  top.append(el('span', 'st-field-lbl', lbl), valEl);
  const inp = el('input', 'st-range') as HTMLInputElement;
  inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val);
  let snapshotDone = false;
  inp.addEventListener('pointerdown', () => { snapshotDone = false; });
  inp.addEventListener('input', () => {
    if (!snapshotDone) { pushUndo(); snapshotDone = true; }
    const v = Number(inp.value);
    valEl.textContent = `${Math.round(v * 100) / 100}${unit}`;
    onChange(v);
  });
  inp.addEventListener('change', () => { onCommit?.(); });
  wrap.append(top, inp);
  return wrap;
}

function rowToggle(lbl: string, checked: boolean, onChange: (v: boolean) => void) {
  const wrap = el('div', 'st-switch-row');
  wrap.append(el('span', 'st-switch-lbl', lbl));
  const btn = el('button', `st-toggle${checked ? ' on' : ''}`);
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(checked));
  btn.append(el('span', 'st-toggle-knob'));
  btn.addEventListener('click', () => {
    pushUndo();
    onChange(!checked);
  });
  wrap.append(btn);
  return wrap;
}

function renderSegmentInspector(panel: HTMLElement): boolean {
  if (!project || !selectedSeg) return false;
  const dur = Math.max(0.1, totalDuration);

  const head = el('div', 'st-seg-head');
  const backBtn = el('button', 'st-mini-btn', `← ${tr('studio.seg.back')}`);
  backBtn.addEventListener('click', () => {
    selectedSeg = null;
    applyStageStyles();
    renderInspector();
    renderTimelineTracks();
  });
  head.append(backBtn);

  if (selectedSeg.kind === 'zoom') {
    const z = project.zooms.find(x => x.id === selectedSeg!.id);
    if (!z) { selectedSeg = null; return false; }
    const delBtn = iconBtn('st-mini-btn danger', 'trash', tr('studio.seg.delete'), 'studio.seg.del', () => {
      pushUndo();
      project!.zooms = project!.zooms.filter(x => x.id !== z.id);
      selectedSeg = null;
      applyStageStyles(); renderInspector(); renderTimelineTracks();
    });
    head.append(delBtn);
    panel.append(
      head,
      el('div', 'st-panel-head', undefined),
    );
    const title = panel.lastElementChild!;
    title.append(el('span', '', `Zoom ${z.scale.toFixed(1)}×`), el('span', 'st-pill acc', tr('studio.lane.zoom')));
    panel.append(
      rowSlider(tr('studio.zoom.scale'), z.scale, 1.2, 2.6, 0.1, '×', v => { z.scale = v; renderTimelineTracks(); }),
      rowSlider(tr('studio.seg.start'), z.start, 0, Math.max(0.1, z.end - 0.3), 0.05, 's', v => { z.start = v; seekTo(v); renderTimelineTracks(); }),
      rowSlider(tr('studio.seg.end'), z.end, Math.min(dur, z.start + 0.3), dur, 0.05, 's', v => { z.end = v; renderTimelineTracks(); }),
      rowSlider('X', Math.round(z.x * 100), 0, 100, 1, '%', v => { z.x = v / 100; applyStageStyles(); }),
      rowSlider('Y', Math.round(z.y * 100), 0, 100, 1, '%', v => { z.y = v / 100; applyStageStyles(); }),
      rowToggle(tr('studio.zoom.lock'), zoomPreviewLocked, v => { zoomPreviewLocked = v; renderInspector(); }),
      el('p', 'st-note', tr('studio.zoom.clickStage')),
    );
    return true;
  }

  if (selectedSeg.kind === 'cut') {
    const c = project.cuts.find(x => x.id === selectedSeg!.id);
    if (!c) { selectedSeg = null; return false; }
    const delBtn = iconBtn('st-mini-btn danger', 'trash', tr('studio.seg.delete'), 'studio.seg.del', () => {
      pushUndo();
      project!.cuts = project!.cuts.filter(x => x.id !== c.id);
      selectedSeg = null;
      renderInspector(); renderTimelineTracks();
    });
    head.append(delBtn);
    const title = el('div', 'st-panel-head');
    title.append(el('span', '', tr('studio.tl.cut')), el('span', 'st-pill red', tr('studio.lane.edits')));
    panel.append(
      head, title,
      rowSlider(tr('studio.seg.start'), c.start, 0, Math.max(0.1, c.end - 0.15), 0.05, 's', v => { c.start = v; seekTo(v); renderTimelineTracks(); }),
      rowSlider(tr('studio.seg.end'), c.end, Math.min(dur, c.start + 0.15), dur, 0.05, 's', v => { c.end = v; renderTimelineTracks(); }),
    );
    return true;
  }

  if (selectedSeg.kind === 'speed') {
    const sp = project.speeds.find(x => x.id === selectedSeg!.id);
    if (!sp) { selectedSeg = null; return false; }
    const delBtn = iconBtn('st-mini-btn danger', 'trash', tr('studio.seg.delete'), 'studio.seg.del', () => {
      pushUndo();
      project!.speeds = project!.speeds.filter(x => x.id !== sp.id);
      selectedSeg = null;
      renderInspector(); renderTimelineTracks();
    });
    head.append(delBtn);
    const title = el('div', 'st-panel-head');
    title.append(el('span', '', `${tr('studio.tl.speed')} ${sp.rate}×`), el('span', 'st-pill cyn', tr('studio.lane.edits')));
    const rateSeg = el('div', 'st-seg');
    for (const r of [0.5, 1.5, 2] as const) {
      const b = el('button', `st-seg-item${sp.rate === r ? ' on' : ''}`, `${r}×`);
      b.addEventListener('click', () => { pushUndo(); sp.rate = r; renderInspector(); renderTimelineTracks(); });
      rateSeg.append(b);
    }
    panel.append(
      head, title,
      el('div', 'st-field-lbl', tr('studio.tl.speed')),
      rateSeg,
      rowSlider(tr('studio.seg.start'), sp.start, 0, Math.max(0.1, sp.end - 0.2), 0.05, 's', v => { sp.start = v; seekTo(v); renderTimelineTracks(); }),
      rowSlider(tr('studio.seg.end'), sp.end, Math.min(dur, sp.start + 0.2), dur, 0.05, 's', v => { sp.end = v; renderTimelineTracks(); }),
    );
    return true;
  }

  if (selectedSeg.kind === 'freeze') {
    const fr = project.freezes.find(x => x.id === selectedSeg!.id);
    if (!fr) { selectedSeg = null; return false; }
    const delBtn = iconBtn('st-mini-btn danger', 'trash', tr('studio.seg.delete'), 'studio.seg.del', () => {
      pushUndo();
      project!.freezes = project!.freezes.filter(x => x.id !== fr.id);
      selectedSeg = null;
      renderInspector(); renderTimelineTracks();
    });
    head.append(delBtn);
    const title = el('div', 'st-panel-head');
    title.append(el('span', '', tr('studio.tl.freeze')), el('span', 'st-pill blu', tr('studio.lane.edits')));
    panel.append(
      head, title,
      rowSlider(tr('studio.seg.start'), fr.at, 0, dur, 0.05, 's', v => { fr.at = v; seekTo(v); renderTimelineTracks(); }),
      rowSlider(tr('studio.seg.duration'), fr.duration, 0.3, 4.0, 0.1, 's', v => { fr.duration = v; renderTimelineTracks(); }),
    );
    return true;
  }

  if (selectedSeg.kind === 'overlay') {
    const ov = project.overlays.find(x => x.id === selectedSeg!.id);
    if (!ov) { selectedSeg = null; return false; }
    const delBtn = iconBtn('st-mini-btn danger', 'trash', tr('studio.seg.delete'), 'studio.seg.del', () => {
      pushUndo();
      project!.overlays = project!.overlays.filter(x => x.id !== ov.id);
      selectedSeg = null;
      applyStageStyles(); renderInspector(); renderTimelineTracks();
    });
    head.append(delBtn);
    const title = el('div', 'st-panel-head');
    title.append(
      el('span', '', tr(ov.kind === 'censor' ? 'studio.tl.censor' : 'studio.tl.text')),
      el('span', `st-pill ${ov.kind === 'censor' ? 'red' : 'org'}`, tr('studio.lane.overlays')),
    );
    panel.append(head, title);
    if (ov.kind === 'text') {
      const inp = el('input', 'st-text-input') as HTMLInputElement;
      inp.value = ov.text ?? '';
      inp.placeholder = tr('studio.cap.defaultText');
      inp.addEventListener('input', () => { ov.text = inp.value; renderStageOverlays(); renderTimelineTracks(); });
      const cols = el('div', 'st-color-row');
      for (const c of ['#6D5EFC', '#FF3B30', '#FFB833', '#1AB39E', '#18181B']) {
        const sw = el('button', `st-color-dot${(ov.color ?? '#6D5EFC') === c ? ' on' : ''}`);
        sw.style.background = c;
        sw.addEventListener('click', () => { pushUndo(); ov.color = c; renderStageOverlays(); renderInspector(); });
        cols.append(sw);
      }
      panel.append(
        el('div', 'st-field-lbl', tr('studio.seg.text')), inp,
        el('div', 'st-field-lbl', tr('studio.seg.color')), cols,
        rowSlider('W', Math.round(ov.w * 100), 8, 92, 1, '%', v => { ov.w = v / 100; renderStageOverlays(); }),
        rowSlider('H', Math.round(ov.h * 100), 4, 32, 1, '%', v => { ov.h = v / 100; renderStageOverlays(); }),
      );
    } else {
      panel.append(
        rowSlider(tr('studio.seg.pixel'), ov.pixelSize ?? 16, 8, 32, 2, 'px', v => { ov.pixelSize = v; renderStageOverlays(); }),
        rowSlider('W', Math.round(ov.w * 100), 6, 70, 1, '%', v => { ov.w = v / 100; renderStageOverlays(); }),
        rowSlider('H', Math.round(ov.h * 100), 4, 60, 1, '%', v => { ov.h = v / 100; renderStageOverlays(); }),
      );
    }
    panel.append(
      rowSlider(tr('studio.seg.start'), ov.start, 0, Math.max(0.1, ov.end - 0.2), 0.05, 's', v => { ov.start = v; seekTo(v); renderTimelineTracks(); renderStageOverlays(); }),
      rowSlider(tr('studio.seg.end'), ov.end, Math.min(dur, ov.start + 0.2), dur, 0.05, 's', v => { ov.end = v; renderTimelineTracks(); renderStageOverlays(); }),
      el('p', 'st-note', tr('studio.seg.dragHint')),
    );
    return true;
  }

  if (selectedSeg.kind === 'caption') {
    const cap = project.captions.find(x => x.id === selectedSeg!.id);
    if (!cap) { selectedSeg = null; return false; }
    const delBtn = iconBtn('st-mini-btn danger', 'trash', tr('studio.seg.delete'), 'studio.seg.del', () => {
      pushUndo();
      project!.captions = project!.captions.filter(x => x.id !== cap.id);
      selectedSeg = null;
      renderInspector(); renderTimelineTracks();
    });
    head.append(delBtn);
    const title = el('div', 'st-panel-head');
    title.append(el('span', '', tr('studio.tl.caption')), el('span', 'st-pill neu', tr('studio.lane.captions')));
    const area = el('textarea', 'st-textarea') as HTMLTextAreaElement;
    area.rows = 3;
    area.value = cap.text;
    area.placeholder = tr('studio.cap.defaultCaption');
    area.addEventListener('input', () => { cap.text = area.value; renderTimelineTracks(); });
    panel.append(
      head, title,
      el('div', 'st-field-lbl', tr('studio.seg.text')),
      area,
      rowSlider(tr('studio.seg.start'), cap.start, 0, Math.max(0.1, cap.end - 0.2), 0.05, 's', v => { cap.start = v; seekTo(v); renderTimelineTracks(); }),
      rowSlider(tr('studio.seg.end'), cap.end, Math.min(dur, cap.start + 0.2), dur, 0.05, 's', v => { cap.end = v; renderTimelineTracks(); }),
    );
    return true;
  }
  return false;
}

// ---- Left Contextual Inspector (`268px`)
function renderInspector() {
  const panel = document.getElementById('st-inspector');
  if (!panel || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  panel.replaceChildren();

  if (renderSegmentInspector(panel)) return;

  const panelHead = (title: string, badge?: string, badgeTone = 'neu') => {
    const h = el('div', 'st-panel-head');
    h.append(el('span', '', title));
    if (badge) h.append(el('span', `st-pill ${badgeTone}`, badge));
    return h;
  };

  if (activeTab === 'bg') {
    panel.append(panelHead(`${tr('studio.tab.bg')} · Background`, tr('studio.badge.lossless'), 'neu'));
    panel.append(el('div', 'st-field-lbl', tr('studio.bg.presets')));
    const swatches = el('div', 'st-bg-grid');
    for (const bg of STUDIO_BACKGROUNDS) {
      const b = el('button', `st-bg-swatch${project.background.presetId === bg.id ? ' on' : ''}`);
      b.title = tr(bg.labelKey);
      if (bg.type === 'gradient') b.style.background = `linear-gradient(135deg, ${bg.colors[0]}, ${bg.colors[1]})`;
      else if (bg.type === 'solid') b.style.background = bg.colors[0];
      else b.classList.add('none');
      b.addEventListener('click', () => {
        pushUndo();
        project!.background.presetId = bg.id;
        project!.background.type = bg.type;
        project!.background.colors = [...bg.colors] as [string, string];
        applyStageStyles();
        renderInspector();
      });
      swatches.append(b);
    }
    panel.append(swatches);

    const aspectSeg = el('div', 'st-seg five');
    for (const asp of ['auto', '16:10', '16:9', '9:16', '1:1'] as StudioAspect[]) {
      const b = el('button', `st-seg-item${project.background.aspect === asp ? ' on' : ''}`, asp === 'auto' ? tr('studio.bg.auto') : asp);
      b.addEventListener('click', () => {
        pushUndo();
        project!.background.aspect = asp;
        applyStageStyles();
        renderInspector();
      });
      aspectSeg.append(b);
    }
    panel.append(
      rowSlider(tr('studio.bg.padding'), project.background.padding, 0, 120, 4, 'px', v => { project!.background.padding = v; applyStageStyles(); }),
      rowSlider(tr('studio.bg.radius'), project.background.radius, 0, 36, 2, 'px', v => { project!.background.radius = v; applyStageStyles(); }),
      el('div', 'st-field-lbl', tr('studio.bg.aspect')),
      aspectSeg,
      rowToggle(tr('studio.bg.shadow'), project.background.shadow, v => { project!.background.shadow = v; applyStageStyles(); renderInspector(); }),
    );
  } else if (activeTab === 'cursor') {
    panel.append(panelHead(`${tr('studio.tab.cursor')} · Pointer`, '240Hz', 'cyn'));
    panel.append(
      rowSlider(tr('studio.cursor.smooth'), project.cursor.smooth, 0, 100, 5, '%', v => { project!.cursor.smooth = v; }),
      rowToggle(tr('rec.clicks.enable'), project.cursor.clicks, v => { project!.cursor.clicks = v; renderInspector(); }),
    );
    const leftCols = el('div', 'st-color-row');
    for (const c of ['#8B7DFF', '#FF3B30', '#1AB39E', '#FFB833', '#0A84FF', '#FFFFFF']) {
      const sw = el('button', `st-color-dot${project.cursor.clickColor === c ? ' on' : ''}`);
      sw.style.background = c;
      sw.addEventListener('click', () => { pushUndo(); project!.cursor.clickColor = c; renderInspector(); });
      leftCols.append(sw);
    }
    const rightCols = el('div', 'st-color-row');
    for (const c of ['#FFB833', '#FF5F57', '#1AB39E', '#8B7DFF', '#FFFFFF']) {
      const sw = el('button', `st-color-dot${project.cursor.rightClickColor === c ? ' on' : ''}`);
      sw.style.background = c;
      sw.addEventListener('click', () => { pushUndo(); project!.cursor.rightClickColor = c; renderInspector(); });
      rightCols.append(sw);
    }
    const sizeSeg = el('div', 'st-seg');
    for (const sz of ['sm', 'md', 'lg'] as ClickSize[]) {
      const b = el('button', `st-seg-item${project.cursor.clickSize === sz ? ' on' : ''}`, sz.toUpperCase());
      b.addEventListener('click', () => { pushUndo(); project!.cursor.clickSize = sz; renderInspector(); });
      sizeSeg.append(b);
    }
    const clickCount = telemetry.filter(e => e.kind === 'click').length;
    panel.append(
      el('div', 'st-field-lbl', tr('studio.cursor.leftColor')), leftCols,
      el('div', 'st-field-lbl', tr('studio.cursor.rightColor')), rightCols,
      el('div', 'st-field-lbl', tr('option.width')), sizeSeg,
      rowToggle(tr('studio.cursor.sound'), project.cursor.clickSound, v => { project!.cursor.clickSound = v; renderInspector(); }),
      el('p', 'st-note', tr('studio.cursor.count', { n: clickCount })),
    );
  } else if (activeTab === 'zoom') {
    panel.append(panelHead(`${tr('studio.tab.zoom')} · Zoom`, tr('studio.badge.autoZoom'), 'acc'));
    const actions = el('div', 'st-btn-row');
    actions.append(
      iconBtn('st-btn primary', 'sparkles', tr('studio.zoom.auto'), 'studio.zoom.auto', () => {
        const gen = autoGenerateZooms(telemetry, totalDuration);
        if (!gen.length) { showToast('error', tr('studio.zoom.noClicks')); return; }
        pushUndo();
        project!.zooms = gen;
        selectedSeg = { kind: 'zoom', id: gen[0].id };
        applyStageStyles(); renderInspector(); renderTimelineTracks();
        showToast('success', tr('studio.zoom.autoDone', { n: gen.length }));
      }),
      iconBtn('st-btn', 'plus', tr('studio.zoom.add'), 'studio.zoom.add', () => addZoomAtPlayhead()),
    );
    panel.append(actions);
    panel.append(rowToggle(tr('studio.zoom.lock'), zoomPreviewLocked, v => { zoomPreviewLocked = v; renderInspector(); }));

    if (!project.zooms.length) {
      panel.append(el('p', 'st-note', tr('studio.zoom.empty')));
    } else {
      const list = el('div', 'st-item-list');
      for (const z of project.zooms) {
        const row = el('div', 'st-list-item');
        const main = el('button', 'st-list-main', `${z.scale.toFixed(1)}× · ${fmtPrecise(z.start)}–${fmtPrecise(z.end)}`);
        main.addEventListener('click', () => {
          selectedSeg = { kind: 'zoom', id: z.id };
          seekTo((z.start + z.end) * 0.5);
          applyStageStyles(); renderInspector(); renderTimelineTracks();
        });
        const del = el('button', 'st-list-del');
        del.append(svgIcon('trash', 13));
        del.addEventListener('click', () => {
          pushUndo();
          project!.zooms = project!.zooms.filter(x => x.id !== z.id);
          applyStageStyles(); renderInspector(); renderTimelineTracks();
        });
        row.append(main, del);
        list.append(row);
      }
      panel.append(list);
    }
  } else if (activeTab === 'keys') {
    panel.append(panelHead(`${tr('studio.tab.keys')} · Keystrokes`, tr('studio.badge.shield'), 'org'));
    panel.append(rowToggle(tr('rec.keys.enable'), project.cursor.keystrokes, v => { project!.cursor.keystrokes = v; renderInspector(); }));

    const filterSeg = el('div', 'st-seg');
    for (const [shortOnly, lbl] of [[false, tr('rec.keys.allKeys')], [true, tr('rec.keys.shortcutsOnly')]] as const) {
      const b = el('button', `st-seg-item${project.cursor.shortcutsOnly === shortOnly ? ' on' : ''}`, lbl);
      b.addEventListener('click', () => { pushUndo(); project!.cursor.shortcutsOnly = shortOnly; renderInspector(); });
      filterSeg.append(b);
    }
    const posSeg = el('div', 'st-seg');
    for (const [pos, lbl] of [['bottom-left', tr('align.left')], ['bottom-center', tr('align.center')], ['bottom-right', tr('align.right')]] as [KeystrokePosition, string][]) {
      const b = el('button', `st-seg-item${project.cursor.keyPosition === pos ? ' on' : ''}`, lbl);
      b.addEventListener('click', () => { pushUndo(); project!.cursor.keyPosition = pos; applyStageStyles(); renderInspector(); });
      posSeg.append(b);
    }
    panel.append(
      el('div', 'st-field-lbl', tr('studio.keys.filter')), filterSeg,
      el('div', 'st-field-lbl', tr('studio.keys.position')), posSeg,
    );

    const keyEvents = activeKeystrokes(telemetry, project);
    const listHead = el('div', 'st-field-top');
    listHead.append(el('span', 'st-field-lbl', tr('studio.keys.listTitle')));
    if (project.cursor.excludedKeyTimes.length > 0) {
      const restore = el('button', 'st-mini-btn', tr('studio.keys.restore', { n: project.cursor.excludedKeyTimes.length }));
      restore.addEventListener('click', () => { pushUndo(); project!.cursor.excludedKeyTimes = []; renderInspector(); });
      listHead.append(restore);
    }
    panel.append(listHead);

    if (!keyEvents.length) {
      panel.append(el('p', 'st-note', tr('studio.keys.empty')));
    } else {
      const list = el('div', 'st-item-list scroll');
      for (const ev of keyEvents.slice(0, 60)) {
        const row = el('div', 'st-list-item');
        const main = el('button', 'st-list-main');
        main.append(el('kbd', 'st-kbd', ev.label ?? ''), el('span', 'st-kbd-t', fmtPrecise(ev.t)));
        main.addEventListener('click', () => seekTo(ev.t + 0.05));
        const del = el('button', 'st-list-del');
        del.title = tr('studio.seg.delete');
        del.append(svgIcon('close', 12));
        del.addEventListener('click', () => {
          pushUndo();
          project!.cursor.excludedKeyTimes.push(ev.t);
          renderInspector();
        });
        row.append(main, del);
        list.append(row);
      }
      panel.append(list);
    }
  } else if (activeTab === 'cam') {
    panel.append(panelHead(`${tr('studio.tab.cam')} · Camera`, tr('studio.badge.track'), 'grn'));
    const hasCam = Boolean(rec.tracks?.['camera.mp4']);
    if (!hasCam) {
      panel.append(el('p', 'st-note', tr('studio.cam.none')));
    } else {
      panel.append(rowToggle(tr('studio.cam.show'), project.camera.enabled, v => { project!.camera.enabled = v; applyStageStyles(); renderInspector(); }));
      const shapeSeg = el('div', 'st-seg');
      for (const [sh, lbl] of [['circle', tr('rec.cam.circle')], ['rounded', tr('rec.cam.rounded')], ['rect', tr('rec.cam.rect')]] as [CameraShape, string][]) {
        const b = el('button', `st-seg-item${project.camera.shape === sh ? ' on' : ''}`, lbl);
        b.addEventListener('click', () => { pushUndo(); project!.camera.shape = sh; applyStageStyles(); renderInspector(); });
        shapeSeg.append(b);
      }
      const posSeg = el('div', 'st-seg four');
      for (const [corner, lbl] of [['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']] as [CameraCorner, string][]) {
        const b = el('button', `st-seg-item${project.camera.position === corner ? ' on' : ''}`, lbl);
        b.addEventListener('click', () => { pushUndo(); project!.camera.position = corner; applyStageStyles(); renderInspector(); });
        posSeg.append(b);
      }
      panel.append(
        el('div', 'st-field-lbl', tr('studio.cam.shape')), shapeSeg,
        el('div', 'st-field-lbl', tr('studio.cam.corner')), posSeg,
        rowSlider(tr('studio.cam.size'), Math.round(project.camera.size * 100), 12, 34, 1, '%', v => { project!.camera.size = v / 100; applyStageStyles(); }),
        rowToggle(tr('rec.cam.mirror'), project.camera.mirror, v => { project!.camera.mirror = v; applyStageStyles(); renderInspector(); }),
        rowToggle(tr('studio.cam.avoidZoom'), project.camera.avoidZoom, v => { project!.camera.avoidZoom = v; renderInspector(); }),
      );
    }
  } else if (activeTab === 'cap') {
    panel.append(panelHead(tr('studio.cap.title'), `${project.overlays.length + project.captions.length}`, 'neu'));
    panel.append(rowToggle(tr('studio.cap.show'), project.showCaptions, v => { project!.showCaptions = v; renderInspector(); }));
    const btns = el('div', 'st-btn-col');
    btns.append(
      iconBtn('st-btn', 'type', tr('studio.cap.addText'), 'studio.cap.addText', () => addOverlayAtPlayhead('text')),
      iconBtn('st-btn', 'grid', tr('studio.cap.addCensor'), 'studio.cap.addCensor', () => addOverlayAtPlayhead('censor')),
      iconBtn('st-btn primary', 'message-square', tr('studio.cap.addCaption'), 'studio.cap.addCaption', () => addCaptionAtPlayhead()),
    );
    panel.append(btns);

    if (!project.overlays.length && !project.captions.length) {
      panel.append(el('p', 'st-note', tr('studio.cap.empty')));
    } else {
      const list = el('div', 'st-item-list scroll');
      for (const ov of project.overlays) {
        const row = el('div', 'st-list-item');
        const main = el('button', 'st-list-main', `${ov.kind === 'censor' ? '▦ ' + tr('studio.tl.censor') : 'T ' + (ov.text || tr('studio.tl.text'))} · ${fmtPrecise(ov.start)}`);
        main.addEventListener('click', () => { selectedSeg = { kind: 'overlay', id: ov.id }; seekTo(ov.start + 0.05); renderInspector(); renderTimelineTracks(); renderStageOverlays(); });
        const del = el('button', 'st-list-del');
        del.append(svgIcon('trash', 13));
        del.addEventListener('click', () => { pushUndo(); project!.overlays = project!.overlays.filter(x => x.id !== ov.id); renderStageOverlays(); renderInspector(); renderTimelineTracks(); });
        row.append(main, del);
        list.append(row);
      }
      for (const cap of project.captions) {
        const row = el('div', 'st-list-item');
        const main = el('button', 'st-list-main', `${cap.text.slice(0, 18) || tr('studio.tl.caption')} · ${fmtPrecise(cap.start)}`);
        main.addEventListener('click', () => { selectedSeg = { kind: 'caption', id: cap.id }; seekTo(cap.start + 0.05); renderInspector(); renderTimelineTracks(); });
        const del = el('button', 'st-list-del');
        del.append(svgIcon('trash', 13));
        del.addEventListener('click', () => { pushUndo(); project!.captions = project!.captions.filter(x => x.id !== cap.id); renderInspector(); renderTimelineTracks(); });
        row.append(main, del);
        list.append(row);
      }
      panel.append(list);
    }
  } else {
    panel.append(panelHead(tr('studio.tab.info'), `${rec.target_fps ?? 60}Hz`, 'acc'));
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

// ---- Segment creators
function addZoomAtPlayhead() {
  if (!project) return;
  pushUndo();
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart, Math.min(totalDuration - 0.6, t0));
  const end = Math.min(project.trimEnd, start + Math.min(2.0, totalDuration * 0.3));
  const id = `zoom-${Date.now().toString(36)}`;
  project.zooms.push({ id, start, end, scale: 1.8, x: 0.5, y: 0.5 });
  selectedSeg = { kind: 'zoom', id };
  activeTab = 'zoom';
  renderRail(); applyStageStyles(); renderInspector(); renderTimelineTracks();
}

function addCutAtPlayhead() {
  if (!project) return;
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart + 0.05, Math.min(project.trimEnd - 0.4, t0));
  const end = Math.min(project.trimEnd - 0.05, start + Math.min(1.2, totalDuration * 0.16));
  if (end - start < 0.15) return;
  pushUndo();
  const id = `cut-${Date.now().toString(36)}`;
  project.cuts.push({ id, start, end });
  selectedSeg = { kind: 'cut', id };
  renderInspector(); renderTimelineTracks();
}

function addSpeedAtPlayhead() {
  if (!project) return;
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart, Math.min(project.trimEnd - 0.5, t0));
  const end = Math.min(project.trimEnd, start + Math.min(2.2, totalDuration * 0.24));
  if (end - start < 0.2) return;
  pushUndo();
  const id = `spd-${Date.now().toString(36)}`;
  project.speeds.push({ id, start, end, rate: 0.5 });
  selectedSeg = { kind: 'speed', id };
  renderInspector(); renderTimelineTracks();
}

function addFreezeAtPlayhead() {
  if (!project) return;
  pushUndo();
  const t0 = Math.max(project.trimStart, Math.min(project.trimEnd, screenVideo?.currentTime ?? 0));
  const id = `frz-${Date.now().toString(36)}`;
  project.freezes.push({ id, at: t0, duration: 1.2 });
  selectedSeg = { kind: 'freeze', id };
  renderInspector(); renderTimelineTracks();
}

function addOverlayAtPlayhead(kind: 'text' | 'censor') {
  if (!project) return;
  pushUndo();
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart, Math.min(totalDuration - 0.5, t0));
  const end = Math.min(project.trimEnd, start + Math.min(2.6, Math.max(0.8, totalDuration * 0.25)));
  const id = `ov-${Date.now().toString(36)}`;
  if (kind === 'censor') {
    project.overlays.push({ id, kind: 'censor', start, end, x: 0.34, y: 0.38, w: 0.28, h: 0.14, pixelSize: 16 });
  } else {
    project.overlays.push({ id, kind: 'text', start, end, x: 0.5, y: 0.16, w: 0.3, h: 0.08, text: tr('studio.cap.defaultText'), color: '#6D5EFC' });
  }
  selectedSeg = { kind: 'overlay', id };
  activeTab = 'cap';
  renderRail(); renderStageOverlays(); renderInspector(); renderTimelineTracks();
}

function addCaptionAtPlayhead() {
  if (!project) return;
  pushUndo();
  const t0 = screenVideo?.currentTime ?? 0;
  const start = Math.max(project.trimStart, Math.min(totalDuration - 0.5, t0));
  const end = Math.min(project.trimEnd, start + Math.min(3.2, Math.max(1.0, totalDuration * 0.32)));
  const id = `cap-${Date.now().toString(36)}`;
  project.showCaptions = true;
  project.captions.push({ id, start, end, text: tr('studio.cap.defaultCaption') });
  selectedSeg = { kind: 'caption', id };
  activeTab = 'cap';
  renderRail(); renderInspector(); renderTimelineTracks();
}

function renderRail() {
  const rail = document.getElementById('st-rail');
  if (!rail) return;
  rail.replaceChildren();
  const mainTabs: { id: StudioTab; icon: IconName; label: string }[] = [
    { id: 'bg', icon: 'sparkles', label: tr('studio.tab.bg') },
    { id: 'cursor', icon: 'click-ripple', label: tr('studio.tab.cursor') },
    { id: 'zoom', icon: 'zoom-in', label: tr('studio.tab.zoom') },
    { id: 'keys', icon: 'keyboard', label: tr('studio.tab.keys') },
    { id: 'cam', icon: 'camera', label: tr('studio.tab.cam') },
    { id: 'cap', icon: 'message-square', label: tr('studio.tab.cap') },
  ];
  const topGroup = el('div', 'st-rail-group');
  for (const tb of mainTabs) {
    const b = el('button', `st-rail-btn${!selectedSeg && activeTab === tb.id ? ' on' : ''}`);
    b.title = tb.label;
    b.dataset.testid = `studio.tab.${tb.id}`;
    b.append(svgIcon(tb.icon, 16), el('span', '', tb.label));
    b.addEventListener('click', () => {
      activeTab = tb.id;
      selectedSeg = null;
      renderRail(); applyStageStyles(); renderInspector(); renderTimelineTracks();
    });
    topGroup.append(b);
  }
  const infoBtn = el('button', `st-rail-btn bottom${!selectedSeg && activeTab === 'info' ? ' on' : ''}`);
  infoBtn.title = tr('studio.tab.info');
  infoBtn.dataset.testid = 'studio.tab.info';
  infoBtn.append(svgIcon('info', 16), el('span', '', tr('studio.tab.info')));
  infoBtn.addEventListener('click', () => {
    activeTab = 'info';
    selectedSeg = null;
    renderRail(); applyStageStyles(); renderInspector(); renderTimelineTracks();
  });
  rail.append(topGroup, infoBtn);
}

// ---- Bottom 5-Lane Timeline (`#cap6`)
function renderTimeline() {
  const host = document.getElementById('st-timeline');
  if (!host || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  const dur = Math.max(0.1, totalDuration);
  host.replaceChildren();

  // Integrated Transport + Quick-Add bar
  const transport = el('div', 'st-transport');
  const trLeft = el('div', 'st-tr-left');
  playBtnEl = el('button', 'st-play-pill') as HTMLButtonElement;
  playBtnEl.dataset.testid = 'studio.transport.play';
  playBtnEl.append(svgIcon(screenVideo && !screenVideo.paused ? 'pause' : 'play', 12), el('span', '', tr(screenVideo && !screenVideo.paused ? 'hud.pause' : 'hud.resume')));
  playBtnEl.addEventListener('click', togglePlayback);

  timecodeEl = el('span', 'st-timecode', `${fmtPrecise(screenVideo?.currentTime ?? 0)} / ${fmtPrecise(dur)}`);
  trLeft.append(playBtnEl, timecodeEl);
  if ((rec.target_fps ?? 60) >= 100) {
    trLeft.append(el('span', 'st-pill cyn', tr('studio.badge.slowmo')));
  }
  const speedSeg = el('div', 'st-seg compact');
  for (const sp of [0.5, 1, 1.5, 2]) {
    const b = el('button', `st-seg-item${previewSpeed === sp ? ' on' : ''}`, `${sp}×`);
    b.addEventListener('click', () => {
      previewSpeed = sp;
      if (screenVideo) screenVideo.playbackRate = sp;
      for (const btn of speedSeg.querySelectorAll('button')) btn.classList.toggle('on', btn.textContent === `${sp}×`);
    });
    speedSeg.append(b);
  }
  trLeft.append(speedSeg);

  const trRight = el('div', 'st-tr-right');
  trRight.append(
    iconBtn('st-tl-btn', 'zoom-in', `+ ${tr('studio.tl.zoom')}`, 'studio.tl.zoom', addZoomAtPlayhead),
    iconBtn('st-tl-btn', 'scissors', tr('studio.tl.cut'), 'studio.tl.cut', addCutAtPlayhead),
    iconBtn('st-tl-btn', 'gauge', `0.5× ${tr('studio.tl.speed')}`, 'studio.tl.speed', addSpeedAtPlayhead),
    iconBtn('st-tl-btn', 'snowflake', tr('studio.tl.freeze'), 'studio.tl.freeze', addFreezeAtPlayhead),
    iconBtn('st-tl-btn', 'type', tr('studio.tl.text'), 'studio.tl.text', () => addOverlayAtPlayhead('text')),
    iconBtn('st-tl-btn', 'grid', tr('studio.tl.censor'), 'studio.tl.censor', () => addOverlayAtPlayhead('censor')),
    iconBtn('st-tl-btn', 'message-square', tr('studio.tl.caption'), 'studio.tl.caption', addCaptionAtPlayhead),
    iconBtn('st-tl-btn ghost', 'rotate-ccw', '', 'studio.tl.reset', () => {
      pushUndo();
      project = createDefaultStudioProject(dur, state!.config, Boolean(rec.tracks?.['camera.mp4']));
      selectedSeg = null;
      applyStageStyles(); applyAudioVolumes(); renderInspector(); renderTimeline();
    }),
  );
  (trRight.lastElementChild as HTMLElement).title = tr('studio.tl.reset');

  transport.append(trLeft, trRight);
  host.append(transport);

  const lanesWrap = el('div', 'st-lanes-grid');
  const gutter = el('div', 'st-gutter');
  gutter.append(
    el('div', 'st-grow clip', tr('studio.lane.clip')),
    el('div', 'st-grow', tr('studio.lane.zoom')),
    el('div', 'st-grow', tr('studio.lane.edits')),
    el('div', 'st-grow', tr('studio.lane.overlays')),
    el('div', 'st-grow', tr('studio.lane.captions')),
  );
  const tracksHost = el('div', 'st-tracks-wrap');
  tracksHost.id = 'st-tracks-wrap';
  lanesWrap.append(gutter, tracksHost);
  host.append(lanesWrap);

  renderTimelineTracks();
}

function wireTrimHandle(handle: HTMLElement, edge: 'in' | 'out', tracksEl: HTMLElement) {
  handle.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (!project) return;
    pushUndo();
    const rect = tracksEl.getBoundingClientRect();
    const dur = Math.max(0.1, totalDuration);
    const onMove = (ev: PointerEvent) => {
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const tSec = frac * dur;
      if (edge === 'in') {
        project!.trimStart = Math.max(0, Math.min(project!.trimEnd - 0.2, tSec));
        seekTo(project!.trimStart);
      } else {
        project!.trimEnd = Math.min(dur, Math.max(project!.trimStart + 0.2, tSec));
        seekTo(project!.trimEnd);
      }
      renderTimelineTracks();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function showTlTip(xPct: number, text: string) {
  if (!tlTipEl) return;
  tlTipEl.hidden = false;
  tlTipEl.textContent = text;
  tlTipEl.style.left = `${Math.max(6, Math.min(94, xPct)).toFixed(2)}%`;
}

function hideTlTip() {
  if (tlTipEl) tlTipEl.hidden = true;
}

function setChipRangeBox(chip: HTMLElement, start: number, end: number, dur: number, minPx: number) {
  const leftPct = Math.max(0, Math.min(98, (start / dur) * 100));
  const rawWidthPct = Math.max(0.5, ((end - start) / dur) * 100);
  const availPct = Math.max(2, 100 - leftPct);
  chip.style.left = `${leftPct.toFixed(2)}%`;
  chip.style.width = `min(${availPct.toFixed(2)}%, max(${minPx}px, ${rawWidthPct.toFixed(2)}%))`;
}

function wireRangeChip(
  chip: HTMLElement,
  item: { start: number; end: number },
  lanesEl: HTMLElement,
  minSpan: number,
  minPx: number,
  onSelectOnly: () => void,
) {
  const hLeft = el('span', 'st-seg-hdl l');
  const hRight = el('span', 'st-seg-hdl r');
  chip.append(hLeft, hRight);

  const selectWithoutRebuild = () => {
    lanesEl.querySelectorAll('.st-titem.on').forEach(n => n.classList.remove('on'));
    chip.classList.add('on');
    onSelectOnly();
  };

  // Drag left edge -> adjust start time
  hLeft.addEventListener('pointerdown', e => {
    e.stopPropagation();
    selectWithoutRebuild();
    pushUndo();
    const rect = lanesEl.getBoundingClientRect();
    const dur = Math.max(0.1, totalDuration);
    const startX = e.clientX;
    const origStart = item.start;
    const onMove = (ev: PointerEvent) => {
      const dt = ((ev.clientX - startX) / Math.max(1, rect.width)) * dur;
      const ns = Math.max(0, Math.min(item.end - minSpan, origStart + dt));
      item.start = Math.round(ns * 100) / 100;
      setChipRangeBox(chip, item.start, item.end, dur, minPx);
      seekTo(item.start);
      showTlTip((item.start / dur) * 100, `${item.start.toFixed(2)}s – ${item.end.toFixed(2)}s (${(item.end - item.start).toFixed(2)}s)`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      hideTlTip();
      applyStageStyles();
      renderInspector();
      renderTimelineTracks();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Drag right edge -> adjust end time
  hRight.addEventListener('pointerdown', e => {
    e.stopPropagation();
    selectWithoutRebuild();
    pushUndo();
    const rect = lanesEl.getBoundingClientRect();
    const dur = Math.max(0.1, totalDuration);
    const startX = e.clientX;
    const origEnd = item.end;
    const onMove = (ev: PointerEvent) => {
      const dt = ((ev.clientX - startX) / Math.max(1, rect.width)) * dur;
      const ne = Math.min(dur, Math.max(item.start + minSpan, origEnd + dt));
      item.end = Math.round(ne * 100) / 100;
      setChipRangeBox(chip, item.start, item.end, dur, minPx);
      seekTo(item.end);
      showTlTip((item.end / dur) * 100, `${item.start.toFixed(2)}s – ${item.end.toFixed(2)}s (${(item.end - item.start).toFixed(2)}s)`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      hideTlTip();
      applyStageStyles();
      renderInspector();
      renderTimelineTracks();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Drag body -> move entire segment keeping duration
  chip.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.st-seg-hdl')) return;
    e.stopPropagation();
    selectWithoutRebuild();
    const rect = lanesEl.getBoundingClientRect();
    const dur = Math.max(0.1, totalDuration);
    const startX = e.clientX;
    const origStart = item.start, origEnd = item.end, span = origEnd - origStart;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) > 3) { pushUndo(); moved = true; }
      if (!moved) return;
      const dt = ((ev.clientX - startX) / Math.max(1, rect.width)) * dur;
      const ns = Math.max(0, Math.min(dur - span, origStart + dt));
      item.start = Math.round(ns * 100) / 100;
      item.end = Math.round((ns + span) * 100) / 100;
      setChipRangeBox(chip, item.start, item.end, dur, minPx);
      seekTo(item.start);
      showTlTip(((item.start + item.end) * 0.5 / dur) * 100, `${item.start.toFixed(2)}s – ${item.end.toFixed(2)}s`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      hideTlTip();
      if (moved) { applyStageStyles(); renderInspector(); renderTimelineTracks(); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function wireFreezeChip(
  chip: HTMLElement,
  labelEl: HTMLElement,
  fr: { id: string; at: number; duration: number },
  lanesEl: HTMLElement,
  dur: number,
  onSelectOnly: () => void,
) {
  const freezeScale = Math.max(dur, 4.0);
  const applyFreezeBox = () => {
    const leftPct = Math.max(0, Math.min(96, (fr.at / dur) * 100));
    const widthPct = Math.max(4.5, Math.min(48, (fr.duration / freezeScale) * 100));
    const availPct = Math.max(3, 100 - leftPct);
    chip.style.left = `${leftPct.toFixed(2)}%`;
    chip.style.width = `min(${availPct.toFixed(2)}%, max(46px, ${widthPct.toFixed(2)}%))`;
    labelEl.textContent = `${fr.duration.toFixed(1)}s`;
  };
  applyFreezeBox();

  const hRight = el('span', 'st-seg-hdl r');
  chip.append(hRight);

  const selectWithoutRebuild = () => {
    lanesEl.querySelectorAll('.st-titem.on').forEach(n => n.classList.remove('on'));
    chip.classList.add('on');
    onSelectOnly();
  };

  // Drag right edge -> adjust freeze duration directly on track!
  hRight.addEventListener('pointerdown', e => {
    e.stopPropagation();
    selectWithoutRebuild();
    pushUndo();
    const rect = lanesEl.getBoundingClientRect();
    const startX = e.clientX;
    const origDur = fr.duration;
    const onMove = (ev: PointerEvent) => {
      const dd = ((ev.clientX - startX) / Math.max(1, rect.width)) * freezeScale;
      fr.duration = Math.round(Math.max(0.2, Math.min(6.0, origDur + dd)) * 10) / 10;
      applyFreezeBox();
      showTlTip((fr.at / dur) * 100, `${fr.at.toFixed(2)}s · ${tr('studio.tl.freeze')} ${fr.duration.toFixed(1)}s`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      hideTlTip();
      renderInspector();
      renderTimelineTracks();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Drag body -> adjust freeze start time (`fr.at`) directly on track!
  chip.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.st-seg-hdl')) return;
    e.stopPropagation();
    selectWithoutRebuild();
    const rect = lanesEl.getBoundingClientRect();
    const startX = e.clientX;
    const origAt = fr.at;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) > 3) { pushUndo(); moved = true; }
      if (!moved) return;
      const dt = ((ev.clientX - startX) / Math.max(1, rect.width)) * dur;
      fr.at = Math.round(Math.max(0, Math.min(dur, origAt + dt)) * 100) / 100;
      applyFreezeBox();
      seekTo(fr.at);
      showTlTip((fr.at / dur) * 100, `${fr.at.toFixed(2)}s · ${tr('studio.tl.freeze')} ${fr.duration.toFixed(1)}s`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      hideTlTip();
      if (moved) { renderInspector(); renderTimelineTracks(); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function renderTimelineTracks() {
  const wrap = document.getElementById('st-tracks-wrap');
  if (!wrap || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  const dur = Math.max(0.1, totalDuration);
  wrap.replaceChildren();

  const pct = (sec: number) => `${Math.max(0, Math.min(100, (sec / dur) * 100)).toFixed(2)}%`;

  const lanes = el('div', 'st-lanes');
  // Smooth scrub playhead by clicking or dragging on tracks
  lanes.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.st-titem, .st-trim-hdl')) return;
    const r = lanes.getBoundingClientRect();
    const updateScrub = (clientX: number) => {
      const frac = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      seekTo(frac * dur);
    };
    updateScrub(e.clientX);
    const onMove = (ev: PointerEvent) => updateScrub(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Lane 1: Clip (waveform + draggable In/Out trim handles + track metadata badges)
  const clipRow = el('div', 'st-trow clip');
  const activeClip = el('div', 'st-clip-bar');
  activeClip.style.left = pct(project.trimStart);
  activeClip.style.width = pct(Math.max(0.05, project.trimEnd - project.trimStart));
  activeClip.append(el('div', 'st-wave'));

  const trackTags: string[] = [];
  if (rec.tracks?.['camera.mp4']) trackTags.push('CAM');
  if (rec.tracks?.['mic.m4a']) trackTags.push(`MIC ${Math.round(project.audio.micVolume * 100)}%`);
  if (rec.tracks?.['system.m4a']) trackTags.push(`SYS ${Math.round(project.audio.systemVolume * 100)}%`);
  if (trackTags.length) {
    activeClip.append(el('span', 'st-clip-meta', trackTags.join(' · ')));
  }

  const hdlIn = el('div', 'st-trim-hdl in');
  hdlIn.title = `${tr('review.trimIn')} ${fmtPrecise(project.trimStart)}`;
  hdlIn.dataset.testid = 'recorder.review.trimStart';
  wireTrimHandle(hdlIn, 'in', lanes);

  const hdlOut = el('div', 'st-trim-hdl out');
  hdlOut.title = `${tr('review.trimOut')} ${fmtPrecise(project.trimEnd)}`;
  hdlOut.dataset.testid = 'recorder.review.trimEnd';
  wireTrimHandle(hdlOut, 'out', lanes);

  activeClip.append(hdlIn, hdlOut);
  clipRow.append(activeClip);
  lanes.append(clipRow);

  const appendChipInner = (chip: HTMLElement, icon: IconName, textEl: HTMLElement) => {
    const inner = el('span', 'st-titem-inner');
    inner.append(svgIcon(icon, 11), textEl);
    chip.append(inner);
  };

  // Lane 2: Zoom
  const zoomRow = el('div', 'st-trow');
  for (const z of project.zooms) {
    const isSel = selectedSeg?.kind === 'zoom' && selectedSeg.id === z.id;
    const chip = el('div', `st-titem zoom${isSel ? ' on' : ''}`);
    setChipRangeBox(chip, z.start, z.end, dur, 58);
    appendChipInner(chip, 'zoom-in', el('span', 'st-titem-lbl', `Zoom ${z.scale.toFixed(1)}×`));
    wireRangeChip(chip, z, lanes, 0.2, 58, () => {
      selectedSeg = { kind: 'zoom', id: z.id };
      seekTo((z.start + z.end) * 0.5);
      applyStageStyles(); renderInspector();
    });
    zoomRow.append(chip);
  }
  lanes.append(zoomRow);

  // Lane 3: Edits (Cut / Speed / Freeze)
  const editsRow = el('div', 'st-trow');
  for (const c of project.cuts) {
    const isSel = selectedSeg?.kind === 'cut' && selectedSeg.id === c.id;
    const chip = el('div', `st-titem cut${isSel ? ' on' : ''}`);
    setChipRangeBox(chip, c.start, c.end, dur, 48);
    appendChipInner(chip, 'scissors', el('span', 'st-titem-lbl', tr('studio.tl.cut')));
    wireRangeChip(chip, c, lanes, 0.15, 48, () => {
      selectedSeg = { kind: 'cut', id: c.id };
      seekTo(c.start);
      renderInspector();
    });
    editsRow.append(chip);
  }
  for (const sp of project.speeds) {
    const isSel = selectedSeg?.kind === 'speed' && selectedSeg.id === sp.id;
    const chip = el('div', `st-titem speed${isSel ? ' on' : ''}`);
    setChipRangeBox(chip, sp.start, sp.end, dur, 52);
    appendChipInner(chip, 'gauge', el('span', 'st-titem-lbl', `${sp.rate}×`));
    wireRangeChip(chip, sp, lanes, 0.2, 52, () => {
      selectedSeg = { kind: 'speed', id: sp.id };
      seekTo(sp.start);
      renderInspector();
    });
    editsRow.append(chip);
  }
  for (const fr of project.freezes) {
    const isSel = selectedSeg?.kind === 'freeze' && selectedSeg.id === fr.id;
    const chip = el('div', `st-titem freeze${isSel ? ' on' : ''}`);
    const lbl = el('span', 'st-titem-lbl', `${fr.duration.toFixed(1)}s`);
    appendChipInner(chip, 'snowflake', lbl);
    wireFreezeChip(chip, lbl, fr, lanes, dur, () => {
      selectedSeg = { kind: 'freeze', id: fr.id };
      seekTo(fr.at);
      renderInspector();
    });
    editsRow.append(chip);
  }
  lanes.append(editsRow);

  // Lane 4: Overlays (Text Title + Censor Mosaic)
  const ovRow = el('div', 'st-trow');
  for (const ov of project.overlays) {
    const isSel = selectedSeg?.kind === 'overlay' && selectedSeg.id === ov.id;
    const chip = el('div', `st-titem ${ov.kind === 'censor' ? 'censor' : 'text'}${isSel ? ' on' : ''}`);
    setChipRangeBox(chip, ov.start, ov.end, dur, 56);
    appendChipInner(chip, ov.kind === 'censor' ? 'grid' : 'type', el('span', 'st-titem-lbl', ov.kind === 'censor' ? tr('studio.tl.censor') : (ov.text || tr('studio.tl.text'))));
    wireRangeChip(chip, ov, lanes, 0.2, 56, () => {
      selectedSeg = { kind: 'overlay', id: ov.id };
      seekTo(ov.start + 0.05);
      renderStageOverlays(); renderInspector();
    });
    ovRow.append(chip);
  }
  lanes.append(ovRow);

  // Lane 5: Captions
  const capRow = el('div', 'st-trow');
  for (const cap of project.captions) {
    const isSel = selectedSeg?.kind === 'caption' && selectedSeg.id === cap.id;
    const chip = el('div', `st-titem caption${isSel ? ' on' : ''}`);
    setChipRangeBox(chip, cap.start, cap.end, dur, 60);
    appendChipInner(chip, 'message-square', el('span', 'st-titem-lbl', cap.text || tr('studio.tl.caption')));
    wireRangeChip(chip, cap, lanes, 0.2, 60, () => {
      selectedSeg = { kind: 'caption', id: cap.id };
      seekTo(cap.start + 0.05);
      renderInspector();
    });
    capRow.append(chip);
  }
  lanes.append(capRow);

  // Floating drag/resize time readout pill
  tlTipEl = el('div', 'st-tl-tip');
  tlTipEl.hidden = true;
  lanes.append(tlTipEl);

  // White triangle Playhead needle (`#cap6`)
  playheadEl = el('div', 'st-playhead');
  playheadEl.style.left = pct(screenVideo?.currentTime ?? 0);
  lanes.append(playheadEl);

  wrap.append(lanes);
}

// ---- Top AudioMerge Popover + `#cap7` Two-Column Export Modal
function renderPopovers() {
  const layer = document.getElementById('st-overlays');
  if (!layer || !project || !state?.activeRecord) return;
  const rec = state.activeRecord;
  layer.replaceChildren();

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

    const stratRow = el('div', 'st-switch-row');
    stratRow.append(el('span', 'st-switch-lbl', tr('studio.audio.strategy')));
    const stratBtn = el('button', 'st-mini-btn', tr(project.audio.mergeTracks ? 'studio.audio.mergeOne' : 'studio.audio.keepDual'));
    stratBtn.addEventListener('click', () => { project!.audio.mergeTracks = !project!.audio.mergeTracks; renderPopovers(); });
    stratRow.append(stratBtn);

    pop.append(
      hd,
      mkMix('mic', tr('studio.audio.mic'), project.audio.micVolume, Boolean(rec.tracks?.['mic.m4a']), v => { project!.audio.micVolume = v; }),
      mkMix('volume', tr('studio.audio.sys'), project.audio.systemVolume, Boolean(rec.tracks?.['system.m4a']), v => { project!.audio.systemVolume = v; }),
      rowToggle(tr('studio.audio.denoise'), project.audio.denoise, v => { project!.audio.denoise = v; renderPopovers(); }),
      stratRow,
    );
    layer.append(pop);
  }

  // `#cap7` Two-Column Hardware Export & Distribution Modal
  if (exportModalOpen) {
    const backdrop = el('div', 'st-modal-backdrop');
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop && !state?.busyAction) {
        exportModalOpen = false;
        renderPopovers();
      }
    });
    const modal = el('div', 'st-modal wide');
    modal.dataset.testid = 'studio.export.modal';

    const hd = el('div', 'st-modal-hd');
    hd.append(el('h3', '', tr('studio.export.title')));
    const close = el('button', 'st-icon-x');
    close.append(svgIcon('close', 15));
    close.disabled = Boolean(state.busyAction);
    close.addEventListener('click', () => { exportModalOpen = false; renderPopovers(); });
    hd.append(close);

    const spec = estimateExportSpec(project, rec.width ?? 1920, rec.height ?? 1080, exportPreset);
    const bodyGrid = el('div', 'st-exp-grid');

    // Left column: 4 presets + post-export destinations
    const leftCol = el('div', 'st-exp-left');
    leftCol.append(el('h4', 'st-exp-h', tr('studio.export.step1')));
    const presetGrid = el('div', 'st-preset-grid');
    const presets: { id: StudioExportPresetId; title: string; pill: string; tone: string; desc: string }[] = [
      { id: 'hevc120', title: tr('studio.export.pHevcTitle'), pill: 'HEVC hvc1', tone: 'acc', desc: tr('studio.export.pHevcDesc') },
      { id: 'h264_60', title: tr('studio.export.pH264Title'), pill: 'H.264 High', tone: 'grn', desc: tr('studio.export.pH264Desc') },
      { id: 'issue120', title: tr('studio.export.pIssueTitle'), pill: '120fps + 遥测', tone: 'org', desc: tr('studio.export.pIssueDesc') },
      { id: 'gif20', title: tr('studio.export.pGifTitle'), pill: '20fps · ≤960px', tone: 'blu', desc: tr('studio.export.pGifDesc') },
    ];
    for (const p of presets) {
      const card = el('button', `st-preset${exportPreset === p.id ? ' on' : ''}`);
      card.dataset.testid = `studio.export.preset.${p.id}`;
      const top = el('div', 'st-preset-top');
      top.append(el('b', '', p.title), el('span', `st-pill ${p.tone}`, p.pill));
      card.append(top, el('span', 'st-preset-desc', p.desc));
      card.addEventListener('click', () => {
        exportPreset = p.id;
        lastExportResult = null;
        renderPopovers();
      });
      presetGrid.append(card);
    }
    leftCol.append(presetGrid);

    leftCol.append(el('h4', 'st-exp-h', tr('studio.export.step2')));
    const destGrid = el('div', 'st-dest-grid');
    const saveCard = el('div', 'st-dest-card on locked');
    saveCard.append(svgIcon('save', 14), el('span', '', tr('studio.export.saveDir', { dir: state.saveDir })));
    destGrid.append(saveCard);

    const mkDest = (iconName: IconName, label: string, on: boolean, disabled: boolean, toggle: () => void) => {
      const b = el('button', `st-dest-card${on && !disabled ? ' on' : ''}`);
      b.disabled = disabled;
      b.append(svgIcon(iconName, 14), el('span', '', label));
      b.addEventListener('click', () => { toggle(); renderPopovers(); });
      return b;
    };
    const isIssue = exportPreset === 'issue120';
    destGrid.append(
      mkDest('copy', tr('studio.export.copyClipboard'), exportCopyFile, isIssue, () => { exportCopyFile = !exportCopyFile; }),
      mkDest('cloud', tr('studio.export.sendDrive'), exportSendDrive, false, () => { exportSendDrive = !exportSendDrive; }),
      mkDest('folder', tr('studio.export.revealAfter'), exportRevealAfter, false, () => { exportRevealAfter = !exportRevealAfter; }),
    );
    leftCol.append(destGrid);

    // Right column: Live Spec Preview + Progress + Actions
    const rightCol = el('div', 'st-exp-sum');
    rightCol.append(el('h4', 'st-exp-h', tr('studio.export.summary')));
    const kvList = el('div', 'st-exp-kvs');
    const kvs: [string, string][] = [
      [tr('studio.export.kvCodec'), spec.codecLabel],
      [tr('studio.export.kvRes'), spec.resolutionLabel],
      [tr('studio.export.kvDur'), `${spec.durationSec.toFixed(1)}s`],
      [tr('studio.export.kvBps'), spec.bitrateLabel],
      [tr('studio.export.kvSize'), `≈ ${formatBytes(spec.estimatedBytes)}`],
      [tr('studio.export.kvExtra'), spec.extraLabel],
    ];
    for (const [k, v] of kvs) {
      const row = el('div', 'st-exp-kv');
      row.append(el('span', '', k), el('b', '', v));
      kvList.append(row);
    }
    rightCol.append(kvList, el('p', 'st-note', tr('studio.export.hwNote')));

    const busy = Boolean(state.busyAction);
    const progWrap = el('div', 'st-export-prog');
    const progBar = el('div', 'st-prog-bar');
    const progFill = el('div', 'st-prog-fill');
    const pct = busy ? Math.max(4, Math.min(100, Math.round(exportProgress * 100))) : (lastExportResult?.ok ? 100 : 0);
    progFill.style.width = `${pct}%`;
    progBar.append(progFill);
    progWrap.append(progBar);
    rightCol.append(progWrap);

    if (lastExportResult && !busy) {
      const resBox = el('div', `st-export-res ${lastExportResult.ok ? 'ok' : 'err'}`);
      if (lastExportResult.ok) {
        const info = el('div', 'st-export-res-info');
        info.append(
          el('strong', '', lastExportResult.name ?? ''),
          el('small', '', `${lastExportResult.width ?? ''}×${lastExportResult.height ?? ''} · ${formatBytes(lastExportResult.bytes ?? 0)}`),
        );
        const reveal = iconBtn('st-btn', 'folder', tr('studio.export.reveal'), 'studio.export.reveal', () => {
          if (lastExportResult?.path) void post({ type: 'review-reveal-path', filePath: lastExportResult.path });
        });
        resBox.append(info, reveal);
      } else {
        resBox.append(el('span', '', `${tr('review.exportFailed')} ${lastExportResult.error ? `(${lastExportResult.error})` : ''}`));
      }
      rightCol.append(resBox);
    }

    const foot = el('div', 'st-modal-foot');
    const goBtn = iconBtn(
      'st-btn primary grow',
      'save',
      busy ? `${tr('review.working')} ${Math.round(exportProgress * 100)}%` : tr('studio.export.run'),
      'studio.export.run',
      () => {
        lastExportResult = null;
        exportProgress = 0;
        const projCopy: StudioProject = {
          ...project!,
          exportFps: spec.fps === 20 ? project!.exportFps : spec.fps,
          exportCodec: spec.codec,
        };
        const recipe = buildExportRecipe(projCopy, spec.format);
        void post({
          type: 'review-studio-export',
          id: rec.id,
          format: spec.format,
          recipe,
          copyFile: exportCopyFile && spec.format !== 'issue_bundle',
          sendDrive: exportSendDrive,
          revealAfter: exportRevealAfter,
        });
        renderPopovers();
      },
    );
    goBtn.disabled = busy;
    const cancelBtn = el('button', 'st-btn', tr('action.close'));
    cancelBtn.disabled = busy;
    cancelBtn.addEventListener('click', () => { exportModalOpen = false; renderPopovers(); });
    foot.append(goBtn, cancelBtn);
    rightCol.append(foot);

    bodyGrid.append(leftCol, rightCol);
    modal.append(hd, bodyGrid);
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
    undoStack = [];
    redoStack = [];
    selectedSeg = null;
    lastExportResult = null;
    exportPreset = state.issueMode ? 'issue120' : ((rec.target_fps ?? 60) >= 100 ? 'hevc120' : 'h264_60');
    void loadTelemetryViaHost(rec);
  }

  // ---- Top Studio Header (`#cap6`)
  const header = el('header', 'st-header');
  const hLeft = el('div', 'st-head-left');
  const histToggle = iconBtn(`st-btn${historyOpen ? ' on' : ''}`, 'sidebar', `${tr('review.history')} (${state.history.length})`, 'studio.history.toggle', () => {
    historyOpen = !historyOpen;
    const sb = document.getElementById('st-history-drawer');
    if (sb) sb.hidden = !historyOpen;
    histToggle.classList.toggle('on', historyOpen);
  });
  const titleBlock = el('div', 'st-head-title');
  titleBlock.append(el('strong', '', rec ? rec.source_title : tr('studio.title')));
  hLeft.append(histToggle, titleBlock);
  if (rec) {
    hLeft.append(el('span', 'st-pill acc', tr('studio.badge.master', { fps: rec.target_fps ?? 60 })));
    if (rec.tracks?.['telemetry.jsonl']) {
      hLeft.append(el('span', 'st-pill cyn', tr('studio.badge.cursor')));
    }
  }

  const hRight = el('div', 'st-head-right');
  undoBtnEl = iconBtn('st-btn icon-only', 'undo', '', 'studio.undo', doUndo) as HTMLButtonElement;
  undoBtnEl.title = `${tr('action.undo')} (⌘Z)`;
  redoBtnEl = iconBtn('st-btn icon-only', 'redo', '', 'studio.redo', doRedo) as HTMLButtonElement;
  redoBtnEl.title = `${tr('action.redo')} (⌘⇧Z)`;
  syncUndoButtons();

  const mixBtn = iconBtn(`st-btn${audioPopOpen ? ' on' : ''}`, 'sliders', tr('studio.audio.btn'), 'studio.audio.btn', () => {
    audioPopOpen = !audioPopOpen;
    renderPopovers();
  });
  const newRecBtn = iconBtn('st-btn', 'record-dot', tr('review.newRecord'), 'recorder.review.new', () =>
    void post({ type: 'review-record-new', issueMode: false }));
  const issueExportBtn = iconBtn('st-btn issue', 'bug', tr('studio.export.issueBtn'), 'recorder.review.packIssue', () => {
    exportPreset = 'issue120';
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

  hRight.append(undoBtnEl, redoBtnEl, mixBtn, newRecBtn, issueExportBtn, exportBtn);
  header.append(hLeft, hRight);

  // ---- Workspace body (Optional History Drawer + 52px Rail + 268px Inspector + Center Stage)
  const workspace = el('div', 'st-workspace');

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

  const rail = el('nav', 'st-rail');
  rail.id = 'st-rail';
  const inspector = el('aside', 'st-inspector');
  inspector.id = 'st-inspector';

  const center = el('div', 'st-center');
  const stage = el('div', 'st-stage');

  // Top-left floating live preview pills (`#cap6`)
  const stageBadges = el('div', 'st-stage-badges');
  stageBadges.append(el('span', 'st-pill stage', `${rec.target_fps ?? 60}Hz · ${(rec.codec ?? 'hevc').toUpperCase()} · ${rec.width ?? ''}×${rec.height ?? ''}`));
  stageZoomBadgeEl = el('span', 'st-pill acc', 'Zoom 1.6×');
  stageZoomBadgeEl.hidden = true;
  stageBadges.append(stageZoomBadgeEl);
  stage.append(stageBadges);

  stageWallEl = el('div', 'st-wallpaper');
  stageFrameEl = el('div', 'st-frame');

  screenVideo = el('video', 'st-video') as HTMLVideoElement;
  screenVideo.src = captureV2.trackURL(rec.id, 'capture.mp4');
  screenVideo.playsInline = true;
  screenVideo.preload = 'auto';
  screenVideo.dataset.testid = 'recorder.review.video';

  telCanvas = el('canvas', 'review-tel-canvas') as HTMLCanvasElement;
  stageOverlaysEl = el('div', 'st-stage-overlays');
  keyBadgeEl = el('div', 'review-key-badge');
  keyBadgeEl.hidden = true;
  captionBarEl = el('div', 'st-caption-bar');
  captionBarEl.hidden = true;
  zoomFocusDot = el('div', 'st-zoom-dot');
  zoomFocusDot.hidden = true;

  stageFrameEl.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.st-ov-censor, .st-ov-text, .st-zoom-box, .st-cam-wrap')) return;
    if (!screenVideo || !project) return;
    const selZ = currentSelectedZoom();
    if (selZ) {
      pushUndo();
      const r = screenVideo.getBoundingClientRect();
      selZ.x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      selZ.y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)));
      applyStageStyles(); renderInspector();
      return;
    }
    togglePlayback();
  });

  stageFrameEl.append(screenVideo, telCanvas, stageOverlaysEl, captionBarEl, keyBadgeEl, zoomFocusDot);

  camWrapEl = null;
  camVideo = null;
  if (rec.tracks?.['camera.mp4']) {
    camWrapEl = el('div', 'st-cam-wrap');
    camVideo = el('video', 'st-cam-pip') as HTMLVideoElement;
    camVideo.src = captureV2.trackURL(rec.id, 'camera.mp4');
    camVideo.muted = true;
    camVideo.playsInline = true;
    camVideo.preload = 'auto';
    camVideo.addEventListener('loadedmetadata', () => {
      if (camVideo && screenVideo && screenVideo.currentTime < 0.05 && Number.isFinite(camVideo.duration) && camVideo.duration > 0.25) {
        camVideo.currentTime = 0.2;
      }
    });
    const camHdl = el('div', 'st-cam-hdl');
    camHdl.title = tr('studio.cam.size');
    camHdl.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (!project || !stageFrameEl || !camWrapEl) return;
      pushUndo();
      const rect = stageFrameEl.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const origSize = project.camera.size;
      const pos = project.camera.position;
      const sx = pos.endsWith('l') ? 1 : -1;
      const sy = pos.startsWith('t') ? 1 : -1;
      const onMove = (ev: PointerEvent) => {
        const dx = ((ev.clientX - startX) / Math.max(1, rect.width)) * sx;
        const dy = ((ev.clientY - startY) / Math.max(1, rect.height)) * sy;
        const delta = (dx + dy) * 0.65;
        project!.camera.size = Math.round(Math.max(0.10, Math.min(0.42, origSize + delta)) * 100) / 100;
        camWrapEl!.style.width = `${Math.round(project!.camera.size * 100)}%`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        applyStageStyles();
        renderInspector();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    camWrapEl.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('.st-cam-hdl')) return;
      e.stopPropagation();
      if (!project || !stageFrameEl) return;
      const rect = stageFrameEl.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12) { pushUndo(); moved = true; }
        if (!moved) return;
        const fx = (ev.clientX - rect.left) / Math.max(1, rect.width);
        const fy = (ev.clientY - rect.top) / Math.max(1, rect.height);
        const corner: CameraCorner = `${fy < 0.5 ? 't' : 'b'}${fx < 0.5 ? 'l' : 'r'}` as CameraCorner;
        if (project!.camera.position !== corner) {
          project!.camera.position = corner;
          applyStageStyles();
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!moved) {
          activeTab = 'cam';
          selectedSeg = null;
          renderRail(); applyStageStyles(); renderInspector(); renderTimelineTracks();
        } else {
          renderInspector();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    camWrapEl.append(camVideo, camHdl);
    stageFrameEl.append(camWrapEl);
  }

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
    lastOverlayTickBucket = -1;
  });

  stageWallEl.append(stageFrameEl);
  stage.append(stageWallEl);

  // Full-width bottom timeline spans beneath Rail+Inspector+Stage just like `#cap6`!
  const timeline = el('section', 'st-timeline');
  timeline.id = 'st-timeline';

  center.append(stage);
  workspace.append(histDrawer, rail, inspector, center);

  const overlays = el('div', 'st-overlays');
  overlays.id = 'st-overlays';

  root.append(header, workspace, timeline, overlays);

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
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (e.key === 'Escape') {
      if (exportModalOpen && !state?.busyAction) { exportModalOpen = false; renderPopovers(); }
      else if (audioPopOpen) { audioPopOpen = false; renderPopovers(); }
      else if (selectedSeg) { selectedSeg = null; applyStageStyles(); renderInspector(); renderTimelineTracks(); }
    }
  });
  channel.onMessage<ToReview>(m => {
    if (m?.type === 'review-state') {
      const prevRecId = state?.activeRecord?.id ?? null;
      const nextRecId = m.state.activeRecord?.id ?? null;
      state = m.state;
      if (prevRecId === nextRecId && screenVideo && project) {
        renderPopovers();
        const openBtn = document.querySelector<HTMLButtonElement>('[data-testid="studio.export.open"] span');
        if (openBtn) openBtn.textContent = state.busyAction ? tr('review.working') : tr('studio.export.btn');
      } else {
        renderShell();
      }
    } else if (m?.type === 'review-export-progress') {
      exportProgress = m.progress;
      renderPopovers();
    } else if (m?.type === 'review-export-done') {
      exportProgress = m.result.ok ? 1 : 0;
      lastExportResult = m.result;
      renderPopovers();
    } else if (m?.type === 'review-toast') {
      showToast(m.tone, m.message);
    }
  });
  await post({ type: 'review-ready' });
}
