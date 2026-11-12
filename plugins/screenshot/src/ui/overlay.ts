// The capture editor: a transparent overlay over the display under the
// pointer shows the frozen screenshot. Pick a region (drag, Shift for a square, click a window,
// Tab toggles window snapping, F takes the whole display), annotate with the bottom toolbar, then
// copy / save / read text / beautify from the right-hand bar.
import { appWindows, channel, i18n } from '@medeo-plugin/sdk';
import { CURSORS, HANDLES, clamp, contains, fromPoints, handlePoint, hitHandle, move, resize, round, windowAt, type Handle, type Point, type Rect } from '../geometry.ts';
import { split, type Action, type FromOverlay, type OcrResult, type Shot, type ToOverlay } from '../protocol.ts';
import {
  COLORS, DEFAULT_OPTIONS, EMOJIS, FONT, KEY_OF, NO_COLOR, NO_WIDTH, TOOLS, TOOL_KEYS, adjust, badgeRadius, bounds, constrain, draw, dragHandle,
  handles, hit, meaningful, optionsFor, spotlight, translate, type Ann, type Env, type HandleId, type Options, type Text, type Tool,
} from '../annotations.ts';
import { DEFAULT_BEAUTY, FRAME_BAR, GRADIENTS, beautify, drawFrame, fillGradient, type Beauty } from '../beautify.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromOverlay) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) => (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// ---------------------------------------------------------------- preferences kept across captures
interface Prefs { tool: Tool; opts: Record<Tool, Options>; beauty: Beauty; snap: boolean; recent: string[] }
const PREFS = 'screenshot.prefs.v1';
function loadPrefs(): Prefs {
  const base: Prefs = { tool: 'arrow', opts: Object.fromEntries(TOOLS.map(k => [k, { ...DEFAULT_OPTIONS }])) as Record<Tool, Options>, beauty: { ...DEFAULT_BEAUTY }, snap: true, recent: [] };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? 'null');
    if (!v || typeof v !== 'object') return base;
    if (TOOLS.includes(v.tool) && v.tool !== 'sampler') base.tool = v.tool;
    for (const k of TOOLS) if (v.opts?.[k] && typeof v.opts[k] === 'object') base.opts[k] = { ...DEFAULT_OPTIONS, ...v.opts[k] };
    // Style, padding and frame are remembered; beautifying itself is chosen per capture, so one
    // beautified screenshot never turns every later one into a framed picture.
    if (v.beauty && typeof v.beauty === 'object') base.beauty = { ...DEFAULT_BEAUTY, ...v.beauty, on: false };
    if (typeof v.snap === 'boolean') base.snap = v.snap;
    if (Array.isArray(v.recent)) base.recent = v.recent.filter((c: unknown) => typeof c === 'string' && /^#[0-9A-F]{6}$/i.test(c as string)).slice(0, 6);
  } catch {}
  return base;
}
let prefs = loadPrefs();
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify({ ...prefs, tool: prefs.tool === 'sampler' ? 'arrow' : prefs.tool })); } catch {} };

// ---------------------------------------------------------------- capture state
let shot: Shot | null = null;
let incoming: { seq: number; parts: string[]; total: number } | null = null;
let base: ImageBitmap | null = null;
let pixels: CanvasRenderingContext2D | null = null;
let effects: { mosaic: HTMLCanvasElement; blur: HTMLCanvasElement } | null = null;
let view: Rect = { x: 0, y: 0, w: innerWidth, h: innerHeight };
let phase: 'idle' | 'select' | 'edit' = 'idle';
let sel: Rect | null = null;
let hover: Rect | null = null;
let pointer: Point | null = null;
let anns: Ann[] = [];
let undoStack: Ann[][] = [];
let redoStack: Ann[][] = [];
let selected: number | null = null;
let counter = 1;
let nextId = 1;
let invert = false;
let busy = false;
let space = false;
let lastWheel = 0;
let popover: 'palette' | 'beauty' | null = null;
let ocr: { loading: boolean; result: OcrResult | null } | null = null;
type Drag =
  | { kind: 'region-new'; origin: Point; moved: boolean }
  | { kind: 'region-move'; origin: Point; start: Rect }
  | { kind: 'region-resize'; handle: Handle; start: Rect }
  | { kind: 'draw'; ann: Ann; origin: Point; last: Point }
  | { kind: 'ann-move'; origin: Point; start: Ann; pushed: boolean }
  | { kind: 'ann-handle'; handle: HandleId; pushed: boolean };
let drag: Drag | null = null;
let text: { at: Point; editing: number | null } | null = null;

const tool = () => prefs.tool;
const canvases = () => [$<HTMLCanvasElement>('base'), $<HTMLCanvasElement>('ann'), $<HTMLCanvasElement>('ui')];

// ---------------------------------------------------------------- loading a shot
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function load(seq: number, b64: string) {
  const bitmap = await createImageBitmap(new Blob([b64ToBytes(b64) as BlobPart], { type: 'image/png' }));
  if (!shot || shot.seq !== seq) { bitmap.close(); return; }
  base = bitmap;
  view = { x: 0, y: 0, w: innerWidth, h: innerHeight };
  sizeCanvases(); paintBase();
  const px = document.createElement('canvas'); px.width = bitmap.width; px.height = bitmap.height;
  pixels = px.getContext('2d', { willReadFrequently: true })!; pixels.drawImage(bitmap, 0, 0);
  if (shot.mode === 'full') { sel = { ...view }; phase = 'edit'; showBars(); }
  else { phase = 'select'; hover = pointer ? snapTarget(pointer) : view; }
  showHint(); dirty(true);
  console.info(`shot #${seq} shown: ${bitmap.width}x${bitmap.height}, visible=${document.visibilityState}`);
}

function sizeCanvases() {
  const dpr = devicePixelRatio || 1;
  for (const c of canvases()) { c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr); c.style.width = `${innerWidth}px`; c.style.height = `${innerHeight}px`; }
}
function paintBase() {
  const b = $<HTMLCanvasElement>('base').getContext('2d')!;
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, b.canvas.width, b.canvas.height);
  if (base) { b.imageSmoothingQuality = 'high'; b.drawImage(base, 0, 0, b.canvas.width, b.canvas.height); }
  $('base').style.filter = invert ? 'invert(1)' : 'none';
}
const snapTarget = (p: Point) => prefs.snap && shot ? windowAt(shot.windows, p, view) : view;

