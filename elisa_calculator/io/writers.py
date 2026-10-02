"""Traceable exports, with truthful per-file failures and collision-safe names."""
import json
import math
import os
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from ..common import sanitize_filename
from ..visualization.plotting import plot_overview, plot_single_group


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _safe_csv(data):
    """Prevent user-provided labels being interpreted as spreadsheet formulas."""
    frame = pd.DataFrame(data)
    for col in frame.columns:
        frame[col] = frame[col].map(lambda v: "'" + v if isinstance(v, str) and v.lstrip().startswith(('=', '+', '-', '@')) else v)
    frame.columns = ["'" + str(v) if str(v).lstrip().startswith(('=', '+', '-', '@')) else v for v in frame.columns]
    return frame


def format_results_table(results_list):
    if not results_list:
        return '无有效数据'
    return pd.DataFrame(results_list).to_string(index=False)


def save_outputs(detail_obj, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    saved_files, warnings = [], []

    def save(name, callback):
        path = os.path.join(output_dir, name)
        try:
            callback(path)
            if not os.path.isfile(path):
                raise OSError('no file was produced')
            saved_files.append(path)
        except Exception as exc:
            warnings.append(f'{name}: {exc}')

    def csv(name, rows):
        if rows:
            save(name, lambda path: _safe_csv(rows).to_csv(path, index=False, encoding='utf-8-sig'))

    csv('EC50_Summary.csv', detail_obj.get('summary_rows', []))
    csv('Unknown_Samples.csv', detail_obj.get('unknown_results', []))
    details = detail_obj.get('detailed_rows', [])
    audit = []
    for i, d in enumerate(details):
        for point in d.get('processed_points', []):
            audit.append({'Group': d.get('group_name', ''), **point})
        # Prefix with original stable index: sanitization cannot collide.
        name = f"{i + 1:03d}_{sanitize_filename(d.get('group_name', 'group'))[:100]}_fit.png"
        if len(d.get('x', [])):
            save(name, lambda path, detail=d: plot_single_group(detail, path, detail_obj.get('options')))
    csv('Input_Audit.csv', audit)
    if any(len(d.get('x', [])) for d in details):
        save('EC50_AllGroups_Overview.png', lambda path: plot_overview(details, path, detail_obj.get('options')))

    # Full raw + processed report is the canonical replay/audit record.
    def write_record(path):
        with open(path, 'w', encoding='utf-8') as out:
            json.dump(_json_safe({'record_schema': 'elisa-report-v2',
                                 'exported_at': datetime.now(timezone.utc).isoformat(),
                                 'report': detail_obj,
                                 'exported_files': [os.path.basename(p) for p in saved_files],
                                 'export_warnings': warnings}), out, ensure_ascii=False, allow_nan=False, indent=2)
    save('Analysis_Record.json', write_record)
    return {'saved_files': saved_files, 'warnings': warnings}
