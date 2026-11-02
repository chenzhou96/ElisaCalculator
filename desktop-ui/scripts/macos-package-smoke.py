"""Verify a copied Mac app without Python on PATH, then package and verify its DMG."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import tempfile
import time


def startup_result(log):
    matches = re.findall(r'\[window startup result\] (\{[^\n]+\})', log)
    if len(matches) != 1:
        raise ValueError('Expected exactly one native startup result')
    result = json.loads(matches[0])
    if result.get('fit_ok') is not True or result.get('fit_error') is not None:
        raise ValueError(f'Native window sizing failed: {result}')
    if 'visible=Ok(true)' not in log:
        raise ValueError('Native window was not visible')
    return result


def run(command, **kwargs):
    completed = subprocess.run(command, check=False, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, **kwargs)
    if completed.returncode:
        raise RuntimeError(f'Command failed ({completed.returncode}): {command!r}\n{completed.stdout}')
    return completed.stdout


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inspect_app(app):
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    binary = app / 'Contents/MacOS' / info['CFBundleExecutable']
    bridge = app / 'Contents/Resources/bridge/elisa_bridge'
    architectures = {}
    for name, path in (('app', binary), ('bridge', bridge)):
        if not os.access(path, os.X_OK):
            raise RuntimeError(f'Missing executable permission: {path}')
        architectures[name] = run(['lipo', '-archs', str(path)]).strip()
        if architectures[name] != 'arm64':
            raise RuntimeError(f'Unexpected {name} architecture: {architectures[name]}')
        run(['codesign', '--verify', '--strict', str(path)])
    run(['codesign', '--verify', '--deep', '--strict', str(app)])
    signature = run(['codesign', '-dvv', str(app)])
    if 'Signature=adhoc' not in signature or 'Authority=Developer ID' in signature:
        raise RuntimeError('Expected only an ad-hoc signature for this unsigned-by-Apple build')
    if info.get('LSMinimumSystemVersion') != '14.0':
        raise RuntimeError(f'Unexpected minimum macOS: {info.get("LSMinimumSystemVersion")}')
    return info, binary, bridge, architectures, signature


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('Mac packaging smoke tests require a native ARM64 Mac')
    app = args.app.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    info, _, _, _, _ = inspect_app(app)
    commit = run(['git', 'rev-parse', 'HEAD'], cwd=root).strip()
    if os.environ.get('GITHUB_SHA') and commit != os.environ['GITHUB_SHA']:
        raise RuntimeError('Checkout and workflow commit differ')
    with tempfile.TemporaryDirectory(prefix='elisa-mac-安装 测试-') as temporary:
        workspace = Path(temporary)
        installed = workspace / app.name
        run(['ditto', str(app), str(installed)])
        _, binary, bridge, architectures, signature = inspect_app(installed)
        environment = dict(os.environ)
        for key in ('PYTHONHOME', 'PYTHONPATH', 'ELISA_PROJECT_ROOT'):
            environment.pop(key, None)
        empty_path = workspace / 'empty-path'
        empty_path.mkdir()
        environment.update(PATH=str(empty_path), HOME=str(workspace),
                           MPLCONFIGDIR=str(workspace / 'matplotlib'),
                           XDG_CACHE_HOME=str(workspace / 'cache'))
        if any(shutil.which(name, path=environment['PATH']) for name in ('python', 'python3', 'py')):
            raise RuntimeError('Smoke environment unexpectedly exposes a Python interpreter')
        build_info = json.loads(run([str(bridge), '--build-info'], env=environment, cwd=workspace))
        if build_info.get('frozen') is not True:
            raise RuntimeError('The bundled engine is not frozen')
        test_env = dict(environment, ELISA_BRIDGE_TEST_EXECUTABLE=str(bridge))
        # Invoke this harness by absolute interpreter path; its child engine has no Python on PATH.
        import sys
        contracts = run([sys.executable, '-m', 'unittest', 'discover', '-s',
                         str(root / 'desktop-ui/scripts'), '-p', 'test_windows_packaging.py', '-v'],
                        env=test_env, cwd=workspace)
        (output / 'frozen-bridge-unittest.log').write_text(contracts, encoding='utf-8')
        with (output / 'native-startup.log').open('w', encoding='utf-8') as stream:
            process = subprocess.Popen([str(binary)], cwd=workspace, env=environment,
                                       stdout=stream, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 60
                result = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError(f'Native app exited early with {process.returncode}')
                    log = (output / 'native-startup.log').read_text(encoding='utf-8')
                    if re.search(r'\[window startup result\] \{[^\n]+\}\r?\n', log):
                        result = startup_result(log)
                        break
                    time.sleep(0.5)
                if result is None:
                    raise RuntimeError('Native startup did not complete within 60 seconds')
                time.sleep(5)
                if process.poll() is not None:
                    raise RuntimeError('Native app exited immediately after startup')
                result = startup_result((output / 'native-startup.log').read_text(encoding='utf-8'))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
        (output / 'codesign-verification.txt').write_text(signature, encoding='utf-8')
        stage = workspace / 'dmg-root'
        stage.mkdir()
        run(['ditto', str(installed), str(stage / app.name)])
        (stage / 'Applications').symlink_to('/Applications')
        dmg = output / f'ElisaCalculator_{info["CFBundleShortVersionString"]}_macOS-arm64_{commit[:7]}.dmg'
        run(['hdiutil', 'create', '-volname', 'ElisaCalculator', '-srcfolder', str(stage),
             '-ov', '-format', 'UDZO', str(dmg)])
        run(['hdiutil', 'verify', str(dmg)])
        mount = workspace / 'mounted'
        mount.mkdir()
        run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(dmg)])
        try:
            _, mounted_binary, mounted_bridge, _, _ = inspect_app(mount / app.name)
            if sha256(mounted_binary) != sha256(binary) or sha256(mounted_bridge) != sha256(bridge):
                raise RuntimeError('DMG executable content does not match the verified app')
        finally:
            run(['hdiutil', 'detach', str(mount)])
        metadata = {
            'commit': commit, 'ref': os.environ.get('GITHUB_REF'),
            'version': info['CFBundleShortVersionString'],
            'workflow_run': (f'https://github.com/{os.environ["GITHUB_REPOSITORY"]}/actions/runs/'
                             f'{os.environ["GITHUB_RUN_ID"]}') if os.environ.get('GITHUB_RUN_ID') else None,
            'runner_macos': platform.mac_ver()[0], 'runner_image': os.environ.get('ImageVersion'),
            'architectures': architectures, 'minimum_macos': info['LSMinimumSystemVersion'],
            'code_signature': 'ad-hoc', 'developer_id_signed': False, 'notarized': False,
            'frozen_engine': build_info, 'native_startup': result,
            'native_process_survived_seconds': 5, 'frozen_contract_tests_passed': True,
            'dmg_verified_and_mounted': True, 'm1_imac_user_acceptance_tested': False,
            'quarantined_clean_machine_gatekeeper_tested': False,
            'app_executable_sha256': sha256(binary), 'bridge_executable_sha256': sha256(bridge),
        }
        (output / 'BUILD_METADATA.json').write_text(json.dumps(metadata, indent=2)+'\n', encoding='utf-8')
        shutil.copyfile(root / 'docs/MACOS_VALIDATION.md', output / 'MACOS_README.md')
    hashes = [f'{sha256(path)}  {path.name}' for path in sorted(output.iterdir())
              if path.is_file() and path.name != 'SHA256SUMS.txt']
    (output / 'SHA256SUMS.txt').write_text('\n'.join(hashes)+'\n', encoding='ascii')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
