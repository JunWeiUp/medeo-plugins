// Pure non-destructive Studio timeline, telemetry parser, Auto-Zoom generator,
// overlay/caption/export-spec models, and native Swift export recipe builder.
import type { CameraCorner, CameraShape, ClickSize, KeystrokePosition, RecordingCodec, RecordingConfig, RecordingFps } from './recording.ts';

export type StudioAspect = 'auto' | '16:10' | '16:9' | '9:16' | '1:1';
export type StudioBgType = 'gradient' | 'solid' | 'none';
export type StudioTab = 'bg' | 'cursor' | 'zoom' | 'keys' | 'cam' | 'cap' | 'info';
export type StudioExportPresetId = 'hevc120' | 'h264_60' | 'issue120' | 'gif20';

export interface StudioBgPreset {
  id: string;
  labelKey: string;
  type: StudioBgType;
  colors: [string, string];
}

export const STUDIO_BACKGROUNDS: StudioBgPreset[] = [
  { id: 'violet', labelKey: 'studio.bg.violet', type: 'gradient', colors: ['#4F46E5', '#EC4899'] },
  { id: 'ocean', labelKey: 'studio.bg.ocean', type: 'gradient', colors: ['#0F766E', '#2563EB'] },
  { id: 'sunset', labelKey: 'studio.bg.sunset', type: 'gradient', colors: ['#EA580C', '#7C3AED'] },
  { id: 'graphite', labelKey: 'studio.bg.graphite', type: 'gradient', colors: ['#1F2937', '#111827'] },
  { id: 'aurora', labelKey: 'studio.bg.aurora', type: 'gradient', colors: ['#1E3A8A', '#0D9488'] },
  { id: 'emerald', labelKey: 'studio.bg.emerald', type: 'gradient', colors: ['#064E3B', '#10B981'] },
  { id: 'indigo', labelKey: 'studio.bg.indigo', type: 'gradient', colors: ['#1E1B4B', '#6D28D9'] },
  { id: 'rose', labelKey: 'studio.bg.rose', type: 'gradient', colors: ['#881337', '#F43F5E'] },
  { id: 'amber', labelKey: 'studio.bg.amber', type: 'gradient', colors: ['#78350F', '#F59E0B'] },
  { id: 'slate', labelKey: 'studio.bg.slate', type: 'solid', colors: ['#18181B', '#18181B'] },
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

export interface StudioOverlay {
  id: string;
  kind: 'text' | 'censor';
  start: number;
  end: number;
  /** Normalized 0..1 coordinates inside the video frame. For text, (x,y) is center; for censor, top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  pixelSize?: number;
}

export interface StudioCaption {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface StudioProject {
  trimStart: number;
  trimEnd: number;
  cuts: StudioCut[];
  speeds: StudioSpeed[];
  freezes: StudioFreeze[];
  zooms: StudioZoom[];
  overlays: StudioOverlay[];
  captions: StudioCaption[];
  showCaptions: boolean;
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
    avoidZoom: boolean;
  };
  audio: {
    micVolume: number;
    systemVolume: number;
    denoise: boolean;
    mergeTracks: boolean;
  };
  cursor: {
    clicks: boolean;
    clickColor: string;
    rightClickColor: string;
    clickSize: ClickSize;
    smooth: number;
    clickSound: boolean;
    keystrokes: boolean;
    shortcutsOnly: boolean;
    excludedKeyTimes: number[];
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
  isShortcut?: boolean;
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
    overlays: [],
    captions: [],
    showCaptions: true,
    background: {
      presetId: 'violet',
      type: 'gradient',
      colors: ['#4F46E5', '#EC4899'],
      padding: 44,
      radius: 14,
      shadow: true,
      aspect: 'auto',
    },
    camera: {
      enabled: hasCamera,
      shape: cfg.camera.shape,
      position: cfg.camera.position,
      size: 0.19,
      mirror: cfg.camera.mirror,
      avoidZoom: true,
    },
    audio: {
      micVolume: 1.0,
      systemVolume: 0.85,
      denoise: true,
      mergeTracks: true,
    },
    cursor: {
      clicks: cfg.clicks.enabled,
      clickColor: cfg.clicks.color || '#8B7DFF',
      rightClickColor: '#FFB833',
      clickSize: cfg.clicks.size,
      smooth: 75,
      clickSound: cfg.clicks.sound,
      keystrokes: cfg.keystrokes.enabled,
      shortcutsOnly: cfg.keystrokes.shortcutsOnly,
      excludedKeyTimes: [],
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
        if (raw.down === false) continue;
        if (typeof raw.x === 'number' && typeof raw.y === 'number') {
          out.push({ t, kind: 'click', x: raw.x, y: raw.y, btn: typeof raw.button === 'string' ? raw.button : 'left' });
        }
      } else if (kind === 'key') {
        const direct = typeof raw.label === 'string' ? raw.label : '';
        const modsArr = Array.isArray(raw.modifiers) ? raw.modifiers.map(String) : [];
        const mods = modsArr.join('');
        const kc = typeof raw.key_code === 'number' ? `#${raw.key_code}` : '';
        const label = direct || `${mods}${kc}`;
        const isShortcut = modsArr.some(m => m === '⌘' || m === '⌃' || m === '⌥') || /[⌘⌃⌥]/.test(label);
        if (label) out.push({ t, kind: 'key', label, isShortcut });
      } else if (kind === 'move' && typeof raw.x === 'number' && typeof raw.y === 'number') {
        out.push({ t, kind: 'move', x: raw.x, y: raw.y });
      }
    } catch {}
  }
  return out;
}

/** Filters keystrokes according to Studio's non-destructive filter & per-key deletion list. */
export function activeKeystrokes(events: ParsedTelemetryEvent[], project: StudioProject): ParsedTelemetryEvent[] {
  const excluded = project.cursor.excludedKeyTimes;
  return events.filter(ev => {
    if (ev.kind !== 'key' || !ev.label) return false;
    if (project.cursor.shortcutsOnly && !ev.isShortcut) return false;
    if (excluded.some(t => Math.abs(t - ev.t) < 0.002)) return false;
    return true;
  });
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

/** Computes exact output duration after Trim, Cuts, Speeds, and Freezes. */
export function computeOutputDuration(project: StudioProject): number {
  const lo = Math.max(0, project.trimStart);
  const hi = Math.max(lo + 0.05, project.trimEnd);
  const sortedCuts = project.cuts
    .map(c => ({ start: Math.max(lo, c.start), end: Math.min(hi, c.end) }))
    .filter(c => c.end > c.start + 0.04)
    .sort((a, b) => a.start - b.start);

  const kept: { start: number; end: number }[] = [];
  let cursor = lo;
  for (const c of sortedCuts) {
    if (c.start > cursor + 0.02) kept.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (hi > cursor + 0.02) kept.push({ start: cursor, end: hi });
  if (!kept.length) kept.push({ start: lo, end: hi });

  let total = 0;
  for (const range of kept) {
    const splits = new Set<number>([range.start, range.end]);
    for (const sp of project.speeds) {
      if (sp.start > range.start && sp.start < range.end) splits.add(sp.start);
      if (sp.end > range.start && sp.end < range.end) splits.add(sp.end);
    }
    const pts = [...splits].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mid = (a + b) * 0.5;
      const rate = project.speeds.find(sp => mid >= sp.start && mid <= sp.end)?.rate ?? 1;
      total += (b - a) / Math.max(0.25, rate);
    }
    for (const fr of project.freezes) {
      if (fr.at >= range.start && fr.at <= range.end) total += Math.min(5, Math.max(0, fr.duration));
    }
  }
  return Math.max(0.1, round2(total));
}

export interface ExportSpecPreview {
  format: 'mp4' | 'gif' | 'issue_bundle';
  fps: RecordingFps | 20;
  codec: RecordingCodec;
  codecLabel: string;
  resolutionLabel: string;
  bitrateLabel: string;
  durationSec: number;
  estimatedBytes: number;
  extraLabel: string;
}

export function estimateExportSpec(
  project: StudioProject,
  srcWidth: number,
  srcHeight: number,
  preset: StudioExportPresetId,
): ExportSpecPreview {
  const dur = computeOutputDuration(project);
  const pad = project.background.type === 'none' ? 0 : project.background.padding;
  let cw = Math.max(320, srcWidth || 1920) + pad * 2;
  let ch = Math.max(180, srcHeight || 1080) + pad * 2;
  if (project.background.aspect === '16:10') { cw = Math.max(cw, ch * 1.6); ch = cw / 1.6; }
  else if (project.background.aspect === '16:9') { cw = Math.max(cw, ch * 16 / 9); ch = cw * 9 / 16; }
  else if (project.background.aspect === '9:16') { ch = Math.max(ch, cw * 16 / 9); cw = ch * 9 / 16; }
  else if (project.background.aspect === '1:1') { const s = Math.max(cw, ch); cw = s; ch = s; }

  const maxEdge = preset === 'gif20' ? 960 : 2560;
  const scale = Math.min(1, maxEdge / Math.max(cw, ch));
  const outW = Math.max(2, Math.floor((cw * scale) / 2) * 2);
  const outH = Math.max(2, Math.floor((ch * scale) / 2) * 2);
  const pxRatio = (outW * outH) / (1920 * 1080);

  if (preset === 'gif20') {
    const estBytes = Math.round(dur * 380_000 * Math.max(0.4, pxRatio));
    return {
      format: 'gif', fps: 20, codec: 'auto',
      codecLabel: 'GIF · 两遍调色板量化',
      resolutionLabel: `${outW} × ${outH} · 20 fps`,
      bitrateLabel: '自动静音 · 循环',
      durationSec: dur, estimatedBytes: estBytes,
      extraLabel: '无（纯动图）',
    };
  }
  if (preset === 'h264_60') {
    const mbps = Math.max(6, round2(12 * Math.max(0.5, pxRatio)));
    return {
      format: 'mp4', fps: 60, codec: 'h264',
      codecLabel: 'MP4 · H.264 High（CABAC）',
      resolutionLabel: `${outW} × ${outH} · 60 fps`,
      bitrateLabel: `≈ ${mbps} Mbps（Fast-Start）`,
      durationSec: dur, estimatedBytes: Math.round((mbps * 1_000_000 / 8) * dur),
      extraLabel: project.audio.mergeTracks ? '单轨混音 AAC 48kHz' : '双轨混音 AAC 48kHz',
    };
  }
  if (preset === 'issue120') {
    const mbps = Math.max(12, round2(24 * Math.max(0.6, pxRatio)));
    return {
      format: 'issue_bundle', fps: 120, codec: 'hevc',
      codecLabel: 'MP4 (HEVC 120fps) + JSONL',
      resolutionLabel: `${outW} × ${outH} · 120 fps`,
      bitrateLabel: `≈ ${mbps} Mbps（VBR）`,
      durationSec: dur, estimatedBytes: Math.round((mbps * 1_000_000 / 8) * dur + 180_000),
      extraLabel: 'telemetry.jsonl + issue.json + Markdown',
    };
  }
  // hevc120 (default master)
  const mbps = Math.max(14, round2(28 * Math.max(0.6, pxRatio)));
  return {
    format: 'mp4', fps: 120, codec: 'hevc',
    codecLabel: 'MP4 · HEVC (hvc1) 硬编',
    resolutionLabel: `${outW} × ${outH} · 120 fps`,
    bitrateLabel: `≈ ${mbps} Mbps（VBR）`,
    durationSec: dur, estimatedBytes: Math.round((mbps * 1_000_000 / 8) * dur),
    extraLabel: project.audio.mergeTracks ? '单轨混音 AAC 48kHz' : '双轨混音 AAC 48kHz',
  };
}

/** Converts StudioProject into the native Swift `capture.export` recipe payload. */
export function buildExportRecipe(project: StudioProject, format: 'mp4' | 'gif' | 'issue_bundle'): Record<string, unknown> {
  return {
    fps: format === 'gif' ? 20 : project.exportFps,
    codec: project.exportCodec,
    trim: { start: round2(project.trimStart), end: round2(project.trimEnd) },
    cuts: project.cuts.map(c => ({ start: round2(c.start), end: round2(c.end) })),
    speeds: project.speeds.map(s => ({ start: round2(s.start), end: round2(s.end), rate: s.rate })),
    freezes: project.freezes.map(f => ({ at: round2(f.at), duration: round2(f.duration) })),
    zooms: project.zooms.map(z => ({ start: round2(z.start), end: round2(z.end), scale: round2(z.scale), x: round3(z.x), y: round3(z.y) })),
    overlays: project.overlays.map(o => ({
      kind: o.kind,
      start: round2(o.start),
      end: round2(o.end),
      x: round3(o.x),
      y: round3(o.y),
      w: round3(o.w),
      h: round3(o.h),
      text: o.text ?? '',
      color: o.color ?? '#6D5EFC',
      pixelSize: o.pixelSize ?? 16,
    })),
    captions: project.captions.map(c => ({ start: round2(c.start), end: round2(c.end), text: c.text })),
    showCaptions: project.showCaptions,
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
      avoidZoom: project.camera.avoidZoom,
    },
    audio: {
      micVolume: round2(project.audio.micVolume),
      systemVolume: round2(project.audio.systemVolume),
      denoise: project.audio.denoise,
      mergeTracks: project.audio.mergeTracks,
    },
    cursor: {
      clicks: project.cursor.clicks,
      clickColor: project.cursor.clickColor,
      rightClickColor: project.cursor.rightClickColor,
      clickSize: project.cursor.clickSize,
      keystrokes: project.cursor.keystrokes,
      shortcutsOnly: project.cursor.shortcutsOnly,
      excludedKeyTimes: project.cursor.excludedKeyTimes.map(round3),
      keyPosition: project.cursor.keyPosition,
    },
  };
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function round2(v: number) { return Math.round(v * 100) / 100; }
function round3(v: number) { return Math.round(v * 1000) / 1000; }
