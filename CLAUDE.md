# ELISA Calculator development guide

## Run and verify

- Backend: `python -m unittest discover -s tests -v`
- Frontend: `cd desktop-ui && npm ci && npm run build && npm run lint`
- Native development: `cd desktop-ui && npm run tauri:dev`
- Real Python browser integration (local only): `VITE_ELISA_DEV_BRIDGE=1 npm run dev`
- Python CLI: `python -m elisa_calculator.bridge --request-file examples/comparison_request.json`
- Windows bundle: `python -m pip install -r requirements-build.txt`, then `npm run tauri:build`
- In read-only-home CI use writable `MPLCONFIGDIR` and `XDG_CACHE_HOME`

## Architecture and ownership

React frontend sends JSON through Tauri Rust command `run_bridge` to the Python bridge. Only explicit local development uses the Vite adapter; production never embeds the Python engine in JavaScript or fabricates results.

- `core/coordinates.py`: explicit input coordinate semantics and option validation
- `core/model.py`: stable logistic and inverse functions
- `core/processing.py`: raw audit, 4PL fit, diagnostics, reference comparison and unknown quantitation
- `io/readers.py`: text parsing with header override and warnings
- `io/writers.py`: collision-safe CSV/PNG and complete JSON audit export
- `services/workflow.py`: staged orchestration, with injection points used in tests
- `bridge.py`: parse/run/normalize request handling and JSON-safe serialization
- `visualization/plotting.py`: shared in-memory previews and file rendering
- `desktop-ui/src/workbench`: compact two-workflow frontend and versioned input/result state
- `tests`: known-truth scientific, independent-oracle, failure-path and export regression tests

## Scientific invariants

Do not infer concentration semantics from a numeric column name or from X values 1–8. Default UI input is dilution step; raw concentration and log10 concentration are explicit alternative modes. Unknown starting concentration means relative stock fractions only.

Fit in log10 dose. Parameter C is logEC50; exported EC50 is 10^C; EC50_step is the correctly inverted ordinal coordinate. Raw response and preprocessing decisions remain auditable.

Shared/independent platforms are explicit. Midpoint ratios are apparent comparisons conditional on comparable assays and preparation, not proof of constant biological potency. Read docs/SCIENTIFIC_MODEL.md before changing normalization.

Parameter uncertainty uses SVD of the residual Jacobian directly. Do not form/invert JᵀJ without accounting for squared conditioning. Shared fits require covariance cross terms for reference-normalized intervals. Unreliable calibration must not return trusted inverse concentrations.

Blank corrections, replicate aggregation, and unknown dilution correction must be visible and explicit. Default out-of-range unknown quantitation is suppressed.

## Engineering invariants

Every relevant input/settings change invalidates prior results. Asynchronous responses must match input version and request ID. Native busy state also blocks file input. Export status reflects files actually written and warnings, not just directory creation. Previews work without persistent export. Durable analysis records can be saved separately from temporary cache outputs.

Do not commit generated artifacts, dependency folders, screenshots or .qa. Do not claim Windows installer verification from web builds. Never push, publish or merge unless separately authorized.
