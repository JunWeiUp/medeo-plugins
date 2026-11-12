// Desktop integration tabs: notifications, menu bar, global shortcuts,
// windows, power, background tasks, clipboard, links and the browser view.
import css from './desktop.css';
import { useStyle } from './style';
import { card, clock, empty, field, h, page, pill, segmented, t, time, timeline, toggle, windows } from './kit';
import { icon } from './icons';
import { accelerator } from './pure';
import { appWindows, background, browserView, clipboard, events, external, i18n, notifications, power, shortcuts, tray } from '@medeo-plugin/sdk';

const base = async (permission: string, wide = false) => { useStyle(css); return page(permission, { wide }); };

// ── Notifications ──
export async function mountNotifications() {
  const p = await base('notifications', true);
  const presets = [
    { title: t('notify.preset.done'), body: t('notify.preset.done_body') },
    { title: t('notify.preset.reminder'), body: t('notify.preset.reminder_body') },
    { title: t('notify.preset.alert'), body: t('notify.preset.alert_body') },
  ];
  const title = h('input', { type: 'text', maxlength: 160, value: presets[0].title, testid: 'drive.notify.title' });
  const body = h('textarea', { maxlength: 2048, rows: 3, testid: 'drive.notify.body' }); body.value = presets[0].body;
  const previewTitle = h('b'), previewBody = h('p'), name = (await i18n.state()).name;
  const banner = h('div', { class: 'notify-banner', testid: 'drive.notify.preview' },
    h('div', { class: 'notify-app' }, icon('notifications', 20)),
    h('div', { class: 'notify-text' }, h('div', { class: 'notify-top' }, h('small', { text: 'Medeo' }), h('small', { text: t('notify.now') })), previewTitle, previewBody));
  const sync = () => { previewTitle.textContent = name + ' · ' + (title.value || t('notify.untitled')); previewBody.textContent = body.value; };
  title.oninput = body.oninput = sync; sync();
  const chips = h('div', { class: 'kit-row' }, ...presets.map(preset => { const b = h('button', { class: 'chip', type: 'button', text: preset.title }); b.onclick = () => { title.value = preset.title; body.value = preset.body; sync(); }; return b; }));
  const send = h('button', { class: 'primary', testid: 'drive.notify.send' }, icon('notifications'), t('notify.send'));
  const sent = h('ul', { class: 'kit-list', testid: 'drive.notify.sent' }), none = empty(t('notify.none'), 'notifications');
  let counter = 0;
  send.onclick = () => void p.act(send, 'notifications.show', async () => {
    const id = 'lab-' + (counter++ % 16), heading = title.value.trim() || t('notify.untitled');
    const value = await notifications.show(id, heading, body.value);
    sent.querySelector(`[data-id="${id}"]`)?.remove();
    const close = h('button', { class: 'ghost', testid: 'drive.notify.close.' + id }, icon('x'), t('notify.close'));
    const row = h('li', { 'data-id': id }, h('span', { class: 'notify-dot' }), h('span', { class: 'grow' }, h('b', { text: heading }), h('small', { text: time(Date.now()) + (body.value ? ' · ' + body.value : '') })), close);
    close.onclick = () => void p.act(close, 'notifications.close', async () => { await notifications.close(id); row.remove(); none.hidden = !!sent.children.length; return null; }, () => t('notify.closed'));
    sent.prepend(row); none.hidden = true;
    return value;
  }, () => t('notify.sent'));
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('notify.compose'), t('notify.compose_hint'), chips, field(t('notify.title'), title), field(t('notify.body'), body), h('div', { class: 'kit-row end' }, send)),
    h('div', { class: 'kit-body' }, card(t('notify.preview'), t('notify.preview_hint'), h('div', { class: 'notify-desk' }, banner)), card(t('notify.history'), t('notify.history_hint'), none, sent))));
}

