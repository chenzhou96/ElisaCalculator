"""Freeze the standalone Apple Silicon engine; run on an ARM64 Mac with CPython 3.12."""
import platform
from pathlib import Path
import subprocess
import sys


def main():
    if sys.platform != 'darwin' or platform.machine() != 'arm64' or sys.version_info[:2] != (3, 12):
        raise SystemExit('The Mac release bridge requires native arm64 macOS and CPython 3.12.')
    root = Path(__file__).resolve().parents[2]
    desktop = root / 'desktop-ui'
    output = desktop / 'src-tauri/resources/bridge'
    work = desktop / 'src-tauri/target/pyinstaller-macos'
    output.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, '-m', 'pip', 'check'], check=True)
    args = [
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console',
        '--target-architecture', 'arm64', '--name', 'elisa_bridge', '--paths', str(root),
        '--distpath', str(output), '--workpath', str(work), '--specpath', str(work),
        '--hidden-import', 'elisa_calculator.bridge', '--collect-submodules', 'elisa_calculator',
        '--hidden-import', 'numpy', '--hidden-import', 'pandas', '--hidden-import', 'scipy',
        '--hidden-import', 'matplotlib', '--hidden-import', 'xml.parsers.expat',
    ]
    for module in ('tkinter', '_tkinter', 'IPython', 'jupyter', 'notebook', 'PyQt5', 'PyQt6',
                   'PySide2', 'PySide6', 'wx', 'bokeh', 'plotly', 'altair', 'sklearn', 'skimage',
                   'xarray', 'dask', 'sqlalchemy', 'numba', 'h5py', 'tables'):
        args.extend(('--exclude-module', module))
    args.append(str(desktop / 'scripts/bridge_entry.py'))
    subprocess.run(args, check=True)
    bridge = output / 'elisa_bridge'
    architecture = subprocess.check_output(['lipo', '-archs', str(bridge)], text=True).strip()
    if architecture != 'arm64':
        raise SystemExit(f'Unexpected bridge architecture: {architecture}')
    subprocess.run(['codesign', '--verify', '--strict', str(bridge)], check=True)
    print(f'Standalone arm64 bridge ready: {bridge}')


if __name__ == '__main__':
    main()
