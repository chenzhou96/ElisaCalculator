# ELISA Calculator desktop workbench

Compact React + TypeScript frontend for the Tauri desktop app. New analyses use the 96-well comparative workflow. All scientific parsing, fitting, reference normalization and image generation are performed by the Python bridge. The frontend never substitutes a browser fit. Historical standard-curve and inverse-prediction APIs remain in the backend for compatibility and regression checks.

## Run and check

```sh
npm ci
npm run tauri:dev
npm run build
npm run lint
npm test
npm run test:integration
npm run test:plate-science
npm run test:e2e
```

Local browser development can opt into a loopback-only Python bridge:

```sh
VITE_ELISA_DEV_BRIDGE=1 npm run dev
```

The Vite endpoint is development-only, accepts raw text rather than arbitrary file paths, and is not a deployment API. Without Tauri or this explicit opt-in, the browser can edit inputs but clearly reports that the calculation engine is unavailable. See the [root README](../README.md) for Python, Node and native build prerequisites, and [test instructions](tests/README.md) for browser sandbox requirements.

## Comparative workflow

- Paste Excel readings into the 8×12 plate, select wells, and assign comparison groups, blanks or exclusions. Each group has explicit starting dose, dilution factor, direction and interval.
- The right-side analysis conventions are the single settings entry. Selected assigned wells load their existing settings; unassigned wells load defaults. Selection and editor drafts do not write plate data until Apply. Cancel and undo preserve prior work.
- Shared A/D or independent 4PL fits are explicit. EC50 ratios and reference-normalized midpoint X have separate definitions and retain quality and nonparallelism warnings.
- Results-side reference changes use the original unrounded fit and covariance without refitting or regenerating plots. Only successful groups can serve as references, with a finite positive assignment.
- Scientific input/model changes invalidate completed results. Selection, theme and reference-only changes retain the fit. Asynchronous responses must match the current input version and request; stale successes and errors are ignored.
- Fitted PNG previews do not require disk export. Optional CSV/PNG/JSON exports go to the application cache, with actual write failures reported separately.

There is no separate editable table, standard-curve or unknown-sample workflow. Legacy table/standard records are preserved with explicit read-only compatibility warnings. See [plate operations](../docs/PLATE_WORKBENCH.md) and [scientific interpretation](../docs/SCIENTIFIC_MODEL.md).

## Records and history

`elisa-analysis/2` portable JSON records and native analysis history retain inputs, plate assignments, original fits, results, plots and reference settings. Valid complete snapshots restore without a Python refit; input/model changes require a new analysis. `elisa-analysis/1` records restore inputs only and never invent trusted fitted results. The scientific export `Analysis_Record.json` is an audit file, not a portable UI restore record.

Desktop persistence uses atomic writes in app data. Native close waits for durable saving and retains the window on failure. Browser development uses IndexedDB, which may be cleared by browser privacy/storage policies. Keep independent JSON backups. Wait for a reference update to finish before saving a portable record: the existing save control can capture new reference settings while the previous normalized report is still displayed; restore reconciles that reference through normalization without refitting.

## Frontend structure

- `src/workbench/model.ts`: reducer, option validation, input versions and reference state
- `src/workbench/Workbench.tsx`: async orchestration, native-safe shell, menus and file operations
- `src/workbench/PlatePanel.tsx`: staged well selection and editing
- `src/workbench/ResultsPanel.tsx`, `PlotsPanel.tsx`, `GuidePanel.tsx`: results, curves and guidance
- `src/workbench/record.ts`, `history.ts`: validated portable records and durable snapshots
- `src/hooks/useBridge.ts`: Tauri / explicit local-development bridge routing
- `src/App.css`: compact desktop layout and short-screen/DPI adaptations
- `tests/`: reducer/record checks, real-Python DOM/scientific integration and browser coverage

## Layout and verification boundaries

The shell uses bounded plate, editor, results and history panels. Short-screen layouts keep the 96 wells compact and make the editor/history scrollable. Native startup sizes the window to the monitor work area with DPI and frame allowance. Browser geometry tests and pure native sizing tests do not establish physical Windows 10/11 compatibility or native file-picker behavior.

Build and lint are required. Unit, DOM-handler and real-Python checks are distinct from browser pixels and native installation. Browser CI keeps Chromium sandboxing enabled; do not disable it when the execution environment blocks browser startup. [October 7 maintenance](../docs/MAINTENANCE_2026-10-07.md) and [Windows validation](../docs/WINDOWS_VALIDATION.md) record version-specific evidence and remaining acceptance limits.

## Standalone Apple Silicon Mac package

The macOS override freezes the Python/SciPy engine inside the app and builds a native ARM64 `.app`. The Mac workflow verifies the copied app, engine and native startup, then creates and mounts a `.dmg` with commit-specific checksums. It targets macOS 14.0 or newer and uses an ad-hoc signature only; it is not Developer ID signed or notarized. See [Mac packaging and verification](../docs/MACOS_VALIDATION.md) for installation, reproduction and remaining acceptance limits.
