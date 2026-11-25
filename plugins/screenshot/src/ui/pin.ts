// Floating always-on-top Pin-to-Screen screenshot window.
// Scroll wheel adjusts opacity via `windows.setOpacity`; double-click or Esc closes.
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import { windowsV2 } from '../platform.ts';
import type { FromPin, PinPayload, ToPin } from '../protocol.ts';
import { svgIcon } from './icons.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export async function startPin() {
  const t = await i18n.catalog().catch(() => ({} as Record<string, string>));
  const tr = (k: string) => t[k] ?? k;
  const params = new URLSearchParams(location.search);
  let pinId = params.get('id') || 'pin-1';
  let opacity = 1.0;

  const copyBtn = $('pin-copy');
  copyBtn.replaceChildren(svgIcon('copy', 12), document.createTextNode(tr('action.copy').replace(/\s*\(.*\)$/, '')));
  const saveBtn = $('pin-save');
  saveBtn.replaceChildren(svgIcon('save', 12), document.createTextNode(tr('action.save').replace(/\s*\(.*\)$/, '')));
  const closeBtn = $('pin-close');
  closeBtn.replaceChildren(svgIcon('close', 12));
  closeBtn.title = tr('action.close');
  closeBtn.setAttribute('aria-label', tr('action.close'));

  const post = (m: FromPin) => channel.post(m);
  $('pin-copy').addEventListener('click', () => void post({ type: 'pin-copy', id: pinId }));
  $('pin-save').addEventListener('click', () => void post({ type: 'pin-save', id: pinId }));
  $('pin-close').addEventListener('click', () => void post({ type: 'pin-close', id: pinId }));
  $('pin-img').addEventListener('dblclick', () => void post({ type: 'pin-close', id: pinId }));
  addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void post({ type: 'pin-close', id: pinId });
    }
  });
  addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    opacity = Math.min(1, Math.max(0.2, Math.round((opacity + delta) * 100) / 100));
    $('pin-opacity').textContent = `${Math.round(opacity * 100)}%`;
    void windowsV2.setOpacity(pinId, opacity).catch(() => {});
  }, { passive: false });

  channel.onMessage<ToPin>(m => {
    if (m?.type === 'pin-data' && m.pin.id === pinId) {
      const p: PinPayload = m.pin;
      pinId = p.id;
      ($('pin-img') as HTMLImageElement).src = p.dataUrl;
    }
  });
  await post({ type: 'pin-ready', id: pinId });
}
