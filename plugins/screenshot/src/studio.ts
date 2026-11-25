// Pure non-destructive Studio timeline, telemetry parser, Auto-Zoom generator, and export recipe builder.
import type { CameraCorner, CameraShape, ClickSize, KeystrokePosition, RecordingCodec, RecordingConfig, RecordingFps } from './recording.ts';

export type StudioAspect = 'auto' | '16:9' | '9:16' | '1:1';
export type StudioBgType = 'gradient' | 'solid' | 'none';
export type StudioTab = 'bg' | 'cursor' | 'zoom' | 'keys' | 'cam' | 'info';

export interface StudioBgPreset {
  id: string;
  labelKey: string;
  type: StudioBgType;
  colors: [string, string];
}

export const STUDIO_BACKGROUNDS: StudioBgPreset[] = [
  { id: 'violet', labelKey: 'studio.bg.violet', type: 'gradient', colors: ['#1E1B4B', '#6D28D9'] },
  { id: 'sunset', labelKey: 'studio.bg.sunset', type: 'gradient', colors: ['#BE185D', '#F97316'] },
  { id: 'ocean', labelKey: 'studio.bg.ocean', type: 'gradient', colors: ['#0F172A', '#0284C7'] },
  { id: 'emerald', labelKey: 'studio.bg.emerald', type: 'gradient', colors: ['#064E3B', '#10B981'] },
  { id: 'graphite', labelKey: 'studio.bg.graphite', type: 'gradient', colors: ['#18181B', '#3F3F46'] },
  { id: 'aurora', labelKey: 'studio.bg.aurora', type: 'gradient', colors: ['#1E3A8A', '#0D9488'] },
  { id: 'carbon', labelKey: 'studio.bg.carbon', type: 'solid', colors: ['#09090B', '#09090B'] },
  { id: 'none', labelKey: 'studio.bg.none', type: 'none', colors: ['#000000', '#000000'] },
];

export interface StudioCut {
  id: string;
  start: number;
  end: number;
}

export interface StudioSpeed {
  id: string;
  start: number;
  end: number;
  rate: 0.5 | 1.5 | 2;
}

export interface StudioFreeze {
  id: string;
  at: number;
  duration: number;
}

export interface StudioZoom {
  id: string;
  start: number;
  end: number;
  scale: number;
  x: number;
  y: number;
}

export interface StudioProject {
  trimStart: number;
  trimEnd: number;
  cuts: StudioCut[];
  speeds: StudioSpeed[];
  freezes: StudioFreeze[];
  zooms: StudioZoom[];
  background: {
    presetId: string;
    type: StudioBgType;
    colors: [string, string];
    padding: number;
    radius: number;
    shadow: boolean;
    aspect: StudioAspect;
  };
  camera: {
    enabled: boolean;
    shape: CameraShape;
    position: CameraCorner;
    size: number;
    mirror: boolean;
  };
  audio: {
    micVolume: number;
    systemVolume: number;
  };
  cursor: {
    clicks: boolean;
    clickColor: string;
    clickSize: ClickSize;
    keystrokes: boolean;
    keyPosition: KeystrokePosition;
  };
  exportFps: RecordingFps;
  exportCodec: RecordingCodec;
}

export interface ParsedTelemetryEvent {
  t: number;
  kind: 'click' | 'key' | 'move';
  x?: number;
  y?: number;
  btn?: string;
  label?: string;
}

export function createDefaultStudioProject(durationSec: number, cfg: RecordingConfig, hasCamera: boolean): StudioProject {
  const safeDur = Math.max(0.1, durationSec);
  return {
    trimStart: 0,
    trimEnd: safeDur,
    cuts: [],
    speeds: [],
    freezes: [],
    zooms: [],
    background: {
      presetId: 'violet',
      type: 'gradient',
      colors: ['#1E1B4B', '#6D28D9'],
      padding: 48,
      radius: 16,
      shadow: true,
      aspect: 'auto',
    },
    camera: {
      enabled: hasCamera,
      shape: cfg.camera.shape,
      position: cfg.camera.position,
      size: 0.2,
      mirror: cfg.camera.mirror,
    },
    audio: {
      micVolume: 1.0,
      systemVolume: 0.85,
    },
    cursor: {
      clicks: cfg.clicks.enabled,
      clickColor: cfg.clicks.color,
      clickSize: cfg.clicks.size,
      keystrokes: cfg.keystrokes.enabled,
      keyPosition: cfg.keystrokes.position,
    },
    exportFps: cfg.fps,
    exportCodec: cfg.codec,
  };
}

