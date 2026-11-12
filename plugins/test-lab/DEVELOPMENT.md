# Test Lab

One test case and one demo UI per permission. Medeo builds a signed single-permission
package from each case to verify grants, denial and revocation. Test Lab puts every
module in one plugin, one tab each; every permission has a dedicated page.

| Path | Contents |
| --- | --- |
| `cases.json` | One case per permission: the grant (with scopes) and the methods to call |
| `src/entry.ts` | Generic panel: authorize, call each method with editable arguments, show the result |
| `src/chat.ts`, `secrets.ts`, `server.ts` + `server-worker.ts`, `workspace.ts`, `network-origins.ts` | Dedicated UIs for agent_api, secrets, local_server, file_access and network origins |
| `src/launcher.ts`, `recorder.ts`, `ime.ts` + `ime-worker.ts` | Launcher (applications), recorder (screen_capture), phrase input method (input_method) |
| `demos/launcher`, `demos/recorder`, `demos/input-method` | The three as complete plugins: `pack` them directly |
| `src/kit.ts` + `kit.css`, `icons.ts`, `locales/` | Shared page for a dedicated tab: header with Medeo and macOS authorization, cards, toast, event timeline, raw call log; Test Lab's own copy (en, zh-CN) |
| `src/media.ts` | Camera, microphone, system audio: live levels or camera picture while recording, takes with waveforms, a scrubbable player (`previewURL`) |
| `src/desktop.ts` | Notifications, menu bar, global shortcuts, windows, power, background tasks, clipboard, links, browser view |
| `src/data.ts` | Storage, system info, process, approvals, printing, location, contacts, calendar, devices, accessibility, creation space, full file access, network |
| `src/pure.ts` | Dependency-free helpers (accelerators, waveform resampling) with node tests |

Each module mounts into the page's `<main>`, brings its own stylesheet (`import css from './x.css'`,
which `pack` loads as text) and stops its polling on `pagehide`.
