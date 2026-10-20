# Apple Silicon Mac package (0.3.1)

## Installation and limits

This package is for Apple Silicon Macs (M1/M2/M3/M4 and compatible ARM64 Macs), with a conservative **macOS 14.0 or newer** deployment target. It is not an Intel/universal build. The DMG contains `ElisaCalculator.app` and an Applications shortcut. Open the DMG and drag the app to Applications. Python, NumPy, SciPy, pandas and Matplotlib are frozen inside the app; users do not need to install Python, Node or Rust.

The package has an **ad-hoc code signature only**. It has **no Apple Developer ID signature and is not notarized by Apple**. Download quarantine/Gatekeeper may prevent the first launch. Review the source and matching SHA-256 before deciding to allow it in macOS System Settings → Privacy & Security. Follow [Apple's instructions for an app from an unidentified developer](https://support.apple.com/102445). Do not disable Gatekeeper, remove quarantine in bulk, or change system security settings. If macOS reports malicious software or a revoked signature, stop rather than override that warning.

An ad-hoc signature checks code integrity; it does not establish a verified developer identity or Apple's security review. Apple-authenticated signing/notarization requires a separately authorized credential workflow and is not part of this build.

## Provenance

Use the artifact whose commit equals the required work-branch head. The marketing version remains 0.3.1; the filename's short commit and `BUILD_METADATA.json` distinguish builds. `SHA256SUMS.txt` covers the DMG and evidence. The GitHub Actions artifact ZIP has its own independent SHA-256 digest.

The workflow only uploads build artifacts with 30-day retention. It does not create a GitHub Release, merge the branch or deploy anything. Build/runtime packages come from the existing project registries, with the numerical stack pinned in `desktop-ui/scripts/requirements-macos-build.txt`.

## Automated verification

`.github/workflows/macos-installer.yml` uses a standard GitHub-hosted `macos-15` ARM64 runner and records its actual version. The build targets ARM64 and macOS 14.0, but runner execution alone does not constitute testing on every supported OS.

- Backend scientific regression suite, frontend lint/unit/DOM/real-Python scientific integration, and native Rust storage/window-sizing tests
- Native ARM64 CPython 3.12 PyInstaller console engine, preserving the stdin/stdout JSON protocol
- ARM64 checks for both the app and frozen bridge; executable permissions and strict ad-hoc signature verification
- Copy the app into a temporary path with spaces/Chinese characters, outside the checkout
- Invoke the copied frozen bridge with Python environment variables removed and no Python available on PATH
- Verify runtime identity, Chinese input parsing, known-truth SciPy comparative fitting, PNG previews, legacy inverse calculation, and real audit exports
- Launch the copied native app, require exactly one successful work-area sizing result and a visible window, and require the process to remain alive for five seconds afterward
- Create a compressed DMG, verify it, mount it read-only, verify its app signature and compare both executable hashes to the tested copy

The test harness itself uses the build interpreter; the app and sidecar subprocesses do not. Existing Windows packaging tests retain their filename for compatibility and are reused for the Mac frozen-engine contract.

## Verification boundaries

Native process/window startup and standalone-engine subprocess tests are separate checks. They do not prove every WebView interaction, file picker, clipboard operation, DPI setting, close/save/reopen flow, or full app-to-engine user interaction on a physical M1 iMac. Full acceptance on the user's Mac and macOS 14, and first launch of a browser-downloaded quarantined app on a clean machine, remain unverified until performed and recorded. Do not describe successful CI as Apple notarization or universal clean-machine acceptance.

Existing analysis data is stored under the same app identifier `com.zhouc.elisacalculator`; independent JSON backups remain recommended before updating. The packaging change does not alter scientific fitting or the record schema.

## Reproduce on Apple Silicon

```sh
python3 -m pip install --only-binary=:all: -r desktop-ui/scripts/requirements-macos-build.txt
cd desktop-ui
npm ci
npm run tauri:build -- --ci --target aarch64-apple-darwin --bundles app -- --locked
cd ..
python3 desktop-ui/scripts/macos-package-smoke.py \
  --app desktop-ui/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ElisaCalculator.app \
  --output desktop-ui/artifacts/macos
```

Use native ARM64 CPython 3.12, Node 24.15+, Rust and Xcode command-line tools. PyInstaller applies its own ad-hoc signatures to the frozen helper. The outer Tauri bundle is also ad-hoc-signed and retains Tauri’s hardened-runtime setting. The resource helper retains PyInstaller’s own ad-hoc executable signature. No macOS system security configuration is changed. A future Developer ID release must separately review hardened-runtime entitlements, nested signatures and notarization.
