// Typed bridge for 120Hz multi-track capture and recording HUD/overlay window primitives.
// Calls through the existing SDK `capabilities.invoke` / `medeoPlugin.invoke` so this plugin
// builds cleanly both with published SDK 0.11.x and SDK 0.12+.
import { appWindows, capabilities } from '@one2x/medeo-plugin-sdk';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtendedWindowOpenOptions {
  id: string;
  entry: string;
  title: string;
  width: number;
  height: number;
  panel?: boolean;
  overlay?: boolean;
  display_id?: number;
  bounds?: WindowBounds;
  click_through?: boolean;
  hide_on_blur?: boolean;
  focusable?: boolean;
  exclude_from_capture?: boolean;
  movable?: boolean;
  resizable?: boolean;
  transparent?: boolean;
  opacity?: number;
}

export interface CaptureSourceV2 {
  id: string;
  title: string;
  width: number;
  height: number;
  display_id?: number;
  refresh_rate?: number;
  scale?: number;
}

export interface CaptureDisplayDevice {
  id: string;
  native_id: string;
  title: string;
  refresh_rate: number;
  scale: number;
  width: number;
  height: number;
  bounds: WindowBounds;
}

export interface CaptureMediaDevice {
  id: string;
  name: string;
  default: boolean;
}

export interface CaptureDevicesResult {
  status: string;
  error?: string;
  os: Record<string, string>;
  displays: CaptureDisplayDevice[];
  microphones: CaptureMediaDevice[];
  cameras: CaptureMediaDevice[];
}

export type CaptureTrack =
  | 'screen'
  | 'capture.mp4'
  | 'camera'
  | 'camera.mp4'
  | 'mic'
  | 'mic.m4a'
  | 'system'
  | 'system.m4a'
  | 'telemetry'
  | 'telemetry.jsonl';

export interface CaptureStartArgsV2 {
  source: string;
  rect?: WindowBounds;
  fps?: 30 | 60 | 120;
  codec?: 'auto' | 'h264' | 'hevc';
  quality?: 'low' | 'medium' | 'high' | 'lossless';
  shows_cursor?: boolean;
  exclude_plugin_windows?: boolean;
  microphone?: boolean | { enabled: boolean; device_id?: string | null; mono?: boolean };
  system_audio?: boolean | { enabled: boolean; exclude_self?: boolean };
  camera?: boolean | {
    enabled: boolean;
    device_id?: string | null;
    mirror?: boolean;
    shape?: 'circle' | 'rounded' | 'rect';
    position?: 'tl' | 'tr' | 'bl' | 'br';
    preview?: boolean;
  };
  separate_audio?: boolean;
  telemetry?: {
    cursor?: boolean;
    keystrokes?: { enabled: boolean; shortcuts_only?: boolean };
  };
}

export interface CaptureRecordV2 {
  id: string;
  source_title: string;
  status: string;
  active: boolean;
  can_stop: boolean;
  can_recover: boolean;
  error?: string | null;
  playable: boolean;
  duration_ms: number;
  bytes: number;
  microphone: boolean;
  system_audio: boolean;
  audio_tracks?: number;
  video_tracks?: number;
  width?: number;
  height?: number;
  paused?: boolean;
  target_fps?: number;
  actual_fps?: number;
  dropped_frames?: number;
  codec?: string;
  mic_level?: number;
  sys_level?: number;
  telemetry_events?: number;
  tracks?: Record<string, boolean>;
  camera_fallback?: boolean;
}

export interface ReadTrackResult {
  id: string;
  track: string;
  content: string;
  bytes: number;
  truncated: boolean;
}

export interface StudioExportResult {
  ok: boolean;
  format: 'mp4' | 'gif' | 'issue_bundle';
  path: string;
  name: string;
  bytes: number;
  duration_ms: number;
  width: number;
  height: number;
  codec?: string;
}

const TRACK_FILE: Record<CaptureTrack, string> = {
  screen: 'capture.mp4',
  'capture.mp4': 'capture.mp4',
  camera: 'camera.mp4',
  'camera.mp4': 'camera.mp4',
  mic: 'mic.m4a',
  'mic.m4a': 'mic.m4a',
  system: 'system.m4a',
  'system.m4a': 'system.m4a',
  telemetry: 'telemetry.jsonl',
  'telemetry.jsonl': 'telemetry.jsonl',
};

export const windowsV2 = {
  open: (options: ExtendedWindowOpenOptions) =>
    globalThis.medeoPlugin.invoke('windows.open', { ...options }),
  close: (id: string) => appWindows.close(id),
  focus: (id: string) => appWindows.focus(id),
  hide: (id: string) => appWindows.hide(id),
  list: () => appWindows.list(),
  setBounds: (id: string, bounds: WindowBounds) =>
    capabilities.invoke('windows.setBounds', { id, bounds }),
  setOpacity: (id: string, opacity: number) =>
    capabilities.invoke('windows.setOpacity', { id, opacity }),
};

export const captureV2 = {
  status: (refresh = true) =>
    capabilities.invoke<{ status: string; os: Record<string, string> }>('capture.status', { refresh }),
  devices: (refresh = false) =>
    capabilities.invoke<CaptureDevicesResult>('capture.devices', { refresh }),
  sources: (refresh = false, requestPermission = false) =>
    capabilities.invoke<{ status: string; error?: string; os: Record<string, string>; sources: CaptureSourceV2[] }>(
      'capture.sources',
      { refresh, request_permission: requestPermission },
    ),
  start: (args: CaptureStartArgsV2) =>
    capabilities.invoke<{ id?: string; cancelled?: boolean }>('capture.start', args as unknown as Record<string, unknown>),
  state: () =>
    capabilities.invoke<{ records: CaptureRecordV2[]; os: Record<string, string> }>('capture.state', {}),
  pause: (id: string) => capabilities.invoke('capture.pause', { id }),
  resume: (id: string) => capabilities.invoke('capture.resume', { id }),
  setAudio: (id: string, options: { microphoneMuted?: boolean; systemAudioMuted?: boolean }) =>
    capabilities.invoke('capture.setAudio', {
      id,
      microphone_muted: options.microphoneMuted,
      system_audio_muted: options.systemAudioMuted,
    }),
  stop: (id: string) => capabilities.invoke('capture.stop', { id }),
  cancel: (id: string) => capabilities.invoke('capture.cancel', { id }),
  recover: (id: string) => capabilities.invoke('capture.recover', { id }),
  open: (id: string, mode: 'play' | 'reveal' = 'play') => capabilities.invoke('capture.open', { id, mode }),
  mediaUrl: (id: string, track: CaptureTrack = 'screen') =>
    capabilities.invoke<{ url: string; track: string }>('capture.mediaUrl', { id, track }),
  readTrack: (id: string, track: 'telemetry' | 'telemetry.jsonl' = 'telemetry.jsonl') =>
    capabilities.invoke<ReadTrackResult>('capture.readTrack', { id, track }),
  exportCapture: (args: {
    id: string;
    format: 'mp4' | 'gif' | 'issue_bundle';
    destination_dir?: string;
    file_name?: string;
    recipe?: Record<string, unknown>;
    issue_meta?: Record<string, unknown>;
  }) => capabilities.invoke<StudioExportResult>('capture.export', args as unknown as Record<string, unknown>),
  trackURL: (id: string, track: CaptureTrack = 'screen') =>
    `${location.origin}/_capture/${encodeURIComponent(id)}/${TRACK_FILE[track]}`,
};
