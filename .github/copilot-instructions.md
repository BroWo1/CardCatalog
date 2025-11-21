## CardCatalog — AI assistant quick guide

This repository is an Electron + Nuxt (renderer) desktop app for cataloging photos. Use this file to guide code-writing AI agents so they can be productive immediately.

Keep suggestions small and specific. When changing runtime behavior, prefer edits under `src/main/` (main process) or `src/renderer/` (UI) depending on where the change belongs.

### Big picture
- Main process: `src/main/` (Electron orchestration, scanning, workers, DB). Key files: `src/main/main.js`, `src/db.js`, `src/file-scanner.js`, `src/processing-queue.js`, `src/workers/`.
- Renderer: `src/renderer/` (Nuxt 4 SPA, hash routing). Key files: `src/renderer/nuxt.config.js`, `src/renderer/pages/index.vue`, `src/renderer/components/` and `src/renderer/composables/`.
- Preload & IPC: `src/preload/preload.js` exposes `window.photoAlbum` API; shared channel constants in `src/shared/ipc-api.js`.

### Developer workflows / commands
- Start dev renderer (must run first): `npm run dev:renderer` (Nuxt on port 3333).
- Start Electron connecting to renderer: `npm run dev` (requires `RENDERER_URL` pointing at the renderer).
- Build renderer for production: `npm run build:renderer` (generates static site in `src/renderer/.output/public`).
- Download CLIP models (required before packaging): `npm run download-models`.
- Package / make installers: `npm run package` / `npm run make` (both run `download-models` via `prepackage`/`premake`).

Note: Packaged app loads renderer from `file://` so Nuxt is generated with hash routing and base URL `./`.

### IPC & data flow rules (important)
- Renderer calls `window.photoAlbum.<method>()`. See `src/preload/preload.js` for the exposed API surface and `src/shared/ipc-api.js` for channel names and types.
- Main process uses `ipcMain.handle()` and emits progress/events using `webContents.send()`.
- Database lives in main process using `sql.js` with in-memory runtime and debounced disk persistence. Call `db.shutdown()` on quit to flush writes.

### Project-specific patterns to follow
- Avoid blocking the main process: heavy work runs in `src/workers/` and is orchestrated by `src/processing-queue.js`.
- File change detection uses a file signature `${size}:${mtimeMs}`. Only reprocess when signature changes —respect that logic when modifying scanning or processing code.
- Renderer routing must remain hash-based (see `nuxt.config.js`) to support `file://` loading in packaged apps.
- Model files live in `models/` and are downloaded with `scripts/download-clip-model.js`. Packaging expects them to be present and included via `forge.config.js` extraResources.

### Where to add tests / small improvements
- Small unit or integration tests: prefer adding under `src/main/` related tests for scan/queue logic, and `src/renderer/composables/` for UI logic. There is no test harness configured — propose adding `vitest` or `jest` if you add tests.

### Files to inspect for examples
- IPC usage: `src/preload/preload.js`, `src/shared/ipc-api.js`, `src/renderer/plugins/photo-album.client.js` (exposes API to Vue).
- Worker pattern: `src/processing-queue.js`, `src/workers/exif-worker.js`, `src/workers/clip-keywords.js`.
- Renderer build quirks: `src/renderer/nuxt.config.js` and `package.json` scripts for `build:renderer`.

### Quick anti-patterns to avoid
- Do not perform heavy CPU/IO on the main thread — always offload to worker threads.
- Do not assume `window.location` history mode; use hash routes in renderer.

If anything here looks incomplete or you want more examples (tests, code snippets, or a contributor workflow), tell me which area to expand and I will iterate.