// ── Menu bar ──
interface TrayItem { id: string; title: string }
export async function mountTray() {
  const p = await base('tray', true);
  const titleInput = h('input', { type: 'text', maxlength: 40, value: '★ Lab', testid: 'drive.tray.title' });
  let items: TrayItem[] = [{ id: 'hello', title: t('tray.sample1') }, { id: 'sync', title: t('tray.sample2') }, { id: 'about', title: t('tray.sample3') }];
  let applied = false, nextId = 1;
  const editor = h('ul', { class: 'tray-items', testid: 'drive.tray.items' });
  const menuTitle = h('span', { class: 'tray-title' }), menu = h('div', { class: 'tray-menu', testid: 'drive.tray.preview' });
  const state = pill(t('tray.not_applied'), 'warn', 'drive.tray.state');
  const add = h('button', { type: 'button', testid: 'drive.tray.add' }, icon('plus'), t('tray.add'));
  const apply = h('button', { class: 'primary', testid: 'drive.tray.apply' }, icon('check'), t('tray.apply'));
  const remove = h('button', { class: 'danger', testid: 'drive.tray.remove', disabled: true }, icon('trash'), t('tray.remove'));
  const feed = timeline(t('tray.no_clicks'), 'drive.tray.events');
  const counts = new Map<string, number>();
  function render() {
    menuTitle.textContent = titleInput.value || '·';
    editor.replaceChildren(...items.map((item, index) => {
      const input = h('input', { type: 'text', maxlength: 80, value: item.title, 'aria-label': t('tray.item') });
      input.oninput = () => { item.title = input.value; preview(); dirty(); };
      const up = h('button', { class: 'icon ghost', 'aria-label': t('tray.up'), disabled: index === 0 }, icon('up'));
      const down = h('button', { class: 'icon ghost', 'aria-label': t('tray.down'), disabled: index === items.length - 1 }, icon('down'));
      const del = h('button', { class: 'icon ghost', 'aria-label': t('tray.delete') }, icon('x'));
      up.onclick = () => { [items[index - 1], items[index]] = [items[index], items[index - 1]]; render(); dirty(); };
      down.onclick = () => { [items[index + 1], items[index]] = [items[index], items[index + 1]]; render(); dirty(); };
      del.onclick = () => { items.splice(index, 1); render(); dirty(); };
      return h('li', {}, h('span', { class: 'tray-grip', text: String(index + 1) }), input, up, down, del);
    }));
    add.disabled = items.length >= 12;
    preview();
  }
  function preview() {
    menuTitle.textContent = titleInput.value || '·';
    menu.replaceChildren(...(items.length ? items.map(item => h('div', { class: 'tray-entry' }, h('span', { text: item.title || '—' }), counts.get(item.id) ? h('small', { text: '×' + counts.get(item.id) }) : null)) : [h('div', { class: 'tray-entry muted', text: t('tray.empty_menu') })]));
  }
  const dirty = () => { if (applied) { state.className = 'kit-pill info'; state.replaceChildren(h('i'), t('tray.changed')); } };
  titleInput.oninput = () => { preview(); dirty(); };
  add.onclick = () => { items.push({ id: 'item-' + nextId++, title: t('tray.new_item', { n: items.length + 1 }) }); render(); dirty(); };
  apply.onclick = () => void p.act(apply, 'tray.set', async () => {
    const clean = items.filter(i => i.title.trim()).map(i => ({ id: i.id, title: i.title.trim() }));
    const value = await tray.set(titleInput.value.trim() || '·', clean);
    applied = true; remove.disabled = false; state.className = 'kit-pill ok'; state.replaceChildren(h('i'), t('tray.applied'));
    return value;
  }, () => t('tray.applied_toast'));
  remove.onclick = () => void p.act(remove, 'tray.remove', async () => {
    const value = await tray.remove(); applied = false; remove.disabled = true;
    state.className = 'kit-pill warn'; state.replaceChildren(h('i'), t('tray.not_applied')); return value;
  }, () => t('tray.removed'));
  p.every(500, async () => {
    if (!applied) return;
    const fired = await tray.events() as { id: string }[];
    for (const event of fired) {
      counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
      const item = items.find(i => i.id === event.id);
      feed.add(t('tray.clicked', { item: item?.title ?? event.id }), t('tray.click_count', { n: counts.get(event.id)! }), 'ok');
    }
    if (fired.length) preview();
  });
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // macOS: a titled item in the menu bar, its menu below. Windows: an icon in the taskbar's
  // notification area (the title becomes its tooltip), its menu above.
  const bar = windows
    ? h('div', { class: 'tray-bar' }, h('span', { class: 'tray-start', text: '⊞' }), h('span', { class: 'tray-spacer' }), h('span', { class: 'tray-sys', text: '^  ⌁  ' + now }), h('span', { class: 'tray-mine' }, h('span', { class: 'tray-glyph', text: '★' }), h('span', { class: 'tray-tip' }, menuTitle)))
    : h('div', { class: 'tray-bar' }, h('span', { class: 'tray-apple', text: '' }), h('span', { class: 'tray-spacer' }), h('span', { class: 'tray-sys', text: '◐  ⌁  ' + now }), h('span', { class: 'tray-mine' }, menuTitle));
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('tray.editor'), t('tray.editor_hint'), field(t('tray.title'), titleInput), h('div', { class: 'kit-field' }, h('span', { text: t('tray.items') }), editor), h('div', { class: 'kit-row' }, add, h('span', { class: 'grow' }), remove, apply)),
    h('div', { class: 'kit-body' },
      card(t('tray.preview'), undefined, h('div', { class: 'tray-screen' + (windows ? ' win' : '') }, bar, h('div', { class: 'tray-drop' }, menu)), h('div', { class: 'kit-row' }, state, h('small', { text: t('tray.preview_hint') }))),
      card(t('tray.clicks'), t('tray.clicks_hint'), feed.root))));
  render();
}

