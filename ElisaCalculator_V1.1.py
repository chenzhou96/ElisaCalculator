import os
import re
import sys
import threading
import traceback
import warnings
from datetime import datetime
from io import StringIO

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from scipy.stats import spearmanr

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

try:
    import pyperclip
except Exception:
    pyperclip = None

warnings.filterwarnings('ignore')


# =============================
# Matplotlib 中文字体设置
# =============================
def configure_matplotlib_chinese_font():
    """
    为导出的 PNG 图设置可用中文字体，尽量避免标题、坐标轴、图例、注释中的中文乱码。
    优先级：
    1) 程序目录 / 打包目录中的字体文件
    2) 系统已安装中文字体
    3) matplotlib 默认 sans-serif 回退
    返回: (font_name, font_source, font_prop)
    """
    candidate_font_files = [
        'msyh.ttc',
        'msyhbd.ttc',
        'simhei.ttf',
        'simsun.ttc',
        'Deng.ttf',
        'PingFang.ttc',
        'NotoSansCJK-Regular.ttc',
        'NotoSansCJKsc-Regular.otf',
        'SourceHanSansCN-Regular.otf',
        'SourceHanSansSC-Regular.otf',
    ]

    search_dirs = []
    try:
        if getattr(sys, 'frozen', False):
            search_dirs.append(os.path.dirname(sys.executable))
    except Exception:
        pass
    try:
        search_dirs.append(os.path.dirname(os.path.abspath(__file__)))
    except Exception:
        pass
    try:
        search_dirs.append(resource_path(''))
    except Exception:
        pass

    seen = set()
    for base_dir in search_dirs:
        if not base_dir or base_dir in seen:
            continue
        seen.add(base_dir)
        for fname in candidate_font_files:
            font_path = os.path.join(base_dir, fname)
            if os.path.isfile(font_path):
                try:
                    font_prop = fm.FontProperties(fname=font_path)
                    font_name = font_prop.get_name()
                    matplotlib.rcParams['font.family'] = 'sans-serif'
                    matplotlib.rcParams['font.sans-serif'] = [font_name, 'DejaVu Sans']
                    matplotlib.rcParams['axes.unicode_minus'] = False
                    return font_name, font_path, font_prop
                except Exception:
                    pass

    installed_names = {f.name for f in fm.fontManager.ttflist}
    candidate_font_names = [
        'Microsoft YaHei',
        'SimHei',
        'DengXian',
        'SimSun',
        'PingFang SC',
        'Heiti SC',
        'Noto Sans CJK SC',
        'Noto Sans SC',
        'Source Han Sans CN',
        'Source Han Sans SC',
        'WenQuanYi Zen Hei',
        'Arial Unicode MS',
    ]

    for font_name in candidate_font_names:
        if font_name in installed_names:
            try:
                font_prop = fm.FontProperties(family=font_name)
                matplotlib.rcParams['font.family'] = 'sans-serif'
                matplotlib.rcParams['font.sans-serif'] = [font_name, 'DejaVu Sans']
                matplotlib.rcParams['axes.unicode_minus'] = False
                return font_name, 'system', font_prop
            except Exception:
                pass

    matplotlib.rcParams['font.family'] = 'sans-serif'
    matplotlib.rcParams['font.sans-serif'] = candidate_font_names + ['DejaVu Sans']
    matplotlib.rcParams['axes.unicode_minus'] = False
    return 'DejaVu Sans (fallback)', 'fallback', fm.FontProperties(family='DejaVu Sans')


MATPLOTLIB_FONT_NAME, MATPLOTLIB_FONT_SOURCE, CN_FONT_PROP = configure_matplotlib_chinese_font()


def font_kwargs(size=None, weight=None):
    kwargs = {}
    if CN_FONT_PROP is not None:
        kwargs['fontproperties'] = CN_FONT_PROP
    if size is not None:
        kwargs['fontsize'] = size
    if weight is not None:
        kwargs['fontweight'] = weight
    return kwargs


# =============================
# 基础工具
# =============================
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


# =============================
# 模型函数
# =============================
def four_param_logistic(x, A, B, C, D):
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        return D + (A - D) / (1 + (x / C) ** B)


def global_four_param_logistic_model(x, group_indices, n_groups, A, D, *bc_flat):
    res = np.zeros_like(x, dtype=float)
    if len(bc_flat) != 2 * n_groups:
        raise ValueError('bc_flat 长度应为 2 * n_groups')

    bc_params = np.array(bc_flat, dtype=float).reshape((n_groups, 2))
    for i in range(n_groups):
        mask = group_indices == i
        if not np.any(mask):
            continue
        B_i, C_i = bc_params[i]
        res[mask] = four_param_logistic(x[mask], A, B_i, C_i, D)
    return res


# =============================
# 数据读取与表头识别
# =============================
def infer_separator(raw_text):
    sample_lines = [line for line in raw_text.splitlines() if line.strip()][:8]
    if not sample_lines:
        return ','
    if any(',' in line for line in sample_lines):
        return ','
    if any('\t' in line for line in sample_lines):
        return '\t'
    return r'\s+'


