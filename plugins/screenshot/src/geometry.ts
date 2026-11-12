// Selection geometry as plain data (display points, top-left origin): dragging out a rectangle,
// the eight resize handles, moving inside the display and placing the toolbar. No DOM, no SDK.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The rectangle between two points, kept inside `bounds`; `square` makes the shorter side follow the longer. */
export function fromPoints(a: Point, b: Point, bounds: Rect, square = false): Rect {
  let bx = clamp(b.x, bounds.x, bounds.x + bounds.w), by = clamp(b.y, bounds.y, bounds.y + bounds.h);
  if (square) {
    const dx = bx - a.x, dy = by - a.y;
    // The side is limited by how far the display reaches in both drag directions.
    const room = Math.min(dx < 0 ? a.x - bounds.x : bounds.x + bounds.w - a.x, dy < 0 ? a.y - bounds.y : bounds.y + bounds.h - a.y);
    const side = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), room);
    bx = a.x + Math.sign(dx || 1) * side; by = a.y + Math.sign(dy || 1) * side;
  }
  return { x: Math.min(a.x, bx), y: Math.min(a.y, by), w: Math.abs(bx - a.x), h: Math.abs(by - a.y) };
}

/** Rounds to whole points so the exported crop lands on pixel boundaries. */
export const round = (r: Rect): Rect => {
  const x = Math.round(r.x), y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
};

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

export const contains = (r: Rect, p: Point, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

export function handlePoint(r: Rect, h: Handle): Point {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.x + r.w, B = r.y + r.h;
  return { nw: { x: r.x, y: r.y }, n: { x: cx, y: r.y }, ne: { x: R, y: r.y }, e: { x: R, y: cy }, se: { x: R, y: B }, s: { x: cx, y: B }, sw: { x: r.x, y: B }, w: { x: r.x, y: cy } }[h];
}

/** The handle under `p` (within `radius`), corners before edges. */
export function hitHandle(r: Rect, p: Point, radius = 6): Handle | null {
  for (const h of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as Handle[]) {
    const q = handlePoint(r, h);
    if (Math.abs(q.x - p.x) <= radius && Math.abs(q.y - p.y) <= radius) return h;
  }
  return null;
}

/** Drags `h` of the rectangle as it was at the start of the drag to `p`; flips past the opposite side. */
export function resize(start: Rect, h: Handle, p: Point, bounds: Rect): Rect {
  let x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h;
  const px = clamp(p.x, bounds.x, bounds.x + bounds.w), py = clamp(p.y, bounds.y, bounds.y + bounds.h);
  if (h.includes('w')) x1 = px; if (h.includes('e')) x2 = px;
  if (h.includes('n')) y1 = py; if (h.includes('s')) y2 = py;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Moves without changing the size, stopping at the display edges. */
export function move(start: Rect, dx: number, dy: number, bounds: Rect): Rect {
  return { ...start, x: clamp(start.x + dx, bounds.x, bounds.x + bounds.w - start.w), y: clamp(start.y + dy, bounds.y, bounds.y + bounds.h - start.h) };
}

export const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

/** The frontmost window under the pointer (windows arrive front to back), else the whole display. */
export function windowAt(windows: Rect[], p: Point, display: Rect): Rect {
  return windows.find(w => contains(w, p)) ?? display;
}

/** Below the selection, else above it, else inside its bottom edge; always inside the display. */
export function placeToolbar(sel: Rect, size: { w: number; h: number }, view: Rect, gap = 8): Point & { above: boolean } {
  const x = clamp(sel.x + sel.w - size.w, view.x + 4, view.x + view.w - size.w - 4);
  if (sel.y + sel.h + gap + size.h <= view.y + view.h - 4) return { x, y: sel.y + sel.h + gap, above: false };
  if (sel.y - gap - size.h >= view.y + 4) return { x, y: sel.y - gap - size.h, above: true };
  return { x, y: Math.max(view.y + 4, sel.y + sel.h - gap - size.h), above: false };
}