/** Pixelated and blurred copies of the display, made on first use of the censor tool. */
function env(): Env {
  const scale = shot?.scale ?? 1;
  if (!effects && base && anns.concat(drag?.kind === 'draw' ? [drag.ann] : []).some(a => a.kind === 'censor')) {
    const block = Math.max(4, Math.round(12 * scale));
    const small = document.createElement('canvas'); small.width = Math.max(1, Math.ceil(base.width / block)); small.height = Math.max(1, Math.ceil(base.height / block));
    small.getContext('2d')!.drawImage(base, 0, 0, small.width, small.height);
    const mosaic = document.createElement('canvas'); mosaic.width = base.width; mosaic.height = base.height;
    const m = mosaic.getContext('2d')!; m.imageSmoothingEnabled = false; m.drawImage(small, 0, 0, mosaic.width, mosaic.height);
    const blur = document.createElement('canvas'); blur.width = base.width; blur.height = base.height;
    const bl = blur.getContext('2d')!; bl.filter = `blur(${Math.round(10 * scale)}px)`; bl.drawImage(base, 0, 0);
    effects = { mosaic, blur };
  }
  return { mosaic: effects?.mosaic ?? null, blur: effects?.blur ?? null, width: view.w, height: view.h, scale };
}

// ---------------------------------------------------------------- rendering
let frame = 0, annDirty = false;
function dirty(annotations = false) { annDirty ||= annotations; if (!frame) frame = requestAnimationFrame(render); }

function render() {
  frame = 0;
  const dpr = devicePixelRatio || 1;
  if (annDirty) {
    annDirty = false;
    const a = $<HTMLCanvasElement>('ann').getContext('2d')!;
    a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, a.canvas.width, a.canvas.height);
    if (sel && base) {
      a.setTransform(dpr, 0, 0, dpr, 0, 0);
      a.save(); a.beginPath(); a.rect(sel.x, sel.y, sel.w, sel.h); a.clip();
      const list = drag?.kind === 'draw' ? [...anns, drag.ann] : anns, e = env();
      list.forEach((s, i) => { if (!(text && text.editing === i)) draw(a, s, e); });
      spotlight(a, list, sel);
      a.restore();
    }
  }
  const u = $<HTMLCanvasElement>('ui').getContext('2d')!;
  u.setTransform(1, 0, 0, 1, 0, 0); u.clearRect(0, 0, u.canvas.width, u.canvas.height);
  if (phase === 'idle' || !base) return;
  u.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hole = sel ?? (drag ? null : hover);
  u.fillStyle = 'rgba(0,0,0,0.45)';
  u.beginPath(); u.rect(0, 0, view.w, view.h);
  if (hole) u.rect(hole.x + hole.w, hole.y, -hole.w, hole.h);
  u.fill('evenodd');
  if (sel && prefs.beauty.on && phase === 'edit') beautyPreview(u, sel);
  if (hole) {
    u.strokeStyle = '#007AFF'; u.lineWidth = sel ? 1.5 : 3;
    if (!sel) u.setLineDash([6, 4]);
    u.strokeRect(hole.x + 0.5, hole.y + 0.5, hole.w - 1, hole.h - 1); u.setLineDash([]);
  }
  if (sel) {
    if (phase === 'edit') for (const h of HANDLES) {
      const p = handlePoint(sel, h); u.fillStyle = '#fff'; u.strokeStyle = '#007AFF'; u.lineWidth = 1.5;
      u.beginPath(); u.rect(p.x - 3.5, p.y - 3.5, 7, 7); u.fill(); u.stroke();
    }
    sizeLabel(u, sel);
  }
  const s = selected !== null ? anns[selected] : null;
  if (s && !text) {
    const r = bounds(s);
    u.strokeStyle = 'rgba(0,122,255,0.9)'; u.lineWidth = 1; u.setLineDash([4, 3]);
    u.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); u.setLineDash([]);
    u.fillStyle = '#fff'; u.strokeStyle = '#007AFF'; u.lineWidth = 1.5;
    for (const h of handles(s)) { u.beginPath(); u.arc(h.p.x, h.p.y, 4.5, 0, Math.PI * 2); u.fill(); u.stroke(); }
  }
  if (pointer && (phase === 'select' || drag?.kind === 'region-new' || drag?.kind === 'region-resize' || (tool() === 'sampler' && phase === 'edit' && sel && contains(sel, pointer)))) magnifier(u, pointer);
}

function beautyPreview(u: CanvasRenderingContext2D, r: Rect) {
  const b = prefs.beauty, bar = b.frame ? FRAME_BAR : 0, pad = b.padding;
  const ox = r.x - pad, oy = r.y - bar - pad, ow = r.w + pad * 2, oh = r.h + bar + pad * 2;
  u.save(); u.beginPath(); u.rect(ox, oy, ow, oh); u.rect(r.x + r.w, r.y, -r.w, r.h); u.clip('evenodd');
  fillGradient(u, ox, oy, ow, oh, b.style);
  if (bar) drawFrame(u, r.x, r.y - bar, r.w);
  u.restore();
}

function sizeLabel(u: CanvasRenderingContext2D, r: Rect) {
  const s = shot?.output.downscale ? 1 : shot?.scale ?? 1, label = `${Math.round(r.w * s)} × ${Math.round(r.h * s)}`;
  u.font = `12px ${FONT}`;
  const w = u.measureText(label).width + 12, h = 22, top = prefs.beauty.on && phase === 'edit' ? prefs.beauty.padding + (prefs.beauty.frame ? FRAME_BAR : 0) : 0;
  const x = clamp(r.x, 2, view.w - w - 2), y = r.y - top - h - 6 >= 2 ? r.y - top - h - 6 : r.y + 6;
  u.fillStyle = 'rgba(28,28,30,0.85)'; u.beginPath(); u.roundRect(x, y, w, h, 5); u.fill();
  u.fillStyle = '#fff'; u.textBaseline = 'middle'; u.fillText(label, x + 6, y + h / 2 + 0.5);
}

