// System and data tabs: storage, system info, processes, approvals, printing,
// location, contacts, calendar, devices, accessibility, creation, full file
// access and network.
import css from './data.css';
import { useStyle } from './style';
import { bytes, card, empty, explain, field, h, lang, page, pill, segmented, t, time, timeline } from './kit';
import { icon } from './icons';
import { mountNetworkOrigins } from './network-origins';
import { accessibility, windowManagement, approvals, calendar, capabilities, contacts, creation, deviceLocation, devices, files, network, operations, printing, processes, resources, storage, system, type FileEntry } from '@medeo-plugin/sdk';

const wait = async <T>(operation: Promise<unknown>) => operations.wait<T>(await operation as { id: string; status: string });
const base = async (permission: string, options: Parameters<typeof page>[1] = {}) => { useStyle(css); return page(permission, options); };
const authorization = (call: () => Promise<unknown>) => async () => (await wait<{ authorization: string }>(call())).authorization;

// ── Storage ──
const INDEX = '__lab_keys';
export async function mountStorage() {
  const p = await base('storage', { wide: true });
  const key = h('input', { type: 'text', maxlength: 120, value: 'theme', testid: 'drive.storage.key' });
  const value = h('textarea', { rows: 5, class: 'kit-mono', testid: 'drive.storage.value' }); value.value = '{\n  "mode": "dark",\n  "accent": "#863dfb"\n}';
  const valid = h('small', { class: 'json-state' });
  const check = () => { try { JSON.parse(value.value); valid.textContent = '✓ ' + t('storage.valid'); valid.className = 'json-state ok'; return true; } catch (error) { valid.textContent = '✕ ' + String((error as Error).message).slice(0, 80); valid.className = 'json-state error'; return false; } };
  value.oninput = check; check();
  const save = h('button', { class: 'primary', testid: 'drive.storage.save' }, icon('check'), t('storage.save'));
  const table = h('div', { class: 'store-table', testid: 'drive.storage.rows' });
  let keys: string[] = [];
  async function load() {
    keys = (await storage.get<string[]>(INDEX)) ?? [];
    table.replaceChildren();
    if (!keys.length) { table.append(empty(t('storage.none'), 'storage')); return; }
    for (const k of keys) {
      const v = await storage.get(k);
      const edit = h('button', { class: 'ghost' }, t('storage.edit')), del = h('button', { class: 'ghost danger', 'aria-label': t('storage.delete') }, icon('trash'));
      edit.onclick = () => { key.value = k; value.value = JSON.stringify(v, null, 2); check(); key.focus(); };
      del.onclick = () => void p.act(del, 'storage.remove', async () => { await storage.remove(k); await storage.set(INDEX, keys.filter(x => x !== k)); await load(); return null; }, () => t('storage.deleted'));
      table.append(h('div', { class: 'store-row' }, h('code', { text: k }), h('pre', { text: JSON.stringify(v) }), h('div', { class: 'kit-row' }, edit, del)));
    }
  }
  save.onclick = () => void p.act(save, 'storage.set', async () => {
    if (!check()) throw Error('invalid_argument');
    const k = key.value.trim(); if (!k || k === INDEX) throw Error('invalid_argument');
    await storage.set(k, JSON.parse(value.value));
    if (!keys.includes(k)) await storage.set(INDEX, [...keys, k]);
    await load(); return { saved: k };
  }, () => t('storage.saved'));
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('storage.editor'), t('storage.editor_hint'), field(t('storage.key'), key), field(t('storage.value'), value), h('div', { class: 'kit-row' }, valid, h('span', { class: 'grow' }), save)),
    card(t('storage.saved_title'), t('storage.saved_hint'), table)));
  if (p.granted()) await load();
}