// ── Global shortcuts ──
const pretty = (a: string) => a.split('+').map(k => ({ Command: '⌘', CommandOrControl: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Up: '↑', Down: '↓', Left: '←', Right: '→', Space: '␣', Enter: '↩' } as Record<string, string>)[k] ?? k);
const keycaps = (a: string) => h('span', { class: 'keys' }, ...pretty(a).map(k => h('kbd', { text: k })));
export async function mountShortcuts() {
  const p = await base('global_shortcuts', true);
  let captured = 'CommandOrControl+Alt+Shift+K', listening = false;
  const capture = h('button', { class: 'shortcut-capture', testid: 'drive.shortcuts.capture', type: 'button' });
  const showCapture = () => capture.replaceChildren(listening ? h('span', { class: 'listening', text: t('shortcuts.listening') }) : keycaps(captured), h('small', { text: listening ? t('shortcuts.esc') : t('shortcuts.change') }));
  capture.onclick = () => { listening = !listening; showCapture(); };
  window.addEventListener('keydown', e => {
    if (!listening) return;
    e.preventDefault();
    if (e.key === 'Escape') { listening = false; showCapture(); return; }
    const next = accelerator(e);
    if (next) { captured = next; listening = false; showCapture(); }
  });
  const openUI = toggle(t('shortcuts.open_ui'), false, () => {}, 'drive.shortcuts.open_ui');
  const register = h('button', { class: 'primary', testid: 'drive.shortcuts.register' }, icon('plus'), t('shortcuts.register'));
  const list = h('ul', { class: 'kit-list', testid: 'drive.shortcuts.list' }), none = empty(t('shortcuts.none'), 'global_shortcuts');
  const feed = timeline(t('shortcuts.no_presses'), 'drive.shortcuts.events');
  const hits = new Map<string, number>();
  let registered: { id: string; accelerator: string; open_ui: boolean }[] = [], nextId = 1;
  async function load() {
    registered = await shortcuts.list();
    none.hidden = registered.length > 0;
    list.replaceChildren(...registered.map(s => {
      const off = h('button', { class: 'ghost danger', testid: 'drive.shortcuts.unregister.' + s.id }, icon('trash'), t('shortcuts.unregister'));
      off.onclick = () => void p.act(off, 'shortcuts.unregister', async () => { await shortcuts.unregister(s.id); await load(); return null; }, () => t('shortcuts.removed'));
      return h('li', { 'data-id': s.id }, keycaps(s.accelerator), h('span', { class: 'grow' }, h('small', { text: s.open_ui ? t('shortcuts.opens_ui') : t('shortcuts.sends_event') })), h('b', { class: 'shortcut-hits', text: hits.get(s.id) ? '×' + hits.get(s.id) : '' }), off);
    }));
  }
  register.onclick = () => void p.act(register, 'shortcuts.register', async () => {
    if (registered.some(s => s.accelerator === captured)) throw Error('shortcut_conflict');
    const value = await shortcuts.register('key-' + nextId++, captured, openUI.input.checked);
    await load(); return value;
  }, () => t('shortcuts.registered', { keys: pretty(captured).join('') }));
  p.every(300, async () => {
    if (!registered.length) return;
    const fired = await shortcuts.events() as { id: string }[];
    for (const event of fired) {
      hits.set(event.id, (hits.get(event.id) ?? 0) + 1);
      const s = registered.find(r => r.id === event.id);
      feed.add(t('shortcuts.pressed', { keys: s ? pretty(s.accelerator).join('') : event.id }), t('shortcuts.times', { n: hits.get(event.id)! }), 'ok');
      const row = list.querySelector<HTMLElement>(`[data-id="${event.id}"]`);
      if (row) { row.querySelector('.shortcut-hits')!.textContent = '×' + hits.get(event.id); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
    }
  });
  showCapture();
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('shortcuts.new'), t('shortcuts.new_hint'), capture, openUI, h('div', { class: 'kit-row end' }, register)),
    h('div', { class: 'kit-body' }, card(t('shortcuts.registered_title'), t('shortcuts.registered_hint'), none, list), card(t('shortcuts.presses'), t('shortcuts.presses_hint'), feed.root))));
  if (p.granted()) await load();
}

