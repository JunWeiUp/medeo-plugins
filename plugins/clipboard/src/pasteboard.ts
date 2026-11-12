// Runs resources/pasteboard.js under osascript: one long-lived `watch` process that
// reports every copy, and a short `write` process per entry put back.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Body, Copy } from './store.ts';

const OSASCRIPT = '/usr/bin/osascript';

export class Pasteboard {
  private child: ChildProcess | null = null;
  private stopped = false;
  private backoff = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly helper: string;
  private readonly incoming: string;
  private readonly onCopy: (copy: Copy) => void;
  private readonly onState: (ready: boolean, error: string | null) => void;

  constructor(helper: string, incoming: string, onCopy: (copy: Copy) => void, onState: (ready: boolean, error: string | null) => void) {
    this.helper = helper; this.incoming = incoming; this.onCopy = onCopy; this.onState = onState;
  }

  start(): void {
    if (this.child || this.stopped) return;
    const child = spawn(OSASCRIPT, ['-l', 'JavaScript', this.helper, 'watch', this.incoming], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    createInterface({ input: child.stdout! }).on('line', line => {
      let copy: Copy;
      try { copy = JSON.parse(line); } catch { return; }
      if (copy.ready !== undefined) { this.backoff = 1000; this.onState(true, null); return; }
      this.onCopy(copy);
    });
    child.on('error', error => console.error('pasteboard helper failed to start:', error));
    child.on('close', code => {
      this.child = null;
      if (this.stopped) return;
      console.error(`pasteboard helper exited (${code}): ${stderr.trim()}`);
      this.onState(false, stderr.trim().split('\n').pop() || `exit ${code}`);
      this.timer = setTimeout(() => { this.timer = null; this.start(); }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.child?.kill();
    this.child = null;
  }

  /** Runs a one-shot helper mode and parses its JSON line. */
  private once(args: string[]): Promise<Record<string, unknown> | null> {
    return new Promise(resolve => execFile(OSASCRIPT, ['-l', 'JavaScript', this.helper, ...args], { timeout: 15_000 },
      (error, stdout) => { try { resolve(error ? null : JSON.parse(String(stdout))); } catch { resolve(null); } }));
  }
  /** ⌘V into whatever app is frontmost. */
  paste = async () => (await this.once(['paste']))?.ok === true;
  /** Whether Medeo may post key events; `prompt` shows macOS's own request once. */
  trusted = async (prompt = false) => (await this.once(['trusted', ...(prompt ? ['prompt'] : [])]))?.trusted === true;

  /** System Settings › Privacy & Security › Accessibility. */
  openAccessibilitySettings = () => new Promise<void>(resolve =>
    execFile('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], () => resolve()));

  async write(body: Body): Promise<boolean> {
    const request = path.join(this.incoming, `write-${randomUUID()}.json`);
    await writeFile(request, JSON.stringify(body));
    try { return (await this.once(['write', request]))?.ok === true; }
    finally { await rm(request, { force: true }); }
  }
}