const MAG = 120, ZOOM = 8;
function pixelAt(p: Point): [number, number, number] {
  const s = shot!.scale, px = clamp(Math.floor(p.x * s), 0, base!.width - 1), py = clamp(Math.floor(p.y * s), 0, base!.height - 1);
  const d = pixels!.getImageData(px, py, 1, 1).data;
  return invert ? [255 - d[0], 255 - d[1], 255 - d[2]] : [d[0], d[1], d[2]];
}
const hex = ([r, g, b]: number[]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function magnifier(u: CanvasRenderingContext2D, p: Point) {
  if (!base || !pixels || !shot) return;
  const s = shot.scale, info = 44;
  let x = p.x + 20, y = p.y + 24;
  if (x + MAG > view.w - 4) x = p.x - 20 - MAG;
  if (y + MAG + info > view.h - 4) y = p.y - 24 - MAG - info;
  const src = MAG / ZOOM;
  u.save();
  u.fillStyle = 'rgba(28,28,30,0.92)'; u.beginPath(); u.roundRect(x - 2, y - 2, MAG + 4, MAG + info + 4, 8); u.fill();
  u.beginPath(); u.rect(x, y, MAG, MAG); u.clip();
  if (invert) u.filter = 'invert(1)';
  u.imageSmoothingEnabled = false;
  u.drawImage(base, (p.x - src / 2) * s, (p.y - src / 2) * s, src * s, src * s, x, y, MAG, MAG);
  u.filter = 'none';
  u.strokeStyle = 'rgba(0,122,255,0.9)'; u.lineWidth = 1;
  u.beginPath(); u.moveTo(x + MAG / 2, y); u.lineTo(x + MAG / 2, y + MAG); u.moveTo(x, y + MAG / 2); u.lineTo(x + MAG, y + MAG / 2); u.stroke();
  u.restore();
  const rgb = pixelAt(p);
  u.fillStyle = hex(rgb); u.fillRect(x + 6, y + MAG + 8, 12, 12);
  u.strokeStyle = 'rgba(255,255,255,.6)'; u.strokeRect(x + 6.5, y + MAG + 8.5, 11, 11);
  u.fillStyle = '#fff'; u.font = `11px ${FONT}`; u.textBaseline = 'middle';
  u.fillText(`${hex(rgb)}  RGB(${rgb.join(', ')})`, x + 24, y + MAG + 14);
  u.fillStyle = 'rgba(255,255,255,.7)';
  u.fillText(`${Math.round(p.x * s)}, ${Math.round(p.y * s)}`, x + 6, y + MAG + 32);
}

// ---------------------------------------------------------------- history
const clone = (list: Ann[]) => list.map(s => structuredClone(s));
function pushHistory() { undoStack.push(clone(anns)); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function restore(from: Ann[][], to: Ann[][]) {
  commitText();
  if (!from.length) return;
  to.push(clone(anns)); anns = from.pop()!; selected = null; syncCounter(); refreshBars(); dirty(true);
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);
/** Numbers follow undo/redo so badges never skip. */
function syncCounter() { const ns = anns.filter(a => a.kind === 'number').map(a => (a as Extract<Ann, { kind: 'number' }>).n); counter = ns.length ? Math.max(...ns) + 1 : 1; }
function removeSelected() { if (selected === null) return; pushHistory(); anns.splice(selected, 1); selected = null; syncCounter(); refreshBars(); dirty(true); }

// ---------------------------------------------------------------- pointer
const pt = (e: MouseEvent): Point => ({ x: clamp(e.clientX, 0, view.w), y: clamp(e.clientY, 0, view.h) });
const topHit = (p: Point) => { for (let i = anns.length - 1; i >= 0; i--) if (hit(anns[i], p)) return i; return null; };

function onDown(e: PointerEvent) {
  if (phase === 'idle' || busy) return;
  const p = pt(e);
  if (e.button === 2) { onRightClick(); return; }
  if (e.button !== 0) return;
  closePopover();
  if (text) {
    const wasText = tool() === 'text';
    commitText();
    if (!(wasText && sel && contains(sel, p) && topHit(p) === null)) return;
  }
  $('ui').setPointerCapture(e.pointerId);
  if (phase === 'select') { drag = { kind: 'region-new', origin: p, moved: false }; dirty(); return; }
  if (!sel) return;
  const current = selected !== null ? anns[selected] : null;
  if (current) {
    const h = handles(current).find(h => Math.hypot(h.p.x - p.x, h.p.y - p.y) <= 7);
    if (h) { drag = { kind: 'ann-handle', handle: h.id, pushed: false }; return; }
  }
  const rh = hitHandle(sel, p, 5);
  if (rh) { drag = { kind: 'region-resize', handle: rh, start: { ...sel } }; return; }
  if (tool() === 'sampler' && contains(sel, p)) { sample(p); return; }
  // Clicking any annotation selects it, whatever the tool.
  const index = topHit(p);
  if (index !== null) {
    selected = index; showOptions(); dirty();
    drag = { kind: 'ann-move', origin: p, start: structuredClone(anns[index]), pushed: false };
    return;
  }
  if (selected !== null) { selected = null; showOptions(); dirty(); }
  if (!contains(sel, p)) {
    if (!anns.length) { sel = null; phase = 'select'; hideBars(); drag = { kind: 'region-new', origin: p, moved: false }; dirty(true); }
    return;
  }
  const k = tool();
  if (k === 'select') { drag = { kind: 'region-move', origin: p, start: { ...sel } }; return; }
  if (k === 'text') { openText(p, null); return; }
  const o = { ...prefs.opts[k] }, id = nextId++;
  let ann: Ann;
  switch (k) {
    case 'pencil': case 'marker': ann = { id, kind: k, o, points: [p] }; break;
    case 'line': case 'arrow': case 'measure': ann = { id, kind: k, o, a: p, b: p, c: null }; break;
    case 'rect': case 'ellipse': case 'censor': case 'highlight': ann = { id, kind: k, o, a: p, b: p }; break;
    case 'number': ann = { id, kind: 'number', o, at: p, tip: null, n: counter }; break;
    case 'stamp': ann = { id, kind: 'stamp', o, at: p, size: o.stampSize }; break;
    default: return;
  }
  drag = { kind: 'draw', ann, origin: p, last: p };
  dirty(true);
}

function onMove(e: PointerEvent) {
  if (phase === 'idle') return;
  const p = pt(e); pointer = p;
  if (!drag) {
    if (phase === 'select') hover = snapTarget(p);
    updateCursor(p); dirty(); return;
  }
  switch (drag.kind) {
    case 'region-new':
      if (!drag.moved && Math.hypot(p.x - drag.origin.x, p.y - drag.origin.y) < 4) break;
      drag.moved = true; sel = fromPoints(drag.origin, p, view, e.shiftKey); break;
    case 'region-move': sel = move(drag.start, p.x - drag.origin.x, p.y - drag.origin.y, view); hideBars(); dirty(true); break;
    case 'region-resize': sel = resize(drag.start, drag.handle, p, view); hideBars(); dirty(true); break;
    case 'draw': {
      const a = drag.ann;
      // Space held: move the shape being drawn instead of resizing it.
      if (space) { drag.ann = translate(a, p.x - drag.last.x, p.y - drag.last.y); drag.origin = { x: drag.origin.x + p.x - drag.last.x, y: drag.origin.y + p.y - drag.last.y }; drag.last = p; dirty(true); break; }
      drag.last = p;
      if (a.kind === 'pencil' || a.kind === 'marker') {
        const last = a.points[a.points.length - 1];
        if (e.shiftKey && a.points.length > 1) a.points = [a.points[0], constrain(a.points[0], p, 'line')];
        else if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) a.points.push(p);
      } else if (a.kind === 'line' || a.kind === 'arrow' || a.kind === 'measure') a.b = e.shiftKey ? constrain(a.a, p, a.kind) : p;
      else if (a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'censor' || a.kind === 'highlight') a.b = e.shiftKey ? constrain(a.a, p, a.kind) : p;
      else if (a.kind === 'number') a.tip = Math.hypot(p.x - a.at.x, p.y - a.at.y) > badgeRadius(a.o) + 4 ? p : null;
      else if (a.kind === 'stamp') drag.ann = { ...a, size: Math.max(a.o.stampSize, Math.max(Math.abs(p.x - a.at.x), Math.abs(p.y - a.at.y)) * 2) };
      dirty(true); break;
    }
    case 'ann-move':
      if (selected === null) break;
      if (!drag.pushed) { pushHistory(); drag.pushed = true; }
      anns[selected] = translate(drag.start, p.x - drag.origin.x, p.y - drag.origin.y); dirty(true); break;
    case 'ann-handle':
      if (selected === null) break;
      if (!drag.pushed) { pushHistory(); drag.pushed = true; }
      anns[selected] = dragHandle(anns[selected], drag.handle, p, e.shiftKey); dirty(true); break;
  }
  dirty();
}

function onUp(e: PointerEvent) {
  if (!drag) return;
  const d = drag; drag = null;
  if ($('ui').hasPointerCapture(e.pointerId)) $('ui').releasePointerCapture(e.pointerId);
  if (d.kind === 'region-new') {
    const picked = d.moved ? sel : hover;
    sel = picked && picked.w >= 2 && picked.h >= 2 ? round(picked) : null;
    if (!sel) { phase = 'select'; dirty(true); return; }
    phase = 'edit';
    if (shot?.mode === 'quick') { void finish(shot.output.enter); return; }
    showBars(); showHint(); dirty(true);
    if (shot?.mode === 'ocr') void runOcr();
    return;
  } else if (d.kind === 'draw') {
    if (meaningful(d.ann)) {
      pushHistory(); anns.push(d.ann);
      if (d.ann.kind === 'number') counter++;
      selected = d.ann.kind === 'pencil' || d.ann.kind === 'marker' ? null : anns.length - 1;
      refreshBars();
    }
  } else if (d.kind === 'region-move' || d.kind === 'region-resize') {
    if (sel) sel = round(sel);
    if (sel && (sel.w < 2 || sel.h < 2)) { sel = null; phase = 'select'; hideBars(); }
    else showBars();
  } else refreshBars();
  updateCursor(pt(e)); showHint(); dirty(true);
}

function onRightClick() {
  if (text) { cancelText(); return; }
  if (selected !== null) { selected = null; showOptions(); dirty(); return; }
  if (phase === 'edit' && !anns.length) { sel = null; phase = 'select'; hideBars(); showHint(); dirty(true); return; }
  if (phase === 'select') cancel();
}

function onWheel(e: WheelEvent) {
  if (selected === null || text) return;
  const p = pt(e), s = anns[selected];
  if (!hit(s, p)) return;
  e.preventDefault();
  const now = Date.now(); if (now - lastWheel > 700) pushHistory(); lastWheel = now;
  anns[selected] = adjust(s, e.deltaY < 0 ? 1 : -1);
  showOptions(); dirty(true);
}

function updateCursor(p: Point) {
  let cursor = 'crosshair';
  if (phase === 'edit' && sel) {
    const current = selected !== null ? anns[selected] : null, rh = hitHandle(sel, p, 5);
    if (current && handles(current).some(h => Math.hypot(h.p.x - p.x, h.p.y - p.y) <= 7)) cursor = 'pointer';
    else if (rh) cursor = CURSORS[rh];
    else if (tool() !== 'sampler' && topHit(p) !== null) cursor = 'move';
    else if (contains(sel, p)) cursor = tool() === 'select' ? 'move' : tool() === 'text' ? 'text' : tool() === 'sampler' ? 'copy' : 'crosshair';
    else cursor = anns.length ? 'default' : 'crosshair';
  }
  $('ui').style.cursor = cursor;
}

function sample(p: Point) {
  const color = hex(pixelAt(p));
  prefs.recent = [color, ...prefs.recent.filter(c => c !== color)].slice(0, 6);
  for (const k of TOOLS) if (!NO_COLOR.has(k)) prefs.opts[k] = { ...prefs.opts[k], color };
  savePrefs(); refreshBars();
  void post({ type: 'copy-text', text: color });
  toast(tr('toast.colorCopied', { color }));
}

// ---------------------------------------------------------------- text
const textFont = (o: Options) => `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${o.fontSize}px ${FONT}`;
function openText(at: Point, index: number | null) {
  const area = $<HTMLTextAreaElement>('text');
  const existing = index !== null ? anns[index] as Text : null, o = existing?.o ?? prefs.opts.text;
  const p = existing ? existing.at : at;
  text = { at: p, editing: index };
  area.value = existing?.text ?? '';
  area.style.left = `${p.x - 4}px`; area.style.top = `${p.y - 4}px`;
  area.style.font = textFont(o); area.style.color = o.textBg ? (o.color.toUpperCase() === '#FFFFFF' ? '#000' : '#fff') : o.color;
  area.style.background = o.textBg ? o.color : 'transparent'; area.style.textAlign = o.align; area.style.textDecoration = o.underline ? 'underline' : 'none';
  area.hidden = false; autosize(); selected = null;
  requestAnimationFrame(() => area.focus());
  showOptions(); dirty(true);
}
function autosize() {
  const area = $<HTMLTextAreaElement>('text');
  area.style.width = '0px'; area.style.height = '0px';
  area.style.width = `${Math.min(Math.max(area.scrollWidth + 12, 40), view.w - (text?.at.x ?? 0))}px`;
  area.style.height = `${area.scrollHeight + 2}px`;
}
function commitText() {
  if (!text) return;
  const area = $<HTMLTextAreaElement>('text'), value = area.value.replace(/\s+$/, ''), t0 = text;
  text = null; area.hidden = true; area.value = '';
  if (t0.editing !== null) {
    const old = anns[t0.editing] as Text;
    if (value === old.text) { selected = t0.editing; dirty(true); return; }
    pushHistory();
    if (!value) { anns.splice(t0.editing, 1); selected = null; } else { anns[t0.editing] = { ...old, text: value }; selected = t0.editing; }
  } else if (value) {
    pushHistory(); anns.push({ id: nextId++, kind: 'text', o: { ...prefs.opts.text }, at: t0.at, text: value }); selected = anns.length - 1;
  }
  refreshBars(); dirty(true);
}
function cancelText() {
  if (!text) return;
  const t0 = text; text = null;
  const area = $<HTMLTextAreaElement>('text'); area.hidden = true; area.value = '';
  selected = t0.editing; dirty(true);
}

// ---------------------------------------------------------------- toolbars
function icon(name: string) { const i = el('i', 'icon'); i.style.setProperty('--src', `url(icons/${name}.svg)`); return i; }
function btn(name: string, title: string, testid: string, onClick: () => void, cls = 'tb') {
  const b = el('button', cls); b.title = title; b.setAttribute('aria-label', title); b.dataset.testid = testid;
  b.append(icon(name));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}
const sep = () => el('span', 'sep');

function buildBars() {
  const tools = $('tools'); tools.replaceChildren();
  for (const k of TOOLS) {
    const key = KEY_OF[k];
    const b = btn(k, `${tr(`tool.${k}`)}${key ? ` (${key})` : ''}`, `screenshot.tool.${k}`, () => setTool(k));
    b.dataset.tool = k; tools.append(b);
  }
  tools.append(sep());
  const color = el('button', 'tb color'); color.dataset.testid = 'screenshot.color'; color.title = tr('option.color');
  color.append(el('span', 'swatch-dot'));
  color.addEventListener('click', e => { e.stopPropagation(); togglePopover('palette'); });
  tools.append(color, sep(),
    btn('undo', tr('action.undo'), 'screenshot.action.undo', undo),
    btn('redo', tr('action.redo'), 'screenshot.action.redo', redo));
  const actions = $('actions'); actions.replaceChildren();
  actions.append(
    btn('copy', tr('action.copy'), 'screenshot.action.copy', () => void finish('copy'), 'tb primary'),
    btn('save', tr('action.save'), 'screenshot.action.save', () => void finish('save')),
    btn('ocr', tr('action.ocr'), 'screenshot.action.ocr', () => void runOcr()),
    btn('beautify', tr('action.beautify'), 'screenshot.action.beautify', () => togglePopover('beauty')),
    btn('invert', tr('action.invert'), 'screenshot.action.invert', () => { invert = !invert; paintBase(); refreshBars(); dirty(); }),
    sep(),
    btn('close', tr('action.cancel'), 'screenshot.action.cancel', cancel));
}

function refreshBars() {
  for (const b of $('tools').querySelectorAll<HTMLButtonElement>('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool());
  const q = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (q('screenshot.action.undo')) q('screenshot.action.undo')!.disabled = !undoStack.length;
  if (q('screenshot.action.redo')) q('screenshot.action.redo')!.disabled = !redoStack.length;
  q('screenshot.action.beautify')?.classList.toggle('lit', prefs.beauty.on);
  q('screenshot.action.invert')?.classList.toggle('on', invert);
  const current = selected !== null ? anns[selected] : null;
  const dot = document.querySelector<HTMLElement>('#tools .swatch-dot');
  if (dot) dot.style.background = (current?.o ?? prefs.opts[tool()]).color;
  showOptions();
  if (popover) placePopover();
}

function setTool(k: Tool) {
  commitText();
  prefs.tool = k; selected = null; savePrefs();
  refreshBars(); showHint(); dirty(true);
}

/** Options for the selected annotation if there is one, else for the current tool. */
function optionTarget(): { kind: Tool | Ann['kind']; o: Options; apply: (patch: Partial<Options>) => void } {
  const current = selected !== null ? anns[selected] : null;
  if (current) return {
    kind: current.kind, o: current.o,
    apply: patch => {
      pushHistory(); const s = anns[selected!];
      anns[selected!] = { ...s, o: { ...s.o, ...patch }, ...(s.kind === 'stamp' && patch.stampSize ? { size: patch.stampSize } : {}) } as Ann;
      // The tool remembers the change too, so the next one looks the same.
      const k = s.kind as Tool; prefs.opts[k] = { ...prefs.opts[k], ...patch }; savePrefs(); dirty(true); refreshBars();
    },
  };
  const k = tool();
  return { kind: k, o: prefs.opts[k], apply: patch => { prefs.opts[k] = { ...prefs.opts[k], ...patch }; savePrefs(); if (text && k === 'text') restyleText(); refreshBars(); } };
}
function restyleText() {
  if (!text) return;
  const o = prefs.opts.text, area = $<HTMLTextAreaElement>('text');
  area.style.font = textFont(o); area.style.color = o.textBg ? (o.color.toUpperCase() === '#FFFFFF' ? '#000' : '#fff') : o.color;
  area.style.background = o.textBg ? o.color : 'transparent'; area.style.textAlign = o.align; area.style.textDecoration = o.underline ? 'underline' : 'none';
  autosize();
}

function segmented<T extends string>(testid: string, value: T, items: { v: T; label: string; icon?: string }[], set: (v: T) => void) {
  const g = el('div', 'seg'); g.dataset.testid = testid;
  for (const it of items) {
    const b = el('button', `seg-item${it.v === value ? ' on' : ''}`); b.title = it.label; b.dataset.value = it.v;
    if (it.icon) b.append(icon(it.icon)); else b.textContent = it.label;
    b.addEventListener('click', e => { e.stopPropagation(); set(it.v); });
    g.append(b);
  }
  return g;
}
function toggle(testid: string, on: boolean, label: string, iconName: string, set: (v: boolean) => void) {
  const b = el('button', `seg-item solo${on ? ' on' : ''}`); b.title = label; b.dataset.testid = testid; b.append(icon(iconName));
  b.addEventListener('click', e => { e.stopPropagation(); set(!on); });
  return b;
}
function slider(testid: string, label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void) {
  const w = el('label', 'slider'); w.title = label;
  const name = el('span', 'slider-name', label);
  const r = el('input') as HTMLInputElement; r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(value); r.dataset.testid = testid;
  const out = el('span', 'slider-value', fmt(value));
  r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); });
  r.addEventListener('change', () => set(Number(r.value)));
  w.append(name, r, out); return w;
}