// ── Windows ──
export async function mountWindows() {
  const p = await base('app_windows');
  const sizes = [{ value: '480x360', label: t('windows.small') }, { value: '680x480', label: t('windows.medium') }, { value: '960x640', label: t('windows.large') }];
  let size = '680x480', n = 1;
  const sketch = h('div', { class: 'win-preview', 'data-size': size }, h('div', { class: 'win-frame' }, h('span'), h('span'), h('span')));
  const pick = segmented(sizes, size, v => { size = v; sketch.dataset.size = v; }, 'drive.windows.size');
  const open = h('button', { class: 'primary', testid: 'drive.windows.open' }, icon('app_windows'), t('windows.open'));
  const list = h('ul', { class: 'kit-list', testid: 'drive.windows.list' }), none = empty(t('windows.none'), 'app_windows');
  async function load() {
    const windows = await appWindows.list() as { id: string; title: string; visible: boolean }[];
    none.hidden = windows.length > 0;
    list.replaceChildren(...windows.map(w => {
      const focus = h('button', { class: 'ghost' }, t('windows.focus')), close = h('button', { class: 'ghost danger' }, icon('x'), t('windows.close'));
      focus.onclick = () => void p.act(focus, 'windows.focus', () => appWindows.focus(w.id));
      close.onclick = () => void p.act(close, 'windows.close', async () => { await appWindows.close(w.id); await load(); return null; });
      return h('li', {}, h('span', { class: 'win-thumb' }, h('i'), h('i'), h('i')), h('span', { class: 'grow' }, h('b', { text: w.title }), h('small', { text: w.visible ? t('windows.visible') : t('windows.hidden') })), focus, close);
    }));
  }
  open.onclick = () => void p.act(open, 'windows.open', async () => {
    const [width, height] = size.split('x').map(Number), id = 'lab-window-' + n;
    const value = await appWindows.open({ id, entry: 'ui/secondary.html', title: t('windows.title', { n: n++ }), width, height });
    await load(); return value;
  }, () => t('windows.opened'));
  p.every(1500, () => p.granted() ? load() : undefined);
  p.body.append(h('div', { class: 'kit-grid' },
    card(t('windows.new'), t('windows.new_hint'), sketch, h('div', { class: 'kit-row' }, pick, h('span', { class: 'grow' }), open)),
    card(t('windows.list'), t('windows.list_hint'), none, list)));
}

