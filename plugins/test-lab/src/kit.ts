// Shared building blocks for the dedicated permission tabs: a page with the
// permission's header and authorization, cards, buttons, a toast, an event
// timeline and the raw call log. Copy is Test Lab's own `locales/`.
import css from './kit.css';
import { useStyle } from './style';
import { icon } from './icons';
import en from '../locales/en.json';
import zh from '../locales/zh-CN.json';
import { capabilities, i18n, permissions } from '@medeo-plugin/sdk';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; testid?: string; text?: string };
/** `h('button', {class:'primary', testid:'drive.x.y', onclick}, 'Label')`. Unknown props become attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'testid') node.dataset.testid = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') (node as unknown as Record<string, unknown>)[key] = value;
    else if (key === 'value' || (key in node && typeof value !== 'string')) (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(typeof child === 'number' ? String(child) : child);
  return node;
}

let table: Record<string, string> = en;
let language = 'en';
/** Medeo for Windows: the tray lives in the notification area, settings are Windows Settings. */
export const windows = /Windows/.test(navigator.userAgent);
/** On Windows a `win.<key>` entry replaces `<key>`. */
const forPlatform = (catalog: Record<string, string>) => windows
  ? { ...catalog, ...Object.fromEntries(Object.entries(catalog).filter(([k]) => k.startsWith('win.')).map(([k, v]) => [k.slice(4), v])) }
  : catalog;
/** Picks this example's catalog for the app language. */
export async function loadCopy() {
  const state = await i18n.state();
  language = (state.locale || 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  table = forPlatform(language === 'zh-CN' ? { ...en, ...zh } : en);
  return language;
}
/** The permission has methods, but this platform offers none of them. */
export const unsupported = (d: { methods: string[]; available_methods: string[] } | undefined) => !!d && d.methods.length > 0 && d.available_methods.length === 0;
export const t = (key: string, vars: Record<string, string | number> = {}) => (table[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
export const lang = () => language;
/** Host error codes in words; unknown codes stay readable as they are. */
export function explain(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error).replace(/^Error:\s*/, '');
  const code = raw.trim();
  return table['error.' + code] ? t('error.' + code) : code.slice(0, 240);
}
export const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const bytes = (n: number) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
export const time = (ms: number) => new Date(ms).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const css$ = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function pill(text: string, tone: 'ok' | 'warn' | 'error' | 'info' | 'live' = 'info', testid?: string) {
  return h('span', { class: 'kit-pill ' + tone, testid }, h('i'), text);
}
export function card(title: string, subtitle?: string, ...children: Child[]) {
  return h('section', { class: 'kit-card' }, h('div', { class: 'kit-card-head' }, h('h2', { text: title }), subtitle ? h('p', { text: subtitle }) : null), ...children);
}
export function field(label: string, control: HTMLElement, hint?: string) {
  return h('label', { class: 'kit-field' }, h('span', { text: label }), control, hint ? h('small', { text: hint }) : null);
}
export function segmented<T extends string | number>(options: { value: T; label: string }[], value: T, onChange: (value: T) => void, testid?: string) {
  const root = h('div', { class: 'kit-segmented', role: 'radiogroup', testid });
  const buttons = options.map(o => {
    const b = h('button', { type: 'button', role: 'radio', text: o.label, 'aria-checked': String(o.value === value) });
    b.onclick = () => { for (const x of buttons) x.setAttribute('aria-checked', String(x === b)); onChange(o.value); };
    return b;
  });
  root.append(...buttons);
  return Object.assign(root, { set disabled(v: boolean) { for (const b of buttons) b.disabled = v; } });
}
export function toggle(label: string, checked: boolean, onChange: (checked: boolean) => void, testid?: string) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, testid });
  input.onchange = () => onChange(input.checked);
  return Object.assign(h('label', { class: 'kit-toggle' }, input, h('span', { class: 'kit-switch' }), h('span', { text: label })), { input });
}
export function empty(text: string, glyph = 'inbox') {
  return h('div', { class: 'kit-empty' }, icon(glyph), h('p', { text }));
}
/** A newest-first list of events with a short highlight as each arrives. */
export function timeline(emptyText: string, testid?: string) {
  const list = h('ol', { class: 'kit-timeline', testid });
  const placeholder = empty(emptyText, 'activity');
  const root = h('div', {}, placeholder, list);
  let count = 0;
  return {
    root,
    get count() { return count; },
    add(title: string, detail = '', tone: 'ok' | 'error' | 'info' = 'info') {
      count++; placeholder.hidden = true;
      const row = h('li', { class: 'fresh ' + tone }, h('i'), h('div', {}, h('b', { text: title }), detail ? h('small', { text: detail }) : null), h('time', { text: time(Date.now()) }));
      list.prepend(row);
      setTimeout(() => row.classList.remove('fresh'), 1200);
      while (list.children.length > 40) list.lastElementChild!.remove();
    },
    clear() { list.replaceChildren(); count = 0; placeholder.hidden = false; },
  };
}

export interface PageOptions {
  /** The OS-level authorization next to Medeo's (camera, contacts…). */
  system?: () => Promise<string>;
  /** Asks the OS for that authorization. */
  requestSystem?: () => Promise<unknown>;
  wide?: boolean;
}
export interface Page {
  main: HTMLElement; body: HTMLElement;
  granted(): boolean;
  refresh(): Promise<boolean>;
  /** Asks for the permission first when it is not granted yet. */
  ensure(): Promise<boolean>;
  toast(text: string, tone?: 'ok' | 'error' | 'info'): void;
  /** Runs `fn` with the button busy; failures become a toast and the raw log. */
  act<T>(button: HTMLButtonElement | null, method: string, fn: () => Promise<T>, success?: (value: T) => string | void): Promise<T | undefined>;
  raw(method: string, value: unknown, failed?: boolean): void;
  every(ms: number, fn: () => unknown): void;
  onLeave(fn: () => void): void;
  readonly left: boolean;
  systemState(): Promise<string | undefined>;
}

