# ELISA Calculator desktop workbench

Compact React + TypeScript frontend for the Tauri desktop app. All scientific parsing, fitting, inverse prediction and image generation are performed by the Python bridge. The frontend never substitutes an approximate browser fit.

## Run and check

```bash
npm ci
npm run tauri:dev
npm run build
npm run lint
npm test
```

Local browser development can opt into a loopback-only Python bridge:

```bash
VITE_ELISA_DEV_BRIDGE=1 npm run dev
```

The Vite endpoint is development-only, accepts raw text rather than arbitrary file paths, and is not a deployment API. Without Tauri or this explicit opt-in, the browser can edit inputs but clearly reports that the calculation engine is unavailable. See the root README for Python and native build prerequisites.

## Workflows

- **曲线比较:** dilution steps (default), raw concentration or already-log10 concentration; shared A/D or independent 4PL fits; explicit reference group and any positive assigned strength. EC50 ratios and reference-normalized stock strength have separate columns and definitions.
- **标准曲线:** known concentrations and units, selected standard curve, unknown-sample OD replicates, dilution correction and range-protected inverse prediction.
- Explicit header overrides, constant blank correction and replicate-column mapping prevent hidden assumptions.
- Scientific values use significant-digit formatting, preserving small nonzero concentrations.
- Fitted curves are returned by the bridge as image previews; no export is required to view them.
- CSV/PNG export writes to the application cache. A portable JSON analysis record captures raw inputs, configuration and results; importing it restores inputs and requires a fresh calculation before results can become current.

## Frontend structure

- `src/workbench/model.ts`: pure reducer, option validation and input versioning
- `src/workbench/Workbench.tsx`: native-safe shell, async request orchestration, menus and file operations
- `src/workbench/*Panel.tsx`: data, settings, unknowns, results, plot and guide views
- `src/workbench/record.ts`: versioned portable-record validation
- `src/hooks/useBridge.ts`: Tauri / explicit local-development bridge routing
- `src/App.css`: compact light desktop layout plus smaller-screen fallback
- `tests/`: reducer/record tests and real-Python integration coverage

Every scientific input change invalidates the current result. Parse, run, data-file import and record-file import carry both a request ID and input revision; late responses cannot overwrite more recent edits. A busy lock prevents duplicate requests, while edits remain available during fitting. Export failures remain separate from successful scientific results.

## Layout and verification boundaries

Desktop views use a fixed shell, independently bounded panels, 5-row data previews, 4-row result pages and 6-row unknown-sample pages. Dense/comfortable display, sidebar and inspector controls are available in the View menu. Below 760 px, the shell becomes a readable vertically flowing layout.

Production build and lint are required. The test suite distinguishes model, DOM-handler and real-Python checks from actual browser or native rendering. Browser screenshot/native-window verification requires an environment that permits launching and connecting to the relevant browser; a DOM test is not evidence of rendered layout, native dragging, download dialogs or Windows packaging.

## macOS local native verification

On macOS, Tauri merges `src-tauri/tauri.macos.conf.json` with the base configuration.
The override builds a local `.app` and maps the Python source into `Contents/Resources`.
The Windows NSIS target, PowerShell bridge build and `.exe` resource remain in the base configuration.

With Rust/Cargo on PATH and the scientific Python environment available as `python`:

```sh
npm run tauri:build -- --debug
```

This local macOS bundle uses the existing Python environment; it does not include a standalone Python runtime.
A distribution-ready Mac package, Developer ID signing, notarization and clean-machine installation require separate verification.
