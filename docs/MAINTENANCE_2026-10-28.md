# October 28, 2026: fail-closed linear conversion at the float boundary

## Scope and baseline

Reviewed the accumulated queue, README, scientific model, previous maintenance
reports, live branches, recent commits, issues and PRs. There is no new concrete
feature request. This bounded pass starts from
`f44980590518a81a110cb37c08489cbd166ac98f` on
`feature/plate-results-history-20261003`; no competing writer was found and a
local maintenance lock was acquired. The October 3 one-time merge authorization
was already consumed by PR #1. `main` remains
`923c3da65d7839f4ffc12e97ce8092faf3c37d25`; this pass does not merge or deploy.

## Reproduced numerical boundary

`safe_power10(math.log10(sys.float_info.max))` passed the upper guard but raised
`OverflowError`: the rounded logarithm's inverse is just beyond the finite float
range. A finite extreme reference assignment consequently crashed an initial
analysis and prevented a saved-fit reference update. New tests reproduced the
exception before the implementation changed.

The existing unavailable-value contract now also covers exponentiation overflow:
return NaN, serialized as JSON null, rather than throw. There is no clamping to
maximum float, fabricated zero, finite potency or confidence interval. The
original finite assignment remains recorded. In particular, a reference value
that cannot be recovered through the rounded log-domain calculation is
unavailable at this numerical boundary, not biologically invalid. Normal-range
formulas, covariances, schemas and normalization semantics are unchanged.

Regressions cover the exact rounded boundary, adjacent representable exponents,
ordinary finite values, NaN and both infinities; initial analysis and reference
editing retain successful fits and finite-only JSON. Reference editing still
must not parse, refit, plot, export or mutate its caller's record.

## Verification and remaining limits

Local Python 3.12: all 116 backend tests, five source-bridge contract tests,
three Mac packaging contract checks and compileall pass. Frontend production
build, lint, 86 unit tests, 28 real-Python DOM/native-contract tests and 11
plate-science checks pass. The focused regression failed before the fix and the
full suite passes afterward. An independent review approved the narrow change.
Writable temporary matplotlib/cache directories are required in this sandbox;
the initial default-cache export failures were environmental, not regressions.

Local browser tests were not retried: the previously recorded sandbox socket
restriction is unchanged. Exact-commit hosted CI must validate Python 3.10/3.12,
all browser cases, and Windows/Mac packaging separately; refer to the final
commit's Actions outcomes, not earlier green runs. No sandbox is weakened.
Physical Windows small-screen/150% DPI, Win10/file-picker/offline first-install
and Mac M1/Gatekeeper acceptance remain unverified. No user-device files or
installed app packages are changed, and no private experimental data is used.
