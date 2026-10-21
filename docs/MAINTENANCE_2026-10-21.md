# October 21, 2026: consistent portable records during reference updates

## Scope and baseline

This Wednesday maintenance pass continues `feature/plate-results-history-20261003`
from `5f5cb787d7c1ebafbee5b4d91bd61b6c27c4dc84`, preserving the standalone Mac
packaging work. The accumulated queue, current README/scientific model, previous
maintenance reports, live branches, PR and workflow state were reviewed. The
October 3 one-time merge approval was already consumed by PR #1; `main` remains
`923c3da65d7839f4ffc12e97ce8092faf3c37d25`. No merge, deployment, user-device
operation or private experimental-data upload is part of this pass. No competing
native/cloud writer or local repository process was found before editing.

## Reproduced record-consistency gap

The previous desktop README documented that portable JSON could contain updated
reference settings but the prior normalized report if saved while the asynchronous
reference update was still pending. Restore reconciled those fields using the
original fit, but the exported record itself was an intermediate, mismatched
snapshot. Durable autosaving and native close already waited for normalization;
the two portable-download controls did not.

Two new real-React/real-Python DOM regressions hold a normalization response in
flight (one successful positive assignment, one invalid zero assignment). Both
failed on the baseline because the toolbar save control remained enabled. The
fix temporarily disables both toolbar and File-menu saves, provides a waiting
tooltip, and guards the shared handler. The tests verify neither entry downloads
while pending, both success and failure restore save availability, and the saved
input/report reference assignments agree with the original unmodified fit.

No fitting formula, covariance calculation, normalization algorithm, file schema,
legacy-record reconciliation or native packaging implementation is changed.
This is software record consistency, not a claim of assay calibration or constant
biological potency. Historical CSV/PNG scientific exports remain unchanged by
reference-only updates as already documented.

## Verification and limits

Local Python 3.12 validation passed all 113 backend tests, five source-bridge
contract tests, three Mac packaging contract checks and compileall. Frontend
production build, lint, 86 unit tests, 28 real-Python DOM/native-contract tests
(including the two new regressions) and 11 plate-science checks passed. An
independent read-only review found no blocking issues. The handler guard is
verified by inspection; disabled-control clicks exercise the UI controls rather
than invoking the handler directly.

All 19 browser tests were enumerated. A focused local browser test could not
reach the application because sandboxed Chromium failed its process-singleton
socket with `Operation not permitted`; this is not a passed browser test. Normal
hosted source CI must verify all browser cases for the exact final commit, and
Windows/Mac installer CI must separately reach a terminal outcome. See the final
commit's Actions results, not earlier green commits. Node dependency installation
uses a writable local npm cache; no security or browser sandbox setting is
weakened.

Hosted Windows/macOS builds are distinct from real user-device acceptance.
Physical Windows 10/11 at 150% DPI, clean offline first installation and native
file-picker behavior remain unverified; Mac 14/M1 and quarantined Gatekeeper
first-open acceptance also remain open. Existing app packages are not replaced
or newly delivered by this source-only weekly pass.
