import { definePlugin } from '@medeo-plugin/sdk';
// The launcher lives in its window; the background entry has no commands.
export const { activate, deactivate } = definePlugin({ activate() {} });
