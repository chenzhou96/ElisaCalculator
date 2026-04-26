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
    if source_label == 'Paste':
        base_dir = os.path.join(os.path.expanduser('~'), 'Desktop')
        if not os.path.exists(base_dir):
            base_dir = os.getcwd()
    else:
        base_dir = os.path.dirname(source_label) if os.path.dirname(source_label) else os.getcwd()
    outdir = os.path.join(base_dir, f'EC50_GlobalFit_Output_{timestamp}')
    os.makedirs(outdir, exist_ok=True)
    return outdir