// ── System info ──
interface Display { id: string; bounds: { x: number; y: number; width: number; height: number }; scale: number }
export async function mountSystemInfo() {
  const p = await base('system_info');
  const tiles = h('div', { class: 'kit-kv', testid: 'drive.system.tiles' }), map = h('div', { class: 'display-map', testid: 'drive.system.displays' });
  const refresh = h('button', { testid: 'drive.system.refresh' }, icon('refresh'), t('system.refresh'));
  async function load() {
    const info = await p.act(refresh, 'system.info', () => system.info() as Promise<{ platform: string; architecture: string; release: string; locale: string; displays: Display[] }>);
    if (!info) return;
    const os = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[info.platform] ?? info.platform;
    tiles.replaceChildren(...[[t('system.os'), os], [t('system.arch'), info.architecture], [t('system.kernel'), info.release], [t('system.locale'), info.locale], [t('system.displays'), String(info.displays.length)]].map(([k, v]) => h('div', {}, h('small', { text: k }), h('b', { text: v }))));
    const minX = Math.min(...info.displays.map(d => d.bounds.x)), minY = Math.min(...info.displays.map(d => d.bounds.y));
    const maxX = Math.max(...info.displays.map(d => d.bounds.x + d.bounds.width)), maxY = Math.max(...info.displays.map(d => d.bounds.y + d.bounds.height));
    const scale = Math.min(520 / (maxX - minX), 220 / (maxY - minY));
    map.style.width = (maxX - minX) * scale + 'px'; map.style.height = (maxY - minY) * scale + 'px';
    map.replaceChildren(...info.displays.map((d, i) => h('div', { class: 'display', style: `left:${(d.bounds.x - minX) * scale}px;top:${(d.bounds.y - minY) * scale}px;width:${d.bounds.width * scale - 4}px;height:${d.bounds.height * scale - 4}px` }, h('b', { text: String(i + 1) }), h('small', { text: `${d.bounds.width}×${d.bounds.height} @${d.scale}x` }))));
  }
  refresh.onclick = () => void load();
  p.body.append(card(t('system.title'), undefined, tiles, h('div', { class: 'kit-row end' }, refresh)), card(t('system.layout'), t('system.layout_hint'), h('div', { class: 'display-stage' }, map)));
  if (p.granted()) await load();
}

// ── Process ──
export async function mountProcess() {
  const p = await base('process_spawn', { wide: true });
  // A program that prints its arguments on each OS: printf on macOS, cmd's echo on Windows
  // (the Host starts only declared .exe files there, with arguments passed one by one).
  const windows = navigator.userAgent.includes('Windows');
  const exe = windows ? 'C:/Windows/System32/cmd.exe' : '/usr/bin/printf';
  const args = h('textarea', { rows: 4, class: 'kit-mono', testid: 'drive.process.args' });
  args.value = windows ? '/d\n/c\necho\nHello\nMedeo' : 'Hello %s 👋\\nToday is %s\\n\nMedeo\n' + new Date().toLocaleDateString(lang());
  const run = h('button', { class: 'primary', testid: 'drive.process.run' }, icon('process_spawn'), t('process.run'));
  const term = h('div', { class: 'terminal', testid: 'drive.process.output' }, h('span', { class: 'muted', text: t('process.idle') }));
  const exit = h('span', { testid: 'drive.process.exit' });
  const list = () => args.value.split('\n').map(line => line.replace(/\\n/g, '\n')).filter((line, i, all) => line || i < all.length - 1);
  run.onclick = () => void p.act(run, 'process.start', async () => {
    const argv = list(), started = Date.now();
    term.replaceChildren(h('span', { class: 'prompt', text: '$ ' + exe + ' ' + argv.map(a => JSON.stringify(a)).join(' ') }));
    const job = await wait<{ id: string }>(processes.start(exe, argv, 5000));
    let state: { status: string; exit_code: number | null; stdout: string; stderr: string };
    for (;;) { state = await wait(processes.state(job.id)); if (state.status !== 'running') break; await new Promise(r => setTimeout(r, 120)); }
    term.append(h('span', { text: state.stdout }), state.stderr ? h('span', { class: 'err', text: state.stderr }) : '');
    exit.replaceChildren(pill(t('process.exit', { code: String(state.exit_code), ms: Date.now() - started }), state.exit_code === 0 ? 'ok' : 'error'));
    return state;
  });
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('process.title'), t('process.hint'), h('div', { class: 'kit-note kit-mono', text: exe }), field(t('process.args'), args, t('process.args_hint')), h('div', { class: 'kit-row end' }, run)),
    card(t('process.output'), undefined, term, exit)));
}

