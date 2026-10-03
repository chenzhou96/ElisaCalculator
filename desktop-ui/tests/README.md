# Frontend regression checks

The editable application is a 96-well comparative workflow: plate readings, explicit comparison/blank/excluded assignments, 4PL fitting, and reference-normalized midpoint X. There is no separate table/standard/unknown-sample editor or left-side analysis settings page. Legacy table and standard records are retained for read-only compatibility.

## Unit tests

```sh
npm test
npm run test:plate-science
```

These use Node's built-in test runner and TypeScript stripping. Node 24.15+ is required for source development (validated with Node 24.19); packaged desktop users do not need Node. Reducer fixtures test request/version guards without representing scientific validation. Python regressions separately preserve standard inversion and out-of-range behavior although that workflow is no longer offered in the editable UI.

## DOM integration with real scientific computation

```sh
npm run test:integration
```

The React Workbench is rendered in jsdom using Vite's SSR transform. Every `parse`, `run`, and `renormalize` request uses the real Python CLI. No fitted parameter, numeric result, warning, or PNG response is synthesized. Each DOM case gets a fresh fake-indexeddb factory; this exercises the real browser storage service with isolated IndexedDB transactions.

Coverage includes:

- Plate-only navigation and permitted well types
- Direct plate run without mandatory parsing: reference 10X → sample 40X
- Result-side reference selection and arithmetic assignment: sample 7X → reference 1.75X, using only `renormalize`; original coordinates, predictions, fitted parameters, global fit, and PNG bytes remain unchanged
- Selection, theme, staged numeric drafts and cancellation preserve completed results; confirmed plate/model edits invalidate results and plots
- Validation opens the actual right editor tab, focuses the invalid setting, selects and marks invalid wells, and permits correction before any scientific call
- Coordinate-preserving file/paste import, valid zero versus missing/invalid cells, overwrite confirmation, undo/redo, optional real mapping parse and editable arithmetic errors
- Full `elisa-analysis/2` JSON snapshots restore existing results and plots without computation; malformed or stale imports preserve current work
- Legacy `elisa-analysis/1` table/standard inputs and settings remain intact and read-only; untrusted v1 result fields are not shown as historical fits
- IndexedDB session restoration and history recall without re-fitting; failed recovery preserves original durable bytes until explicit confirmed replacement; failed autosave retains results and retries without fitting; delayed scientific responses cannot overwrite changed inputs
- Focused editor integration separately covers saved single/multi/mixed selection, original gradient coordinates and atomic apply/cancel

DOM scientific-call summaries are written to `artifacts/qa/dom-scientific-calls.json` (gitignored). DOM integration does not measure layout, CSS rendering, actual image decoding, browser mouse behavior, or native OS dialogs. It must not be reported as a passed browser/screenshot check.

## Real browser integration

Install repository Python requirements and frontend Node dependencies, then use an allowed Chromium installation:

```sh
python -m pip install -r ../requirements.txt
npm ci
npx playwright install --with-deps chromium
npm run test:e2e
```

The configuration uses `CHROMIUM_PATH` when set, otherwise `/usr/bin/chromium` when present, otherwise Playwright's installed Chromium. Chromium sandboxing is enabled. Hosted CI uses its official browser path (for example `/opt/google/chrome/chrome`) with the sandbox enabled. If a managed environment denies browser sockets, security setup, or launch, do not disable sandboxing or retry with bypass flags; enumerate tests locally and run browser acceptance in the approved CI environment.

```sh
npm run test:e2e -- --list
```

Playwright starts a loopback Vite server on port 1420 with the opt-in development Python adapter. Keep that port free so the browser and backend share one environment. Browser tests assert actual Python responses and rendered numeric cells, preserve PNG fit previews through reference changes, test JSON/history restoration and page reload, verify exported CSV/PNG/JSON files, and guard stale fits after atomic plate edits. Legacy compatibility uses the real standard fixture to confirm 12 ng/mL × 5 → 60 ng/mL and guarded out-of-range values, then verifies v1 import displays no invented history results.

Screenshots, geometry, traces and JSON results are written under `artifacts/qa/` (gitignored). Compact plate, right editor tabs, results, plots and history are checked at 1366×768 and 1440×900; all 96 wells remain visible and pages must not overflow horizontally. Runtime and console errors fail browser tests. The plate suite also covers mouse/keyboard/multi/rectangle selection, sparse and increasing/decreasing gradients, explicit clipboard preview, same-group blanks, and undo/redo.

The integration suite includes native-close transport-stub regressions for delayed persistence, duplicate close, edit locking, write failure and close during startup. These render the real Workbench but replace Tauri window/storage transport; they do not prove real OS or filesystem behavior. Rust persistence tests, native bridge invocation, packaging, installation and real Windows interaction are separate checks.