def build_default_columns(n_cols):
    if n_cols < 2:
        return []
    return ['concentration'] + [f'col_{i}' for i in range(1, n_cols)]


def read_table_from_raw_text(raw_text):
    """
    先按 header=None 读取原始文本，再判断首列是否全为数字：
    - 若首列全为数字 => 视为无表头，使用默认列名 concentration, col_1, col_2...
    - 否则 => 视为有表头，按第一行作为表头读取
    返回: df, meta(dict)
    """
    if not raw_text or not raw_text.strip():
        return None, {'error': '输入为空'}

    lines = [line for line in raw_text.splitlines() if line.strip()]
    if not lines:
        return None, {'error': '输入为空'}

    raw = '\n'.join(lines)
    sep = infer_separator(raw)

    # 先无表头读取，用于判断首列是否全为数字
    try:
        preview_df = pd.read_csv(StringIO(raw), sep=sep, engine='python', header=None)
    except Exception as e:
        return None, {'error': f'无法解析数据: {e}'}

    if preview_df is None or preview_df.empty or preview_df.shape[1] < 2:
        return None, {'error': '列数不足，至少需要 2 列'}

    first_col = preview_df.iloc[:, 0].astype(str).str.strip()
    first_col_numeric = pd.to_numeric(first_col, errors='coerce').notna().all()

    if first_col_numeric:
        df = preview_df.copy()
        df.columns = build_default_columns(df.shape[1])
        header_mode = 'auto_default'
        header_note = '检测到首列全为数字，已按“无表头数据”处理，并自动使用默认列名。'
    else:
        try:
            df = pd.read_csv(StringIO(raw), sep=sep, engine='python', header=0)
        except Exception as e:
            return None, {'error': f'表头读取失败: {e}'}
        if df is None or df.empty or df.shape[1] < 2:
            return None, {'error': '读取失败或列数不足'}
        header_mode = 'user_header'
        header_note = '检测到表头，已按用户原始列名处理。'

    df.attrs['header_mode'] = header_mode
    df.attrs['header_note'] = header_note
    df.attrs['separator'] = sep
    return df, {
        'header_mode': header_mode,
        'header_note': header_note,
        'separator': sep,
        'columns': list(df.columns),
    }


def read_text_file_with_fallbacks(file_path):
    encodings = ['utf-8-sig', 'utf-8', 'gbk', 'gb18030', 'latin1']
    last_error = None
    for enc in encodings:
        try:
            with open(file_path, 'r', encoding=enc) as f:
                text = f.read()
            if text and text.strip():
                return text, enc, None
        except Exception as e:
            last_error = e
    return None, None, last_error


def preview_dataframe_text(df, n=5):
    try:
        return df.head(n).to_string(index=False)
    except Exception:
        return ''


# =============================
# 预处理与异常检测
# =============================
def prepare_group_data(df, x_col_name=None, y_cols_names=None):
    removed_x_nonpositive_total = 0
    groups = []

    if df is None or df.empty:
        return None, '数据为空', removed_x_nonpositive_total

    columns = df.columns.tolist()
    if len(columns) < 2:
        return None, '列数不足，至少需要1列浓度和1列响应值', removed_x_nonpositive_total

    if x_col_name is None:
        x_col_name = columns[0]
    if y_cols_names is None:
        y_cols_names = columns[1:]

    if x_col_name not in df.columns:
        return None, f'找不到X轴列: {x_col_name}', removed_x_nonpositive_total

    x_raw_series = df[x_col_name]

    for idx, y_col in enumerate(y_cols_names):
        if y_col not in df.columns:
            continue

        tmp = pd.DataFrame({'x': x_raw_series, 'y': df[y_col]})
        n_input = len(tmp)
        tmp = tmp.apply(pd.to_numeric, errors='coerce')
        n_after_numeric = len(tmp.dropna())
        tmp = tmp.dropna().copy()
        n_non_numeric_removed = n_input - n_after_numeric

        nonpositive_mask = tmp['x'] <= 0
        removed_nonpositive = int(nonpositive_mask.sum())
        if removed_nonpositive > 0:
            tmp = tmp.loc[~nonpositive_mask].copy()
        removed_x_nonpositive_total += removed_nonpositive

        notes = []
        if n_non_numeric_removed > 0:
            notes.append(f'移除非数值/缺失 {n_non_numeric_removed} 个')
        if removed_nonpositive > 0:
            notes.append(f'移除非正浓度 {removed_nonpositive} 个')

        if len(tmp) < 3:
            groups.append({
                'group_index': idx,
                'group_name': y_col,
                'x': np.array([], dtype=float),
                'y': np.array([], dtype=float),
                'status': 'Skipped',
                'skip_reason': '有效数据点少于 3 个',
                'pre_notes': notes,
                'n_points': len(tmp),
            })
            continue

        x = tmp['x'].to_numpy(dtype=float)
        y = tmp['y'].to_numpy(dtype=float)

        groups.append({
            'group_index': idx,
            'group_name': y_col,
            'x': x,
            'y': y,
            'status': 'Ready',
            'skip_reason': '',
            'pre_notes': notes,
            'n_points': len(tmp),
        })

    if not groups:
        return None, '无有效数据组', removed_x_nonpositive_total

    ready_groups = [g for g in groups if g['status'] == 'Ready']
    if not ready_groups:
        return None, '无可用于拟合的数据组', removed_x_nonpositive_total

    return {
        'x_col_name': x_col_name,
        'groups': groups,
        'ready_groups': ready_groups,
    }, 'Success', removed_x_nonpositive_total