// ── Approvals ──
export async function mountApprovals() {
  const p = await base('approvals', { wide: true });
  const title = h('input', { type: 'text', value: t('approvals.sample_title'), testid: 'drive.approvals.title' });
  const detail = h('input', { type: 'text', value: t('approvals.sample_detail') });
  let kind: 'command' | 'text' | 'diff' = 'command';
  const preview = h('textarea', { rows: 4, class: 'kit-mono', testid: 'drive.approvals.preview' }); preview.value = 'git status';
  const samples = { command: 'git status', text: t('approvals.sample_text'), diff: '- const timeout = 30\n+ const timeout = 60' };
  const kinds = segmented([{ value: 'command', label: t('approvals.kind_command') }, { value: 'text', label: t('approvals.kind_text') }, { value: 'diff', label: t('approvals.kind_diff') }] as { value: typeof kind; label: string }[], kind, v => { kind = v; preview.value = samples[v]; });
  const key = h('input', { type: 'text', class: 'kit-mono', value: 'bash:git status' }), pattern = h('input', { type: 'text', class: 'kit-mono', value: 'bash:git *' });
  const ask = h('button', { class: 'primary', testid: 'drive.approvals.ask' }, icon('approvals'), t('approvals.ask'));
  const answers = timeline(t('approvals.no_answers'), 'drive.approvals.answers');
  const rules = h('ul', { class: 'kit-list', testid: 'drive.approvals.rules' }), noRules = empty(t('approvals.no_rules'), 'approvals');
  async function loadRules() {
    const list = await approvals.rules();
    noRules.hidden = list.length > 0;
    rules.replaceChildren(...list.map(rule => { const forget = h('button', { class: 'ghost danger' }, t('approvals.forget')); forget.onclick = () => void p.act(forget, 'approvals.forget', async () => { const v = await approvals.forget(rule.action, rule.pattern); await loadRules(); return v; }); return h('li', {}, pill(rule.allow ? t('approvals.allow') : t('approvals.deny'), rule.allow ? 'ok' : 'error'), h('span', { class: 'grow' }, h('b', { class: 'kit-mono', text: rule.pattern }), h('small', { text: rule.action + ' · ' + t('approvals.scope.' + rule.scope) })), forget); }));
  }
  ask.onclick = () => void p.act(ask, 'approvals.request', async () => {
    const answer = await approvals.request({ action: 'run_command', title: title.value, detail: detail.value, preview: { kind, text: preview.value }, rule_key: key.value, ...(pattern.value ? { rule_pattern: pattern.value } : {}) });
    answers.add(answer.decision === 'allow' ? t('approvals.allowed') : t('approvals.denied'), t('approvals.scope.' + answer.scope) + (answer.rule ? ' · ' + answer.rule : ''), answer.decision === 'allow' ? 'ok' : 'error');
    await loadRules(); return answer;
  });
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('approvals.compose'), t('approvals.compose_hint'), field(t('approvals.title'), title), field(t('approvals.detail'), detail), h('div', { class: 'kit-field' }, h('span', { text: t('approvals.preview') }), kinds, preview), h('div', { class: 'kit-grid' }, field(t('approvals.rule_key'), key), field(t('approvals.rule_pattern'), pattern, t('approvals.rule_hint'))), h('div', { class: 'kit-row end' }, ask)),
    h('div', { class: 'kit-body' }, card(t('approvals.answers'), undefined, answers.root), card(t('approvals.rules'), t('approvals.rules_hint'), noRules, rules))));
  if (p.granted()) await loadRules();
}

// ── Printing ──
export async function mountPrinting() {
  const p = await base('printing', { wide: true });
  const text = h('textarea', { rows: 10, testid: 'drive.print.text' }); text.value = t('print.sample');
  const paper = h('div', { class: 'paper' }), sync = () => { paper.textContent = text.value; };
  text.oninput = sync; sync();
  const print = h('button', { class: 'primary', testid: 'drive.print.print' }, icon('printing'), t('print.print'));
  print.onclick = () => void p.act(print, 'printing.print', () => printing.print(text.value), () => t('print.done'));
  p.body.append(h('div', { class: 'kit-grid split' }, card(t('print.compose'), t('print.hint'), text, h('div', { class: 'kit-row end' }, print)), card(t('print.preview'), undefined, h('div', { class: 'paper-desk' }, paper))));
}

