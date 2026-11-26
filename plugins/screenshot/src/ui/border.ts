// Click-through, capture-excluded recording region border overlay.
import { channel } from '@one2x/medeo-plugin-sdk';
import type { BorderState, FromBorder, ToBorder } from '../protocol.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function render(s: BorderState) {
  const box = $('border');
  const tag = $('border-tag');
  box.dataset.status = s.status;
  tag.textContent = `${s.label} · ${s.width}×${s.height} · ${s.fps}Hz`;
}

export async function startBorder() {
  channel.onMessage<ToBorder>(m => {
    if (m?.type === 'border-state') render(m.state);
  });
  const msg: FromBorder = { type: 'border-ready' };
  await channel.post(msg);
}
