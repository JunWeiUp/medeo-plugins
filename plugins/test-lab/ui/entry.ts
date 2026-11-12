import { capabilities, commands, i18n } from '@medeo-plugin/sdk';
import cases from '../cases.json';
import { mount, type Case } from '../src/entry';
import { icon } from '../src/icons';
import { loadCopy, t as copy, unsupported } from '../src/kit';
import { mountMedia } from '../src/media';
import { mountAccessibility, mountWindowManagement, mountApprovals, mountCalendar, mountContacts, mountCreation, mountDevices, mountFullAccess, mountLocation, mountNetwork, mountPrinting, mountProcess, mountStorage, mountSystemInfo } from '../src/data';
import { mountBackground, mountBrowser, mountClipboard, mountExternal, mountNotifications, mountPower, mountShortcuts, mountTray, mountWindows } from '../src/desktop';
import { mountChat } from '../src/chat';
import { mountInputMethod } from '../src/ime';
import { mountLauncher } from '../src/launcher';
import { mountRecorder } from '../src/recorder';
import { mountSecrets } from '../src/secrets';
import { mountLocalServer } from '../src/server';
import { mountWorkspace } from '../src/workspace';

// Every permission has its own page from the permissions example; the generic method panel stays for the single-permission packages.
const DEDICATED: Record<string, () => Promise<void>> = {
  accessibility: () => mountAccessibility(),
  window_management: () => mountWindowManagement(),
  agent_api: () => mountChat(),
  approvals: () => mountApprovals(),
  calendar: () => mountCalendar(),
  contacts: () => mountContacts(),
  creation_open: () => mountCreation(),
  device_access: () => mountDevices(),
  file_full_access: () => mountFullAccess(),
  location: () => mountLocation(),
  network: () => mountNetwork(),
  printing: () => mountPrinting(),
  process_spawn: () => mountProcess(),
  storage: () => mountStorage(),
  system_info: () => mountSystemInfo(),
  app_windows: () => mountWindows(),
  background_tasks: () => mountBackground(),
  browser_view: () => mountBrowser(),
  clipboard_read: () => mountClipboard('read'),
  clipboard_write: () => mountClipboard('write'),
  external_open: () => mountExternal(),
  global_shortcuts: () => mountShortcuts(),
  notifications: () => mountNotifications(),
  power: () => mountPower(),
  tray: () => mountTray(),
  camera: () => mountMedia('camera'),
  microphone: () => mountMedia('microphone'),
  system_audio: () => mountMedia('system_audio'),
  applications: () => mountLauncher(true),
  file_access: () => mountWorkspace(),
  input_method: () => mountInputMethod(),
  local_server: () => mountLocalServer(),
  screen_capture: () => mountRecorder(),
  secrets: () => mountSecrets(),
};
const all = (cases as Case[]).filter(c => c.permission !== 'node');
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
// Plugin windows cannot navigate or reload, so a tab swaps in a fresh <main>. Leaving one
// sends the modules the `pagehide` they already stop their polling on.
const go = (permission: string) => { location.hash = permission; };
let inTab = false;
function fresh() {
  if (inTab) window.dispatchEvent(new PageTransitionEvent('pagehide'));
  const main = document.createElement('main');
  document.querySelector('main')!.replaceWith(main);
  document.querySelector<HTMLElement>('.lab-bar')!.hidden = true;
  document.body.setAttribute('aria-busy', 'true');
  return main;
}

const GROUPS = ['media', 'desktop', 'data', 'services', 'personal', 'runtime', 'hardware', 'medeo'];
interface Report { passed: boolean; checks: { name: string; ok: boolean; error?: string }[] }