// ── Location ──
const dms = (v: number, pos: string, neg: string) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60; return `${d}°${m}′${s.toFixed(1)}″ ${v >= 0 ? pos : neg}`; };
export async function mountLocation() {
  const p = await base('location', { system: authorization(() => deviceLocation.status()), requestSystem: () => wait(deviceLocation.request()) });
  const get = h('button', { class: 'primary', testid: 'drive.location.get' }, icon('location'), t('location.get'));
  const radar = h('div', { class: 'radar' }, h('i', { class: 'ring' }), h('i', { class: 'ring two' }), h('span', { class: 'accuracy' }), h('span', { class: 'dot' }));
  const tiles = h('div', { class: 'kit-kv', testid: 'drive.location.result' }, h('div', {}, h('small', { text: t('location.latitude') }), h('b', { text: '—' })), h('div', {}, h('small', { text: t('location.longitude') }), h('b', { text: '—' })));
  get.onclick = () => void p.act(get, 'location.current', async () => {
    radar.classList.add('scanning');
    try {
      const fix = await wait<{ latitude: number; longitude: number; accuracy_m: number; timestamp_ms: number }>(deviceLocation.current());
      radar.classList.add('found');
      radar.querySelector<HTMLElement>('.accuracy')!.style.setProperty('--r', Math.min(90, 18 + Math.log10(Math.max(1, fix.accuracy_m)) * 22) + 'px');
      tiles.replaceChildren(...[[t('location.latitude'), dms(fix.latitude, 'N', 'S'), fix.latitude.toFixed(5)], [t('location.longitude'), dms(fix.longitude, 'E', 'W'), fix.longitude.toFixed(5)], [t('location.accuracy'), '± ' + Math.round(fix.accuracy_m) + ' m', ''], [t('location.time'), time(fix.timestamp_ms), '']].map(([k, v, s]) => h('div', {}, h('small', { text: k }), h('b', { text: v }), s ? h('small', { class: 'kit-mono', text: s }) : null)));
      return fix;
    } finally { radar.classList.remove('scanning'); }
  }, () => t('location.found'));
  p.body.append(h('div', { class: 'kit-grid split' }, card(t('location.title'), t('location.hint'), radar, h('div', { class: 'kit-row end' }, get)), card(t('location.result'), undefined, tiles)));
}

// ── Contacts ──
interface Contact { id: string; given_name: string; family_name: string; email: string; phone: string }
export async function mountContacts() {
  const p = await base('contacts', { wide: true, system: authorization(() => contacts.status()), requestSystem: () => wait(contacts.request()) });
  const query = h('input', { type: 'search', placeholder: t('contacts.search'), testid: 'drive.contacts.query' });
  const list = h('ul', { class: 'kit-list contact-list', testid: 'drive.contacts.list' });
  let timer = 0;
  async function search() {
    const rows = await p.act(null, 'contacts.list', () => wait<Contact[]>(contacts.list(query.value.trim(), 50)));
    if (!rows) return;
    list.replaceChildren(...(rows.length ? rows.map(c => { const name = [c.given_name, c.family_name].filter(Boolean).join(' ') || c.email || '—'; return h('li', {}, h('span', { class: 'avatar', text: (c.given_name || c.family_name || c.email || '?').slice(0, 1).toUpperCase() }), h('span', { class: 'grow' }, h('b', { text: name }), h('small', { text: [c.email, c.phone].filter(Boolean).join(' · ') || '—' }))); }) : [h('li', { class: 'plain' }, empty(t('contacts.none'), 'contacts'))]));
  }
  query.oninput = () => { clearTimeout(timer); timer = window.setTimeout(() => void search(), 300); };
  const form = { given_name: h('input', { type: 'text', placeholder: t('contacts.given') }), family_name: h('input', { type: 'text', placeholder: t('contacts.family') }), email: h('input', { type: 'text', placeholder: 'name@example.com' }), phone: h('input', { type: 'text', placeholder: '+86 …' }) };
  const save = h('button', { class: 'primary', testid: 'drive.contacts.save' }, icon('plus'), t('contacts.save'));
  save.onclick = () => void p.act(save, 'contacts.save', async () => { const v = await wait(contacts.save({ given_name: form.given_name.value, family_name: form.family_name.value, email: form.email.value, phone: form.phone.value })); await search(); return v; }, () => t('contacts.saved'));
  const load = h('button', {}, icon('search'), t('contacts.load'));
  load.onclick = () => void search();
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('contacts.title'), t('contacts.hint'), h('div', { class: 'kit-row' }, h('div', { class: 'grow' }, query), load), list),
    card(t('contacts.new'), undefined, h('div', { class: 'kit-grid two' }, form.given_name, form.family_name), form.email, form.phone, h('p', { class: 'kit-note', text: t('contacts.warning') }), h('div', { class: 'kit-row end' }, save))));
}

