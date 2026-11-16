// Netdisk does everything in its window; the worker only has to exist.
import { definePlugin } from '@medeo-plugin/sdk';
export const { activate, deactivate } = definePlugin({ activate() {} });
