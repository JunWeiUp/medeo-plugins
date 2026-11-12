// Annotations as plain data in display points, and how to draw, hit-test and edit them on any 2D
// context. The live editor draws with a devicePixelRatio transform and the export with the
// capture's scale, so both come out identical.
import type { Point, Rect } from './geometry.ts';

export type Tool = 'select' | 'arrow' | 'line' | 'pencil' | 'marker' | 'rect' | 'ellipse' | 'text' | 'number' | 'censor' | 'highlight' | 'stamp' | 'measure' | 'sampler';
export const TOOLS: Tool[] = ['select', 'arrow', 'line', 'pencil', 'marker', 'rect', 'ellipse', 'text', 'number', 'censor', 'highlight', 'stamp', 'measure', 'sampler'];
/** Single-key tool shortcuts once a region is selected. */
export const TOOL_KEYS: Record<string, Tool> = { s: 'select', a: 'arrow', l: 'line', p: 'pencil', m: 'marker', r: 'rect', o: 'ellipse', t: 'text', n: 'number', b: 'censor', h: 'highlight', g: 'stamp', u: 'measure', i: 'sampler' };
export const KEY_OF: Partial<Record<Tool, string>> = Object.fromEntries(Object.entries(TOOL_KEYS).map(([k, v]) => [v, k.toUpperCase()]));

export const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FFFFFF', '#8E8E93', '#000000'];
export const EMOJIS = ['👍', '👎', '✅', '❌', '⚠️', '❓', '❗', '💡', '🔥', '⭐', '❤️', '😀', '😂', '😍', '🤔', '😢', '😡', '🎉', '👀', '👉', '🐛'];

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type ArrowStyle = 'single' | 'double' | 'open' | 'thick' | 'tail';
export type Fill = 'stroke' | 'strokeFill' | 'fill';
export type NumberFormat = 'decimal' | 'roman' | 'alpha' | 'alphaLower';
export type CensorMode = 'pixelate' | 'blur' | 'solid';
export type Align = 'left' | 'center' | 'right';

/** Everything a tool can be set to; each annotation keeps the values it was drawn with. */
export interface Options {
  color: string; width: number; opacity: number; lineStyle: LineStyle;
  arrow: ArrowStyle; fill: Fill; radius: number;
  fontSize: number; bold: boolean; italic: boolean; underline: boolean; align: Align; textBg: boolean;
  numberFormat: NumberFormat; censor: CensorMode; emoji: string; stampSize: number;
}
export const DEFAULT_OPTIONS: Options = {
  color: COLORS[0], width: 4, opacity: 1, lineStyle: 'solid', arrow: 'single', fill: 'stroke', radius: 0,
  fontSize: 22, bold: false, italic: false, underline: false, align: 'left', textBg: false,
  numberFormat: 'decimal', censor: 'pixelate', emoji: '👍', stampSize: 48,
};

interface Base { id: number; o: Options }
export type Stroke = Base & { kind: 'pencil' | 'marker'; points: Point[] };
export type Segment = Base & { kind: 'line' | 'arrow' | 'measure'; a: Point; b: Point; c: Point | null };
export type Box = Base & { kind: 'rect' | 'ellipse' | 'censor' | 'highlight'; a: Point; b: Point };
export type Text = Base & { kind: 'text'; at: Point; text: string };
export type Num = Base & { kind: 'number'; at: Point; tip: Point | null; n: number };
export type Stamp = Base & { kind: 'stamp'; at: Point; size: number };
export type Ann = Stroke | Segment | Box | Text | Num | Stamp;

/** What drawing needs besides the annotation: pixelated/blurred copies of the display, the capture scale. */
export interface Env { mosaic: CanvasImageSource | null; blur: CanvasImageSource | null; width: number; height: number; scale: number }

export const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif';
const LINE = 1.25;

// ---------------------------------------------------------------- small helpers
export const boxOf = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
const contrast = (hex: string) => {
  const v = parseInt(hex.slice(1), 16), r = v >> 16 & 255, g = v >> 8 & 255, b = v & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#000000' : '#FFFFFF';
};