// ── Calendar ──
interface CalendarEvent { id: string; title: string; start_ms: number; end_ms: number }
export async function mountCalendar() {
  const p = await base('calendar', { wide: true, system: authorization(() => calendar.status()), requestSystem: () => wait(calendar.request()) });
  const agenda = h('div', { class: 'agenda', testid: 'drive.calendar.agenda' });
  const day = (ms: number) => new Date(ms).toLocaleDateString(lang(), { weekday: 'short', month: 'short', day: 'numeric' });
  const hm = (ms: number) => new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  async function load() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const rows = await p.act(null, 'calendar.list', () => wait<CalendarEvent[]>(calendar.list(start.getTime(), start.getTime() + 7 * 86400000, 100)));
    if (!rows) return;
    agenda.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const from = start.getTime() + i * 86400000, items = rows.filter(e => e.start_ms < from + 86400000 && e.end_ms > from).sort((a, b) => a.start_ms - b.start_ms);
      agenda.append(h('div', { class: 'agenda-day' + (i === 0 ? ' today' : '') }, h('b', { text: day(from) }), items.length ? h('ul', {}, ...items.map(e => h('li', {}, h('time', { text: hm(e.start_ms) + '–' + hm(e.end_ms) }), h('span', { text: e.title || '—' })))) : h('small', { text: t('calendar.free') })));
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const soon = new Date(Date.now() + 3600000); soon.setMinutes(0, 0, 0);
  const title = h('input', { type: 'text', value: t('calendar.sample') }), startAt = h('input', { type: 'datetime-local', value: `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:00` });
  let minutes = 30;
  const save = h('button', { class: 'primary', testid: 'drive.calendar.save' }, icon('plus'), t('calendar.save'));
  save.onclick = () => void p.act(save, 'calendar.save', async () => { const s = new Date(startAt.value).getTime(); const v = await wait(calendar.save({ title: title.value, notes: 'Medeo Test Lab', start_ms: s, end_ms: s + minutes * 60000 })); await load(); return v; }, () => t('calendar.saved'));
  const refresh = h('button', {}, icon('refresh'), t('calendar.refresh'));
  refresh.onclick = () => void load();
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('calendar.week'), t('calendar.week_hint'), agenda, h('div', { class: 'kit-row end' }, refresh)),
    card(t('calendar.new'), undefined, field(t('calendar.event_title'), title), field(t('calendar.start'), startAt), h('div', { class: 'kit-field' }, h('span', { text: t('calendar.length') }), segmented([15, 30, 60].map(v => ({ value: v, label: v + ' min' })), minutes, v => { minutes = v; })), h('p', { class: 'kit-note', text: t('calendar.warning') }), h('div', { class: 'kit-row end' }, save))));
  agenda.append(empty(t('calendar.load_hint'), 'calendar'));
}

