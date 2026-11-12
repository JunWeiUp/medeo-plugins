// What the panel can show, built only from Medeo Launcher Protocol data (plugins.commands and
// launcher.search). Nothing here knows any particular plugin. Pure, no IO.
import type { InstalledPluginCommands, LauncherArgumentInfo, LauncherDataType, LauncherItem, LauncherTone } from '@medeo-plugin/sdk';

export type Kind = 'answer' | 'app' | 'command' | 'option' | 'open' | 'result' | 'center';
export interface Entry {
  key: string;
  kind: Kind;
  title: string;
  subtitle: string;
  keywords: string[];
  /** The plugin it belongs to (not for apps and answers). */
  plugin?: string;
  pluginName?: string;
  pluginIcon?: string | null;
  /** An image (`data:` URL) or a symbol for the row. */
  image?: string | null;
  symbol?: string;
  accessory?: { text: string; tone: LauncherTone };
  /** command / option: what runs, with the arguments already chosen and those still to ask. */
  command?: string;
  args?: Record<string, string | number | boolean>;
  needs?: LauncherArgumentInfo[];
  pinnable?: boolean;
  /** app */
  appId?: string;
  appPath?: string;
  /** result: the provider's own item. */
  item?: LauncherItem;
  /** What the row carries, for "send to…". */
  data?: { type: LauncherDataType; value: string; title: string };
  /** answer */
  copy?: string;
}
export interface SendTarget { plugin: string; pluginName: string; pluginIcon: string | null; command: string; title: string }
export interface Pin { key: string; plugin: string; command: string; args: Record<string, string | number | boolean>; title: string; subtitle: string }

const imageOf = (icon: LauncherItem['icon']) => icon && 'data' in icon ? icon.data : null;

/** Every plugin's window, commands and expanded options. */
export function catalogEntries(plugins: InstalledPluginCommands[], openLabel: string): Entry[] {
  return plugins.flatMap(p => {
    const base = { plugin: p.id, pluginName: p.name, pluginIcon: p.icon };
    const info = new Map((p.launcher?.commands ?? []).map(c => [c.command, c]));
    const out: Entry[] = [];
    if (p.has_ui) out.push({ ...base, key: `open:${p.id}`, kind: 'open', title: `${openLabel} ${p.name}`, subtitle: p.name, keywords: [p.name, p.id, ...(p.launcher?.keyword ? [p.launcher.keyword] : [])], image: p.icon });
    for (const c of p.commands) {
      const l = info.get(c.id);
      const title = l?.title ?? c.title;
      const keywords = [p.name, c.id, ...(l?.keywords ?? [])];
      out.push({ ...base, key: `command:${p.id}:${c.id}`, kind: 'command', title, subtitle: l?.subtitle ? `${p.name} · ${l.subtitle}` : p.name, keywords,
        image: l?.icon ?? p.icon, command: c.id, args: {}, needs: l?.arguments ?? [], pinnable: !!l?.pinnable });
      const expand = l?.expand ? l.arguments.find(a => a.name === l.expand) : undefined;
      for (const o of expand?.options ?? []) {
        out.push({ ...base, key: `option:${p.id}:${c.id}:${o.value}`, kind: 'option', title: o.title, subtitle: `${p.name} · ${title}`,
          // Not the command id: searching for the command should find the command, not all its options.
          keywords: [p.name, ...(l?.keywords ?? []), ...o.keywords, title], image: o.icon ?? l?.icon ?? p.icon, command: c.id, args: { [expand!.name]: o.value },
          needs: l!.arguments.filter(a => a !== expand), pinnable: !!l?.pinnable });
      }
    }
    return out;
  });
}

/** Provider results as rows of their plugin. */
export function resultEntries(results: { plugin_id: string; items: LauncherItem[] }[], plugins: InstalledPluginCommands[]): Entry[] {
  const byId = new Map(plugins.map(p => [p.id, p]));
  return results.flatMap(r => {
    const p = byId.get(r.plugin_id);
    if (!p) return [];
    return r.items.map(item => ({
      key: `result:${p.id}:${item.id}`, kind: 'result' as const, title: item.title, subtitle: item.subtitle ?? p.name,
      keywords: item.keywords ?? [], plugin: p.id, pluginName: p.name, pluginIcon: p.icon,
      image: imageOf(item.icon), symbol: item.icon && 'symbol' in item.icon ? item.icon.symbol : undefined,
      accessory: item.accessory ? { text: item.accessory.text, tone: item.accessory.tone ?? 'default' } : undefined,
      item, data: item.type && item.data ? { type: item.type, value: item.data, title: item.title } : undefined,
    }));
  });
}

/** The plugin whose keyword the query is, so ⇥ can enter its scope. */
export function scopeFor(query: string, plugins: InstalledPluginCommands[]): InstalledPluginCommands | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return plugins.find(p => p.launcher?.keyword === q) ?? plugins.find(p => p.launcher && p.name.toLowerCase() === q);
}

/** Commands of other plugins that take this type of data ("send to…"). */
export function sendTargets(type: LauncherDataType, plugins: InstalledPluginCommands[], from?: string): SendTarget[] {
  return plugins.flatMap(p => p.id === from ? [] : (p.launcher?.commands ?? [])
    .filter(c => c.accepts.includes(type))
    .map(c => ({ plugin: p.id, pluginName: p.name, pluginIcon: p.icon, command: c.command, title: c.title })));
}

/** Pinned commands that still exist, drawn like their catalog rows. */
export function pinEntries(pins: Pin[], catalog: Entry[]): Entry[] {
  const byCommand = new Map(catalog.filter(e => e.kind === 'command').map(e => [`${e.plugin}:${e.command}`, e]));
  return pins.flatMap(pin => {
    const base = byCommand.get(`${pin.plugin}:${pin.command}`);
    if (!base) return [];
    const chosen = new Set(Object.keys(pin.args));
    return [{ ...base, key: pin.key, kind: 'command' as const, title: pin.title, subtitle: pin.subtitle, args: { ...pin.args }, needs: (base.needs ?? []).filter(a => !chosen.has(a.name)) }];
  });
}
export function pinFor(entry: Entry): Pin | null {
  if (!entry.pinnable || !entry.plugin || !entry.command) return null;
  return { key: `pin:${entry.plugin}:${entry.command}:${JSON.stringify(entry.args ?? {})}`, plugin: entry.plugin, command: entry.command, args: { ...(entry.args ?? {}) }, title: entry.title, subtitle: entry.subtitle };
}

/** The next argument still to ask, required ones first. */
export function nextArgument(entry: Entry): LauncherArgumentInfo | undefined {
  return (entry.needs ?? []).find(a => !a.optional) ?? undefined;
}
/** Turns typed text into an argument value; null when it does not fit. */
export function argumentValue(argument: LauncherArgumentInfo, text: string): string | number | boolean | null {
  const t = text.trim();
  switch (argument.type) {
    case 'string': return t ? t : null;
    case 'number': return t && Number.isFinite(Number(t)) ? Number(t) : null;
    case 'boolean': return /^(1|y|yes|true|on|是|开)$/i.test(t) ? true : /^(0|n|no|false|off|否|关)$/i.test(t) ? false : null;
    case 'enum': return argument.options.find(o => o.value === t || o.title === t)?.value ?? null;
  }
}
