from pathlib import Path
import sys

if not getattr(sys, 'frozen', False):
    PROJECT_ROOT = Path(__file__).resolve().parents[2]
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

from elisa_calculator.bridge import main

if __name__ == '__main__':
    # Rust writes UTF-8 bytes. PyInstaller's isolated Python initialization may
    # ignore PYTHONIOENCODING and pick the Windows system code page for a pipe.
    sys.stdin.reconfigure(encoding='utf-8')
    raise SystemExit(main())