// ── Power ──
export async function mountPower() {
  const p = await base('power');
  const modes = ['prevent-app-suspension', 'prevent-display-sleep'] as const;
  const active = new Map<string, { id: string; since: number }>();
  const rows = modes.map(mode => {
    const timer = h('small', { class: 'kit-mono', text: '' });
    const sw = toggle(t('power.' + mode), false, on => void change(mode, on, sw.input), 'drive.power.' + mode);
    return { mode, sw, timer, el: h('div', { class: 'power-row' }, h('div', { class: 'power-art ' + mode }, icon(mode === 'prevent-display-sleep' ? 'system_info' : 'power')), h('div', { class: 'grow' }, sw, h('small', { text: t('power.' + mode + '.hint') })), timer) };
  });
  async function change(mode: typeof modes[number], on: boolean, input: HTMLInputElement) {
    input.disabled = true;
    const ok = await p.act(null, on ? 'power.start' : 'power.stop', async () => {
      if (on) { const { id } = await power.start(mode); active.set(mode, { id, since: Date.now() }); return { id }; }
      const current = active.get(mode); if (current) await power.stop(current.id); active.delete(mode); return null;
    }, () => on ? t('power.on') : t('power.off'));
    if (ok === undefined) input.checked = !on;
    input.disabled = false; tick();
  }
  const tick = () => { for (const r of rows) { const a = active.get(r.mode); r.timer.textContent = a ? t('power.for', { time: clock(Date.now() - a.since) }) : ''; r.el.classList.toggle('on', !!a); } };
  p.every(1000, tick);
  p.onLeave(() => { for (const a of active.values()) void power.stop(a.id).catch(() => {}); });
  p.body.append(card(t('power.title'), t('power.hint'), ...rows.map(r => r.el), h('p', { class: 'kit-note', text: t('power.note') })));
  if (p.granted()) {
    const existing = await power.state() as { id: string; type: typeof modes[number]; active: boolean }[];
    for (const e of existing) if (e.active) { active.set(e.type, { id: e.id, since: Date.now() }); rows.find(r => r.mode === e.type)!.sw.input.checked = true; }
    tick();
  }
}

