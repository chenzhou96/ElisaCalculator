import os

import pandas as pd

from ..common import sanitize_filename
from ..visualization.plotting import plot_overview, plot_single_group


def format_results_table(results_list):
    if not results_list:
        return '无有效数据'

    col_group_width = 24
    col_ec50_width = 12
    col_r2_width = 10
    col_status_width = 10

    header = (
        f"{'Group':<{col_group_width}} | {'EC50':^{col_ec50_width}} | "
        f"{'R2':^{col_r2_width}} | {'Status':^{col_status_width}}"
    )
    separator = '-' * len(header)
    lines = [header, separator]

    for item in results_list:
        group = str(item.get('Group', ''))[:col_group_width - 1]
        ec50_val = 'N/A' if pd.isna(item.get('EC50')) else f"{item['EC50']:.4f}"
        r2_val = 'N/A' if pd.isna(item.get('R2')) else f"{item['R2']:.4f}"
        status = str(item.get('Status', ''))[:col_status_width - 1]
        line = (
            f"{group:<{col_group_width}} | {ec50_val:^{col_ec50_width}} | "
            f"{r2_val:^{col_r2_width}} | {status:<{col_status_width}}"
        )
        lines.append(line)
    return '\n'.join(lines)


def save_outputs(detail_obj, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    saved_files = []
    warnings = []

    try:
        summary_df = pd.DataFrame(detail_obj.get('summary_rows', []))
        if not summary_df.empty:
            summary_path = os.path.join(output_dir, 'EC50_Summary.csv')
            summary_df.to_csv(summary_path, index=False, encoding='utf-8-sig')
            saved_files.append(summary_path)
    except Exception as exc:
        warnings.append(f'summary export failed: {exc}')

    detail_rows = detail_obj.get('detailed_rows', [])
    for d in detail_rows:
        group_name = sanitize_filename(d.get('group_name', 'group'))
        plot_path = os.path.join(output_dir, f'{group_name}_fit.png')
        if len(d.get('x', [])) > 0:
            try:
                plot_single_group(d, plot_path)
                saved_files.append(plot_path)
            except Exception as exc:
                warnings.append(f'group plot export failed [{group_name}]: {exc}')

    overview_path = os.path.join(output_dir, 'EC50_AllGroups_Overview.png')
    try:
        if plot_overview(detail_rows, overview_path):
            saved_files.append(overview_path)
    except Exception as exc:
        warnings.append(f'overview export failed: {exc}')

    return {
        'saved_files': saved_files,
        'warnings': warnings,
    }
