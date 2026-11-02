# October 14, 2026: bounded legacy-model and documentation maintenance

## Scope and baseline

This weekly pass continues `feature/plate-results-history-20261003` from
`ba8cab7551b164c4b80127a9a7b65c7dbb1daebb`. Stable `main` remains
`923c3da65d7839f4ffc12e97ce8092faf3c37d25`; the October 3 merge was a separate,
completed approval. This pass does not merge or deploy, replace an installed
application, or publish experiment records.

The accumulated maintenance queue, root/desktop documentation, October 7
maintenance record, recent commits, pull request and workflow state were reviewed
first. Delivered window-startup/reference fixes were not reimplemented. No
competing write task, local maintenance process or newer remote commit was found
before this pass. Only source, regression tests and project documentation are
updated; the existing repository tree retains its binary resources unchanged.

## Reproduced legacy-helper defect

`global_four_param_logistic_model` is an exported legacy helper, not a call path
of the current fitter, bridge or plate workflow. The existing shape/range guard
accepted fractional and NaN group IDs. Such observations matched no group mask,
leaving `np.empty_like` output unwritten. The observed returned value is incidental
memory content, not a defined numerical prediction. New regressions failed on
the baseline before changing the helper.

The helper now requires a positive integer group count and finite, integer-valued
numeric group IDs with matching shape and valid range. Integer-valued floating
IDs remain supported. Boolean, text, complex and object-array IDs are rejected;
original boolean elements in mixed numeric lists are checked before coercion.
NumPy integer group counts are converted to Python integers before parameter
count arithmetic, avoiding fixed-width multiplication overflow.

Nine focused tests cover valid interleaved/multidimensional groups, signed and
unsigned integer and integral-float IDs, scalar/empty inputs, invalid values and
shapes, mixed booleans, group-count validation and parameter-count overflow.
The 4PL formula, current fitting/normalization implementation, record schema and
UI behavior are unchanged. This boundary fix does not establish assay accuracy
or clinical/biological potency validation.

## Documentation correction

The desktop README incorrectly described editable table/standard/unknown modes,
input-only portable restoration and historical layout controls. It now describes
the plate-only workflow, staged editing, result-side reference changes, complete
v2 history and v1 input compatibility, and version-specific native/browser limits.
It also documents the existing portable-save/reference-update intermediate-state
limitation: wait for normalization to finish before saving a record. This pass
does not change that save control or invent a new completed UI fix.

## Verification and boundaries

Local Python 3.12 validation passed all 113 backend tests (104 baseline tests plus
nine new helper regressions), five source-bridge packaging contract tests and
compileall. Frontend locked dependency installation, production build, lint and
86 unit tests, 26 real-Python DOM/native-contract integration tests and 11
plate-science tests passed. Hosted CI must still be checked for the final
work-branch commit.

Matplotlib/cache paths must be writable as documented in `CLAUDE.md`. An initial
run without those paths failed three export-dependent checks; rerunning with the
documented environment passed. Lint initially overlapped Playwright artifact
cleanup and failed on a disappearing temporary directory; the serial rerun
passed without changing source or security settings.

Local Chromium remained sandboxed and could not create its process-singleton
socket (`Operation not permitted`), so none of the 19 local browser cases reached
application execution. They are not counted as local browser passes. The normal
source CI runs those browser checks in its approved sandbox-supported runner.
The Windows workflow separately builds and checks the frozen engine, Rust,
installer and native window bounds for the exact pushed SHA. A successful hosted
Windows Server 2022 run does not substitute for physical Windows 10/11, 150% DPI,
file-picker or clean-offline-machine acceptance. User-reported installation of a
prior version is distinct from full acceptance of this maintenance commit.

No user computer, display configuration, security setting, browser sandbox,
sharing permission or credential was changed. No generated files or private
experimental data are included. Use the final commit's Actions runs rather than
an earlier version's green checks; publication is not approval to merge.
