// Both pages share this bundle: `index.html` is the main window, `ring.html` the overlay.
import { channel, i18n, permissions, windowManagement, operations } from '@medeo-plugin/sdk';
import { RING, frameFor, ringAction, type Action } from '../src/layout.ts';
import { fromKey, symbols, valid } from '../src/shortcuts.ts';
import { BINDINGS, type FromWorker, type RingSession, type Status, type ToWorker } from '../src/protocol.ts';

const send = (message: ToWorker) => channel.post(message);
const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const t = (key: string, values?: Record<string, string>) => i18n.t(key, values);

if (document.body.classList.contains('overlay')) ring(); else main();

// ---------------------------------------------------------------- main window
function main() {
  const SVG = 'http://www.w3.org/2000/svg';
  const DIAL_HUB = 34, DIAL_OUT = 106;
  /** Arrow per ring direction, in RING order (clockwise from the right). */
  const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const GROUPS: { key: string; ids: string[] }[] = [
    { key: 'group.ring', ids: ['ring'] },
    { key: 'group.halves', ids: ['left-half', 'right-half', 'top-half', 'bottom-half', 'maximize', 'center'] },
    { key: 'group.corners', ids: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] },
    { key: 'group.thirds', ids: ['left-third', 'center-third', 'right-third'] },
    { key: 'group.more', ids: ['next-display', 'undo'] },
  ];
  let status: Status | undefined, strings: Record<string, string> = {};
  let recording: string | null = null, saving = false;
  const errors = new Map<string, { error: string; keys?: string; other?: string }>();
  const tr = (key: string, values: Record<string, string> = {}) =>
    Object.entries(values).reduce((text, [k, v]) => text.split(`{${k}}`).join(v), strings[key] ?? key);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
  };
  const svgEl = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e;
  };
  const accelerator = (id: string) => status ? status.accelerators[id] ?? null : BINDINGS.find(b => b.id === id)?.accelerator ?? null;
  const keycaps = (value: string | null, cls = 'keys') => {
    const box = el('span', cls);
    if (value) for (const k of symbols(value)) box.append(el('kbd', undefined, k));
    return box;
  };

  // ---------------- the dial: the same eight directions and centre as the real ring
  const dial = $<SVGSVGElement>('dial');
  const point = (deg: number, r: number) => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r].map(n => n.toFixed(2)).join(' ');
  dial.append(svgEl('circle', { r: DIAL_OUT + 6, class: 'track' }));
  const segments = RING.map((action, i) => {
    const start = i * 45 - 22.5, end = start + 45, mid = i * 45, a = DIAL_HUB + 5, b = DIAL_OUT - 2;
    const g = svgEl('g', { class: 'seg', role: 'radio', 'data-action': action, 'data-testid': `window-ring.demo.${action}` });
    g.append(svgEl('path', { d: `M ${point(start, a)} L ${point(start, b)} A ${b} ${b} 0 0 1 ${point(end, b)} L ${point(end, a)} A ${a} ${a} 0 0 0 ${point(start, a)} Z` }));
    const [x, y] = point(mid, (a + b) / 2).split(' ');
    // An arrow pointing outwards, drawn at the origin then turned to its direction.
    g.append(svgEl('path', { class: 'arrow', d: 'M -9 0 L 8 0 M 2 -6 L 8 0 L 2 6', transform: `translate(${x} ${y}) rotate(${mid})` }));
    dial.append(g);
    return g;
  });
  const hub = svgEl('g', { class: 'seg hub', role: 'radio', 'data-action': 'maximize', 'data-testid': 'window-ring.demo.maximize' });
  hub.append(svgEl('circle', { r: DIAL_HUB }), svgEl('path', { class: 'arrow', d: 'M -11 -4 L -11 -11 L -4 -11 M 4 -11 L 11 -11 L 11 -4 M 11 4 L 11 11 L 4 11 M -4 11 L -11 11 L -11 4' }));
  dial.append(hub);

  // ---------------- the little screen
  const AREA = { x: 0, y: 0, width: 100, height: 100 }, START = { x: 24, y: 22, width: 52, height: 56 };
  const win = $('win'), ghost = $('ghost');
  const place = (node: HTMLElement, f: { x: number; y: number; width: number; height: number }) =>
    Object.assign(node.style, { left: `${f.x}%`, top: `${f.y}%`, width: `${f.width}%`, height: `${f.height}%` });
  place(ghost, START); place(win, START);

  let shown: Action = 'maximize', auto: ReturnType<typeof setInterval> | undefined, idle: ReturnType<typeof setTimeout> | undefined, step = 0;
  function show(action: Action, flash = false) {
    shown = action;
    for (const s of [...segments, hub]) s.classList.toggle('on', s.dataset.action === action);
    place(win, frameFor(action, AREA, START, 1.5) ?? START);
    win.classList.toggle('flash', false);
    if (flash) { void win.offsetWidth; win.classList.add('flash'); }
    const i = RING.indexOf(action);
    $('demo-name').textContent = tr(`action.${action}`);
    $('demo-move').textContent = i >= 0 ? tr('demo.move', { arrow: ARROWS[i] }) : tr('demo.center');
    $('demo-keys').replaceWith(Object.assign(keycaps(accelerator(action)), { id: 'demo-keys' }));
    $('demo-keys').dataset.testid = 'window-ring.demo.keys';
  }
  // A slow tour of every direction until the user points at the dial themselves.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOUR: Action[] = [...RING, 'maximize'];
  function startTour() {
    if (reduced || auto) return;
    auto = setInterval(() => { show(TOUR[step++ % TOUR.length]); }, 1500);
  }
  function stopTour() { clearInterval(auto); auto = undefined; clearTimeout(idle); }
  const resumeLater = () => { clearTimeout(idle); idle = setTimeout(startTour, 4000); };

  const fromPointer = (event: PointerEvent): Action => {
    const box = dial.getBoundingClientRect(), scale = 240 / box.width;
    return ringAction((event.clientX - box.left) * scale - 120, (event.clientY - box.top) * scale - 120, DIAL_HUB);
  };
  dial.addEventListener('pointermove', event => { stopTour(); const next = fromPointer(event); if (next !== shown) show(next); });
  dial.addEventListener('pointerleave', resumeLater);
  dial.addEventListener('click', event => { stopTour(); show(fromPointer(event), true); resumeLater(); });
  // Arrow keys on the focused dial: one arrow for a half, two together for a corner, Return for the centre.
  const held = new Set<string>();
  dial.addEventListener('keydown', event => {
    const known = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); stopTour(); show('maximize', true); return; }
    if (!known.includes(event.key)) return;
    event.preventDefault(); stopTour(); held.add(event.key);
    const dx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0), dy = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
    if (dx || dy) show(ringAction(dx * 100, dy * 100, 1), true);
  });
  dial.addEventListener('keyup', event => { held.delete(event.key); if (!held.size) resumeLater(); });
  dial.addEventListener('blur', () => { held.clear(); resumeLater(); });

  // ---------------- shortcuts
  function glyph(id: string): Element {
    const box = svgEl('svg', { class: 'glyph', viewBox: '0 0 30 20', 'aria-hidden': 'true' });
    box.append(svgEl('rect', { x: 0.75, y: 0.75, width: 28.5, height: 18.5, rx: 3, class: 'frame' }));
    const binding = BINDINGS.find(b => b.id === id)!;
    if (binding.action === 'ring') box.append(svgEl('circle', { cx: 15, cy: 10, r: 6, class: 'stroke' }), svgEl('circle', { cx: 15, cy: 10, r: 2, class: 'fill' }));
    else if (binding.action === 'next-display') box.append(svgEl('rect', { x: 3, y: 4, width: 10, height: 12, rx: 1.5, class: 'fill dim' }), svgEl('path', { d: 'M 16 10 L 26 10 M 22 6 L 26 10 L 22 14', class: 'stroke' }));
    else if (binding.action === 'undo') box.append(svgEl('path', { d: 'M 10 7 L 6 10 L 10 13 M 6 10 L 19 10 A 4 4 0 0 1 19 18', class: 'stroke' }));
    else {
      const f = frameFor(binding.action, { x: 2.5, y: 2.5, width: 25, height: 15 }, { x: 8, y: 5, width: 14, height: 10 }, 0.6);
      if (f) box.append(svgEl('rect', { x: f.x, y: f.y, width: f.width, height: f.height, rx: 1.5, class: 'fill' }));
    }
    return box;
  }
  function row(id: string): HTMLElement {
    const binding = BINDINGS.find(b => b.id === id)!, value = accelerator(id), state = status?.bindings[id];
    const item = el('div', 'binding'), name = el('div', 'name');
    item.dataset.testid = `window-ring.binding.${id}`;
    name.append(glyph(id), el('span', undefined, tr(`action.${binding.action}`)));
    // Pointing at a row plays it on the diagram.
    if (binding.action !== 'ring' && binding.action !== 'undo' && binding.action !== 'next-display') {
      item.addEventListener('pointerenter', () => { stopTour(); show(binding.action as Action); });
      item.addEventListener('pointerleave', resumeLater);
    }
    const chip = el('button', 'chip');
    chip.type = 'button'; chip.dataset.testid = `window-ring.binding.${id}.record`;
    if (recording === id) { chip.classList.add('recording'); chip.append(el('span', undefined, saving ? tr('edit.saving') : tr('edit.press'))); }
    else if (value) chip.append(keycaps(value));
    else { chip.classList.add('empty'); chip.append(el('span', undefined, tr('edit.none'))); }
    if (errors.has(id)) chip.classList.add('bad');
    chip.title = tr('edit.change');
    chip.addEventListener('click', () => { if (recording === id) stopRecording(); else startRecording(id); });
    const tools = el('div', 'tools');
    tools.append(chip);
    if (status?.customized.includes(id) && recording !== id) {
      const reset = el('button', 'icon', '↺'); reset.type = 'button'; reset.title = tr('edit.reset', { keys: symbols(binding.accelerator).join('') });
      reset.setAttribute('aria-label', reset.title); reset.dataset.testid = `window-ring.binding.${id}.reset`;
      reset.addEventListener('click', () => { errors.delete(id); send({ type: 'reset-shortcuts', id }); });
      tools.append(reset);
    } else tools.append(el('span', 'icon-space'));
    item.append(name, tools);
    let note: string | undefined, bad = true;
    const failure = errors.get(id);
    if (recording === id) { note = tr('edit.hint'); bad = false; }
    else if (failure) note = tr(`edit.${failure.error}`, { keys: failure.keys ?? '', other: failure.other ? tr(`action.${BINDINGS.find(b => b.id === failure.other)?.action ?? failure.other}`) : '' });
    else if (state && state !== 'registered' && state !== 'none') note = tr(state === 'conflict' ? 'shortcuts.conflict' : state === 'denied' ? 'shortcuts.denied' : 'shortcuts.off');
    if (note) { const p = el('p', 'note' + (bad ? ' error' : ''), note); p.dataset.testid = `window-ring.binding.${id}.note`; item.append(p); }
    return item;
  }
  function startRecording(id: string) {
    recording = id; saving = false; errors.delete(id);
    send({ type: 'record', active: true });
    render();
    document.querySelector<HTMLButtonElement>('.chip.recording')?.focus();
  }
  function stopRecording() {
    if (!recording) return;
    recording = null; saving = false;
    send({ type: 'record', active: false });
    render();
  }
  window.addEventListener('keydown', event => {
    if (!recording || saving) return;
    event.preventDefault(); event.stopPropagation();
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    if (plain && event.key === 'Escape') return stopRecording();
    if (plain && (event.key === 'Backspace' || event.key === 'Delete')) { saving = true; render(); send({ type: 'set-shortcut', id: recording, accelerator: null }); return; }
    const value = fromKey(event);
    if (!value) return; // only modifiers so far
    if (!valid(value)) { errors.set(recording, { error: 'invalid', keys: symbols(value).join('') }); render(); return; }
    errors.delete(recording); saving = true; pendingKeys = symbols(value).join(''); render();
    send({ type: 'set-shortcut', id: recording, accelerator: value });
  }, true);
  let pendingKeys = '';
  window.addEventListener('blur', () => { if (recording && !saving) stopRecording(); });
  window.addEventListener('pagehide', () => { if (recording) send({ type: 'record', active: false }); });

  // ---------------- the rest of the page
  function render() {
    const ok = !!status?.plugin && status.os === 'granted';
    $('title').textContent = tr('title');
    $('intro').textContent = tr('intro.short');
    $('dial-hint').textContent = tr('demo.hint');
    const ringKeys = accelerator('ring');
    const steps = [tr('step.hold', { keys: ringKeys ? symbols(ringKeys).join('') : tr('edit.none') }), tr('step.move'), tr('step.release')];
    $('steps').replaceChildren(...steps.map(text => el('li', undefined, text)));
    const pill = $('permission-pill');
    pill.hidden = ok || !status; pill.textContent = tr('permission.needed');
    $('permission-title').textContent = tr('permission.title');
    const badge = $('permission-badge'), grant = $<HTMLButtonElement>('grant');
    badge.className = 'badge ' + (ok ? 'ok' : 'warn'); badge.textContent = ok ? '✓' : '!';
    $('permission-text').textContent = tr(!status?.plugin ? 'permission.plugin' : status.os === 'granted' ? 'permission.granted' : 'permission.os');
    grant.hidden = ok; grant.textContent = tr(status?.plugin ? 'permission.open_settings' : 'permission.grant');
    $('shortcuts-title').textContent = tr('shortcuts.title');
    $('shortcuts-hint').textContent = tr('shortcuts.hint');
    const resetAll = $<HTMLButtonElement>('reset-all');
    resetAll.hidden = !status?.customized.length; resetAll.textContent = tr('edit.reset_all');
    const storageNote = $('storage-note');
    storageNote.hidden = status?.storage !== false; storageNote.textContent = tr('edit.storage');
    $('groups').replaceChildren(...GROUPS.map(group => {
      const box = el('div', 'group'); box.append(el('h3', undefined, tr(group.key)), ...group.ids.map(row)); return box;
    }));
    $('tray-title').textContent = tr('tray.title');
    $('tray-text').textContent = tr('tray.text');
    $<HTMLInputElement>('tray').checked = status?.tray !== false;
    $('settings-hint').textContent = tr('settings.hint');
    const last = status?.last;
    $('last').textContent = last && !last.ok ? (last.error === 'no_window' ? tr('status.none') : tr('status.failed', { error: last.error ?? '' })) : '';
    show(shown);
  }

  $('grant').addEventListener('click', async () => {
    try {
      if (!status?.plugin) await permissions.request('window_management', tr('permission.reason'));
      else await operations.wait(await windowManagement.request());
    } catch { /* the badge shows what is still missing */ }
    send({ type: 'grant' });
  });
  $('reset-all').addEventListener('click', () => { errors.clear(); send({ type: 'reset-shortcuts' }); });
  $<HTMLInputElement>('tray').addEventListener('change', event => send({ type: 'tray', visible: (event.target as HTMLInputElement).checked }));

  channel.onMessage<FromWorker>(message => {
    if (message?.type === 'status') { status = message.status; render(); }
    if (message?.type === 'applied') { stopTour(); show(message.action, true); resumeLater(); }
    if (message?.type === 'shortcut-result' && message.id === recording) {
      if (message.ok) { errors.delete(message.id); recording = null; saving = false; send({ type: 'record', active: false }); }
      else { errors.set(message.id, { error: message.error ?? 'failed', keys: pendingKeys, other: message.other }); recording = null; saving = false; send({ type: 'record', active: false }); }
      render();
    }
  });
  const loadStrings = async () => { strings = await i18n.catalog().catch(() => ({})); render(); };
  i18n.onDidChangeLocale(() => void loadStrings());
  void loadStrings().then(startTour);
  send({ type: 'hello', from: 'main' });
}

