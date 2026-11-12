// How the recorder shows a capture record. Pure presentation.
export interface RecordFacts { status: string; duration_ms?: number; bytes?: number }
const KEYS: Record<string, string> = {
  starting: 'recording_loading', recording: 'recording_recording', stopping: 'recording_stopping',
  recovering: 'recording_recover', recovered: 'completed', completed: 'completed', cancelled: 'cancelled', interrupted: 'interrupted',
};
export function describe(record: RecordFacts) {
  const seconds = Math.floor((record.duration_ms ?? 0) / 1000);
  return {
    key: KEYS[record.status] ?? 'failed',
    duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    size: `${((record.bytes ?? 0) / (1024 * 1024)).toFixed(1)} MB`,
  };
}