// ── Background tasks ──
export async function mountBackground() {
  const p = await base('background_tasks', true);
  const delays = [{ value: 5000, label: '5s' }, { value: 15000, label: '15s' }, { value: 60000, label: '1m' }];
  const intervals = [{ value: 0, label: t('background.once') }, { value: 10000, label: t('background.every', { n: 10 }) }, { value: 30000, label: t('background.every', { n: 30 }) }];
  let delay = 5000, interval = 0, n = 1;
  const name = h('input', { type: 'text', maxlength: 60, value: t('background.default_name'), testid: 'drive.background.name' });
  const schedule = h('button', { class: 'primary', testid: 'drive.background.schedule' }, icon('background_tasks'), t('background.schedule'));
  const list = h('ul', { class: 'kit-list', testid: 'drive.background.list' }), none = empty(t('background.none'), 'background_tasks');
  const feed = timeline(t('background.no_runs'), 'drive.background.events');
  let tasks: { id: string; due_ms: number; interval_ms: number }[] = [];
  const names = new Map<string, string>();
  function render() {
    none.hidden = tasks.length > 0;
    list.replaceChildren(...tasks.map(task => {
      const left = Math.max(0, task.due_ms - Date.now()), cancel = h('button', { class: 'ghost danger' }, icon('x'), t('background.cancel'));
      cancel.onclick = () => void p.act(cancel, 'background.cancel', async () => { await background.cancel(task.id); await load(); return null; });
      return h('li', {}, h('span', { class: 'bg-ring', style: `--left:${Math.min(1, left / Math.max(task.interval_ms || 60000, 1))}` }, icon('background_tasks', 18)), h('span', { class: 'grow' }, h('b', { text: names.get(task.id) ?? task.id }), h('small', { text: (task.interval_ms ? t('background.repeats', { n: task.interval_ms / 1000 }) + ' · ' : '') + t('background.in', { time: clock(left) }) })), cancel);
    }));
  }
  async function load() { tasks = await background.list() as typeof tasks; render(); }
  async function pull() {
    const fired = await background.events();
    for (const event of fired) feed.add(t('background.ran', { name: names.get(event.schedule) ?? event.schedule }), t('background.payload', { value: JSON.stringify(event.payload) }), 'ok');
    if (fired.length) await load();
  }
  schedule.onclick = () => void p.act(schedule, 'background.schedule', async () => {
    const id = 'task-' + n++; names.set(id, name.value || id);
    const value = await background.schedule(id, delay, { name: name.value, scheduled: Date.now() }, interval);
    await load(); return value;
  }, () => t('background.scheduled'));
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('background.new'), t('background.new_hint'), field(t('background.name'), name), h('div', { class: 'kit-field' }, h('span', { text: t('background.delay') }), segmented(delays, delay, v => { delay = v; }, 'drive.background.delay')), h('div', { class: 'kit-field' }, h('span', { text: t('background.repeat') }), segmented(intervals, interval, v => { interval = v; }, 'drive.background.interval')), h('div', { class: 'kit-row end' }, schedule)),
    h('div', { class: 'kit-body' }, card(t('background.list'), undefined, none, list), card(t('background.runs'), t('background.runs_hint'), feed.root))));
  if (p.granted()) {
    await load();
    const off = events.onSignal('background', () => pull());
    p.onLeave(off);
    p.every(1000, render);
  }
}

// ── Clipboard ──
export async function mountClipboard(mode: 'read' | 'write') {
  const p = await base(mode === 'read' ? 'clipboard_read' : 'clipboard_write');
  if (mode === 'write') {
    const text = h('textarea', { rows: 5, maxlength: 32768, testid: 'drive.clipboard.text' }); text.value = t('clipboard.sample');
    const counter = h('small', { class: 'kit-mono' }), update = () => { counter.textContent = t('clipboard.chars', { n: text.value.length }); };
    text.oninput = update; update();
    const copy = h('button', { class: 'primary', testid: 'drive.clipboard.write' }, icon('copy'), t('clipboard.copy'));
    const recent = h('ul', { class: 'kit-list' });
    copy.onclick = () => void p.act(copy, 'clipboard.write', async () => {
      const value = await clipboard.write(text.value);
      recent.prepend(h('li', {}, icon('check', 18), h('span', { class: 'grow' }, h('b', { text: text.value.slice(0, 80) || '—' }), h('small', { text: time(Date.now()) })))); while (recent.children.length > 5) recent.lastElementChild!.remove();
      return value;
    }, () => t('clipboard.copied'));
    p.body.append(card(t('clipboard.write_title'), t('clipboard.write_hint'), text, h('div', { class: 'kit-row' }, counter, h('span', { class: 'grow' }), copy), recent));
    return;
  }
  const read = h('button', { class: 'primary', testid: 'drive.clipboard.read' }, icon('clipboard_read'), t('clipboard.read'));
  const shown = h('div', { class: 'clip-content', testid: 'drive.clipboard.content' }, empty(t('clipboard.nothing'), 'clipboard_read'));
  const history = h('ul', { class: 'kit-list' });
  read.onclick = () => void p.act(read, 'clipboard.read', async () => {
    const value = await clipboard.read();
    shown.replaceChildren(value.text ? h('pre', { text: value.text }) : empty(t('clipboard.empty'), 'clipboard_read'), h('small', { text: t('clipboard.read_at', { time: time(Date.now()), n: value.text.length }) }));
    if (value.text) { history.prepend(h('li', {}, h('span', { class: 'grow' }, h('b', { text: value.text.slice(0, 80) }), h('small', { text: time(Date.now()) })))); while (history.children.length > 5) history.lastElementChild!.remove(); }
    return value;
  }, () => t('clipboard.read_done'));
  p.body.append(h('div', { class: 'kit-grid split' }, card(t('clipboard.read_title'), t('clipboard.read_hint'), shown, h('div', { class: 'kit-row end' }, read)), card(t('clipboard.history'), undefined, history)));
}