function showOptions() {
  const row = $('options');
  if (phase !== 'edit' || $('tools').hidden) { row.hidden = true; return; }
  const { kind, o, apply } = optionTarget();
  const parts: HTMLElement[] = [];
  if (!NO_WIDTH.has(kind)) parts.push(slider('screenshot.option.width', tr('option.width'), 1, 24, 1, o.width, v => `${v}`, v => apply({ width: v })));
  if (!NO_COLOR.has(kind) && kind !== 'censor') parts.push(slider('screenshot.option.opacity', tr('option.opacity'), 10, 100, 5, Math.round(o.opacity * 100), v => `${v}%`, v => apply({ opacity: v / 100 })));
  for (const key of optionsFor(kind)) {
    switch (key) {
      case 'arrow': parts.push(segmented('screenshot.option.arrow', o.arrow, (['single', 'double', 'open', 'thick', 'tail'] as const).map(v => ({ v, label: tr(`arrow.${v}`), icon: `arrow-${v}` })), v => apply({ arrow: v }))); break;
      case 'lineStyle': parts.push(segmented('screenshot.option.line', o.lineStyle, (['solid', 'dashed', 'dotted'] as const).map(v => ({ v, label: tr(`line.${v}`), icon: `line-${v}` })), v => apply({ lineStyle: v }))); break;
      case 'fill': parts.push(segmented('screenshot.option.fill', o.fill, (['stroke', 'strokeFill', 'fill'] as const).map(v => ({ v, label: tr(`fill.${v}`), icon: `fill-${v}` })), v => apply({ fill: v }))); break;
      case 'radius': parts.push(slider('screenshot.option.radius', tr('option.radius'), 0, 40, 2, o.radius, v => `${v}`, v => apply({ radius: v }))); break;
      case 'fontSize': parts.push(slider('screenshot.option.font', tr('option.fontSize'), 10, 96, 2, o.fontSize, v => `${v}`, v => apply({ fontSize: v }))); break;
      case 'bold': parts.push(toggle('screenshot.option.bold', o.bold, tr('option.bold'), 'bold', v => apply({ bold: v }))); break;
      case 'italic': parts.push(toggle('screenshot.option.italic', o.italic, tr('option.italic'), 'italic', v => apply({ italic: v }))); break;
      case 'underline': parts.push(toggle('screenshot.option.underline', o.underline, tr('option.underline'), 'underline', v => apply({ underline: v }))); break;
      case 'align': parts.push(segmented('screenshot.option.align', o.align, (['left', 'center', 'right'] as const).map(v => ({ v, label: tr(`align.${v}`), icon: `align-${v}` })), v => apply({ align: v }))); break;
      case 'textBg': parts.push(toggle('screenshot.option.textBg', o.textBg, tr('option.textBg'), 'text-bg', v => apply({ textBg: v }))); break;
      case 'numberFormat': parts.push(segmented('screenshot.option.number', o.numberFormat, [{ v: 'decimal', label: '1' }, { v: 'roman', label: 'I' }, { v: 'alpha', label: 'A' }, { v: 'alphaLower', label: 'a' }], v => apply({ numberFormat: v }))); break;
      case 'censor': parts.push(segmented('screenshot.option.censor', o.censor, (['pixelate', 'blur', 'solid'] as const).map(v => ({ v, label: tr(`censor.${v}`) })), v => apply({ censor: v }))); break;
      case 'emoji': {
        const g = el('div', 'emojis'); g.dataset.testid = 'screenshot.option.emoji';
        for (const e of EMOJIS) { const b = el('button', `emoji${e === o.emoji ? ' on' : ''}`, e); b.addEventListener('click', ev => { ev.stopPropagation(); apply({ emoji: e }); }); g.append(b); }
        parts.push(g); break;
      }
    }
  }
  if (kind === 'sampler') parts.push(el('span', 'note', tr('option.samplerNote')));
  if (kind === 'select') parts.push(el('span', 'note', tr('option.selectNote')));
  if (selected !== null) parts.push(btn('trash', tr('action.delete'), 'screenshot.action.delete', removeSelected, 'tb small'));
  row.replaceChildren(...parts);
  row.hidden = parts.length === 0;
  placeBars();
}

