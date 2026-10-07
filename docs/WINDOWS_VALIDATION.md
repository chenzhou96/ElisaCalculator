# Standalone Windows installer and validation

## Distribution contract

The x64 NSIS `*-setup.exe` contains the release Tauri app and a PyInstaller
one-file `elisa_bridge.exe`. The bridge embeds CPython, NumPy, pandas, SciPy,
Matplotlib, and their collected native dependencies. **End users do not install
Python, pip, Node, Rust, or a development environment.** Windows bundles contain
the frozen engine rather than Python source files. The Rust release path looks
for the installed `resources/bridge/elisa_bridge.exe` before a developer-only
system-Python fallback.

The NSIS configuration uses `currentUser` installation and Tauri's
`offlineInstaller` WebView2 mode. This embeds Microsoft's Evergreen WebView2
standalone installer for machines where the runtime is missing; the smaller
internet-dependent bootstrapper is not used. Building requires internet access
to official package registries and Tauri/Microsoft tooling. A successful build
does not, by itself, prove installation on an offline clean machine.

The artifact is currently **unsigned**. Windows can show SmartScreen or other
trust warnings. Review the commit and checksum before installation; no test or
script disables antivirus, SmartScreen, certificate checks, or OS security.
Signing and public release publishing are separate work.

## Compatibility target and source check

Target: **Windows 10 22H2 x64 and Windows 11 x64**, with working WebView2 and an
ordinary writable user profile. No Windows 7/8, 32-bit, or ARM64 compatibility is
claimed. This target is a component-level compatibility assessment, not a native
Windows 10 validation result.

Official documentation checked on 2026-10-03:

- [Tauri Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/)
  documents NSIS and the offline WebView2 installer option. The checked-in
  `Cargo.lock` selects Tauri 2.10.3/WRY 0.54.4, while `package-lock.json` controls
  the CLI/API build. Tauri's [2.12 support-policy announcement](https://tauri.app/blog/tauri-2.12/)
  now drops Windows 7 and raises its Rust minimum to 1.90; some older guide pages
  still mention Windows 7. Neither is a reason to claim pre-Windows-10 support
  here. No framework upgrade is part of this change; CI uses stable Rust and
  locked dependency resolution, not the old manifest minimum as a tested
  toolchain guarantee.
