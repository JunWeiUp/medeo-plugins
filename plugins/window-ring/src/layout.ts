// Window layouts as pure geometry: no SDK, no platform. Frames are global points with the
// origin at the top-left of the main display and y growing downwards (the host's convention).

export interface Frame { x: number; y: number; width: number; height: number }
export interface Screen { id: string; frame: Frame; visible_frame: Frame }

/** Every action the ring and the shortcuts can apply. */
export const ACTIONS = [
  'maximize', 'almost-maximize', 'center',
  'left-half', 'right-half', 'top-half', 'bottom-half',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
  'left-third', 'center-third', 'right-third', 'left-two-thirds', 'right-two-thirds',
  'next-display', 'undo',
] as const;
export type Action = typeof ACTIONS[number];
export const isAction = (value: unknown): value is Action => typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);

/** Pressing the same shortcut again steps through its cycle (Loop-style "cycles"). */
export const CYCLES: Partial<Record<Action, Action[]>> = {
  'left-half': ['left-half', 'left-two-thirds', 'left-third'],
  'right-half': ['right-half', 'right-two-thirds', 'right-third'],
  'maximize': ['maximize', 'almost-maximize'],
  'center-third': ['center-third', 'center'],
};

/** Fractions of the usable area: [x, y, width, height]. */
const UNITS: Partial<Record<Action, [number, number, number, number]>> = {
  'maximize': [0, 0, 1, 1],
  'left-half': [0, 0, 1 / 2, 1], 'right-half': [1 / 2, 0, 1 / 2, 1],
  'top-half': [0, 0, 1, 1 / 2], 'bottom-half': [0, 1 / 2, 1, 1 / 2],
  'top-left': [0, 0, 1 / 2, 1 / 2], 'top-right': [1 / 2, 0, 1 / 2, 1 / 2],
  'bottom-left': [0, 1 / 2, 1 / 2, 1 / 2], 'bottom-right': [1 / 2, 1 / 2, 1 / 2, 1 / 2],
  'left-third': [0, 0, 1 / 3, 1], 'center-third': [1 / 3, 0, 1 / 3, 1], 'right-third': [2 / 3, 0, 1 / 3, 1],
  'left-two-thirds': [0, 0, 2 / 3, 1], 'right-two-thirds': [1 / 3, 0, 2 / 3, 1],
};

const round = (f: Frame): Frame => ({ x: Math.round(f.x), y: Math.round(f.y), width: Math.max(1, Math.round(f.width)), height: Math.max(1, Math.round(f.height)) });

/**
 * Where `action` puts a window on `area` (a display's visible frame). `gap` is the space kept
 * between windows and around the edges, so two halves leave exactly `gap` between them.
 * `current` is the window's frame, needed by actions that keep its size. `next-display` and
 * `undo` are not geometry and return null.
 */
export function frameFor(action: Action, area: Frame, current: Frame, gap = 0): Frame | null {
  const g = Math.max(0, Math.min(gap, 64));
  if (action === 'center') {
    const width = Math.min(current.width, area.width - 2 * g), height = Math.min(current.height, area.height - 2 * g);
    return round({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height });
  }
  if (action === 'almost-maximize') {
    const width = area.width * 0.9, height = area.height * 0.9;
    return round({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height });
  }
  const unit = UNITS[action];
  if (!unit) return null;
  const [ux, uy, uw, uh] = unit;
  // Inner edges get half a gap from each side; outer edges a full gap.
  const left = ux === 0 ? g : g / 2, top = uy === 0 ? g : g / 2;
  const right = ux + uw >= 0.999 ? g : g / 2, bottom = uy + uh >= 0.999 ? g : g / 2;
  return round({
    x: area.x + area.width * ux + left,
    y: area.y + area.height * uy + top,
    width: area.width * uw - left - right,
    height: area.height * uh - top - bottom,
  });
}

const overlap = (a: Frame, b: Frame) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const contains = (f: Frame, x: number, y: number) => x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.height;