function showBars() { $('tools').hidden = false; $('actions').hidden = false; refreshBars(); placeBars(); }
function hideBars() { $('tools').hidden = true; $('actions').hidden = true; $('options').hidden = true; closePopover(); }

/** Bottom bar under the selection (or above, or inside); options row next to it; actions on the right. */
function placeBars() {
  if (!sel || $('tools').hidden) return;
  const tools = $('tools'), options = $('options'), actions = $('actions');
  const extra = prefs.beauty.on ? prefs.beauty.padding : 0;
  const tr0 = tools.getBoundingClientRect(), orow = options.hidden ? { width: 0, height: 0 } : options.getBoundingClientRect();
  const block = tr0.height + (options.hidden ? 0 : orow.height + 6), gap = 8 + extra;
  let y: number, above = false;
  if (sel.y + sel.h + gap + block <= view.h - 4) y = sel.y + sel.h + gap;
  else if (sel.y - gap - block >= 4) { y = sel.y - gap - block; above = true; }
  else y = Math.max(4, sel.y + sel.h - 8 - block);
  const x = clamp(sel.x + sel.w / 2 - tr0.width / 2, 4, view.w - tr0.width - 4);
  if (above && !options.hidden) { options.style.top = `${y}px`; tools.style.top = `${y + orow.height + 6}px`; }
  else { tools.style.top = `${y}px`; options.style.top = `${y + tr0.height + 6}px`; }
  tools.style.left = `${x}px`;
  options.style.left = `${clamp(sel.x + sel.w / 2 - orow.width / 2, 4, view.w - orow.width - 4)}px`;
  const ar = actions.getBoundingClientRect();
  let ax = sel.x + sel.w + gap;
  if (ax + ar.width > view.w - 4) ax = sel.x - gap - ar.width;
  if (ax < 4) ax = sel.x + sel.w - ar.width - 8;
  actions.style.left = `${ax}px`;
  actions.style.top = `${clamp(sel.y, 4, view.h - ar.height - 4)}px`;
  if (popover) placePopover();
}