// ── Devices ──
export async function mountDevices() {
  const p = await base('device_access');
  let transport: 'serial' | 'hid' | 'ble' = 'serial';
  const choose = h('button', { class: 'primary', testid: 'drive.devices.choose' }, icon('device_access'), t('devices.choose'));
  const list = h('ul', { class: 'kit-list', testid: 'drive.devices.list' }), none = empty(t('devices.none'), 'device_access');
  async function load() {
    const rows = await wait<{ id: string; name: string; transport: string; opened: boolean }[]>(devices.list());
    none.hidden = rows.length > 0;
    list.replaceChildren(...rows.map(d => { const toggleOpen = h('button', { class: 'ghost' }, d.opened ? t('devices.close') : t('devices.open')); toggleOpen.onclick = () => void p.act(toggleOpen, d.opened ? 'devices.close' : 'devices.open', async () => { const v = await wait(d.opened ? devices.close(d.id) : devices.open(d.id)); await load(); return v; }); return h('li', {}, h('span', { class: 'device-badge', text: d.transport.toUpperCase() }), h('span', { class: 'grow' }, h('b', { text: d.name }), h('small', { text: d.opened ? t('devices.opened') : t('devices.closed') })), toggleOpen); }));
  }
  choose.onclick = () => void p.act(choose, 'devices.choose', async () => { const v = await wait(devices.choose(transport)); await load(); return v; });
  p.body.append(card(t('devices.title'), t('devices.hint'), h('div', { class: 'kit-row' }, segmented([{ value: 'serial', label: t('devices.serial') }, { value: 'hid', label: 'HID' }, { value: 'ble', label: t('devices.ble') }] as { value: typeof transport; label: string }[], transport, v => { transport = v; }), h('span', { class: 'grow' }), choose), none, list));
  if (p.granted()) await load().catch(() => {});
}

// ── Accessibility ──
export async function mountAccessibility() {
  const p = await base('accessibility', { wide: true, system: authorization(() => accessibility.status()), requestSystem: () => wait(accessibility.request()) });
  const groups = h('div', { class: 'ax-groups', testid: 'drive.accessibility.windows' });
  const selected = h('div', { class: 'clip-content', testid: 'drive.accessibility.selection' }, empty(t('ax.no_selection'), 'accessibility'));
  const scan = h('button', { class: 'primary', testid: 'drive.accessibility.scan' }, icon('refresh'), t('ax.scan'));
  scan.onclick = () => void p.act(scan, 'accessibility.windows', async () => {
    const windows = await wait<{ id: string; title: string; application: string }[]>(accessibility.windows());
    const apps = new Map<string, typeof windows>();
    for (const w of windows) apps.set(w.application, [...(apps.get(w.application) ?? []), w]);
    groups.replaceChildren(...[...apps].map(([app, list]) => h('div', { class: 'ax-app' }, h('b', { text: app || '—' }), h('ul', { class: 'kit-list' }, ...list.map(w => {
      const read = h('button', { class: 'ghost' }, t('ax.read'));
      read.onclick = () => void p.act(read, 'accessibility.selected_text', async () => {
        await wait(accessibility.focus(w.id));
        const result = await wait<{ id: string; text: string }>(accessibility.selectedText(w.id));
        selected.replaceChildren(result.text ? h('pre', { text: result.text }) : empty(t('ax.empty'), 'accessibility'), h('small', { text: app + ' · ' + (w.title || '—') }));
        return result;
      });
      return h('li', {}, h('span', { class: 'grow' }, h('b', { text: w.title || t('ax.untitled') })), read);
    })))));
    if (!windows.length) groups.append(empty(t('ax.no_windows'), 'app_windows'));
    return { windows: windows.length };
  });
  p.body.append(h('div', { class: 'kit-grid split' }, card(t('ax.windows'), t('ax.windows_hint'), h('div', { class: 'kit-row end' }, scan), groups), card(t('ax.selection'), t('ax.selection_hint'), selected)));
}