/** The display a window is mostly on (the main display when it is off every display). */
export function screenOf<S extends Screen>(frame: Frame, screens: S[]): S | undefined {
  let best = screens[0], area = 0;
  for (const s of screens) { const a = overlap(frame, s.frame); if (a > area) { area = a; best = s; } }
  return best;
}
/** The display under a point, else the one the point is closest to. */
export function screenAt<S extends Screen>(x: number, y: number, screens: S[]): S | undefined {
  const hit = screens.find(s => contains(s.frame, x, y));
  if (hit) return hit;
  const distance = (s: S) => Math.hypot(x - (s.frame.x + s.frame.width / 2), y - (s.frame.y + s.frame.height / 2));
  return [...screens].sort((a, b) => distance(a) - distance(b))[0];
}

/** Displays ordered left to right, then top to bottom, so "next" is predictable. */
const ordered = <S extends Screen>(screens: S[]) => [...screens].sort((a, b) => a.frame.x - b.frame.x || a.frame.y - b.frame.y);

/** The display after the one a window is mostly on, left to right, wrapping; none with one display. */
export function nextScreen<S extends Screen>(current: Frame, screens: S[]): S | undefined {
  const list = ordered(screens), from = screenOf(current, list);
  if (!from || list.length < 2) return undefined;
  return list[(list.indexOf(from) + 1) % list.length];
}

/** Moves a window to the next display, keeping its relative position and size. */
export function onNextDisplay(current: Frame, screens: Screen[]): Frame | null {
  const list = ordered(screens), from = screenOf(current, list);
  if (!from || list.length < 2) return null;
  const to = list[(list.indexOf(from) + 1) % list.length], a = from.visible_frame, b = to.visible_frame;
  const width = Math.min(b.width, current.width * b.width / a.width), height = Math.min(b.height, current.height * b.height / a.height);
  const x = b.x + (current.x - a.x) * b.width / a.width, y = b.y + (current.y - a.y) * b.height / a.height;
  return round({ x: Math.min(Math.max(x, b.x), b.x + b.width - width), y: Math.min(Math.max(y, b.y), b.y + b.height - height), width, height });
}

export const close = (a: Frame, b: Frame, tolerance = 12) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
  Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;

/**
 * The action a press of `pressed` should apply. When the window still sits where the previous
 * step of the same cycle put it, the press moves on to the next step; a window the user moved
 * meanwhile starts the cycle again.
 */
export function nextInCycle(pressed: Action, last: { action: Action; frame: Frame } | undefined, current: Frame, cycles = true): Action {
  const cycle = CYCLES[pressed];
  if (!cycles || !cycle || !last || !cycle.includes(last.action) || !close(last.frame, current)) return pressed;
  return cycle[(cycle.indexOf(last.action) + 1) % cycle.length];
}

/**
 * The ring: the pointer's offset from where the ring opened picks one of eight directions.
 * Inside the dead zone it is `maximize`; 0° is to the right and angles grow clockwise because
 * screen y grows downwards.
 */
export const RING: Action[] = ['right-half', 'bottom-right', 'bottom-half', 'bottom-left', 'left-half', 'top-left', 'top-half', 'top-right'];
export function ringAction(dx: number, dy: number, deadZone = 18): Action {
  if (Math.hypot(dx, dy) < deadZone) return 'maximize';
  const degrees = (Math.atan2(dy, dx) * 180 / Math.PI + 360 + 22.5) % 360;
  return RING[Math.floor(degrees / 45)];
}

/** Per-window undo, newest last, bounded. */
export class History {
  private frames = new Map<string, Frame[]>();
  private limit: number;
  private windows: number;
  constructor(limit = 10, windows = 64) { this.limit = limit; this.windows = windows; }
  push(id: string, frame: Frame) {
    const list = this.frames.get(id) ?? [];
    this.frames.delete(id);
    list.push(frame);
    if (list.length > this.limit) list.shift();
    this.frames.set(id, list);
    if (this.frames.size > this.windows) this.frames.delete(this.frames.keys().next().value!);
  }
  pop(id: string): Frame | undefined { return this.frames.get(id)?.pop(); }
}
