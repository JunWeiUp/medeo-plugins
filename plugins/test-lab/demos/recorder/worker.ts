import { definePlugin } from '@medeo-plugin/sdk';
// Recording is driven from the window; the Host keeps a recording going if it closes.
export const { activate, deactivate } = definePlugin({ activate() {} });