// ---------------------------------------------------------------- popovers (palette, beautify)
function closePopover() { popover = null; $('popover').hidden = true; }
function togglePopover(kind: 'palette' | 'beauty') { if (popover === kind) closePopover(); else openPopover(kind); }

function openPopover(kind: 'palette' | 'beauty') {
  popover = kind;
  const box = $('popover'); box.replaceChildren();
  if (kind === 'palette') {
    const { o, apply } = optionTarget();
    const grid = el('div', 'palette');
    for (const c of [...COLORS, ...prefs.recent.filter(c => !COLORS.includes(c))]) {
      const s = el('button', `swatch${o.color.toUpperCase() === c ? ' on' : ''}`); s.style.background = c; s.title = c; s.dataset.testid = `screenshot.color.${c.slice(1)}`;
      s.addEventListener('click', e => { e.stopPropagation(); apply({ color: c }); openPopover('palette'); });
      grid.append(s);
    }
    const custom = el('input') as HTMLInputElement; custom.type = 'color'; custom.value = o.color.toLowerCase(); custom.className = 'custom'; custom.title = tr('option.customColor');
    custom.addEventListener('change', () => { const c = custom.value.toUpperCase(); prefs.recent = [c, ...prefs.recent.filter(x => x !== c)].slice(0, 6); apply({ color: c }); openPopover('palette'); });
    box.append(grid, custom);
  } else {
    const b = prefs.beauty;
    const set = (patch: Partial<Beauty>) => { prefs.beauty = { ...prefs.beauty, ...patch }; savePrefs(); refreshBars(); placeBars(); dirty(); openPopover('beauty'); };
    const head = el('label', 'row-line');
    const on = el('input') as HTMLInputElement; on.type = 'checkbox'; on.checked = b.on; on.dataset.testid = 'screenshot.beauty.on';
    on.addEventListener('change', () => set({ on: on.checked }));
    head.append(on, el('span', '', tr('beauty.enable')));
    const grads = el('div', 'gradients');
    GRADIENTS.forEach((stops, i) => {
      const g = el('button', `gradient${b.style === i ? ' on' : ''}`); g.style.background = `linear-gradient(135deg, ${stops.join(', ')})`; g.dataset.testid = `screenshot.beauty.style.${i}`;
      g.addEventListener('click', e => { e.stopPropagation(); set({ style: i, on: true }); });
      grads.append(g);
    });
    const frameRow = el('label', 'row-line');
    const frame = el('input') as HTMLInputElement; frame.type = 'checkbox'; frame.checked = b.frame; frame.dataset.testid = 'screenshot.beauty.frame';
    frame.addEventListener('change', () => set({ frame: frame.checked, on: true }));
    frameRow.append(frame, el('span', '', tr('beauty.frame')));
    box.append(head, grads, slider('screenshot.beauty.padding', tr('beauty.padding'), 16, 120, 4, b.padding, v => `${v}`, v => set({ padding: v, on: true })), frameRow);
  }
  box.hidden = false;
  placePopover();
}