// ── Window management ──
export async function mountWindowManagement() {
  const p = await base('window_management', { wide: true, system: authorization(() => windowManagement.status()), requestSystem: () => wait(windowManagement.request()) });
  const screens = h('ul', { class: 'kit-list', testid: 'drive.window_management.screens' });
  const target = h('div', { class: 'clip-content', testid: 'drive.window_management.window' }, empty(t('wm.no_window'), 'window_management'));
  const list = h('button', { class: 'primary', testid: 'drive.window_management.screens.read' }, icon('refresh'), t('wm.screens_read'));
  list.onclick = () => void p.act(list, 'window_management.screens', async () => {
    const all = await wait<{ name: string; primary: boolean; frame: { x: number; y: number; width: number; height: number } }[]>(windowManagement.screens());
    screens.replaceChildren(...all.map(s => h('li', {}, h('span', { class: 'grow' }, h('b', { text: s.name + (s.primary ? ' ★' : '') })), h('small', { text: `${s.frame.width}×${s.frame.height} @ ${s.frame.x}, ${s.frame.y}` }))));
    return { screens: all.length };
  });
  // Clicking here makes Medeo frontmost, and Medeo is never a target: give the user time to switch.
  const read = h('button', { class: 'primary', testid: 'drive.window_management.focused' }, t('wm.read_later'));
  read.onclick = () => void p.act(read, 'window_management.focused', async () => {
    await new Promise(r => setTimeout(r, 3000));
    const w = await wait<{ id: string; title: string; application: string; frame: { x: number; y: number; width: number; height: number } } | null>(windowManagement.focused());
    if (!w) { target.replaceChildren(empty(t('wm.no_window'), 'window_management')); return null; }
    // Nudge it and put it back, so the move is visible but leaves nothing changed.
    const moved = await wait<{ frame: typeof w.frame }>(windowManagement.setFrame(w.id, { ...w.frame, x: w.frame.x + 40 }));
    await new Promise(r => setTimeout(r, 600));
    const back = await wait<{ frame: typeof w.frame }>(windowManagement.setFrame(w.id, w.frame));
    target.replaceChildren(h('pre', { text: JSON.stringify({ application: w.application, title: w.title, frame: w.frame, nudged: moved.frame, restored: back.frame }, null, 2) }));
    return { moved: moved.frame.x - w.frame.x, restored: back.frame.x === w.frame.x };
  });
  p.body.append(h('div', { class: 'kit-grid split' }, card(t('wm.screens'), t('wm.screens_hint'), h('div', { class: 'kit-row end' }, list), screens), card(t('wm.window'), t('wm.window_hint'), h('div', { class: 'kit-row end' }, read), target)));
}

// ── Creation ──
export async function mountCreation() {
  const p = await base('creation_open');
  const open = h('button', { class: 'primary big', testid: 'drive.creation.open' }, icon('creation_open'), t('creation.open'));
  open.onclick = () => void p.act(open, 'creation.open', () => creation.open(), () => t('creation.opened'));
  p.body.append(h('section', { class: 'kit-card hero' }, h('div', { class: 'hero-art' }, icon('creation_open', 48)), h('h2', { text: t('creation.title') }), h('p', { text: t('creation.hint') }), open));
}

