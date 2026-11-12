// Paths a clean never touches, whatever a rule or a project scan produced.
// Both the spelling as given and the real path are checked: removal acts on the
// real path (/var → /private/var), and a symlinked parent must not lead around the list.
import { realpathSync } from 'node:fs';

const EXACT = ['/', '/System', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/Library', '/Library/Apple', '/Applications'];
const PREFIXES = ['/System/', '/usr/', '/bin/', '/sbin/', '/etc/', '/private/etc/', '/Library/Apple/', '/System/Volumes/Data/System/', '/private/var/db/', '/var/db/'];

function spellingProtected(raw: string, home: string): boolean {
  let path = raw;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!path.startsWith('/')) return true;
  if (EXACT.includes(path) || path === home) return true;
  if (PREFIXES.some(prefix => path.startsWith(prefix))) return true;
  // The keychain, and the Trash as a container: emptying it removes its children, never the folder.
  if (path === `${home}/Library/Keychains` || path.startsWith(`${home}/Library/Keychains/`) || path === `${home}/.Trash`) return true;
  // Medeo's own data, caches and preferences: removing them under a running Medeo breaks it.
  if (path.split('/').some(part => part.startsWith('app.medeo.'))) return true;
  return false;
}
export function isProtected(path: string, home: string): boolean {
  if (spellingProtected(path, home)) return true;
  let real: string;
  try { real = realpathSync(path); } catch { return false; }
  return real !== path && spellingProtected(real, home);
}