def build_group_warning_notes(x, y, ec50, r2):
    notes = []
    if len(x) < 4:
        notes.append('数据点较少')

    y_range = float(np.max(y) - np.min(y)) if len(y) else np.nan
    if np.isfinite(y_range) and y_range < 0.3:
        notes.append('响应范围较小')

    try:
        rho, _ = spearmanr(x, y)
        if np.isfinite(rho) and abs(rho) < 0.7:
            notes.append(f'单调性较弱(r={rho:.2f})')
    except Exception:
        pass

    x_min, x_max = np.min(x), np.max(x)
    if np.isfinite(ec50):
        if ec50 < x_min or ec50 > x_max:
            notes.append('EC50 超出实验浓度范围')
    else:
        notes.append('EC50 无法确定')

    if np.isfinite(r2) and r2 < 0.90:
        notes.append(f'拟合度偏低(R²={r2:.3f})')

    return notes


# =============================
# 核心计算
# =============================
def calculate_ec50_global_df(df, x_col_name=None, y_cols_names=None):
    prepared, status_msg, removed_count = prepare_group_data(df, x_col_name, y_cols_names)
    if prepared is None:
        return [], status_msg, removed_count, None

    ready_groups = prepared['ready_groups']
    all_x = np.concatenate([g['x'] for g in ready_groups]).astype(float)
    all_y = np.concatenate([g['y'] for g in ready_groups]).astype(float)

    group_id_map = {g['group_index']: i for i, g in enumerate(ready_groups)}
    group_indices = np.concatenate([
        np.full(len(g['x']), group_id_map[g['group_index']], dtype=int)
        for g in ready_groups
    ])
    n_groups = len(ready_groups)

    global_y_min = float(np.min(all_y))
    global_y_max = float(np.max(all_y))
    initial_params = [global_y_min, global_y_max]

    for g in ready_groups:
        x_grp, y_grp = g['x'], g['y']
        init_b = -1.0 if (len(y_grp) > 1 and y_grp[0] > y_grp[-1]) else 1.0
        med = np.median(x_grp)
        init_c = med if med > 0 else 1.0
        initial_params.extend([init_b, init_c])

    initial_params = np.array(initial_params, dtype=float)
    lower_bounds = [-np.inf, -np.inf] + [-np.inf, 1e-12] * n_groups
    upper_bounds = [np.inf, np.inf] + [np.inf, np.inf] * n_groups

    fit_model = lambda x, A, D, *bc_flat: global_four_param_logistic_model(
        x, group_indices, n_groups, A, D, *bc_flat
    )

    try:
        popt, _ = curve_fit(
            fit_model,
            all_x,
            all_y,
            p0=initial_params,
            maxfev=20000,
            bounds=(lower_bounds, upper_bounds)
        )
    except Exception as e:
        return [], f'全局拟合失败: {str(e)}', removed_count, {
            'prepared': prepared,
            'fit_success': False,
            'fit_error': str(e),
        }

    global_A = float(popt[0])
    global_D = float(popt[1])

    summary_rows = []
    detailed_rows = []

    for g in prepared['groups']:
        row = {
            'Group': g['group_name'],
            'N': g.get('n_points', 0),
            'EC50': np.nan,
            'Slope': np.nan,
            'Global_A': global_A,
            'Global_D': global_D,
            'R2': np.nan,
            'RMSE': np.nan,
            'X_min': np.nan,
            'X_max': np.nan,
            'Y_min': np.nan,
            'Y_max': np.nan,
            'Status': 'Skipped' if g['status'] != 'Ready' else 'Unknown',
            'Warning': '; '.join(g.get('pre_notes', [])),
        }

        detail = {
            'group_name': g['group_name'],
            'x': g.get('x', np.array([], dtype=float)),
            'y': g.get('y', np.array([], dtype=float)),
            'y_pred': None,
            'status': row['Status'],
            'warning_list': list(g.get('pre_notes', [])),
            'skip_reason': g.get('skip_reason', ''),
        }

        if g['status'] != 'Ready':
            if g.get('skip_reason'):
                detail['warning_list'].append(g['skip_reason'])
            row['Warning'] = '; '.join(detail['warning_list'])
            detailed_rows.append(detail)
            summary_rows.append(row)
            continue

        fit_idx = group_id_map[g['group_index']]
        idx_b = 2 + fit_idx * 2
        idx_c = idx_b + 1
        b_val = float(popt[idx_b])
        c_val = float(popt[idx_c])

        x = g['x']
        y = g['y']
        y_pred = four_param_logistic(x, global_A, b_val, c_val, global_D)

        ss_res = float(np.sum((y - y_pred) ** 2))
        ss_tot = float(np.sum((y - np.mean(y)) ** 2))
        r2 = np.nan if ss_tot == 0 else 1 - ss_res / ss_tot
        rmse = float(np.sqrt(np.mean((y - y_pred) ** 2)))

        warn_list = list(g.get('pre_notes', []))
        warn_list.extend(build_group_warning_notes(x, y, c_val, r2))
        warn_list = list(dict.fromkeys([w for w in warn_list if w]))

        row.update({
            'EC50': c_val,
            'Slope': b_val,
            'R2': r2,
            'RMSE': rmse,
            'X_min': float(np.min(x)),
            'X_max': float(np.max(x)),
            'Y_min': float(np.min(y)),
            'Y_max': float(np.max(y)),
            'Status': 'Success',
            'Warning': '; '.join(warn_list),
        })

        detail.update({
            'y_pred': y_pred,
            'status': 'Success',
            'warning_list': warn_list,
            'params': {
                'A': global_A,
                'B': b_val,
                'C': c_val,
                'D': global_D,
            },
            'r2': r2,
            'rmse': rmse,
        })

        detailed_rows.append(detail)
        summary_rows.append(row)

    detail_obj = {
        'prepared': prepared,
        'fit_success': True,
        'fit_error': '',
        'global_params': {'A': global_A, 'D': global_D},
        'summary_rows': summary_rows,
        'detailed_rows': detailed_rows,
    }
    return summary_rows, 'Success', removed_count, detail_obj


