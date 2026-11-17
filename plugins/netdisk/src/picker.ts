// The small "Store to Medeo Drive" window (ui/store.html): which folder a file another plugin sent goes to.
// The worker asks (src/receive.ts); this only shows the question and posts the answer back.
import { channel, drive, i18n } from '@medeo-plugin/sdk';
import type { FromPicker, ToPicker } from './receive.ts';
import { code, format, size } from './logic.ts';

const SENDERS: Record<string, string> = { 'app.medeo.screenshot': 'sender_screenshot', 'app.medeo.clipboard': 'sender_clipboard', 'app.medeo.launcher': 'sender_launcher' };

export async function mountPicker() {
  const T = await i18n.catalog().catch(() => ({} as Record<string, string>));
  const t = (key: string, params?: Record<string, string | number>) => format(T[key] ?? key, params);
  const app = document.getElementById('app')!;
  const post = (message: FromPicker) => channel.post(message);
  let request: ToPicker | null = null, chosen = '', remember = true, answered = false, adding = false;
  const answer = (message: FromPicker) => { if (answered) return; answered = true; post(message); };
  const h = (tag: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | false)[]) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) (e as unknown as Record<string, unknown>)[k] = v;
      else if (k === 'test') e.dataset.testid = `netdisk.store.${v}`;
      else if (v !== false && v != null) e.setAttribute(k, String(v));
    }
    e.append(...kids.filter((k): k is Node | string => !!k));
    return e;
  };
  const render = () => {
    app.setAttribute('aria-busy', String(!request));
    if (!request) { app.replaceChildren(h('div', { class: 'pk-load' }, t('loading'))); return; }
    if (!chosen) chosen = request.remembered && request.roots.some(r => r.name === request!.remembered) ? request.remembered : request.roots[0]?.name ?? '';
    const sender = SENDERS[request.from] ? t(SENDERS[request.from]) : '';
    app.replaceChildren(h('div', { class: 'st-sheet' },
      h('h4', {}, t('store_title')),
      h('p', {}, sender ? t('store_from', { app: sender }) : t('store_sub')),
      h('div', { class: 'st-file', test: 'file' }, h('b', {}, request.name), h('small', {}, size(request.size))),
      request.roots.length
        ? h('div', { class: 'st-list', role: 'radiogroup', test: 'folders' }, ...request.roots.map(r => h('button', {
            class: `st-opt${r.name === chosen ? ' on' : ''}`, role: 'radio', 'aria-checked': String(r.name === chosen), title: r.name, test: `folder.${r.label}`,
            onclick: () => { chosen = r.name; render(); },
            ondblclick: () => answer({ type: 'store.choose', root: r.name, remember }),
          }, h('i', {}), h('b', {}, r.label))))
        : h('div', { class: 'st-empty' }, t('store_no_folders')),
      h('button', { class: 'st-add', test: 'add', disabled: adding, onclick: () => void add() }, `＋ ${t('store_add')}`),
      h('label', { class: 'st-check' }, h('input', { type: 'checkbox', test: 'remember', ...(remember ? { checked: '' } : {}), onchange: (e: Event) => { remember = (e.target as HTMLInputElement).checked; } }), t('store_remember')),
      h('div', { class: 'st-acts' },
        h('button', { class: 'secondary', test: 'cancel', onclick: () => { answer({ type: 'store.cancel' }); } }, t('cancel')),
        h('button', { class: 'primary', test: 'confirm', disabled: !chosen, onclick: () => answer({ type: 'store.choose', root: chosen, remember }) }, t('store_confirm')))));
  };
  // Another Medeo Drive folder: Medeo's own picker and confirmation, then the list again.
  const add = async () => {
    adding = true; render();
    try { await drive.requestFolder(t('reason')); } catch (error) { if (code(error) !== 'cancelled') console.warn(code(error)); }
    adding = false; post({ type: 'store.hello' });
  };
  channel.onMessage<ToPicker>(message => { if (message?.type === 'store.request') { request = message; render(); } });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') answer({ type: 'store.cancel' });
    if (e.key === 'Enter' && chosen) answer({ type: 'store.choose', root: chosen, remember });
  });
  addEventListener('pagehide', () => answer({ type: 'store.cancel' }));
  render();
  post({ type: 'store.hello' });
}
