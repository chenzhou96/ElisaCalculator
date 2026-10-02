# Frontend regression checks

These checks cover state transitions, input validation, scientific display, and browser workflows against the real local Python bridge. Browser tests do not emulate fit or interpolation results.

## Unit tests

```sh
npm test
```

The script uses Node's built-in test runner and TypeScript stripping, with no scientific test doubles. Small response fixtures are used only to exercise the reducer's asynchronous request/version guards. Node 24.15+ is required for source development and these tests (validated with Node 24.19). Packaged desktop users do not need Node.

## Browser integration

Install the Python requirements in the repository root, install Node dependencies here, and make Chromium available:

```sh
python -m pip install -r ../requirements.txt
npm ci
npx playwright install --with-deps chromium
npm run test:e2e
```

The configuration automatically uses `CHROMIUM_PATH` when set, otherwise `/usr/bin/chromium` when present, otherwise Playwright's installed Chromium. It starts its own loopback Vite server on port 1420 with the opt-in development Python adapter. Keep that port free. This also ensures the server and tests share one execution environment.

Known-truth inputs are loaded from `../examples/comparison_request.json` and `../examples/standard_request.json`. Main workflow assertions compare the actual Python response and rendered result cells: reference 10X → sample 40X, known concentration 12 ng/mL × 5 → original 60 ng/mL, and guarded out-of-range samples without fabricated numeric results.

Screenshots and JSON results are written under `artifacts/qa/` (gitignored), including 1366×768, 1440×900 and 960×720 layouts. Error screenshots and traces are retained on failure. Browser console errors fail the tests.

Desktop-native Tauri dialogs, native packaging, and clean Windows installation are separate checks and are not proven by these browser tests.

## DOM integration with real scientific computation

```sh
npm run test:integration
```

This separate suite renders the actual React Workbench in jsdom using Vite's SSR transform. Its transport adapter invokes the real Python CLI for every parse and run; it does not synthesize fit, concentration, warning or plot responses. It verifies actual UI controls, displayed truth values, A/D plateau labels, settings invalidation, file decoding, portable records, asynchronous import guards and error recovery.

DOM integration does not measure layout, CSS rendering, actual image decoding, Chromium interaction, or native OS dialogs. It must not be reported as a passed browser or screenshot check.
