# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ELISA 4PL Global Fit tool — analyzes ELISA assay data via shared-A/D global four-parameter logistic curve fitting. Desktop GUI is built with Tauri + React; all computation happens in the Python core.

## Commands

```bash
# Install Python dependencies
python -m pip install -r requirements.txt

# Run all tests
python -m unittest discover -s tests -v

# Run Python bridge CLI (parse/run requests via JSON)
python -m elisa_calculator.bridge --request-file request.json

# Dev the desktop GUI
cd desktop-ui && npm install && npm run tauri:dev

# Build redistributable (Windows)
cd desktop-ui && npm run tauri build -- --bundles nsis

# Type-check frontend
cd desktop-ui && npm run build
```

## Architecture

Three layers, each a pipeline stage (parse → calculate → export):

### Python core (`elisa_calculator/`)

- **`bridge.py`** — JSON CLI bridge. The single integration surface for the GUI. Accepts commands: `parse`, `run`, `normalize_text`. Serializes NumPy→JSON safely. The Tauri Rust side calls `python -m elisa_calculator.bridge` as a subprocess via `invoke('run_bridge', ...)`.

- **`io/readers.py`** — Parses pasted/text CSV data into DataFrames. Auto-detects separator (comma/tab/whitespace) and whether the first row is a header or data. `read_text_file_with_fallbacks` tries multiple encodings (UTF-8, GBK, GB18030, Latin-1).

- **`io/writers.py`** — CSV export and table formatting (`format_results_table`). Calls plotting functions to save per-group and overview PNGs.

- **`core/model.py`** — Pure math: `four_param_logistic(x, A, B, C, D)` and `global_four_param_logistic_model(x, group_indices, n_groups, A, D, *bc_flat)`. The global model shares A/D across all groups, each group gets its own B/C.

- **`core/processing.py`** — `prepare_group_data` (validate/clean columns, drop non-numeric), `fit_prepared_groups` (scipy `curve_fit` with global model), `build_calculation_report` (compute per-group metrics, warnings). Defines key dataclasses: `FitParameters`, `GroupCalculationDetail`, `CalculationReport`, `GlobalFitResult`.

- **`core/evaluator.py`** — Fit quality metrics (R², RMSE) and automatic warning notes (low point count, small response range, weak monotonicity, EC50 out of range, poor R²).

- **`services/workflow.py`** — Staged pipeline orchestration with dependency injection: `parse_workflow_input` → `calculate_workflow_report` → `export_workflow_outputs`. Each stage accepts injectable callables for the underlying operation, enabling test mocking. The composite `run_calculation_workflow` chains all three. All stage results are typed dataclasses (`ParseStageResult`, `CalculationStageResult`, `ExportStageResult`, `WorkflowResult`).

- **`visualization/plotting.py`** — Matplotlib (Agg backend) scatter + 4PL fit curve plots, per-group and overview grid. Uses Chinese-capable font configuration from `fonts.py`.

- **`common.py`** — `resource_path` (PyInstaller-safe), `sanitize_filename`, `make_output_dir` (platform-correct cache dirs: `%LOCALAPPDATA%/Elisa_calculator/` on Windows, `~/Library/Caches/` on macOS, `~/.cache/` on Linux).

### Desktop GUI (`desktop-ui/`)

- **Stack**: Tauri 2 (Rust backend), React 19 + TypeScript, Vite (via Rolldown), CSS variables for theming.
- **Frontend entry**: `src/main.tsx` → `src/App.tsx` → `Shell.tsx` (IDE-like layout: TitleBar, ActivityBar, LeftSidebar, MainContent, RightSidebar, BottomPanel, StatusBar).
- **Bridge**: `src/hooks/useBridge.ts` calls `invoke<T>('run_bridge', ...)` which the Tauri Rust side routes to `python -m elisa_calculator.bridge`.
- **Types**: `src/types/bridge.ts` mirrors the bridge JSON contract (`ParseResponse`, `RunResponse`, `DetailRow`, `SummaryRow`).
- **Key components**: `RawDataEditor` (data input), `FilePanel` (file selection), `ResultsTable` (summary), `GroupList` (group picker), `DetailPanel` (per-group detail), `PlotViewer` / `PlotThumbList` (renders plots from saved PNGs).
- **State**: `AppStateContext.tsx` — single React context for workspace state.
- **Build**: `npm run tauri:dev` for dev; `npm run tauri build -- --bundles nsis` for production NSIS installer. Offline build scripts use cached NSIS tools in `target/.tauri/`.

## Key design decisions

- Python core is GUI-agnostic — `bridge.py` is the only integration point. The GUI never imports Python directly; it spawns a subprocess.
- Workflow services use dependency injection (callables as parameters) so tests can swap in mock calculators/exporters without touching real computation.
- The global 4PL fit **shares A/D across all groups**; each group independently estimates B (slope) and C (EC50).
- Separator inference prefers explicit delimiters (comma, tab) over whitespace to avoid false splits on space-separated data.
- X values are treated as log-concentration — non-positive values (e.g., -2, -1, 0 in log scale) are valid and not filtered out.
- Test data (`test_data.csv`) uses Chinese headers with GBK encoding as a real-world edge case.
