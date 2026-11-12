import { definePlugin } from '@medeo-plugin/sdk';
import { startInputProvider } from '../../src/ime-worker';
// Resident (onStartup): the provider answers compositions while Medeo runs.
export const { activate, deactivate } = definePlugin({ activate(context) { context.subscriptions.push(startInputProvider(true)); } });