function placePopover() {
  const box = $('popover');
  const anchor = popover === 'palette' ? document.querySelector<HTMLElement>('[data-testid="screenshot.color"]') : document.querySelector<HTMLElement>('[data-testid="screenshot.action.beautify"]');
  if (!anchor || $('tools').hidden) { box.hidden = true; return; }
  const a = anchor.getBoundingClientRect(), r = box.getBoundingClientRect();
  if (popover === 'beauty') {
    // Beside the vertical action bar.
    let x = a.right + 8; if (x + r.width > view.w - 4) x = a.left - 8 - r.width;
    box.style.left = `${x}px`; box.style.top = `${clamp(a.top, 4, view.h - r.height - 4)}px`;
  } else {
    const below = a.bottom + 8 + r.height <= view.h - 4;
    box.style.left = `${clamp(a.left + a.width / 2 - r.width / 2, 4, view.w - r.width - 4)}px`;
    box.style.top = `${below ? a.bottom + 8 : a.top - 8 - r.height}px`;
  }
}

// ---------------------------------------------------------------- OCR panel
async function runOcr() {
  if (!shot || !sel || busy) return;
  commitText();
  ocr = { loading: true, result: null }; renderOcr();
  try {
    const blob = await encode(flatten(false, true), 'image/png');
    const chunks = split(await toBase64(blob)), seq = shot.seq;
    for (let i = 0; i < chunks.length; i++) await post({ type: 'result', seq, action: 'ocr', mime: 'image/png', i, parts: chunks.length, data: chunks[i] });
  } catch (error) { console.error('ocr export failed:', error); ocr = { loading: false, result: null }; renderOcr(); }
}

function renderOcr() {
  const panel = $('ocr');
  if (!ocr || !sel) { panel.hidden = true; return; }
  panel.replaceChildren();
  const head = el('div', 'ocr-head'); head.append(el('b', '', tr('ocr.title')));
  const close = btn('close', tr('action.close'), 'screenshot.ocr.close', () => { ocr = null; renderOcr(); if (shot?.mode === 'ocr') cancel(); }, 'tb small');
  head.append(close); panel.append(head);
  if (ocr.loading) panel.append(el('p', 'muted', tr('ocr.loading')));
  else if (!ocr.result) panel.append(el('p', 'muted', tr('ocr.failed')));
  else {
    const { text: found, codes } = ocr.result;
    for (const code of codes) {
      const row = el('div', 'code'); row.dataset.testid = 'screenshot.ocr.code';
      row.append(el('span', 'code-label', tr('ocr.qr')), el('span', 'code-value', code));
      row.append(btn('copy-doc', tr('ocr.copy'), 'screenshot.ocr.code.copy', () => { void post({ type: 'copy-text', text: code }); toast(tr('toast.copied')); }, 'tb small'));
      if (/^https?:\/\//i.test(code)) row.append(btn('open', tr('ocr.open'), 'screenshot.ocr.code.open', () => { void post({ type: 'open-url', url: code }); cancel(); }, 'tb small'));
      panel.append(row);
    }
    if (found) {
      const area = el('textarea', 'ocr-text') as HTMLTextAreaElement; area.value = found; area.spellcheck = false; area.dataset.testid = 'screenshot.ocr.text';
      area.addEventListener('keydown', e => e.stopPropagation());
      const copy = el('button', 'cta', tr('ocr.copyAll')); copy.dataset.testid = 'screenshot.ocr.copy';
      copy.addEventListener('click', () => { void post({ type: 'copy-text', text: area.value }); toast(tr('toast.copied')); if (shot?.mode === 'ocr') setTimeout(cancel, 400); });
      panel.append(area, copy);
    } else if (!codes.length) panel.append(el('p', 'muted', tr('ocr.empty')));
  }
  panel.hidden = false;
  const r = panel.getBoundingClientRect();
  let x = sel.x + sel.w + 60; if (x + r.width > view.w - 4) x = sel.x - r.width - 60; if (x < 4) x = clamp(sel.x + sel.w - r.width - 8, 4, view.w - r.width - 4);
  panel.style.left = `${x}px`; panel.style.top = `${clamp(sel.y, 4, view.h - r.height - 4)}px`;
}

// ---------------------------------------------------------------- output
/** The selection as an image: optionally with annotations, optionally beautified. */
function flatten(withAnnotations: boolean, raw = false): HTMLCanvasElement {
  const r = sel!, s = shot!.output.downscale && !raw ? 1 : shot!.scale, src = shot!.scale;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(r.w * s)); c.height = Math.max(1, Math.round(r.h * s));
  const ctx = c.getContext('2d')!;
  if (invert) ctx.filter = 'invert(1)';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(base!, r.x * src, r.y * src, r.w * src, r.h * src, 0, 0, c.width, c.height);
  ctx.filter = 'none';
  if (withAnnotations) {
    ctx.setTransform(s, 0, 0, s, -r.x * s, -r.y * s);
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const e = { ...env(), scale: s };
    for (const a of anns) draw(ctx, a, e);
    spotlight(ctx, anns, r);
  }
  return withAnnotations && prefs.beauty.on ? beautify(c, prefs.beauty, s) : c;
}
const encode = (c: HTMLCanvasElement, mime: string) => new Promise<Blob>((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('encode_failed')), mime, 0.92));
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function finish(action: Exclude<Action, 'ocr'>) {
  if (!shot || !sel || busy) return;
  commitText();
  busy = true;
  const seq = shot.seq, mime = action === 'save' && shot.output.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  try {
    const chunks = split(await toBase64(await encode(flatten(true), mime)));
    // Back to the user's app at once; the worker copies or saves afterwards.
    reset(); await appWindows.hide('overlay').catch(() => {});
    for (let i = 0; i < chunks.length; i++) await post({ type: 'result', seq, action, mime, i, parts: chunks.length, data: chunks[i] });
  } catch (error) {
    console.error('screenshot export failed:', error);
    await post({ type: 'cancel', seq }); reset(); await appWindows.hide('overlay').catch(() => {});
  } finally { busy = false; }
}