export function formatNumber(n: number, f: NumberFormat): string {
  if (f === 'decimal') return String(n);
  if (f === 'roman') {
    const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '', v = Math.max(1, Math.min(3999, n));
    for (const [k, s] of table) while (v >= k) { out += s; v -= k; }
    return out;
  }
  // A…Z, AA…AZ, BA… (spreadsheet columns)
  let out = '', v = Math.max(1, n);
  while (v > 0) { v--; out = String.fromCharCode(65 + (v % 26)) + out; v = Math.floor(v / 26); }
  return f === 'alpha' ? out : out.toLowerCase();
}

/** Shift: lines snap to 45°, boxes become squares. */
export function constrain(a: Point, p: Point, kind: Ann['kind']): Point {
  const dx = p.x - a.x, dy = p.y - a.y;
  if (kind === 'line' || kind === 'arrow' || kind === 'measure') {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * d, y: a.y + Math.sign(dy || 1) * d };
}

export const badgeRadius = (o: Options) => 10 + o.width * 1.6;
export const arrowHead = (o: Options) => 9 + o.width * 2.6;

let scratch: CanvasRenderingContext2D | null = null;
const measureCtx = () => scratch ??= document.createElement('canvas').getContext('2d')!;
const textFont = (o: Options) => `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${o.fontSize}px ${FONT}`;
export function textBox(s: Text): Rect {
  const ctx = measureCtx(); ctx.font = textFont(s.o);
  const lines = s.text.split('\n'), pad = s.o.textBg ? s.o.fontSize * 0.35 : 0;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width), s.o.fontSize * 0.5);
  return { x: s.at.x - pad, y: s.at.y - pad, w: w + pad * 2, h: lines.length * s.o.fontSize * LINE + pad * 2 };
}

/** The bounding box, for selection outlines and hit tests. */
export function bounds(s: Ann): Rect {
  switch (s.kind) {
    case 'pencil': case 'marker': {
      const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'line': case 'arrow': case 'measure': {
      const pts = [s.a, s.b, ...(s.c ? [curveMid(s)] : [])];
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'rect': case 'ellipse': case 'censor': case 'highlight': return boxOf(s.a, s.b);
    case 'text': return textBox(s);
    case 'number': { const r = badgeRadius(s.o); return { x: s.at.x - r, y: s.at.y - r, w: r * 2, h: r * 2 }; }
    case 'stamp': return { x: s.at.x - s.size / 2, y: s.at.y - s.size / 2, w: s.size, h: s.size };
  }
}

// ---------------------------------------------------------------- drawing
function dash(ctx: CanvasRenderingContext2D, o: Options) {
  ctx.setLineDash(o.lineStyle === 'dashed' ? [o.width * 3, o.width * 2] : o.lineStyle === 'dotted' ? [0.1, o.width * 2] : []);
}

function smooth(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  if (points.length === 1) { ctx.moveTo(points[0].x, points[0].y); ctx.lineTo(points[0].x + 0.01, points[0].y); return; }
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const m = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    ctx.quadraticCurveTo(points[i].x, points[i].y, m.x, m.y);
  }
  const last = points[points.length - 1]; ctx.lineTo(last.x, last.y);
}

function head(ctx: CanvasRenderingContext2D, tip: Point, from: Point, size: number, open = false) {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x), spread = Math.PI / 7;
  const l = { x: tip.x - size * Math.cos(ang - spread), y: tip.y - size * Math.sin(ang - spread) };
  const r = { x: tip.x - size * Math.cos(ang + spread), y: tip.y - size * Math.sin(ang + spread) };
  ctx.beginPath();
  if (open) { ctx.setLineDash([]); ctx.moveTo(l.x, l.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(r.x, r.y); ctx.stroke(); return; }
  ctx.moveTo(tip.x, tip.y); ctx.lineTo(l.x, l.y);
  ctx.lineTo(tip.x - size * 0.72 * Math.cos(ang), tip.y - size * 0.72 * Math.sin(ang));
  ctx.lineTo(r.x, r.y); ctx.closePath(); ctx.fill();
}

/** The point halfway along a segment; dragging it bends the shaft through the pointer. */
export function curveMid(s: Segment): Point {
  const c = s.c ?? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
  return { x: 0.25 * s.a.x + 0.5 * c.x + 0.25 * s.b.x, y: 0.25 * s.a.y + 0.5 * c.y + 0.25 * s.b.y };
}

/** Pull `p` back towards `from` by `by` points (so a round cap never pokes out of an arrowhead). */
const back = (p: Point, from: Point, by: number): Point => { const d = Math.hypot(p.x - from.x, p.y - from.y) || 1; return { x: p.x - (p.x - from.x) / d * by, y: p.y - (p.y - from.y) / d * by }; };

function segment(ctx: CanvasRenderingContext2D, s: Segment, env: Env) {
  const o = s.o;
  if (s.kind === 'arrow' && o.arrow === 'thick') { thickArrow(ctx, s.a, s.b, o); return; }
  const size = arrowHead(o);
  const endFrom = s.c ?? s.a, startFrom = s.c ?? s.b;
  const headEnd = s.kind === 'arrow', headStart = s.kind === 'arrow' && o.arrow === 'double';
  const filled = s.kind === 'arrow' && o.arrow !== 'open';
  const a = headStart && filled ? back(s.a, startFrom, size * 0.6) : s.a;
  const b = headEnd && filled ? back(s.b, endFrom, size * 0.6) : s.b;
  dash(ctx, o);
  ctx.beginPath(); ctx.moveTo(a.x, a.y);
  if (s.c) ctx.quadraticCurveTo(s.c.x, s.c.y, b.x, b.y); else ctx.lineTo(b.x, b.y);
  ctx.stroke(); ctx.setLineDash([]);
  if (headEnd) head(ctx, s.b, endFrom, size, o.arrow === 'open');
  if (headStart) head(ctx, s.a, startFrom, size, false);
  if (s.kind === 'arrow' && o.arrow === 'tail') { ctx.beginPath(); ctx.arc(s.a.x, s.a.y, Math.max(3, o.width * 1.2), 0, Math.PI * 2); ctx.fill(); }
  if (s.kind === 'measure') {
    // Ticks at both ends and the length in pixels of the captured image.
    const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x), t = 6 + o.width;
    for (const p of [s.a, s.b]) { ctx.beginPath(); ctx.moveTo(p.x - Math.sin(ang) * t, p.y + Math.cos(ang) * t); ctx.lineTo(p.x + Math.sin(ang) * t, p.y - Math.cos(ang) * t); ctx.stroke(); }
    const len = Math.round(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * env.scale), label = `${len} px`;
    const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    ctx.font = `600 12px ${FONT}`; const w = ctx.measureText(label).width + 10;
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(17,24,39,0.85)'; ctx.beginPath(); ctx.roundRect(m.x - w / 2, m.y - 20 - t, w, 18, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, m.x, m.y - 11 - t);
  }
}

