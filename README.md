# Medeo Plugins

[简体中文](README.zh-CN.md)

Source for the Medeo desktop plugins. Each plugin lives in `plugins/<name>/` and builds with the public
[`@medeo-plugin/sdk`](https://www.npmjs.com/package/@medeo-plugin/sdk) and
[`@medeo-plugin/cli`](https://www.npmjs.com/package/@medeo-plugin/cli).

| Plugin | ID | Runtime | What it does |
|---|---|---|---|
| [Clipboard](plugins/clipboard) | `app.medeo.clipboard` | node | Clipboard history for text, rich text, images and files |
| [Launcher](plugins/launcher) | `app.medeo.launcher` | sandbox | ⌥Space search box: apps, calculator, conversions, plugin commands |
| [Mac Cleaner](plugins/mac-cleaner) | `app.medeo.mac-cleaner` | node | Finds caches, logs and leftovers; moves only what you choose to the Trash |
| [Screenshot](plugins/screenshot) | `app.medeo.screenshot` | node | Capture part of the screen and annotate it in place |
| [Window Ring](plugins/window-ring) | `app.medeo.window-ring` | sandbox | Move and resize windows with a ring or keyboard shortcuts |
| [Test Lab](plugins/test-lab) | `app.medeo.test-lab` | sandbox | One tab per permission, for trying every plugin capability |

## Development

Requires Node.js 22.18+ (tests import TypeScript directly).

```bash
npm install
npm run typecheck
npm test
npm run pack                       # all plugins → dist/, signed with a throwaway key
npm run pack -- launcher           # one plugin
npm run pack -- --key /path/outside/repo/key.pem
npx medeo-plugin dev plugins/launcher   # rebuild on change and load into a running Medeo
```

Never commit signing keys. Packages signed with a different key than the installed copy are
treated as a different publisher.

Official signed releases are currently still published from the Medeo plugin SDK release pipeline.

## License

MIT
