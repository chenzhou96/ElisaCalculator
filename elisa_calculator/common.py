import os
import re
import sys
from datetime import datetime


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath('.')
    return os.path.join(base_path, relative_path)


def sanitize_filename(name):
    name = str(name).strip()
    if not name:
        return 'group'
    return re.sub(r'[\\/:*?"<>|]+', '_', name)


def make_output_dir(source_label='Paste'):
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    if sys.platform.startswith('win'):
        cache_root = os.environ.get('LOCALAPPDATA') or os.environ.get('APPDATA')
        if not cache_root:
            cache_root = os.path.join(os.path.expanduser('~'), 'AppData', 'Local')
    elif sys.platform == 'darwin':
        cache_root = os.path.join(os.path.expanduser('~'), 'Library', 'Caches')
    else:
        cache_root = os.environ.get('XDG_CACHE_HOME') or os.path.join(os.path.expanduser('~'), '.cache')

    app_cache_dir = os.path.join(cache_root, 'Elisa_calculator')
    outdir = os.path.join(app_cache_dir, f'EC50_GlobalFit_Output_{timestamp}')
    os.makedirs(outdir, exist_ok=True)
    return outdir
