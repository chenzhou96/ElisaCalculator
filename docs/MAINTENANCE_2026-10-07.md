# October 7, 2026: 0.3.1 validation maintenance

## Scope and baseline

This pass continues `feature/plate-results-history-20261003` from `ee2c1b9`.
Stable `main` remains `923c3da65d7839f4ffc12e97ce8092faf3c37d25` (0.3.0).
The changes are published on the work branch; they do not merge, deploy or
replace any installed application. Existing plate editing, history and fitted
results are preserved. No scientific fitting formula or record schema changes.

## Native startup completion

The previous [Windows installer run](https://github.com/chenzhou96/ElisaCalculator/actions/runs/37125496772)
failed its exactly-one Ready sizing marker assertion after a visible, responsive
window had already been discovered. Its final diagnostic artifact contains a
successful sizing result: a 992×704 client, measured frame 16×8, in a 1024×728
physical monitor work area. The frozen-engine fit also passed. This evidence
supports a startup-completion observation race; it does not prove log buffering
or a native dispatch deadlock. Tauri's locked main-thread dispatch and Ready
callback are retained.

The smoke harness now waits for a complete, strict sizing result under the
original launch timeout before beginning its full five-second stability check.
It then revalidates the single result and measures visible outer/client bounds
in physical pixels. Missing, duplicate or malformed evidence, a failed fit,
unresponsive windows and work-area overflow remain failures. The result includes
startup time, elapsed duration and errors to make any future delay diagnosable.
Parser regressions cover incomplete writes, delayed completion, LF/CRLF,
Boolean failure, duplicate records, invalid JSON and invalid root/value types.

## Reference changes

Formula inputs can commit the same evaluated value on change and again on blur.
That should be a no-op rather than invalidating the normalization request that
was just issued. A test waiting only for the first response with a numeric value
can also mistake an older request for the final reference choice. Regression
coverage now correlates reference choices and responses, including intentionally
reversed deliveries. Reference-only changes retain the original fitted report
and plots and never invoke a new fit.

The [earlier main browser run](https://github.com/chenzhou96/ElisaCalculator/actions/runs/37127848593)
passed on its second attempt after one 15-second normalized-cell timeout. The
first attempt did not retain a request trace, so its precise cause remains
unproven. New per-request diagnostics and retained failure traces allow a future
failure to be investigated without relying on a same-commit retry as proof.

## Verification and remaining acceptance

Local Linux validation of this patch passed 104 Python tests, 86 frontend unit
tests, 26 real-Python DOM/native-contract integration tests and 11 plate-science
tests, plus the production build, lint and whitespace checks. Local Chromium
could not create its process-singleton socket in the execution environment;
browser tests were not counted as local passes, and its sandbox was retained.
Hosted browser and Windows results must be checked for the final pushed commit.
The first pushed Windows run caught PowerShell's `[pscustomobject]` accelerator
accepting a wrapped array. The guard now checks the concrete custom-object type;
the array regression and all script parser checks passed locally in official
PowerShell 7.5.3 before publishing the correction.

Run the documented Python suite with writable Matplotlib/cache directories,
locked frontend install, build, lint, unit tests, DOM integration and plate
science tests. Windows CI runs the PowerShell regressions, locked native Rust
tests, NSIS installation, frozen-engine checks and physical window bounds gate.
The source and installer workflows record their exact tested commit and results;
use the pushed commit's Actions runs rather than another build's green status.

Browser short-screen/DPI layout tests and pure native geometry tests provide
automated coverage. Windows Server 2022 CI is not physical Windows 11 at 150%
display scaling, Windows 10 acceptance, or native file-picker validation. Those
remain separate checks of the exact installed 0.3.1 binary. No display settings,
browser sandbox, security protection or installed user application was changed.