/** A solid banner arrow: a tapered body with a wide head. */
function thickArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, o: Options) {
  const len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 1) return;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
  const w = 3 + o.width * 1.6, hw = w * 2.4, hl = Math.min(len * 0.6, w * 3.2);
  const base = { x: b.x - ux * hl, y: b.y - uy * hl };
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w * 0.25, a.y + ny * w * 0.25);
  ctx.lineTo(base.x + nx * w, base.y + ny * w); ctx.lineTo(base.x + nx * hw, base.y + ny * hw);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(base.x - nx * hw, base.y - ny * hw); ctx.lineTo(base.x - nx * w, base.y - ny * w);
  ctx.lineTo(a.x - nx * w * 0.25, a.y - ny * w * 0.25); ctx.closePath(); ctx.fill();
}

function box(ctx: CanvasRenderingContext2D, s: Box, env: Env) {
  const r = boxOf(s.a, s.b), o = s.o;
  if (s.kind === 'censor') {
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); ctx.globalAlpha = 1;
    if (o.censor === 'solid') { ctx.fillStyle = o.color; ctx.fillRect(r.x, r.y, r.w, r.h); }
    else { const src = o.censor === 'pixelate' ? env.mosaic : env.blur; if (src) ctx.drawImage(src, 0, 0, env.width, env.height); }
    ctx.restore(); return;
  }
  if (s.kind === 'highlight') return; // painted together with the others by `spotlight`
  ctx.beginPath();
  if (s.kind === 'rect') ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(o.radius, r.w / 2, r.h / 2));
  else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  if (o.fill !== 'stroke') { ctx.save(); ctx.globalAlpha = o.opacity * (o.fill === 'strokeFill' ? 0.3 : 1); ctx.fill(); ctx.restore(); }
  if (o.fill !== 'fill') { dash(ctx, o); ctx.stroke(); ctx.setLineDash([]); }
}

