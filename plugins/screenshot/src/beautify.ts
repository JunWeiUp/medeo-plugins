// Beautify: the capture on a gradient with padding, rounded corners, a soft shadow and an optional
// macOS window frame. Used for the export and for the live preview around the selection.
export interface Beauty { on: boolean; style: number; padding: number; frame: boolean }
export const DEFAULT_BEAUTY: Beauty = { on: false, style: 0, padding: 48, frame: false };
export const GRADIENTS: string[][] = [
  ['#6366F1', '#A855F7', '#EC4899'], ['#0EA5E9', '#6366F1'], ['#F97316', '#F43F5E'], ['#10B981', '#06B6D4'],
  ['#FDE68A', '#F9A8D4', '#C4B5FD'], ['#1E293B', '#334155'], ['#F1F5F9', '#CBD5E1'], ['#FB7185', '#FDBA74', '#FDE047'],
];
export const FRAME_BAR = 28;
export const RADIUS = 10;

export function fillGradient(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: number) {
  const stops = GRADIENTS[style] ?? GRADIENTS[0];
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}

/** Draws the window chrome (title bar with the three lights) at `x,y`, `w` wide, in points. */
export function drawFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.fillStyle = '#ECECEC'; ctx.fillRect(x, y, w, FRAME_BAR);
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x, y + FRAME_BAR - 1, w, 1);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 16 + i * 20, y + FRAME_BAR / 2, 6, 0, Math.PI * 2); ctx.fill(); });
}

/** The beautified image; `src` is the flattened capture at `scale` pixels per point. */
export function beautify(src: HTMLCanvasElement, b: Beauty, scale: number): HTMLCanvasElement {
  const w = src.width / scale, h = src.height / scale, bar = b.frame ? FRAME_BAR : 0, pad = b.padding;
  const out = document.createElement('canvas');
  out.width = Math.round((w + pad * 2) * scale); out.height = Math.round((h + bar + pad * 2) * scale);
  const ctx = out.getContext('2d')!; ctx.scale(scale, scale);
  fillGradient(ctx, 0, 0, w + pad * 2, h + bar + pad * 2, b.style);
  const x = pad, y = pad;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(x, y, w, h + bar, RADIUS); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h + bar, RADIUS); ctx.clip();
  if (bar) drawFrame(ctx, x, y, w);
  ctx.drawImage(src, x, y + bar, w, h);
  ctx.restore();
  return out;
}
