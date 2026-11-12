// Which list an item belongs to; shared by the worker and the window (no Node imports here).
/** Mackit's two scopes: the developer list (scanned on open) and the junk cleanup (scanned on request). */
export type Scope = 'developer' | 'general';
export const GENERAL_CATEGORIES = ['system', 'appJunk', 'language', 'downloads', 'browser', 'trash'];
export const scopeOf = (category: string): Scope => (GENERAL_CATEGORIES.includes(category) ? 'general' : 'developer');