function text(ctx: CanvasRenderingContext2D, s: Text) {
  const o = s.o, r = textBox(s), lines = s.text.split('\n');
  ctx.font = textFont(o); ctx.textBaseline = 'top';
  const inner = { x: s.at.x, w: r.w - (o.textBg ? o.fontSize * 0.7 : 0) };
  if (o.textBg) { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, o.fontSize * 0.3); ctx.fill(); ctx.fillStyle = contrast(o.color); }
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    const x = o.align === 'center' ? inner.x + (inner.w - w) / 2 : o.align === 'right' ? inner.x + inner.w - w : inner.x;
    const y = s.at.y + i * o.fontSize * LINE + o.fontSize * 0.1;
    ctx.fillText(line, x, y);
    if (o.underline && w) ctx.fillRect(x, y + o.fontSize * 1.02, w, Math.max(1, o.fontSize / 14));
  });
}

function number(ctx: CanvasRenderingContext2D, s: Num) {
  const o = s.o, r = badgeRadius(o);
  if (s.tip) {
    // A cone from the badge towards what it points at.
    const d = Math.hypot(s.tip.x - s.at.x, s.tip.y - s.at.y);
    if (d > r) {
      const ang = Math.atan2(s.tip.y - s.at.y, s.tip.x - s.at.x), spread = Math.asin(Math.min(0.95, r * 0.55 / r));
      ctx.beginPath(); ctx.moveTo(s.at.x + Math.cos(ang - spread) * r, s.at.y + Math.sin(ang - spread) * r);
      ctx.lineTo(s.tip.x, s.tip.y); ctx.lineTo(s.at.x + Math.cos(ang + spread) * r, s.at.y + Math.sin(ang + spread) * r); ctx.closePath(); ctx.fill();
    }
  }
  ctx.beginPath(); ctx.arc(s.at.x, s.at.y, r, 0, Math.PI * 2); ctx.fill();
  const label = formatNumber(s.n, o.numberFormat);
  ctx.fillStyle = contrast(o.color); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * (label.length > 2 ? 0.75 : label.length > 1 ? 0.9 : 1.1))}px ${FONT}`;
  ctx.fillText(label, s.at.x, s.at.y + r * 0.05);
}

export function draw(ctx: CanvasRenderingContext2D, s: Ann, env: Env) {
  const o = s.o;
  ctx.save();
  ctx.globalAlpha = o.opacity; ctx.strokeStyle = o.color; ctx.fillStyle = o.color;
  ctx.lineWidth = o.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (s.kind) {
    case 'pencil': dash(ctx, o); smooth(ctx, s.points); ctx.stroke(); break;
    case 'marker':
      ctx.globalAlpha = 0.4 * o.opacity; ctx.globalCompositeOperation = 'multiply'; ctx.lineWidth = o.width * 3 + 8; ctx.lineCap = 'butt';
      smooth(ctx, s.points); ctx.stroke(); break;
    case 'line': case 'arrow': case 'measure': segment(ctx, s, env); break;
    case 'rect': case 'ellipse': case 'censor': case 'highlight': box(ctx, s, env); break;
    case 'text': text(ctx, s); break;
    case 'number': number(ctx, s); break;
    case 'stamp': ctx.globalAlpha = o.opacity; ctx.font = `${s.size}px "Apple Color Emoji", ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.emoji, s.at.x, s.at.y + s.size * 0.06); break;
  }
  ctx.restore();
}

