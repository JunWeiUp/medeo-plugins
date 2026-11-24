// Pre-recording 3-2-1 countdown overlay with Esc/click cancellation.
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import type { CountdownState, FromCountdown, ToCountdown } from '../protocol.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export async function startCountdown() {
  const t = await i18n.catalog().catch(() => ({} as Record<string, string>));
  const tr = (k: string) => t[k] ?? k;
  $('countdown-cancel').textContent = tr('rec.countdown.cancel');
  const post = (m: FromCountdown) => channel.post(m);
  const cancel = () => void post({ type: 'countdown-cancel' });
  $('countdown-cancel').addEventListener('click', cancel);
  addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  channel.onMessage<ToCountdown>(m => {
    if (m?.type === 'countdown-state') {
      const s: CountdownState = m.state;
      $('countdown-num').textContent = String(Math.max(1, s.secondsLeft));
      $('countdown-meta').textContent = `${s.fps}Hz`;
    }
  });
  await post({ type: 'countdown-ready' });
}