- [CPython 3.12 Windows documentation](https://docs.python.org/3.12/using/windows.html)
  gives Windows 8.1 or later as the component's minimum. CI deliberately selects
  x64 Python 3.12; the build script rejects other Python minors/architectures.
- [PyInstaller requirements](https://pyinstaller.org/en/stable/requirements.html)
  list Windows 8 or newer. Its [manual](https://pyinstaller.org/en/stable/)
  supports Python 3.8+ and explains that freezing for Windows must run on Windows.
  These component minima do not extend this app's declared Windows target.
- [SciPy 1.17.0 release notes](https://docs.scipy.org/doc/scipy-1.17.0/release/1.17.0-notes.html)
  require Python 3.11–3.14 and NumPy 1.26.4+. The Windows numerical stack is pinned
  to NumPy 2.3.5, pandas 2.2.3, SciPy 1.17.0, and Matplotlib 3.10.8. Python 3.12
  satisfies those requirements. `pip check`, Windows backend tests, and a frozen
  known-truth fit verify the actual imported APIs/DLLs; version ranges alone
  cannot guarantee binary compatibility.
- [Microsoft's WebView2 supported platforms](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)
  include Windows 10, Windows 11, and Windows Server 2022. Microsoft's
  [Edge operating-system support policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems)
  states continued Edge/WebView2 updates on Windows 10 22H2 until at least October
  2028. This does not extend Windows 10 OS support or replace an appropriate OS
  security-update plan.
- [GitHub's runner image catalog](https://github.com/actions/runner-images)
  identifies `windows-2022` as **Windows Server 2022**, not Windows 10 or 11.

## CI evidence and artifact identity

`.github/workflows/windows-installer.yml` runs on pushes, pull requests, and
manual dispatches. It has read-only repository permissions and never publishes a
release, merges, or deploys. It performs:

1. PowerShell parser checks, x64 CPython 3.12 dependency installation from wheels,
   `pip check`, and the full Python unittest suite on Windows
2. Locked frontend installation and Tauri release/NSIS build with the frozen
   bridge, followed by locked Rust tests including native persistence tests
3. Silent installation of that exact generated NSIS executable into a fresh
   user-writable directory containing spaces and non-ASCII characters
4. SHA-256 equality between the built bridge and the installed bridge
5. Direct tests of the **installed frozen bridge**, including its `--build-info`
   proof of frozen x64 CPython 3.12 and the exact embedded numerical versions,
   with `python` and `py`
   unavailable on the test process's PATH, `PYTHONHOME`/`PYTHONPATH` unset, and no
   `ELISA_PROJECT_ROOT`: UTF-8 parsing; an analytic 4PL standard with EC50 = 1
   ng/mL; unknown concentration = 1.3 ng/mL; 7× dilution correction = 9.1 ng/mL;
   PNG previews; nonempty CSV/PNG exports; replayable raw-input JSON audit; and
   rejection of an unsupported command
6. Native launch of the installed app from outside the repository with the same
   Python isolation, requiring the titled top-level window to remain responsive
7. Python-driven subprocess unittests against that installed frozen executable,
   covering its runtime identity, UTF-8/raw JSON pipe, normalization/errors, real
   comparative SciPy fitting/PNG previews, and preserved legacy inverse/export
   contracts. The harness uses Python on the runner; every tested frozen child
   runs with the isolated PATH and its own temporary user/cache directories

The frozen inverse/standard-curve test covers the preserved legacy backend API.
It does not imply that standard/unknown editing is available in the new
plate-only comparative UI.

The Python installation remains on the hosted runner. PATH isolation verifies
that the frozen bridge does not invoke a system `python` or `py`; it is not the
same as a clean-VM test with Python absent. The native-window smoke does not
exercise frontend-to-Rust invocation, interactive plate editing, save/relaunch,
or reopening persisted results. Those need the acceptance checks below.

Successful artifacts are named `ElisaCalculator-windows-x64-<full-commit-sha>`
and contain:

- `*-setup.exe`
- `BUILD_METADATA.json`: exact checkout SHA/ref, app version, run URL, OS/image,
  Python/Rust/Node versions, architecture, signing status, and native-validation
  scope
- `SHA256SUMS.txt`: hashes of the installer and all evidence files (excluding the
  checksum file itself)
- `python-build-environment.txt` and `npm-build-environment.json`: resolved build
  dependencies, including the exact PyInstaller/hooks versions
- `installed-bridge-health.json` and `windows-installer-smoke.json`
- `frozen-bridge-unittest.log`

GitHub artifact upload adds archive wrapping; verify the checksum of the
**extracted setup executable**. For example, in PowerShell:

```powershell
Get-FileHash .\ElisaCalculator_0.3.1_x64-setup.exe -Algorithm SHA256
```

Use the actual filename in the artifact. The metadata SHA must match the branch
commit under review. Pull-request builds record GitHub's tested merge commit,
which can differ from the PR head; pushed-branch builds record that pushed SHA.

## Developer reproduction

Build on Windows x64 using the official Microsoft C++ Build Tools, Rust,
Node 24, and x64 CPython 3.12 described by the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). From the repo:

```powershell
$env:BRIDGE_PYTHON_HOME = Split-Path -Parent (Get-Command python).Source
python -m pip install --only-binary=:all: -r desktop-ui/scripts/requirements-windows-build.txt
python -m pip check
python -m unittest discover -s tests -v
python -m unittest discover -s desktop-ui/scripts -p test_windows_packaging.py -v
cd desktop-ui
npm ci
npm run tauri:build -- --ci --bundles nsis -- --locked
cd src-tauri
cargo test --locked
cd ..\..
$setup = Get-ChildItem desktop-ui/src-tauri/target/release/bundle/nsis/*-setup.exe
& desktop-ui/scripts/windows-installer-smoke.ps1 -Installer $setup.FullName `
  -ReportDirectory desktop-ui/artifacts/windows
```

The script's default installation destination must be absent; choose a new
`-InstallDirectory` for a repeat run. Generated binaries, caches, reports, and
dependency folders are ignored and must not be committed. The existing Linux
CI retains sandbox-supported Chrome at `/opt/google/chrome/chrome`.

## Native acceptance record

### 0.3.1 DPI/work-area correction

The 0.3.0 installer from commit `def459d90f218d89a5cfc984267159c2812355b0`
passed hosted Windows installer/engine/launch CI and an actual Windows 11
installation, installed binary hash checks, frozen-engine calculation, unchanged
fit/plot reference normalization (10X/40X to 1.75X/7X), and six exports. Native
1440×900 pixels were checked. At 150% display scaling the old 600-logical-pixel
minimum height forced 900 physical pixels, so a requested 1366×768 physical
window could not fit. Native Windows 11 editor/history/reference acceptance for
that 0.3.0 binary was subsequently completed before PR #1 merged into `main`
at `923c3da65d7839f4ffc12e97ce8092faf3c37d25`. This does not validate 0.3.1 sizing.

Version 0.3.1 creates a visible, centered window with native overflow prevention
and a small initial workspace. After configured-window creation and setup have
completed, the main-thread `RunEvent::Ready` callback fits the current monitor's
physical work area, reserves the measured native frame and eight physical pixels
at each edge, and sets a bounded 800×420 logical minimum. Roomy monitors retain
the preferred 1360×900 logical workspace. If monitor/sizing queries fail, startup
attempts maximization; the hosted smoke gate requires a successful fit as well as
a visible, responsive, correctly titled window within its monitor's work area,
so this fallback cannot silently count as validated sizing. Sixteen pure Rust cases cover
100%/150%/200%, fractional scales, taskbar and secondary-monitor offsets, frames,
and small/invalid areas. The short-height CSS retains all 96 wells and readable OD
text, uses an accessible icon rail, and scrolls the right editor internally.
Scientific calculations, native history paths, and record schema are unchanged.

The smoke harness awaits a newline-complete Ready sizing record within the
existing launch timeout, then checks a full five seconds of window stability.
It rejects missing, malformed, non-Boolean, array-root and duplicate results;
`fit_ok:false` and either outer/client work-area overflow still fail the gate.
Startup UTC/elapsed timing and any fit error are preserved in the bounds report.
The completion parser is regression-tested in Windows CI before packaging.
See [the October 7 maintenance record](MAINTENANCE_2026-10-07.md) for the prior
failed-run evidence and the limits of the diagnosis.

The native bounds probe accounts for the documented
[GetWindowRect DPI virtualization](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect)
by temporarily setting only its measuring thread's
[DPI awareness context](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext),
then restoring it in `finally`. It does not alter monitor scaling, application
preferences, or global OS settings. The probe's newest APIs require Windows 10
1607, below the Windows 10 22H2 compatibility target.

Hosted browser regressions exercise 150% scaling at short logical viewport
sizes, verify actual OD screenshot pixels and all well bounds, and check editor,
navigation, calculation, plot, and history layouts. Browser PNG/geometry evidence
is retained as a commit-specific CI artifact. The new installer needs its own
native startup/window and compact-interaction retest; the 0.3.0 native result
does not validate the 0.3.1 binary. Keep a scoped backup of existing history before
an update, install to the already verified destination, verify exact hashes and
version, then check startup against the current taskbar-excluded monitor work
area at the existing DPI without changing OS display settings.

Status of the new 0.3.1 build at preparation of this change:

- Hosted Windows Server 2022 installer/engine/launch job: **pending execution on
  the pushed commit**; the workflow and checks are implemented, not a completed
  run
- Windows 11 x64: **pending native installation and interactive validation**
- Windows 10 22H2 x64: **not natively validated**
- Fresh VM without Python and offline installation without existing WebView2:
  **not yet validated**

Record the full commit, artifact SHA-256, OS edition/build, app version, and
actual outcomes when updating this section. Do not mark a different commit's
installer as validated.

For both Windows 10 and Windows 11, use a standard-user profile and test the
installed executable, not `npm run dev`:

1. Install, launch, verify version and plate-only workbench, then create/paste
   plate data in a directory/profile with spaces and non-ASCII text
2. Configure a comparative analysis, fit with SciPy, inspect all generated
   curves/tables/diagnostics, then export and reopen the actual CSV/PNG/JSON files
3. Select a different reference for an existing successful comparative fit.
   Start with reference 10× / sample 40×, select the sample as reference and assign
   it 7×; the original reference must display 1.75× in the known-truth fixture, with
   no refit or change to fitted curves, parameters, or raw input
4. Save complete results to native history; relaunch; restore the plate,
   settings, curves, comparison tables/diagnostics, and exports without rerunning
   the calculation. Open a legacy v1 analysis with standard/unknown information
   and verify its inputs and settings remain readable without invented results.
   A legacy-workflow v2 full snapshot retains its archived computed results
5. Test the plate editor's Apply-only changes: selection hydration, mixed-value
   selections, Undo, Cancel, interrupted/repeated clicks, and close/reopen.
   Applying input/settings changes must invalidate stale results; cancelling
   must preserve the pre-edit plate and calculation
6. In a clean VM with Python absent, repeat the analysis and history round-trip;
   separately test installation offline where WebView2 is initially absent
7. Record installation failures, trust prompts, render/scroll/window issues,
   persistence or export failures, and successful uninstall/reinstall behavior

A native acceptance pass must include interactive calculation and persistence;
a successful hosted build or responsive window is insufficient.