let spot: HTMLCanvasElement | null = null;
/** Spotlight: everything in `area` outside the highlight boxes is dimmed (the Highlight tool). */
export function spotlight(ctx: CanvasRenderingContext2D, list: Ann[], area: Rect) {
  const boxes = list.filter((s): s is Box => s.kind === 'highlight');
  if (!boxes.length) return;
  const c = spot ??= document.createElement('canvas');
  if (c.width !== ctx.canvas.width || c.height !== ctx.canvas.height) { c.width = ctx.canvas.width; c.height = ctx.canvas.height; }
  const m = c.getContext('2d')!;
  m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, c.width, c.height);
  m.setTransform(ctx.getTransform());
  m.fillStyle = 'rgba(0,0,0,0.55)'; m.fillRect(area.x, area.y, area.w, area.h);
  m.globalCompositeOperation = 'destination-out';
  for (const b of boxes) { const r = boxOf(b.a, b.b); m.beginPath(); m.roundRect(r.x, r.y, r.w, r.h, 6); m.fill(); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(c, 0, 0); ctx.restore();
  for (const b of boxes) {
    const r = boxOf(b.a, b.b);
    ctx.save(); ctx.strokeStyle = b.o.color; ctx.lineWidth = 2; ctx.globalAlpha = b.o.opacity; dash(ctx, b.o);
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 6); ctx.stroke(); ctx.restore();
  }
}

// ---------------------------------------------------------------- editing
export type HandleId = 'a' | 'b' | 'c' | 'tip' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function handles(s: Ann): { id: HandleId; p: Point }[] {
  switch (s.kind) {
    case 'rect': case 'ellipse': case 'censor': case 'highlight': case 'stamp': {
      const r = bounds(s), cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.x + r.w, B = r.y + r.h;
      const corners: { id: HandleId; p: Point }[] = [{ id: 'nw', p: { x: r.x, y: r.y } }, { id: 'ne', p: { x: R, y: r.y } }, { id: 'se', p: { x: R, y: B } }, { id: 'sw', p: { x: r.x, y: B } }];
      if (s.kind === 'stamp') return corners;
      return [...corners, { id: 'n', p: { x: cx, y: r.y } }, { id: 'e', p: { x: R, y: cy } }, { id: 's', p: { x: cx, y: B } }, { id: 'w', p: { x: r.x, y: cy } }];
    }
    case 'line': case 'measure': return [{ id: 'a', p: s.a }, { id: 'b', p: s.b }];
    case 'arrow': return s.o.arrow === 'thick' ? [{ id: 'a', p: s.a }, { id: 'b', p: s.b }] : [{ id: 'a', p: s.a }, { id: 'c', p: curveMid(s) }, { id: 'b', p: s.b }];
    case 'number': return s.tip ? [{ id: 'tip', p: s.tip }] : [];
    default: return [];
  }
}

export function dragHandle(s: Ann, h: HandleId, p: Point, shift = false): Ann {
  switch (s.kind) {
    case 'line': case 'arrow': case 'measure':
      if (h === 'a') return { ...s, a: shift ? constrain(s.b, p, s.kind) : p };
      if (h === 'b') return { ...s, b: shift ? constrain(s.a, p, s.kind) : p };
      if (h === 'c') return { ...s, c: { x: 2 * p.x - (s.a.x + s.b.x) / 2, y: 2 * p.y - (s.a.y + s.b.y) / 2 } };
      return s;
    case 'number': return h === 'tip' ? { ...s, tip: p } : s;
    case 'stamp': {
      const size = Math.max(16, Math.min(400, Math.max(Math.abs(p.x - s.at.x), Math.abs(p.y - s.at.y)) * 2));
      return { ...s, size };
    }
    case 'rect': case 'ellipse': case 'censor': case 'highlight': {
      const r = boxOf(s.a, s.b); let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
      if (h.includes('w')) x1 = p.x; if (h.includes('e')) x2 = p.x; if (h.includes('n')) y1 = p.y; if (h.includes('s')) y2 = p.y;
      return { ...s, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
    }
    default: return s;
  }
}

export function translate(s: Ann, dx: number, dy: number): Ann {
  const t = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  switch (s.kind) {
    case 'pencil': case 'marker': return { ...s, points: s.points.map(t) };
    case 'line': case 'arrow': case 'measure': return { ...s, a: t(s.a), b: t(s.b), c: s.c && t(s.c) };
    case 'rect': case 'ellipse': case 'censor': case 'highlight': return { ...s, a: t(s.a), b: t(s.b) };
    case 'text': case 'stamp': return { ...s, at: t(s.at) };
    case 'number': return { ...s, at: t(s.at), tip: s.tip && t(s.tip) };
  }
}

function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const k = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
}
const nearPolyline = (p: Point, pts: Point[], tol: number) => pts.length === 1 ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol : pts.some((q, i) => i > 0 && distToSegment(p, pts[i - 1], q) <= tol);
const inside = (r: Rect, p: Point, pad: number) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

