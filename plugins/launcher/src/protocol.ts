// Messages between the worker (shortcut, panel) and the panel page.
export type FromWorker = { type: 'shown' };
export type ToWorker = { type: 'hide' };
export const PANEL = 'panel';