function cancel() {
  const seq = shot?.seq;
  reset(); void appWindows.hide('overlay').catch(() => {});
  if (seq !== undefined) void post({ type: 'cancel', seq });
}

/** Clears the capture so the next one never flashes this one; tool settings stay. */
function reset() {
  shot = null; incoming = null; base?.close(); base = null; pixels = null; effects = null;
  phase = 'idle'; sel = null; hover = null; drag = null; anns = []; undoStack = []; redoStack = [];
  selected = null; counter = 1; text = null; invert = false; ocr = null; space = false;
  const area = $<HTMLTextAreaElement>('text'); area.hidden = true; area.value = '';
  hideBars(); $('hint').hidden = true; $('ocr').hidden = true; $('toast').hidden = true;
  for (const c of canvases()) { const x = c.getContext('2d')!; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); }
  $('base').style.filter = 'none';
}

// ---------------------------------------------------------------- hint and toast
function showHint() {
  const box = $('hint');
  if (phase === 'idle') { box.hidden = true; return; }
  const keys = phase === 'select'
    ? ['hint.drag', 'hint.square', prefs.snap ? 'hint.snapOn' : 'hint.snapOff', 'hint.full', 'hint.esc']
    : ['hint.tools', 'hint.select', 'hint.space', 'hint.enter', 'hint.esc'];
  box.replaceChildren(...keys.map(k => el('div', '', tr(k))));
  box.hidden = false;
  box.classList.remove('top'); const r = box.getBoundingClientRect();
  const covers = (y: number) => !!sel && !(r.right < sel.x || r.left > sel.x + sel.w || y + r.height < sel.y || y > sel.y + sel.h);
  if (covers(r.top)) { box.classList.add('top'); if (covers(16)) box.hidden = true; }
}
let toastTimer = 0;
function toast(message: string) {
  const box = $('toast'); box.textContent = message; box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 1600) as unknown as number;
}

// ---------------------------------------------------------------- keyboard
function onKey(e: KeyboardEvent) {
  if (phase === 'idle') return;
  const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
  if (e.target === $('text')) {
    if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
    else if (e.key === 'Enter' && mod) { e.preventDefault(); commitText(); }
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ') { space = true; e.preventDefault(); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (popover) closePopover(); else if (ocr && shot?.mode !== 'ocr') { ocr = null; renderOcr(); } else if (selected !== null) { selected = null; showOptions(); dirty(); } else cancel();
    return;
  }
  if (phase === 'select') {
    if (e.key === 'Tab') { e.preventDefault(); prefs.snap = !prefs.snap; savePrefs(); if (pointer) hover = snapTarget(pointer); showHint(); dirty(); }
    else if (key === 'f' && !mod) { e.preventDefault(); sel = { ...view }; phase = 'edit'; if (shot?.mode === 'quick') { void finish(shot.output.enter); return; } if (shot?.mode === 'ocr') { showBars(); void runOcr(); return; } showBars(); showHint(); dirty(true); }
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); void finish(shot?.output.enter ?? 'copy'); return; }
  if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && key === 'c') { e.preventDefault(); void finish('copy'); return; }
  if (mod && key === 's') { e.preventDefault(); void finish('save'); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeSelected(); return; }
  if (e.key.startsWith('Arrow') && sel) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (selected !== null) { pushHistory(); anns[selected] = translate(anns[selected], dx, dy); dirty(true); }
    else { sel = move(sel, dx, dy, view); placeBars(); dirty(true); }
    return;
  }
  if (!mod && !e.altKey && TOOL_KEYS[key]) { e.preventDefault(); setTool(TOOL_KEYS[key]); }
}

// ---------------------------------------------------------------- wiring
export async function startOverlay() {
  t = await i18n.catalog().catch(() => ({}));
  i18n.onDidChangeLocale(async () => { t = await i18n.catalog().catch(() => t); buildBars(); refreshBars(); });
  buildBars();
  const ui = $('ui');
  ui.addEventListener('pointerdown', onDown);
  ui.addEventListener('pointermove', onMove);
  ui.addEventListener('pointerup', onUp);
  ui.addEventListener('pointercancel', onUp);
  ui.addEventListener('dblclick', e => {
    if (phase !== 'edit' || !sel) return;
    const p = pt(e), i = topHit(p);
    if (i !== null && anns[i].kind === 'text') { openText(p, i); return; }
    if (i === null && tool() === 'select' && contains(sel, p)) void finish(shot?.output.enter ?? 'copy');
  });
  ui.addEventListener('wheel', onWheel, { passive: false });
  for (const id of ['tools', 'options', 'actions', 'popover', 'ocr', 'text']) $(id).addEventListener('pointerdown', e => e.stopPropagation());
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', onKey);
  addEventListener('keyup', e => { if (e.key === ' ') space = false; });
  $('text').addEventListener('input', autosize);
  // The overlay hides when it loses focus (another app came forward): that ends the capture.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && shot && !busy) { console.info('overlay hidden (lost focus): cancelling'); cancel(); } });
  addEventListener('resize', () => { if (base) { view = { x: 0, y: 0, w: innerWidth, h: innerHeight }; sizeCanvases(); paintBase(); effects = null; dirty(true); placeBars(); } });
  channel.onMessage<ToOverlay>(m => {
    if (m?.type === 'shot') {
      reset(); prefs = loadPrefs();
      shot = m.shot; incoming = { seq: m.shot.seq, parts: [], total: m.parts };
      $('ui').style.cursor = 'crosshair';
    } else if (m?.type === 'chunk' && incoming && m.seq === incoming.seq) {
      incoming.parts[m.i] = m.data;
      if (incoming.parts.filter(p => p !== undefined).length === incoming.total) {
        const b64 = incoming.parts.join(''), seq = incoming.seq; incoming = null;
        void load(seq, b64).catch(error => { console.error('screenshot load failed:', error); cancel(); });
      }
    } else if (m?.type === 'ocr' && shot && m.seq === shot.seq && ocr) {
      ocr = { loading: false, result: m.result }; renderOcr();
    } else if (m?.type === 'overlay-toast' && shot) toast(tr(m.key, m.params ?? {}));
  });
  await post({ type: 'overlay-ready' });
}