/** Parses `telemetry.jsonl` from both Swift (`type`) and legacy (`kind`) schemas cleanly. */
export function parseTelemetryJsonl(text: string): ParsedTelemetryEvent[] {
  const out: ParsedTelemetryEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const t = typeof raw.t === 'number' ? raw.t : NaN;
      if (!Number.isFinite(t)) continue;
      const kind = String(raw.type ?? raw.kind ?? '');
      if (kind === 'click') {
        // Only highlight button-down events (ignore release).
        if (raw.down === false) continue;
        if (typeof raw.x === 'number' && typeof raw.y === 'number') {
          out.push({ t, kind: 'click', x: raw.x, y: raw.y, btn: typeof raw.button === 'string' ? raw.button : 'left' });
        }
      } else if (kind === 'key') {
        const direct = typeof raw.label === 'string' ? raw.label : '';
        const mods = Array.isArray(raw.modifiers) ? raw.modifiers.join('') : '';
        const kc = typeof raw.key_code === 'number' ? `#${raw.key_code}` : '';
        const label = direct || `${mods}${kc}`;
        if (label) out.push({ t, kind: 'key', label });
      } else if (kind === 'move' && typeof raw.x === 'number' && typeof raw.y === 'number') {
        out.push({ t, kind: 'move', x: raw.x, y: raw.y });
      }
    } catch {}
  }
  return out;
}

/** Groups click bursts into smooth, non-overlapping Auto-Zoom keyframes. */
export function autoGenerateZooms(events: ParsedTelemetryEvent[], durationSec: number): StudioZoom[] {
  const clicks = events.filter(e => e.kind === 'click' && e.x !== undefined && e.y !== undefined);
  if (!clicks.length || durationSec < 0.8) return [];
  const zooms: StudioZoom[] = [];
  let i = 0;
  while (i < clicks.length) {
    const first = clicks[i];
    let sumX = first.x!, sumY = first.y!, count = 1;
    let lastT = first.t;
    while (i + 1 < clicks.length && clicks[i + 1].t - lastT <= 1.2) {
      i++;
      sumX += clicks[i].x!;
      sumY += clicks[i].y!;
      count++;
      lastT = clicks[i].t;
    }
    const start = Math.max(0, first.t - 0.35);
    const end = Math.min(durationSec, Math.max(first.t + 1.4, lastT + 0.9));
    if (end - start >= 0.6) {
      const prev = zooms[zooms.length - 1];
      if (prev && start < prev.end + 0.25) {
        prev.end = end;
        prev.x = clamp01((prev.x + sumX / count) / 2);
        prev.y = clamp01((prev.y + sumY / count) / 2);
      } else {
        zooms.push({
          id: `zoom-${zooms.length + 1}`,
          start: round2(start),
          end: round2(end),
          scale: 1.6,
          x: clamp01(round3(sumX / count)),
          y: clamp01(round3(sumY / count)),
        });
      }
    }
    i++;
  }
  return zooms.slice(0, 12);
}

/** Evaluates smooth cubic ease-in-out zoom scale & focus at timestamp `t`. */
export function evaluateZoom(t: number, zooms: StudioZoom[]): { scale: number; x: number; y: number } {
  const ease = (u: number) => {
    const c = Math.max(0, Math.min(1, u));
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
  };
  for (const z of zooms) {
    if (z.end <= z.start + 0.1 || z.scale <= 1.01) continue;
    if (t >= z.start && t <= z.end) {
      const ramp = Math.min(0.32, (z.end - z.start) * 0.35);
      let k = 1;
      if (t < z.start + ramp) k = ease((t - z.start) / Math.max(0.05, ramp));
      else if (t > z.end - ramp) k = ease((z.end - t) / Math.max(0.05, ramp));
      return { scale: 1 + (Math.min(3, z.scale) - 1) * k, x: clamp01(z.x), y: clamp01(z.y) };
    }
  }
  return { scale: 1, x: 0.5, y: 0.5 };
}

/** Converts StudioProject into the native Swift `capture.export` recipe payload. */
export function buildExportRecipe(project: StudioProject, format: 'mp4' | 'gif' | 'issue_bundle'): Record<string, unknown> {
  return {
    fps: format === 'gif' ? 18 : project.exportFps,
    codec: project.exportCodec,
    trim: { start: round2(project.trimStart), end: round2(project.trimEnd) },
    cuts: project.cuts.map(c => ({ start: round2(c.start), end: round2(c.end) })),
    speeds: project.speeds.map(s => ({ start: round2(s.start), end: round2(s.end), rate: s.rate })),
    freezes: project.freezes.map(f => ({ at: round2(f.at), duration: round2(f.duration) })),
    zooms: project.zooms.map(z => ({ start: round2(z.start), end: round2(z.end), scale: round2(z.scale), x: round3(z.x), y: round3(z.y) })),
    background: {
      type: project.background.type,
      colors: project.background.colors,
      padding: project.background.padding,
      radius: project.background.radius,
      shadow: project.background.shadow,
      aspect: project.background.aspect,
    },
    camera: {
      enabled: project.camera.enabled,
      shape: project.camera.shape,
      position: project.camera.position,
      size: round2(project.camera.size),
      mirror: project.camera.mirror,
    },
    audio: {
      micVolume: round2(project.audio.micVolume),
      systemVolume: round2(project.audio.systemVolume),
    },
    cursor: {
      clicks: project.cursor.clicks,
      clickColor: project.cursor.clickColor,
      clickSize: project.cursor.clickSize,
      keystrokes: project.cursor.keystrokes,
      keyPosition: project.cursor.keyPosition,
    },
  };
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function round2(v: number) { return Math.round(v * 100) / 100; }
function round3(v: number) { return Math.round(v * 1000) / 1000; }