async function hub() {
  const [state, labels, catalog] = await Promise.all([i18n.state(), capabilities.labels(), capabilities.list(), loadCopy()]);
  const t = (key: string) => i18n.t(key);
  const main = fresh(); main.className = 'lab'; inTab = false;
  document.documentElement.lang = state.catalog_locale ?? state.locale; document.title = state.name;
  const header = el('header'), logo = el('img'), text = el('div'), run = el('button', await t('lab.selftest'), 'primary');
  logo.src = '../icon.svg'; logo.alt = '';
  text.append(el('h1', state.name), el('p', await t('lab.subtitle'))); run.dataset.testid = 'drive.lab.selftest';
  const summary = el('div', undefined, 'lab-summary'), raw = el('details'), result = el('pre');
  raw.append(el('summary', await t('lab.details')), result); summary.hidden = true; summary.dataset.testid = 'drive.lab.summary';
  result.dataset.testid = 'drive.lab.result';
  run.onclick = async () => {
    run.disabled = true; summary.hidden = false; summary.className = 'lab-summary'; summary.replaceChildren(el('b', await t('lab.running')));
    try {
      const report = await commands.run('lab.selftest') as Report;
      result.textContent = JSON.stringify(report, null, 2); result.dataset.outcome = report.passed ? 'passed' : 'failed';
      const ok = report.checks.filter(c => c.ok).length;
      summary.className = 'lab-summary ' + (report.passed ? 'ok' : 'error');
      summary.replaceChildren(el('b', (await t(report.passed ? 'lab.passed' : 'lab.failed_checks')) + ' · ' + ok + ' / ' + report.checks.length), ...report.checks.filter(c => !c.ok).map(c => el('small', c.name + ' — ' + (c.error ?? ''))), raw);
    } catch (error) { result.textContent = String(error); result.dataset.outcome = 'failed'; summary.className = 'lab-summary error'; summary.replaceChildren(el('b', String(error)), raw); }
    finally { run.disabled = false; }
  };
  header.append(logo, text, run);
  const [granted, missing, placeholder] = await Promise.all([t('lab.granted'), t('lab.missing'), t('lab.search')]);
  const search = el('input'); search.type = 'search'; search.placeholder = placeholder; search.dataset.testid = 'drive.lab.search';
  const count = catalog.filter(c => c.granted && all.some(s => s.permission === c.permission)).length;
  const toolbar = el('div', undefined, 'lab-toolbar'); toolbar.append(search, el('small', count + ' / ' + all.length + ' ' + granted));
  const groups = el('div', undefined, 'lab-groups');
  const cards: { card: HTMLElement; text: string }[] = [];
  for (const group of GROUPS) {
    const specs = all.filter(spec => (catalog.find(c => c.permission === spec.permission)?.group ?? 'runtime') === group);
    if (!specs.length) continue;
    const section = el('section'), grid = el('div', undefined, 'lab-grid');
    section.append(el('h2', await t('lab.group.' + group)), grid);
    for (const spec of specs) {
      const descriptor = catalog.find(c => c.permission === spec.permission);
      const ok = !!descriptor?.granted, absent = unsupported(descriptor);
      const name = labels[spec.permission] ?? spec.title, intro = copy(spec.permission + '.intro');
      const card = el('button'); card.dataset.testid = `drive.lab.tab.${spec.permission}`;
      const tile = el('span', undefined, 'lab-tile'); tile.append(icon(spec.permission));
      const words = el('span', undefined, 'lab-words'); words.append(el('b', name), el('small', intro));
      if (absent) card.classList.add('unsupported');
      card.append(tile, words, absent ? el('i', copy('lab.unsupported'), 'unsupported') : el('i', ok ? granted : missing, ok ? 'ok' : 'missing'));
      card.onclick = () => go(spec.permission);
      grid.append(card); cards.push({ card, text: (name + ' ' + intro + ' ' + spec.permission).toLowerCase() });
    }
    groups.append(section);
  }
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    for (const c of cards) c.card.hidden = !!q && !c.text.includes(q);
    for (const section of groups.children) (section as HTMLElement).hidden = ![...section.querySelectorAll('.lab-grid button')].some(b => !(b as HTMLElement).hidden);
  };
  main.append(header, summary, toolbar, groups);
  document.body.setAttribute('aria-busy', 'false');
}

async function tab(permission: string) {
  const spec = all.find(c => c.permission === permission);
  if (!spec) return go('');
  fresh(); inTab = true;
  const bar = document.querySelector<HTMLElement>('.lab-bar')!, back = bar.querySelector('button')!;
  back.textContent = '← ' + await i18n.t('lab.back'); back.onclick = () => go('');
  bar.querySelector('span')!.textContent = spec.permission; bar.hidden = false;
  await (DEDICATED[permission] ?? (() => mount(spec)))();
}

function show() {
  const permission = decodeURIComponent(location.hash.slice(1));
  void (permission ? tab(permission) : hub()).catch(error => { document.querySelector('main')!.textContent = String(error); document.body.setAttribute('aria-busy', 'false'); });
}
// `ui/secondary.html` (opened from the windows tab) loads this same script.
if (location.pathname.endsWith('/secondary.html')) void secondary();
else { window.addEventListener('hashchange', show); show(); }

async function secondary() {
  await loadCopy();
  const main = document.querySelector('main')!; main.className = 'lab-secondary';
  const now = el('b'), tick = () => { now.textContent = new Date().toLocaleTimeString(); };
  main.append(icon('app_windows'), el('h1', document.title), el('p', copy('windows.secondary')), now);
  tick(); setInterval(tick, 1000);
  document.body.setAttribute('aria-busy', 'false');
}