# =============================
# 导出结果与绘图
# =============================
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


def plot_single_group(detail_row, output_path):
    x = detail_row['x']
    y = detail_row['y']
    group_name = detail_row['group_name']
    status = detail_row['status']

    plt.figure(figsize=(6.8, 5.2))
    plt.scatter(x, y, s=42, label='Observed')

    title = group_name
    if status == 'Success' and detail_row.get('params'):
        p = detail_row['params']
        xmin = max(np.min(x), 1e-12)
        xmax = max(np.max(x), xmin * 1.01)
        xfit = np.geomspace(xmin, xmax, 300)
        yfit = four_param_logistic(xfit, p['A'], p['B'], p['C'], p['D'])
        plt.plot(xfit, yfit, linewidth=2, label='4PL Fit')
        plt.axvline(p['C'], linestyle='--', linewidth=1.2, label=f"EC50={p['C']:.4g}")
        title += f"\nEC50={p['C']:.4g}, R²={detail_row.get('r2', np.nan):.3f}"
    else:
        title += '\n拟合未完成'

    plt.xscale('log')
    plt.xlabel('Concentration (log scale)', **font_kwargs())
    plt.ylabel('Response', **font_kwargs())
    plt.title(title, **font_kwargs())
    plt.legend(loc='best', fontsize=9, prop=CN_FONT_PROP)
    plt.tight_layout()
    plt.savefig(output_path, dpi=220, bbox_inches='tight')
    plt.close()


def plot_overview(detail_rows, output_path):
    valid_rows = [d for d in detail_rows if len(d.get('x', [])) > 0]
    if not valid_rows:
        return False

    n = len(valid_rows)
    ncols = 2 if n > 1 else 1
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(7.5 * ncols, 4.8 * nrows))
    axes = np.array(axes).reshape(-1)

    for ax in axes[n:]:
        ax.axis('off')

    for ax, d in zip(axes, valid_rows):
        x = d['x']
        y = d['y']
        ax.scatter(x, y, s=28, label='Observed')
        title = d['group_name']

        if d['status'] == 'Success' and d.get('params'):
            p = d['params']
            xmin = max(np.min(x), 1e-12)
            xmax = max(np.max(x), xmin * 1.01)
            xfit = np.geomspace(xmin, xmax, 300)
            yfit = four_param_logistic(xfit, p['A'], p['B'], p['C'], p['D'])
            ax.plot(xfit, yfit, linewidth=1.8)
            ax.axvline(p['C'], linestyle='--', linewidth=1.0)
            title += f"\nEC50={p['C']:.4g}, R²={d.get('r2', np.nan):.3f}"
        else:
            title += '\n拟合未完成'

        ax.set_xscale('log')
        ax.set_xlabel('Concentration', **font_kwargs())
        ax.set_ylabel('Response', **font_kwargs())
        ax.set_title(title, **font_kwargs(size=10))

        warns = d.get('warning_list', [])
        if warns:
            warn_txt = '；'.join(warns[:2])
            ax.text(
                0.02, 0.04, warn_txt, transform=ax.transAxes, fontsize=8,
                va='bottom', ha='left',
                bbox=dict(boxstyle='round,pad=0.22', alpha=0.10),
                **font_kwargs(size=8)
            )

    fig.suptitle('4PL Global Fit Overview (Shared A/D)', y=1.01, **font_kwargs(size=14))
    fig.tight_layout()
    fig.savefig(output_path, dpi=220, bbox_inches='tight')
    plt.close(fig)
    return True


