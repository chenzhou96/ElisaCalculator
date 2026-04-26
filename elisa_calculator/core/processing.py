from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

from .evaluator import build_group_warning_notes, compute_fit_metrics
from .model import four_param_logistic, global_four_param_logistic_model


@dataclass
class FitParameters:
    A: float
    B: float
    C: float
    D: float


@dataclass
class GroupCalculationDetail:
    group_name: str
    x: np.ndarray
    y: np.ndarray
    y_pred: Optional[np.ndarray]
    status: str
    warning_list: list
    skip_reason: str = ''
    params: Optional[FitParameters] = None
    r2: float = np.nan
    rmse: float = np.nan

    def to_dict(self):
        data = asdict(self)
        return data


@dataclass
class CalculationReport:
    prepared: dict
    fit_success: bool
    fit_error: str
    global_params: dict
    summary_rows: list
    detailed_rows: list

    def to_dict(self):
        return {
            'prepared': self.prepared,
            'fit_success': self.fit_success,
            'fit_error': self.fit_error,
            'global_params': self.global_params,
            'summary_rows': self.summary_rows,
            'detailed_rows': [row.to_dict() for row in self.detailed_rows],
        }


@dataclass
class GlobalFitResult:
    success: bool
    error: str
    group_id_map: dict
    params: Optional[np.ndarray]
    global_A: float = np.nan
    global_D: float = np.nan


def prepare_group_data(df, x_col_name=None, y_cols_names=None):
    removed_x_nonpositive_total = 0
    groups = []

    if df is None or df.empty:
        return None, 'data is empty', removed_x_nonpositive_total

    columns = df.columns.tolist()
    if len(columns) < 2:
        return None, 'insufficient columns', removed_x_nonpositive_total

    if x_col_name is None:
        x_col_name = columns[0]
    if y_cols_names is None:
        # Use all columns except the chosen x column by default.
        y_cols_names = [col for col in columns if col != x_col_name]
    elif isinstance(y_cols_names, (str, bytes)):
        y_cols_names = [y_cols_names]

    if not y_cols_names:
        return None, 'no y columns available for fitting', removed_x_nonpositive_total

    if x_col_name not in df.columns:
        return None, f'missing x column: {x_col_name}', removed_x_nonpositive_total

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

        notes = []
        if n_non_numeric_removed > 0:
            notes.append(f'removed non-numeric/missing {n_non_numeric_removed}')

        if len(tmp) < 3:
            groups.append({
                'group_index': idx,
                'group_name': y_col,
                'x': np.array([], dtype=float),
                'y': np.array([], dtype=float),
                'status': 'Skipped',
                'skip_reason': 'valid points less than 3',
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
        return None, 'no valid groups', removed_x_nonpositive_total

    ready_groups = [g for g in groups if g['status'] == 'Ready']
    if not ready_groups:
        return None, 'no groups ready for fitting', removed_x_nonpositive_total

    return {
        'x_col_name': x_col_name,
        'groups': groups,
        'ready_groups': ready_groups,
    }, 'Success', removed_x_nonpositive_total


def fit_prepared_groups(prepared):
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
        init_c = med if np.isfinite(med) else 0.0
        initial_params.extend([init_b, init_c])

    initial_params = np.array(initial_params, dtype=float)
    lower_bounds = [-np.inf, -np.inf] + [-np.inf, -np.inf] * n_groups
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
        return GlobalFitResult(
            success=False,
            error=str(e),
            group_id_map=group_id_map,
            params=None,
        )

    return GlobalFitResult(
        success=True,
        error='',
        group_id_map=group_id_map,
        params=popt,
        global_A=float(popt[0]),
        global_D=float(popt[1]),
    )


def build_calculation_report(prepared, fit_result):
    summary_rows = []
    detailed_rows = []

    for g in prepared['groups']:
        row = {
            'Group': g['group_name'],
            'N': g.get('n_points', 0),
            'EC50': np.nan,
            'Slope': np.nan,
            'Global_A': fit_result.global_A,
            'Global_D': fit_result.global_D,
            'R2': np.nan,
            'RMSE': np.nan,
            'X_min': np.nan,
            'X_max': np.nan,
            'Y_min': np.nan,
            'Y_max': np.nan,
            'Status': 'Skipped' if g['status'] != 'Ready' else 'Unknown',
            'Warning': '; '.join(g.get('pre_notes', [])),
        }

        detail = GroupCalculationDetail(
            group_name=g['group_name'],
            x=g.get('x', np.array([], dtype=float)),
            y=g.get('y', np.array([], dtype=float)),
            y_pred=None,
            status=row['Status'],
            warning_list=list(g.get('pre_notes', [])),
            skip_reason=g.get('skip_reason', ''),
        )

        if g['status'] != 'Ready':
            if g.get('skip_reason'):
                detail.warning_list.append(g['skip_reason'])
            row['Warning'] = '; '.join(detail.warning_list)
            detailed_rows.append(detail)
            summary_rows.append(row)
            continue

        fit_idx = fit_result.group_id_map[g['group_index']]
        idx_b = 2 + fit_idx * 2
        idx_c = idx_b + 1
        b_val = float(fit_result.params[idx_b])
        c_val = float(fit_result.params[idx_c])

        x = g['x']
        y = g['y']
        y_pred = four_param_logistic(x, fit_result.global_A, b_val, c_val, fit_result.global_D)

        metrics = compute_fit_metrics(y, y_pred)
        r2 = metrics['r2']
        rmse = metrics['rmse']

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

        detail.y_pred = y_pred
        detail.status = 'Success'
        detail.warning_list = warn_list
        detail.params = FitParameters(A=fit_result.global_A, B=b_val, C=c_val, D=fit_result.global_D)
        detail.r2 = r2
        detail.rmse = rmse

        detailed_rows.append(detail)
        summary_rows.append(row)

    return CalculationReport(
        prepared=prepared,
        fit_success=True,
        fit_error='',
        global_params={'A': fit_result.global_A, 'D': fit_result.global_D},
        summary_rows=summary_rows,
        detailed_rows=detailed_rows,
    )


def calculate_ec50_global_df(df, x_col_name=None, y_cols_names=None):
    prepared, status_msg, removed_count = prepare_group_data(df, x_col_name, y_cols_names)
    if prepared is None:
        return [], status_msg, removed_count, None

    fit_result = fit_prepared_groups(prepared)
    if not fit_result.success:
        report = CalculationReport(
            prepared=prepared,
            fit_success=False,
            fit_error=fit_result.error,
            global_params={},
            summary_rows=[],
            detailed_rows=[],
        )
        return [], f'global fitting failed: {fit_result.error}', removed_count, report

    report = build_calculation_report(prepared, fit_result)
    summary_rows = report.summary_rows
    return summary_rows, 'Success', removed_count, report