// ── Full file access ──
export async function mountFullAccess() {
  const p = await base('file_full_access', { wide: true });
  const choose = h('button', { class: 'primary', testid: 'drive.full.choose' }, icon('file_full_access'), t('full.choose'));
  const rootSelect = h('select', { testid: 'drive.full.root' });
  const listing = h('ul', { class: 'kit-list', testid: 'drive.full.entries' });
  const log = timeline(t('full.no_moves'), 'drive.full.log');
  async function roots() {
    const list = await files.result(await files.roots());
    rootSelect.replaceChildren(...list.filter(r => r.id).map(r => h('option', { value: r.id!, text: r.name + (r.available ? '' : ' ✕') })));
    if (rootSelect.value) await show();
    else listing.replaceChildren(h('li', { class: 'plain' }, empty(t('full.no_root'), 'file_full_access')));
  }
  async function show() {
    const root = rootSelect.value;
    const entries = await p.act(null, 'files.list', async () => files.result(await files.list(root)));
    if (!entries) return;
    listing.replaceChildren(...(entries.length ? entries.slice(0, 200).map((entry: FileEntry) => {
      const trash = h('button', { class: 'ghost danger', disabled: entry.kind === 'blocked' }, icon('trash'), t('full.trash'));
      // Full access moves without a Host confirmation, so the tab asks twice itself.
      let armed = false;
      trash.onclick = () => {
        if (!armed) { armed = true; trash.replaceChildren(icon('trash'), t('full.confirm')); setTimeout(() => { armed = false; trash.replaceChildren(icon('trash'), t('full.trash')); }, 3000); return; }
        void p.act(trash, 'files.trash_direct', async () => {
        type Stamp = { revision: string; digest: string; bytes: number; count: number };
        const stamp = await operations.wait<Stamp>(await capabilities.invoke<{ id: string; status: string }>('files.measure', { root, path: entry.path }));
        const [result] = await files.result(await files.trashDirect([{ root, path: entry.path, stamp: { revision: stamp.revision, digest: stamp.digest, bytes: stamp.bytes, count: stamp.count } }]));
        log.add(result.error ? t('full.failed', { name: entry.name }) : t('full.moved', { name: entry.name }), result.error ? explain(result.error) : bytes(stamp.bytes), result.error ? 'error' : 'ok');
        await show(); return result;
        });
      };
      return h('li', {}, icon(entry.kind === 'directory' ? 'file_access' : 'copy', 18), h('span', { class: 'grow' }, h('b', { text: entry.name }), h('small', { text: entry.kind === 'directory' ? t('full.folder') : bytes(entry.size) })), trash);
    }) : [h('li', { class: 'plain' }, empty(t('full.empty_folder'), 'file_access'))]));
  }
  choose.onclick = () => void p.act(choose, 'resources.choose_directories', async () => { const v = await resources.chooseDirectories({ full: true }); await roots(); return v; });
  rootSelect.onchange = () => void show();
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('full.title'), t('full.hint'), h('div', { class: 'kit-row' }, h('div', { class: 'grow' }, rootSelect), choose), listing),
    card(t('full.log'), t('full.log_hint'), log.root)));
  if (p.granted()) await roots().catch(() => {});
}

// ── Network ──
export async function mountNetwork() {
  const p = await base('network', { wide: true });
  const labels = await capabilities.labels();
  let method = 'GET' as 'GET' | 'POST';
  const url = h('input', { type: 'url', value: 'http://127.0.0.1:8765/health', class: 'kit-mono', testid: 'drive.network.url' });
  const body = h('textarea', { rows: 3, class: 'kit-mono', placeholder: '{"hello":"medeo"}' });
  const send = h('button', { class: 'primary', testid: 'drive.network.send' }, icon('network'), t('network.send'));
  const status = h('div', { class: 'kit-row' }), headers = h('div', { class: 'kit-mono net-headers' }), response = h('pre', { class: 'terminal', testid: 'drive.network.response' });
  send.onclick = () => void p.act(send, 'network.request', async () => {
    const started = Date.now();
    const job = await network.request({ url: url.value.trim(), method, ...(method === 'POST' && body.value ? { body: body.value, headers: { 'content-type': 'application/json' } } : {}), timeout_ms: 10000 });
    const done = await network.settled(job.id);
    try {
      if (done.status !== 'completed') throw Error(done.error ?? done.status);
      const text = await network.text(job.id);
      status.replaceChildren(pill(String(done.http_status), (done.http_status ?? 0) < 400 ? 'ok' : 'error'), h('small', { text: (Date.now() - started) + ' ms · ' + bytes(done.received ?? text.length) }));
      headers.replaceChildren(...(done.headers ?? []).slice(0, 12).map(([k, v]) => h('div', {}, h('b', { text: k + ': ' }), v)));
      try { response.textContent = JSON.stringify(JSON.parse(text), null, 2); } catch { response.textContent = text.slice(0, 20000); }
      return { status: done.http_status, bytes: done.received };
    } finally { await network.release(job.id).catch(() => {}); }
  });
  const origins = h('div', {});
  p.body.append(h('div', { class: 'kit-grid split' },
    card(t('network.title'), t('network.hint'), h('div', { class: 'kit-row' }, segmented([{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }] as { value: typeof method; label: string }[], method, v => { method = v; body.hidden = v !== 'POST'; }), h('div', { class: 'grow' }, url)), body, h('div', { class: 'kit-row end' }, send), status, headers, response),
    card(t('network.origins'), t('network.origins_hint'), origins)));
  body.hidden = true;
  await mountNetworkOrigins(origins, labels).catch(error => origins.append(h('p', { class: 'kit-note', text: explain(error) })));
}