def save_outputs(detail_obj, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    saved_files = []

    summary_df = pd.DataFrame(detail_obj.get('summary_rows', []))
    if not summary_df.empty:
        summary_path = os.path.join(output_dir, 'EC50_Summary.csv')
        summary_df.to_csv(summary_path, index=False, encoding='utf-8-sig')
        saved_files.append(summary_path)

    detail_rows = detail_obj.get('detailed_rows', [])
    for d in detail_rows:
        group_name = sanitize_filename(d['group_name'])
        plot_path = os.path.join(output_dir, f'{group_name}_fit.png')
        if len(d.get('x', [])) > 0:
            plot_single_group(d, plot_path)
            saved_files.append(plot_path)

    overview_path = os.path.join(output_dir, 'EC50_AllGroups_Overview.png')
    if plot_overview(detail_rows, overview_path):
        saved_files.append(overview_path)

    return saved_files


# =============================
# GUI 应用
# =============================

class ElisaCalculatorApp:
    def __init__(self, root):
        self.root = root
        self.colors = {
            'bg': '#F3F6FB',
            'panel': '#FFFFFF',
            'hero': '#0F172A',
            'text': '#0F172A',
            'subtext': '#475569',
            'muted': '#64748B',
            'border': '#D8E2F0',
            'accent': '#2563EB',
            'accent_hover': '#1D4ED8',
            'soft': '#EAF2FF',
            'success': '#0F766E',
            'warning': '#B45309',
            'log_bg': '#FBFDFF',
        }
        self.file_var = tk.StringVar()
        self.status_var = tk.StringVar(value='就绪')
        self.last_output_dir = None
        self._build_root()
        self._build_styles()
        self._build_ui()

    def _build_root(self):
        self.root.title('ELISA Calculator')
        self.root.geometry('1240x860')
        self.root.minsize(1080, 720)
        self.root.configure(bg=self.colors['bg'])
        try:
            icon_path = resource_path('Ab.ico')
            if os.path.exists(icon_path):
                self.root.iconbitmap(icon_path)
        except Exception:
            pass

    def _build_styles(self):
        style = ttk.Style()
        try:
            style.theme_use('clam')
        except Exception:
            pass

        style.configure('App.TFrame', background=self.colors['bg'])
        style.configure('Title.TLabel', background=self.colors['panel'], foreground=self.colors['text'], font=('Segoe UI', 13, 'bold'))
        style.configure('Body.TLabel', background=self.colors['panel'], foreground=self.colors['subtext'], font=('Segoe UI', 10))
        style.configure('Muted.TLabel', background=self.colors['panel'], foreground=self.colors['muted'], font=('Segoe UI', 9))
        style.configure('Accent.TButton', font=('Segoe UI', 10, 'bold'), padding=(14, 10), foreground='white', background=self.colors['accent'], borderwidth=0)
        style.map('Accent.TButton', background=[('active', self.colors['accent_hover']), ('pressed', self.colors['accent_hover'])])
        style.configure('Soft.TButton', font=('Segoe UI', 10), padding=(12, 9), foreground=self.colors['text'], background=self.colors['soft'], borderwidth=0)
        style.map('Soft.TButton', background=[('active', '#DCEAFF')])
        style.configure('Modern.TEntry', padding=8)
        style.configure('Modern.TNotebook', background=self.colors['bg'], borderwidth=0, tabmargins=(0, 0, 0, 0))
        style.configure('Modern.TNotebook.Tab', padding=(18, 10), font=('Segoe UI', 10, 'bold'))
        style.map('Modern.TNotebook.Tab', background=[('selected', self.colors['panel']), ('active', '#EEF4FF')])

    def _make_card(self, parent, padding=16):
        outer = tk.Frame(parent, bg=self.colors['bg'])
        card = tk.Frame(
            outer,
            bg=self.colors['panel'],
            highlightthickness=1,
            highlightbackground=self.colors['border'],
            bd=0
        )
        card.pack(fill='both', expand=True)
        inner = tk.Frame(card, bg=self.colors['panel'], padx=padding, pady=padding)
        inner.pack(fill='both', expand=True)
        return outer, inner

    def _make_textbox(self, parent, height=10, font=('Consolas', 10)):
        wrapper = tk.Frame(parent, bg=self.colors['panel'], highlightthickness=1, highlightbackground=self.colors['border'])
        text = scrolledtext.ScrolledText(
            wrapper,
            wrap=tk.NONE,
            height=height,
            font=font,
            relief='flat',
            bd=0,
            highlightthickness=0,
            bg=self.colors['log_bg'],
            fg=self.colors['text'],
            insertbackground=self.colors['text'],
            padx=10,
            pady=10
        )
        text.pack(fill='both', expand=True)
        return wrapper, text

    def _build_ui(self):
        main = ttk.Frame(self.root, style='App.TFrame', padding=18)
        main.pack(fill='both', expand=True)

        # Hero
        hero = tk.Frame(main, bg=self.colors['hero'], padx=24, pady=22)
        hero.pack(fill='x', pady=(0, 14))
        tk.Label(
            hero,
            text='ELISA 4PL Global Fit Studio',
            bg=self.colors['hero'], fg='white',
            font=('Segoe UI', 22, 'bold')
        ).pack(anchor='w')
        tk.Label(
            hero,
            text='EC50 自动计算系统',
            bg=self.colors['hero'], fg='#CBD5E1',
            font=('Segoe UI', 10)
        ).pack(anchor='w', pady=(6, 0))

        # Main content: left workspace + right log sidebar
        content = tk.Frame(main, bg=self.colors['bg'])
        content.pack(fill='both', expand=True)

        paned = tk.PanedWindow(content, orient=tk.HORIZONTAL, sashwidth=6, bg=self.colors['bg'], bd=0, relief='flat', showhandle=False)
        paned.pack(fill='both', expand=True)

        left = tk.Frame(paned, bg=self.colors['bg'])
        right = tk.Frame(paned, bg=self.colors['bg'])
        paned.add(left, minsize=620, stretch='always')
        paned.add(right, minsize=320)

        # Left: notebook
        notebook_wrap, notebook_inner = self._make_card(left, padding=0)
        notebook_wrap.pack(fill='x', expand=False, pady=(0, 14))

        notebook = ttk.Notebook(notebook_inner, style='Modern.TNotebook', height=295)
        notebook.pack(fill='x', expand=False)
        self.notebook = notebook

        file_tab = tk.Frame(notebook, bg=self.colors['panel'])
        paste_tab = tk.Frame(notebook, bg=self.colors['panel'])
        notebook.add(file_tab, text='文件导入')
        notebook.add(paste_tab, text='直接粘贴')

        # File tab compact layout
        file_inner = tk.Frame(file_tab, bg=self.colors['panel'], padx=18, pady=18)
        file_inner.pack(fill='x', anchor='n')
        ttk.Label(file_inner, text='从 CSV / 文本文件导入', style='Title.TLabel').pack(anchor='w')
        ttk.Label(
            file_inner,
            text='支持 utf-8 / gbk / gb18030 等常见编码, 程序会自动识别是否存在表头',
            style='Body.TLabel', wraplength=620
        ).pack(anchor='w', pady=(6, 14))

        row = tk.Frame(file_inner, bg=self.colors['panel'])
        row.pack(fill='x')
        self.file_entry = ttk.Entry(row, textvariable=self.file_var, style='Modern.TEntry')
        self.file_entry.pack(side='left', fill='x', expand=True)
        ttk.Button(row, text='浏览文件', style='Soft.TButton', command=self.select_file).pack(side='left', padx=(10, 0))

        hint_box = tk.Frame(file_inner, bg='#F8FBFF', highlightthickness=1, highlightbackground=self.colors['border'])
        hint_box.pack(fill='x', pady=(12, 0))
        tk.Label(
            hint_box,
            text='格式要求: 第一列为浓度, 后续每列为一个组, 兼容无表头数据',
            bg='#F8FBFF', fg=self.colors['muted'], font=('Segoe UI', 9), justify='left', wraplength=640, padx=12, pady=10
        ).pack(anchor='w')

        # Paste tab
        paste_inner = tk.Frame(paste_tab, bg=self.colors['panel'], padx=18, pady=18)
        paste_inner.pack(fill='both', expand=True)
        ttk.Label(paste_inner, text='粘贴 Excel / 文本数据', style='Title.TLabel').pack(anchor='w')
        ttk.Label(
            paste_inner,
            text='支持逗号, Tab, 或空格分隔, 若首列全部为数字, 则按无表头数据处理, 并使用默认列名',
            style='Body.TLabel', wraplength=640
        ).pack(anchor='w', pady=(6, 12))

        paste_box_wrap, self.text_paste_input = self._make_textbox(paste_inner, height=11, font=('Consolas', 10))
        paste_box_wrap.pack(fill='both', expand=True)

        paste_btn_row = tk.Frame(paste_inner, bg=self.colors['panel'])
        paste_btn_row.pack(fill='x', pady=(10, 0))
        ttk.Button(paste_btn_row, text='从剪贴板粘贴', style='Soft.TButton', command=self.paste_from_clipboard).pack(side='left')
        ttk.Button(paste_btn_row, text='清空粘贴区', style='Soft.TButton', command=self.clear_paste).pack(side='left', padx=(8, 0))

        notebook.select(paste_tab)

        # Left: action card
        action_wrap, action_inner = self._make_card(left, padding=16)
        action_wrap.pack(fill='both', expand=True)
        top_action = tk.Frame(action_inner, bg=self.colors['panel'])
        top_action.pack(fill='x')
        tk.Label(top_action, text='执行与状态', bg=self.colors['panel'], fg=self.colors['text'], font=('Segoe UI', 12, 'bold')).pack(side='left')
        tk.Label(top_action, textvariable=self.status_var, bg=self.colors['panel'], fg=self.colors['success'], font=('Segoe UI', 10, 'bold')).pack(side='right')

        tk.Label(
            action_inner,
            text='计算完成后会自动输出: EC50_Summary.csv, 每组拟合曲线图, 以及所有组总览图',
            bg=self.colors['panel'], fg=self.colors['subtext'], font=('Segoe UI', 10), wraplength=760, justify='left'
        ).pack(anchor='w', pady=(6, 12))

        primary_btn_row = tk.Frame(action_inner, bg=self.colors['panel'])
        primary_btn_row.pack(fill='x', pady=(2, 0))
        self.btn_calculate = ttk.Button(
            primary_btn_row,
            text='开始计算',
            style='Accent.TButton',
            command=self.start_unified_calculation
        )
        self.btn_calculate.pack(fill='x')

        btn_row = tk.Frame(action_inner, bg=self.colors['panel'])
        btn_row.pack(fill='x', pady=(10, 0))
        ttk.Button(btn_row, text='清空当前输入', style='Soft.TButton', command=self.clear_current_input).pack(side='left')
        ttk.Button(btn_row, text='复制输出日志', style='Soft.TButton', command=self.copy_output_to_clipboard).pack(side='left', padx=(10, 0))
        self.btn_open_output = ttk.Button(btn_row, text='打开输出目录', style='Soft.TButton', command=self.open_output_dir)
        self.btn_open_output.pack(side='left', padx=(10, 0))
        ttk.Button(btn_row, text='清空输出日志', style='Soft.TButton', command=self.clear_output).pack(side='left', padx=(10, 0))

        note_spacer = tk.Frame(action_inner, bg=self.colors['panel'])
        note_spacer.pack(fill='both', expand=True)

        note_row = tk.Frame(action_inner, bg=self.colors['panel'])
        note_row.pack(fill='x', pady=(10, 0))
        tk.Label(
            note_row,
            text='提示: 运行过程中请勿关闭程序, 否则可能会导致数据丢失',
            bg=self.colors['panel'], fg=self.colors['muted'], font=('Segoe UI', 9), justify='left'
        ).pack(side='left', anchor='w')

        # Right: sidebar log/results
        result_wrap, result_inner = self._make_card(right, padding=16)
        result_wrap.pack(fill='both', expand=True)
        head = tk.Frame(result_inner, bg=self.colors['panel'])
        head.pack(fill='x')
        ttk.Label(head, text='运行日志与结果汇总', style='Title.TLabel').pack(side='left')
        tk.Label(
            head,
            text='',
            bg=self.colors['panel'], fg=self.colors['success'], font=('Segoe UI', 9, 'bold')
        ).pack(side='right')

        ttk.Label(
            result_inner,
            text='这里显示计算过程和输出数据的文本摘要',
            style='Body.TLabel', wraplength=340
        ).pack(anchor='w', pady=(6, 12))

        output_wrap, self.text_output = self._make_textbox(result_inner, height=30, font=('Consolas', 10))
        output_wrap.pack(fill='both', expand=True)

        footer = tk.Label(
            main,
            text='Version 1.1 for XMJ, GCY, LH, LSZ',
            bg=self.colors['bg'], fg=self.colors['muted'], font=('Segoe UI', 9)
        )
        footer.pack(anchor='w', pady=(10, 0))

    # ---------- UI helpers ----------
    def append_output(self, text):
        self.text_output.insert(tk.END, text)
        self.text_output.see(tk.END)

    def clear_output(self):
        self.text_output.delete('1.0', tk.END)

    def clear_paste(self):
        self.text_paste_input.delete('1.0', tk.END)

    def clear_file(self):
        self.file_var.set('')

    def clear_current_input(self):
        current = self.notebook.index(self.notebook.select())
        if current == 0:
            self.clear_file()
        else:
            self.clear_paste()

    def open_output_dir(self):
        if not self.last_output_dir or not os.path.isdir(self.last_output_dir):
            messagebox.showinfo('提示', '当前还没有可打开的输出目录，请先运行一次计算。')
            return
        try:
            if sys.platform.startswith('win'):
                os.startfile(self.last_output_dir)
            elif sys.platform == 'darwin':
                import subprocess
                subprocess.Popen(['open', self.last_output_dir])
            else:
                import subprocess
                subprocess.Popen(['xdg-open', self.last_output_dir])
        except Exception as e:
            messagebox.showerror('错误', f'无法打开输出目录：{e}')

    def set_busy(self, is_busy, status_text=None):
        self.btn_calculate.configure(state=('disabled' if is_busy else 'normal'))
        if status_text:
            self.status_var.set(status_text)

    def ui(self, func, *args, **kwargs):
        self.root.after(0, lambda: func(*args, **kwargs))

    # ---------- user actions ----------
    def select_file(self):
        file_path = filedialog.askopenfilename(
            title='选择 CSV / 文本数据文件',
            filetypes=[('CSV Files', '*.csv'), ('Text Files', '*.txt'), ('All Files', '*.*')]
        )
        if file_path:
            self.file_var.set(file_path)

    def paste_from_clipboard(self):
        try:
            if pyperclip is None:
                raise RuntimeError('未安装 pyperclip')
            clip_text = pyperclip.paste()
            if clip_text:
                self.text_paste_input.delete('1.0', tk.END)
                self.text_paste_input.insert('1.0', clip_text)
        except Exception:
            messagebox.showerror('错误', '无法访问剪贴板，请手动粘贴 (Ctrl+V)，或安装 pyperclip。')

    def copy_output_to_clipboard(self):
        try:
            output_text = self.text_output.get('1.0', tk.END).strip()
            if not output_text:
                messagebox.showwarning('提示', '输出区域为空，无可复制内容。')
                return
            if pyperclip is None:
                raise RuntimeError('未安装 pyperclip')
            pyperclip.copy(output_text)
            messagebox.showinfo('成功', '输出内容已复制到剪贴板。')
        except Exception as e:
            messagebox.showerror('错误', f'复制失败: {str(e)}')

    # ---------- core workflow ----------
    def start_unified_calculation(self):
        raw_text = self.text_paste_input.get('1.0', tk.END).strip()
        file_path = self.file_var.get().strip()

        self.clear_output()
        self.set_busy(True, '处理中...')

        def run_logic():
            try:
                if raw_text:
                    self.process_raw_text(raw_text, source_label='Paste')
                elif file_path and os.path.exists(file_path):
                    self.process_file(file_path)
                else:
                    self.ui(messagebox.showwarning, '提示', '请粘贴数据或选择文件。')
                    self.ui(self.set_busy, False, '就绪')
            except Exception as e:
                self.ui(self.append_output, f'运行错误: {str(e)}\n')
                self.ui(self.set_busy, False, '就绪')

        thread = threading.Thread(target=run_logic, daemon=True)
        thread.start()

    def process_file(self, file_path):
        log_lines = [f"[0/4] 正在读取文件: {os.path.basename(file_path)}\n"]
        self.ui(self.append_output, ''.join(log_lines))

        raw_text, encoding_used, err = read_text_file_with_fallbacks(file_path)
        if raw_text is None:
            self.ui(self.append_output, f'错误：无法读取文件。{err if err else ""}\n')
            self.ui(self.set_busy, False, '就绪')
            return

        self.process_raw_text(raw_text, source_label=file_path, encoding_used=encoding_used)

    def process_raw_text(self, raw_text, source_label='Paste', encoding_used=None):
        log_lines = []
        try:
            df, meta = read_table_from_raw_text(raw_text)
            if df is None:
                log_lines.append('❌ 数据解析失败\n')
                log_lines.append(f"原因: {meta.get('error', '未知错误')}\n")
                log_lines.append('提示：请检查分隔符、空行、合并单元格或文本格式。\n')
                self.ui(self.append_output, ''.join(log_lines))
                self.ui(self.set_busy, False, '就绪')
                return

            log_lines.append(f'[1/4] 数据源: {source_label}\n')
            if encoding_used:
                log_lines.append(f'      文件编码: {encoding_used}\n')
            log_lines.append(f"      数据形状: {df.shape[0]} 行 x {df.shape[1]} 列\n")
            log_lines.append(f"      表头识别: {meta.get('header_note', '')}\n")
            log_lines.append(f"      列名: {', '.join(map(str, meta.get('columns', [])))}\n")
            log_lines.append(f"      图片字体: {MATPLOTLIB_FONT_NAME} ({MATPLOTLIB_FONT_SOURCE})\n")
            log_lines.append('\n[2/4] 数据预览 (前 5 行):\n')
            log_lines.append(preview_dataframe_text(df, n=5) + '\n\n')
            log_lines.append('[3/4] 开始全局拟合 (共享渐近线 A/D，每组独立 B/C)...\n')
            log_lines.append('-' * 42 + '\n')

            results, status_msg, removed_count, detail = calculate_ec50_global_df(df)

            if removed_count > 0:
                log_lines.append(f'⚠️ 已移除 {removed_count} 个非正浓度数据点（4PL 要求 x > 0）\n')

            if status_msg != 'Success':
                log_lines.append(f'拟合出错: {status_msg}\n')
            else:
                gp = detail.get('global_params', {}) if detail else {}
                log_lines.append(
                    f"拟合成功。共享参数: A={gp.get('A', np.nan):.4f}, D={gp.get('D', np.nan):.4f}\n"
                )

            log_lines.append('\n' + '-' * 42 + '\n')
            log_lines.append('[4/4] 计算完成，结果汇总:\n\n')
            log_lines.append(format_results_table(results) + '\n\n')

            if results:
                warn_rows = [r for r in results if str(r.get('Warning', '')).strip()]
                if warn_rows:
                    log_lines.append('异常/提示信息:\n')
                    for r in warn_rows:
                        log_lines.append(f" - {r['Group']}: {r['Warning']}\n")
                    log_lines.append('\n')

                output_dir = make_output_dir(source_label)
                saved_files = save_outputs(detail, output_dir)
                self.last_output_dir = output_dir

                log_lines.append('输出文件位置:\n')
                log_lines.append(f'{output_dir}\n')
                for fp in saved_files:
                    log_lines.append(f'  · {os.path.basename(fp)}\n')
            else:
                log_lines.append('未生成有效结果，无需保存。\n')

        except Exception as e:
            log_lines.append(f'\n[ERROR] 发生未知错误: {str(e)}\n')
            log_lines.append(traceback.format_exc() + '\n')
        finally:
            self.ui(self.append_output, ''.join(log_lines))
            self.ui(self.set_busy, False, '就绪')


def main():
    root = tk.Tk()
    app = ElisaCalculatorApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