// ---------------------------------------------------------------- ring overlay
function ring() {
  const SVG = 'http://www.w3.org/2000/svg', OUTER = 90, HUB = 30;
  const svg = $<SVGSVGElement>('ring'), box = $('ring-box'), preview = $('preview'), label = $('label');
  let session: RingSession | undefined, action: Action = 'maximize', done = true;
  const names = new Map<Action, string>();

  // Eight 45° segments centred on 0° (right), clockwise because y grows downwards.
  const point = (deg: number, r: number) => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r].map(n => n.toFixed(2)).join(' ');
  const track = document.createElementNS(SVG, 'circle');
  track.setAttribute('r', String(OUTER)); track.setAttribute('class', 'track'); svg.append(track);
  const segments = RING.map((a, i) => {
    const start = i * 45 - 22.5, end = start + 45, path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', `M ${point(start, HUB + 4)} L ${point(start, OUTER - 4)} A ${OUTER - 4} ${OUTER - 4} 0 0 1 ${point(end, OUTER - 4)} L ${point(end, HUB + 4)} A ${HUB + 4} ${HUB + 4} 0 0 0 ${point(start, HUB + 4)} Z`);
    path.setAttribute('class', 'segment'); path.dataset.action = a; svg.append(path);
    return path;
  });
  const hub = document.createElementNS(SVG, 'circle');
  hub.setAttribute('r', String(HUB)); hub.setAttribute('class', 'hub'); svg.append(hub);

  const local = (x: number, y: number) => ({ x: x - session!.screen.frame.x, y: y - session!.screen.frame.y });
  async function select(next: Action) {
    if (!session) return;
    action = next;
    for (const s of segments) s.classList.toggle('on', s.dataset.action === next);
    hub.classList.toggle('on', next === 'maximize');
    const frame = frameFor(next, session.screen.visible_frame, session.window, session.gap);
    if (frame) {
      const at = local(frame.x, frame.y);
      Object.assign(preview.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${frame.width}px`, height: `${frame.height}px` });
      preview.hidden = false;
    }
    if (!names.has(next)) names.set(next, await t(`action.${next}`));
    label.textContent = names.get(next)!;
  }

  function open(message: RingSession) {
    session = message; done = false;
    const at = local(message.pointer.x, message.pointer.y);
    Object.assign(box.style, { left: `${at.x - 100}px`, top: `${at.y - 100}px` });
    Object.assign(label.style, { left: `${at.x}px`, top: `${at.y + OUTER + 14}px` });
    box.hidden = false; label.hidden = false;
    void select('maximize');
  }
  function finish(apply: boolean) {
    if (!session || done) return;
    done = true;
    box.hidden = true; preview.hidden = true; label.hidden = true;
    send(apply ? { type: 'apply', session: session.session, action } : { type: 'cancel', session: session.session });
  }

  window.addEventListener('mousemove', event => {
    if (!session || done) return;
    const next = ringAction(event.screenX - session.pointer.x, event.screenY - session.pointer.y, HUB);
    if (next !== action) void select(next);
  });
  // Releasing ⌃ or ⌥ applies (the shortcut is still held when the ring opens); a click also
  // applies, for a quick tap. Esc or a right click cancels.
  window.addEventListener('keyup', event => { if (event.key === 'Control' || event.key === 'Alt') finish(true); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') finish(false); });
  window.addEventListener('mousedown', event => finish(event.button === 0));
  window.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('blur', () => finish(false));
  channel.onMessage<FromWorker>(message => {
    if (message?.type === 'ring' && message.session !== session?.session) open(message);
    if (message?.type === 'closed' && message.session === session?.session) { done = true; box.hidden = true; preview.hidden = true; label.hidden = true; }
  });
  send({ type: 'hello', from: 'ring' });
}