/** Whether `p` grabs `s`. Outlined shapes are grabbed by their edge so things inside stay clickable. */
export function hit(s: Ann, p: Point): boolean {
  const tol = Math.max(6, s.o.width / 2 + 5);
  switch (s.kind) {
    case 'pencil': return nearPolyline(p, s.points, tol);
    case 'marker': return nearPolyline(p, s.points, (s.o.width * 3 + 8) / 2 + 3);
    case 'line': case 'arrow': case 'measure': {
      if (!s.c) return distToSegment(p, s.a, s.b) <= tol + (s.kind === 'arrow' && s.o.arrow === 'thick' ? s.o.width * 2 : 2);
      const pts: Point[] = [];
      for (let i = 0; i <= 24; i++) { const k = i / 24, u = 1 - k; pts.push({ x: u * u * s.a.x + 2 * u * k * s.c.x + k * k * s.b.x, y: u * u * s.a.y + 2 * u * k * s.c.y + k * k * s.b.y }); }
      return nearPolyline(p, pts, tol + 2);
    }
    case 'rect': case 'ellipse': {
      const r = boxOf(s.a, s.b);
      if (s.o.fill !== 'stroke') return inside(r, p, tol / 2);
      if (!inside(r, p, tol)) return false;
      if (s.kind === 'rect') return !inside({ x: r.x + tol, y: r.y + tol, w: r.w - tol * 2, h: r.h - tol * 2 }, p, 0);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = Math.max(1, r.w / 2), ry = Math.max(1, r.h / 2);
      const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= tol;
    }
    case 'censor': case 'stamp': case 'text': return inside(bounds(s), p, 3);
    case 'highlight': { const r = boxOf(s.a, s.b); return inside(r, p, tol) && !inside({ x: r.x + tol, y: r.y + tol, w: r.w - tol * 2, h: r.h - tol * 2 }, p, 0); }
    case 'number': return Math.hypot(p.x - s.at.x, p.y - s.at.y) <= badgeRadius(s.o) + 3 || (!!s.tip && distToSegment(p, s.at, s.tip) <= tol);
  }
}

/** Mouse wheel over a selected annotation: stroke width, font size or stamp size. */
export function adjust(s: Ann, delta: number): Ann {
  if (s.kind === 'text') return { ...s, o: { ...s.o, fontSize: Math.max(10, Math.min(160, s.o.fontSize + delta * 2)) } };
  if (s.kind === 'stamp') return { ...s, size: Math.max(16, Math.min(400, s.size + delta * 4)) };
  return { ...s, o: { ...s.o, width: Math.max(1, Math.min(40, s.o.width + delta)) } };
}

/** A drag that never really moved draws nothing (a number badge is placed by a click). */
export function meaningful(s: Ann): boolean {
  switch (s.kind) {
    case 'rect': case 'ellipse': case 'censor': case 'highlight': return Math.abs(s.a.x - s.b.x) > 3 && Math.abs(s.a.y - s.b.y) > 3;
    case 'line': case 'arrow': case 'measure': return Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y) > 4;
    case 'text': return s.text.trim().length > 0;
    default: return true;
  }
}

/** Which option controls a tool shows (besides colour, width and opacity). */
export function optionsFor(kind: Tool | Ann['kind']): (keyof Options)[] {
  switch (kind) {
    case 'arrow': return ['arrow', 'lineStyle'];
    case 'line': case 'pencil': return ['lineStyle'];
    case 'rect': return ['fill', 'radius', 'lineStyle'];
    case 'ellipse': return ['fill', 'lineStyle'];
    case 'text': return ['fontSize', 'bold', 'italic', 'underline', 'align', 'textBg'];
    case 'number': return ['numberFormat'];
    case 'censor': return ['censor'];
    case 'stamp': return ['emoji'];
    default: return [];
  }
}
/** Tools without a meaningful colour or stroke width. */
export const NO_COLOR = new Set<Tool | Ann['kind']>(['select', 'sampler', 'stamp']);
export const NO_WIDTH = new Set<Tool | Ann['kind']>(['select', 'sampler', 'stamp', 'text', 'censor', 'highlight']);