// ── External links ──
export async function mountExternal() {
  const p = await base('external_open');
  const url = h('input', { type: 'url', value: 'https://example.com/', testid: 'drive.external.url' });
  const open = h('button', { class: 'primary', testid: 'drive.external.open' }, icon('external_open'), t('external.open'));
  open.onclick = () => void p.act(open, 'external.open', () => external.open(url.value.trim()), () => t('external.opened'));
  const quick = ['https://example.com/', 'https://example.com/?from=medeo'].map(link => { const b = h('button', { class: 'link-card', type: 'button' }, h('span', { class: 'link-fav', text: 'e' }), h('span', { class: 'grow' }, h('b', { text: new URL(link).host }), h('small', { text: link }))); b.onclick = () => { url.value = link; void p.act(b, 'external.open', () => external.open(link), () => t('external.opened')); }; return b; });
  p.body.append(card(t('external.title'), t('external.hint'), field(t('external.url'), url, t('external.scope')), h('div', { class: 'kit-row end' }, open), h('div', { class: 'link-grid' }, ...quick)));
}

// ── Browser view ──
export async function mountBrowser() {
  const p = await base('browser_view');
  const id = 'lab-browser';
  const url = h('input', { type: 'url', value: 'http://127.0.0.1:8765/health', testid: 'drive.browser.url' });
  let size = '800x600';
  const open = h('button', { class: 'primary', testid: 'drive.browser.open' }, icon('browser_view'), t('browser.open'));
  const close = h('button', { class: 'danger', testid: 'drive.browser.close', disabled: true }, icon('x'), t('browser.close'));
  const status = pill(t('browser.closed'), 'info', 'drive.browser.state');
  const page$ = h('div', { class: 'browser-chrome' }, h('div', { class: 'browser-dots' }, h('i'), h('i'), h('i')), h('span', { class: 'browser-url', text: '—' }));
  const titleText = h('small', { text: '' });
  let isOpen = false;
  async function state() {
    if (!isOpen) return;
    try {
      const s = await browserView.state(id) as { url: string; loading: boolean; title: string };
      page$.querySelector('.browser-url')!.textContent = s.url; titleText.textContent = s.title;
      status.className = 'kit-pill ' + (s.loading ? 'info' : 'ok'); status.replaceChildren(h('i'), s.loading ? t('browser.loading') : t('browser.ready'));
    } catch { isOpen = false; close.disabled = true; status.className = 'kit-pill info'; status.replaceChildren(h('i'), t('browser.closed')); }
  }
  open.onclick = () => void p.act(open, 'browser.open', async () => {
    const [w, hh] = size.split('x').map(Number);
    if (isOpen) await browserView.close(id).catch(() => {});
    const value = await browserView.open(id, url.value.trim(), w, hh); isOpen = true; close.disabled = false; await state(); return value;
  });
  close.onclick = () => void p.act(close, 'browser.close', async () => { const v = await browserView.close(id); isOpen = false; close.disabled = true; status.className = 'kit-pill info'; status.replaceChildren(h('i'), t('browser.closed')); return v; });
  p.every(1000, state);
  p.onLeave(() => { if (isOpen) void browserView.close(id).catch(() => {}); });
  p.body.append(card(t('browser.title'), t('browser.hint'), field(t('browser.url'), url, t('browser.scope')), h('div', { class: 'kit-row' }, segmented([{ value: '640x480', label: '640×480' }, { value: '800x600', label: '800×600' }, { value: '1024x720', label: '1024×720' }], size, v => { size = v; }), h('span', { class: 'grow' }), close, open), h('div', { class: 'browser-box' }, page$, h('div', { class: 'kit-row' }, status, titleText))));
}