/** Mounts a dedicated tab into `<main>`: header with authorization, body, raw log and toast. */
export async function page(permission: string, options: PageOptions = {}): Promise<Page> {
  useStyle(css);
  await loadCopy();
  const labels = await capabilities.labels();
  const main = document.querySelector('main')!;
  main.className = 'kit' + (options.wide ? ' wide' : '');
  main.replaceChildren();
  document.title = labels[permission] ?? permission;
  const status = h('span', { class: 'kit-pill', testid: 'drive.permission.status' });
  const authorize = h('button', { class: 'primary', testid: 'drive.permission.authorize', text: t('kit.authorize') });
  const systemPill = h('span', { class: 'kit-pill', testid: 'drive.permission.system' });
  const systemButton = h('button', { text: t('kit.system_request'), testid: 'drive.permission.system_request' });
  const systemRow = h('div', { class: 'kit-system', hidden: true }, h('span', { text: t('kit.system') }), systemPill, systemButton);
  const unavailable = h('div', { class: 'kit-system kit-unsupported', hidden: true, testid: 'drive.permission.unsupported' }, h('span', { text: t('kit.unsupported_note') }));
  const header = h('header', { class: 'kit-head' },
    h('div', { class: 'kit-icon' }, icon(permission)),
    h('div', { class: 'kit-title' }, h('small', { text: t('kit.eyebrow') }), h('h1', { text: labels[permission] ?? permission }), h('p', { text: t(permission + '.intro') })),
    h('div', { class: 'kit-auth' }, status, authorize));
  const body = h('div', { class: 'kit-body' });
  const log = h('pre', { testid: 'drive.permission.result' });
  const raw = h('details', { class: 'kit-raw' }, h('summary', { text: t('kit.raw') }), log);
  const toastNode = h('div', { class: 'kit-toast', role: 'status', 'aria-live': 'polite', testid: 'drive.permission.toast' });
  main.append(header, unavailable, systemRow, body, raw, toastNode);

  let granted = false, left = false, toastTimer = 0;
  const leave: (() => void)[] = [];
  window.addEventListener('pagehide', () => { left = true; for (const fn of leave) try { fn(); } catch { /* already gone */ } }, { once: true });

  const self: Page = {
    main, body,
    granted: () => granted,
    get left() { return left; },
    async refresh() {
      const descriptor = (await capabilities.list()).find(d => d.permission === permission);
      granted = !!descriptor?.granted;
      // Not provided on this OS: say so instead of "Authorized"; granting would change nothing.
      const missing = unsupported(descriptor);
      status.className = 'kit-pill ' + (missing ? 'info' : granted ? 'ok' : 'warn');
      status.replaceChildren(h('i'), missing ? t('kit.unsupported') : granted ? t('kit.granted') : t('kit.missing'));
      authorize.hidden = granted || missing;
      unavailable.hidden = !missing;
      return granted;
    },
    async ensure() {
      if (granted || await self.refresh()) return true;
      const answer = await permissions.request(permission, document.title);
      self.raw('permissions.request', answer);
      await self.refresh();
      if (!granted) self.toast(t('kit.denied'), 'error');
      return granted;
    },
    toast(text, tone = 'info') {
      toastNode.textContent = text; toastNode.className = 'kit-toast show ' + tone;
      clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toastNode.className = 'kit-toast ' + tone; }, 3200);
    },
    raw(method, value, failed = false) {
      log.textContent = method + (failed ? '  ✕' : '  ✓') + '\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null');
      log.dataset.outcome = failed ? 'failed' : 'passed';
    },
    async act(button, method, fn, success) {
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      try {
        if (!await self.ensure()) return undefined;
        const value = await fn();
        self.raw(method, value);
        const message = success?.(value);
        if (message) self.toast(message, 'ok');
        return value;
      } catch (error) {
        self.raw(method, String(error), true);
        self.toast(explain(error), 'error');
        return undefined;
      } finally {
        if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
      }
    },
    every(ms, fn) {
      const run = async () => { if (left) return; try { await fn(); } catch { /* the next tick retries */ } finally { if (!left) setTimeout(() => void run(), ms); } };
      void run();
    },
    onLeave(fn) { leave.push(fn); },
    async systemState() {
      if (!options.system || !granted) { systemRow.hidden = true; return undefined; }
      try {
        const state = await options.system();
        systemRow.hidden = false;
        const ok = state === 'granted';
        systemPill.className = 'kit-pill ' + (ok ? 'ok' : state === 'not_determined' ? 'info' : 'warn');
        systemPill.replaceChildren(h('i'), t('kit.os.' + state));
        systemButton.hidden = ok || !options.requestSystem;
        return state;
      } catch (error) { self.raw('status', String(error), true); return undefined; }
    },
  };
  authorize.onclick = () => void self.act(authorize, 'permissions.request', async () => { await self.ensure(); await self.systemState(); return granted; }, ok => ok ? t('kit.now_granted') : undefined);
  systemButton.onclick = () => void self.act(systemButton, 'system.request', async () => { await options.requestSystem?.(); return self.systemState(); });
  await self.refresh();
  await self.systemState();
  document.body.setAttribute('aria-busy', 'false');
  return self;
}
