"""Auditable coordinate conversion, bounded 4PL fitting and quantitation.

The legacy function name is retained; options explicitly choose shared or
independent plateaus and comparative or standard-curve analysis.
"""
from dataclasses import asdict, dataclass, field
from typing import Optional
import math
import platform
import scipy

import numpy as np
import pandas as pd
from scipy.optimize import least_squares
from scipy.stats import t

from .coordinates import (normalize_options, coordinate_options, to_log_dose,
                          dose_to_step, safe_power10, finite_number)
from .evaluator import build_group_warning_notes, compute_fit_metrics
from .model import four_param_logistic, inverse_four_param_logistic


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
    raw_x: list = field(default_factory=list)
    raw_y: list = field(default_factory=list)
    processed_points: list = field(default_factory=list)
    coordinate: dict = field(default_factory=dict)
    residuals: Optional[np.ndarray] = None
    log_ec50_se: float = np.nan
    log_ec50_ci: list = field(default_factory=list)
    fit_diagnostics: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)


@dataclass
class CalculationReport:
    prepared: dict
    fit_success: bool
    fit_error: str
    global_params: dict
    summary_rows: list
    detailed_rows: list
    options: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)
    comparison: dict = field(default_factory=dict)
    unknown_results: list = field(default_factory=list)
    warning_list: list = field(default_factory=list)

    def to_dict(self):
        return {**self.__dict__, 'detailed_rows': [row.to_dict() for row in self.detailed_rows]}


@dataclass
class GlobalFitResult:
    success: bool
    error: str
    group_id_map: dict
    params: Optional[np.ndarray]
    global_A: float = np.nan
    global_D: float = np.nan
    estimates: dict = field(default_factory=dict)
    covariance: Optional[np.ndarray] = None
    c_covariance: dict = field(default_factory=dict)
    diagnostics: dict = field(default_factory=dict)
    failures: dict = field(default_factory=dict)


def _raw_scalar(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, np.generic):
        return value.item()
    return value


def prepare_group_data(df, x_col_name=None, y_cols_names=None, analysis_options=None):
    removed_count = 0
    try:
        options = normalize_options(analysis_options)
        if df is None or df.empty:
            return None, 'data is empty', 0
        if not df.columns.is_unique:
            return None, 'duplicate column names are ambiguous', 0
        columns = list(df.columns)
        if len(columns) < 2:
            return None, 'insufficient columns', 0
        x_col_name = columns[0] if x_col_name is None else x_col_name
        if x_col_name not in columns:
            return None, f'missing x column: {x_col_name}', 0
        y_cols_names = [c for c in columns if c != x_col_name] if y_cols_names is None else y_cols_names
        if isinstance(y_cols_names, (str, bytes)):
            y_cols_names = [y_cols_names]
        if not y_cols_names:
            return None, 'no y columns available for fitting', 0
        if len(set(y_cols_names)) != len(y_cols_names) or x_col_name in y_cols_names:
            return None, 'y column selection must be unique and exclude x', 0
        missing = [str(c) for c in y_cols_names if c not in columns]
        if missing:
            return None, 'missing y column(s): ' + ', '.join(missing), 0

        definitions, used = [], set()
        for name, cols in options['replicate_groups'].items():
            if not str(name).strip() or not isinstance(cols, list) or not cols:
                raise ValueError('replicate_groups requires nonempty named column arrays')
            if len(set(cols)) != len(cols) or any(c not in y_cols_names for c in cols):
                raise ValueError(f'invalid replicate columns for {name}')
            if used.intersection(cols):
                raise ValueError('a column cannot belong to multiple replicate groups')
            definitions.append((str(name), cols))
            used.update(cols)
        definitions.extend((str(c), [c]) for c in y_cols_names if c not in used)
        if len({n for n, _ in definitions}) != len(definitions):
            raise ValueError('replicate group names conflict with response column names')
        unknown_groups = set(options['group_options']) - {n for n, _ in definitions}
        if unknown_groups:
            raise ValueError('group_options names do not match response groups: ' + ', '.join(sorted(unknown_groups)))
        groups = []
        for idx, (name, cols) in enumerate(definitions):
            coordinate = coordinate_options(options, name)
            audit, valid = [], []
            blank = options['blank_value'] if options['blank_mode'] == 'constant' else 0.0
            for position in range(len(df)):
                for col in cols:
                    raw_x, raw_y = df.iloc[position][x_col_name], df.iloc[position][col]
                    record = {'source_row': position + 1, 'source_column': str(col),
                              'raw_x': _raw_scalar(raw_x), 'raw_y': _raw_scalar(raw_y),
                              'log_dose': None, 'processed_y': None, 'included': False, 'exclusion_reason': ''}
                    try:
                        x_num = finite_number(raw_x, 'x')
                        y_num = finite_number(raw_y, 'OD')
                        log_x = float(to_log_dose([x_num], coordinate)[0])
                        y_value = y_num - blank
                        if not np.isfinite(y_value):
                            raise ValueError('blank-corrected OD is not finite')
                        record.update(log_dose=log_x, processed_y=y_value, included=True)
                        valid.append((log_x, y_value))
                    except (ValueError, TypeError) as exc:
                        record['exclusion_reason'] = str(exc)
                        removed_count += 1
                    audit.append(record)
            values = np.asarray(valid, dtype=float).reshape(-1, 2)
            if options['replicate_mode'] == 'mean' and len(values):
                values = np.asarray([(x, np.mean(values[values[:, 0] == x, 1])) for x in sorted(set(values[:, 0]))])
            x, y = values[:, 0], values[:, 1]
            notes = []
            excluded = sum(not r['included'] for r in audit)
            if excluded:
                notes.append(f'excluded {excluded} invalid/nonfinite/domain observations; see input audit')
            if options['replicate_mode'] == 'mean':
                notes.append('replicates averaged per dose; unweighted fit of means')
            elif len(x) > len(np.unique(x)):
                notes.append('replicate observations fit individually with equal weights; technical replicates may not be independent')
            if coordinate['input_mode'] == 'dilution_step' and not coordinate['absolute']:
                notes.append('starting concentration unknown: EC50 is a relative stock fraction, not an absolute concentration')
            if coordinate['absolute'] and not coordinate['concentration_unit']:
                notes.append('concentration unit unspecified; cross-group comparisons require matching units')
            if options['blank_mode'] == 'constant':
                notes.append(f'constant blank subtracted: {blank:g}; negative corrected OD retained')
            reason = ''
            if len(np.unique(x)) < 4:
                reason = 'at least 4 distinct valid doses are required to identify a 4PL curve'
            elif np.max(np.abs(x)) > 1e6 or np.max(np.abs(y)) > 1e100:
                reason = 'input exceeds safe numerical range (|log10 dose| <= 1e6 and |OD| <= 1e100 required)'
            elif np.ptp(y) <= max(1e-12, np.max(np.abs(y)) * 1e-10):
                reason = 'constant response: 4PL parameters are not identifiable'
            groups.append({'group_index': idx, 'group_name': name, 'source_columns': cols,
                           'x': x, 'y': y, 'raw_x': [r['raw_x'] for r in audit],
                           'raw_y': [r['raw_y'] for r in audit], 'processed_points': audit,
                           'coordinate': coordinate, 'status': 'Skipped' if reason else 'Ready',
                           'skip_reason': reason, 'pre_notes': notes, 'n_points': len(x),
                           'n_observations': len(valid), 'n_distinct_doses': len(np.unique(x))})
        ready = [g for g in groups if g['status'] == 'Ready']
        prepared = {'x_col_name': x_col_name, 'groups': groups, 'ready_groups': ready, 'options': options}
        if not ready:
            # Retain the complete audit for failed/insufficient input.
            prepared['preparation_error'] = 'no groups ready for fitting: ' + '; '.join(f"{g['group_name']}: {g['skip_reason']}" for g in groups)
        return prepared, 'Success', removed_count
    except (ValueError, TypeError) as exc:
        return None, str(exc), removed_count


def _fit_batch(groups):
    """OLS with stable parameterization, physical plateau ordering and multistarts."""
    all_y = np.concatenate([g['y'] for g in groups])
    lo, hi = float(all_y.min()), float(all_y.max())
    span = max(hi - lo, 1e-8)
    # q=[lower plateau, log(positive plateau span), log(abs B), C, ...].
    initial, lower, upper = [lo, math.log(span)], [lo - 20*span, math.log(span*1e-5)], [hi, math.log(span*100)]
    signs = []
    for g in groups:
        x, y = g['x'], g['y']
        centered_x, centered_y = x - np.mean(x), y - np.mean(y)
        sign = 1.0 if np.dot(centered_x, centered_y) >= 0 else -1.0
        signs.append(sign)
        width = max(float(np.ptp(x)), 1e-6)
        # The midpoint of observed extremes is an initialization, not an EC50 estimator.
        c0 = float(x[np.argmin(abs(y - (float(y.min()) + float(y.max()))/2))])
        initial.extend([math.log(min(10.0, max(0.1, 4.0/width))), c0])
        lower.extend([math.log(1e-4), float(x.min()) - 4*width])
        upper.extend([math.log(100.0), float(x.max()) + 4*width])
    initial, lower, upper = map(lambda a: np.asarray(a, dtype=float), (initial, lower, upper))
    if not all(np.all(np.isfinite(values)) for values in (initial,lower,upper)):
        raise ValueError('data exceed the finite numerical range for bounded fitting')

    def unpack(q, i):
        return FitParameters(A=float(q[0]), D=float(q[0]+np.exp(q[1])), B=float(signs[i]*np.exp(q[2+2*i])), C=float(q[3+2*i]))

    def residual(q):
        return np.concatenate([(four_param_logistic(g['x'], **asdict(unpack(q, i))) - g['y']) / span for i, g in enumerate(groups)])

    candidates = []
    for slope_scale, midpoint_shift in ((1, 0), (0.35, 0), (3, 0), (1, -0.3), (1, 0.3)):
        seed = initial.copy()
        for i, g in enumerate(groups):
            seed[2+2*i] += math.log(slope_scale)
            seed[3+2*i] += midpoint_shift * np.ptp(g['x'])
        seed = np.clip(seed, lower+1e-9, upper-1e-9)
        try:
            fit = least_squares(residual, seed, bounds=(lower, upper), max_nfev=6000,
                                x_scale='jac', ftol=1e-11, xtol=1e-11, gtol=1e-11)
            if fit.success and np.all(np.isfinite(fit.x)) and np.all(np.isfinite(fit.fun)):
                candidates.append(fit)
        except (ValueError, FloatingPointError, np.linalg.LinAlgError):
            continue
    if not candidates:
        raise ValueError('bounded 4PL optimization failed to converge')
    best = min(candidates, key=lambda fit: float(np.dot(fit.fun, fit.fun)))
    n, p = len(best.fun), len(best.x)
    dof = n-p
    _, singular, vt = np.linalg.svd(best.jac, full_matrices=False)
    tolerance = np.finfo(float).eps * max(best.jac.shape) * singular[0]
    rank = int(np.sum(singular > tolerance))
    condition = float(singular[0]/singular[-1]) if singular[-1] > 0 else np.inf
    near_bound = np.any((best.x-lower) < 1e-5*(upper-lower)) or np.any((upper-best.x) < 1e-5*(upper-lower))
    covariance = None
    if dof > 0 and rank == p and condition < 1e10 and not near_bound:
        # Invert singular values of J directly; forming J.T@J would square
        # the condition number and can spuriously truncate uncertainty.
        covariance = (vt.T / singular**2) @ vt * np.dot(best.fun,best.fun) / dof
    notes = []
    if dof <= 0:
        notes.append('no residual degrees of freedom; confidence intervals unavailable')
    if rank < p or condition >= 1e10:
        notes.append('ill-conditioned or rank-deficient fit; parameters weakly identifiable and confidence intervals unavailable')
    if near_bound:
        notes.append('optimizer reached a parameter bound; estimates may be non-identifiable and confidence intervals are unavailable')
    diagnostics = {'severity': 'unreliable' if near_bound or rank < p or condition >= 1e10 else ('limited' if dof <= 0 else 'ok'),
                   'n_observations': n, 'n_parameters': p, 'residual_degrees_of_freedom': dof,
                   'jacobian_rank': rank, 'jacobian_condition': condition,
                   'at_parameter_bound': bool(near_bound), 'warning_list': notes,
                   'residual_sum_of_squares': float(np.dot(best.fun,best.fun)*span**2),
                   'optimizer': 'scipy.optimize.least_squares; bounded multistart TRF',
                   'optimizer_settings': {'max_nfev':6000, 'ftol':1e-11, 'xtol':1e-11, 'gtol':1e-11, 'x_scale':'jac', 'multistarts':5},
                   'parameterization': '[A, ln(D-A), ln(abs(B1)), C1, ...]; response direction inferred from centered covariance',
                   'parameter_lower_bounds': lower.tolist(), 'parameter_upper_bounds': upper.tolist(),
                   'covariance_method': 'Jacobian SVD; no interval at bounds, rank deficiency, cond(J)>=1e10 or nonpositive residual df',
                   'objective': 'unweighted ordinary least squares',
                   'ci_method': 'approximate Student-t delta-method covariance; conditional on chosen 4PL and replicate assumptions'}
    estimates = {}
    for i, g in enumerate(groups):
        params = unpack(best.x, i)
        se = math.sqrt(max(0, covariance[3+2*i,3+2*i])) if covariance is not None else np.nan
        half_width = t.ppf(.975, dof)*se if np.isfinite(se) else np.nan
        estimates[g['group_index']] = {'params': params, 'log_ec50_se': se,
                                      'log_ec50_ci': [params.C-half_width, params.C+half_width],
                                      'diagnostics': diagnostics, 'q_c_index': 3+2*i}
    return estimates, covariance, diagnostics


def fit_prepared_groups(prepared):
    groups = prepared['ready_groups']
    group_map = {g['group_index']: i for i,g in enumerate(groups)}
    if not groups:
        return GlobalFitResult(False, prepared.get('preparation_error', 'no groups ready for fitting'), group_map, None)
    mode = prepared['options']['fit_mode']
    estimates, failures, c_covariance, diagnostics = {}, {}, {}, {}
    covariance = None
    batches = [groups] if mode == 'shared' else [[g] for g in groups]
    for batch in batches:
        try:
            result, cov, diag = _fit_batch(batch)
            estimates.update(result)
            diagnostics[str(batch[0]['group_name']) if mode == 'independent' else 'shared'] = diag
            if mode == 'shared':
                covariance = cov
            for left in batch:
                for right in batch:
                    pair = (left['group_index'], right['group_index'])
                    c_covariance[pair] = float(cov[result[pair[0]]['q_c_index'], result[pair[1]]['q_c_index']]) if cov is not None else np.nan
        except (ValueError, np.linalg.LinAlgError) as exc:
            for g in batch:
                failures[g['group_index']] = str(exc)
    if not estimates:
        return GlobalFitResult(False, '; '.join(failures.values()), group_map, None, failures=failures)
    first = next(iter(estimates.values()))['params']
    global_A, global_D = (first.A, first.D) if mode == 'shared' else (np.nan, np.nan)
    legacy = [global_A, global_D]
    for g in groups:
        fit = estimates.get(g['group_index'])
        legacy.extend([fit['params'].B,fit['params'].C] if fit else [np.nan,np.nan])
    return GlobalFitResult(True, '', group_map, np.asarray(legacy), global_A, global_D,
                           estimates, covariance, c_covariance, diagnostics, failures)


def _append_warning(row, detail, warning):
    if warning not in row['warning_list']:
        row['warning_list'].append(warning)
    row['Warning'] = '; '.join(row['warning_list'])
    detail.warning_list = list(row['warning_list'])


def _comparison(prepared, fit_result, rows, details):
    options = prepared['options']
    if options['workflow'] != 'comparative':
        return {'enabled': False}
    groups = prepared['groups']
    reference_name = options['reference_group'] or next((r['Group'] for r in rows if r['Status']=='Success'), None)
    by_name = {row['Group']: (g,row,detail) for g,row,detail in zip(groups,rows,details)}
    comparison = {'enabled': True, 'reference_group': reference_name,
                  'reference_assigned_value': options['reference_assigned_value'],
                  'ec50_ratio_definition': 'group EC50 / reference EC50 on the same dose scale',
                  'stock_potency_definition': 'reference assigned X × reference midpoint stock fraction / group midpoint stock fraction',
                  'interpretation': 'Apparent midpoint-based stock strength, conditional on comparable assay response and preparation. Slopes are independently estimated; a common potency across all response levels is not established.',
                  'nonparallel_warning_rule': 'Heuristic slope magnitude ratio outside 0.8–1.25; not a statistical parallelism test',
                  'warning_list': [], 'logEC50_covariance': {}}
    if reference_name not in by_name or by_name[reference_name][1]['Status'] != 'Success':
        warning = 'reference group missing or could not be fitted; comparisons unavailable'
        comparison['warning_list'].append(warning)
        for row, detail in zip(rows,details):
            _append_warning(row,detail,warning)
        return comparison
    ref_g, ref_row, ref_detail = by_name[reference_name]
    for g,row,detail in zip(groups,rows,details):
        if row['Status'] != 'Success':
            continue
        coord, ref_coord = g['coordinate'], ref_g['coordinate']
        valid_domain = coord['absolute'] == ref_coord['absolute']
        valid_unit = coord['concentration_unit'] == ref_coord['concentration_unit']
        # Empty units are identical within this input, but explicitly reported as unspecified.
        if not valid_domain or (coord['absolute'] and not valid_unit):
            _append_warning(row,detail,'comparison unavailable: reference and group use incompatible dose domains or concentration units')
            continue
        if any(d.fit_diagnostics.get('at_parameter_bound') or
               d.fit_diagnostics.get('jacobian_rank',0) < d.fit_diagnostics.get('n_parameters',0) or
               d.fit_diagnostics.get('jacobian_condition',0) >= 1e10 for d in (detail,ref_detail)):
            _append_warning(row,detail,'comparison unavailable: group or reference parameters are not identifiable (bound/rank/conditioning)')
            continue
        delta = row['LogEC50'] - ref_row['LogEC50']
        row['EC50_ratio'] = safe_power10(delta)
        same = g['group_index'] == ref_g['group_index']
        if same:
            variance = 0.0
        else:
            var_g = fit_result.c_covariance.get((g['group_index'], g['group_index']), np.nan)
            var_r = fit_result.c_covariance.get((ref_g['group_index'], ref_g['group_index']), np.nan)
            cross = 0.0 if options['fit_mode']=='independent' else fit_result.c_covariance.get((g['group_index'],ref_g['group_index']), np.nan)
            variance = max(0, var_g + var_r - 2*cross) if np.all(np.isfinite([var_g,var_r,cross])) else np.nan
        for other in groups:
            comparison['logEC50_covariance'].setdefault(g['group_name'], {})[other['group_name']] = fit_result.c_covariance.get((g['group_index'],other['group_index']), 0.0 if options['fit_mode']=='independent' else np.nan)
        df = min(detail.fit_diagnostics.get('residual_degrees_of_freedom',0),ref_detail.fit_diagnostics.get('residual_degrees_of_freedom',0))
        half = 0.0 if same else t.ppf(.975,df)*math.sqrt(variance) if np.isfinite(variance) and df>0 else np.nan
        row['EC50_ratio_CI_low'], row['EC50_ratio_CI_high'] = safe_power10(delta-half),safe_power10(delta+half)
        stock_possible = (coord['input_mode']=='dilution_step' and ref_coord['input_mode']=='dilution_step') or (coord['start_concentration'] is not None and ref_coord['start_concentration'] is not None)
        if stock_possible:
            offset = math.log10(coord['start_concentration'] or 1.0)-math.log10(ref_coord['start_concentration'] or 1.0)
            stock_log = math.log10(options['reference_assigned_value']) - delta + offset
            row['Relative_stock_potency_X'] = safe_power10(stock_log)
            row['Relative_stock_potency_X_CI_low'],row['Relative_stock_potency_X_CI_high'] = safe_power10(stock_log-half),safe_power10(stock_log+half)
        else:
            _append_warning(row,detail,'original-stock potency unavailable without stock concentrations or relative dilution coordinates; EC50 ratio is a concentration midpoint ratio')
        if not same:
            _append_warning(row,detail,'midpoint comparison only: parallel response curves and constant biological potency have not been established')
            reference_qualifiers = ('not well bracketed', 'out of concentration range', 'wide logEC50', 'confidence intervals unavailable', 'low fit quality', 'weak monotonicity')
            if any(any(fragment in note for fragment in reference_qualifiers) for note in ref_detail.warning_list):
                _append_warning(row,detail,'reference EC50 is qualified by fit/range/uncertainty warnings; denominator uncertainty also limits this comparison')
            slope_ratio = abs(detail.params.B / ref_detail.params.B)
            if detail.params.B * ref_detail.params.B < 0:
                for key in ('EC50_ratio','Relative_stock_potency_X','EC50_ratio_CI_low','EC50_ratio_CI_high','Relative_stock_potency_X_CI_low','Relative_stock_potency_X_CI_high'):
                    row[key] = np.nan
                _append_warning(row,detail,'comparison unavailable: reference and group have opposite response directions')
            elif slope_ratio < .8 or slope_ratio > 1.25:
                _append_warning(row,detail,'nonparallel slopes: ratio describes EC50 midpoint only, not a constant potency across response levels')
            if options['fit_mode']=='independent':
                _append_warning(row,detail,'independent plateaus: EC50 refers to each curve’s own response midpoint; common-response potency is not established')
            if not (max(g['x'].min(),ref_g['x'].min()) <= min(g['x'].max(),ref_g['x'].max())):
                _append_warning(row,detail,'dose ranges do not overlap; comparison relies on extrapolated model assumptions')
    return comparison


def _quantitate_unknowns(options, groups, details):
    if options['workflow'] != 'standard_curve':
        return []
    details_map = {d.group_name: (g,d) for g,d in zip(groups,details)}
    default_standard = options['standard_group'] or next((d.group_name for d in details if d.status=='Success'), None)
    results = []
    for index,sample in enumerate(options['unknown_samples']):
        sample = sample if isinstance(sample,dict) else {'od':sample}
        row = {'Sample': str(sample.get('sample_id') or f'Unknown {index+1}'),
               'Standard_group': sample.get('standard_group') or default_standard,
               'OD_raw': [], 'OD_processed': np.nan, 'Dilution_factor': sample.get('dilution_factor',1),
               'Log_concentration': np.nan, 'Concentration': np.nan, 'Corrected_concentration': np.nan,
               'Concentration_unit': '', 'Status': 'Invalid', 'Warning': '', 'warning_list': []}
        try:
            od = sample.get('od')
            raw_od = od if isinstance(od,list) else [od]
            if not raw_od:
                raise ValueError('unknown sample requires at least one OD')
            row['OD_raw'] = [_raw_scalar(value) for value in raw_od]
            values = [finite_number(value,'unknown OD') for value in raw_od]
            dilution = finite_number(sample.get('dilution_factor',1),'unknown dilution factor',True)
            if dilution < 1:
                raise ValueError('unknown dilution factor must be >= 1 (multiplicative correction)')
            row['Dilution_factor'] = dilution
            corrected_od = float(np.mean(values)) - (options['blank_value'] if options['blank_mode']=='constant' else 0)
            row['OD_processed'] = corrected_od
            if row['Standard_group'] not in details_map:
                raise ValueError('selected standard group does not exist')
            group,detail = details_map[row['Standard_group']]
            row['Concentration_unit'] = group['coordinate']['dose_unit']
            if detail.params is None or detail.status != 'Success':
                raise ValueError('selected standard could not be fitted')
            if not group['coordinate']['absolute']:
                raise ValueError('absolute quantitation requires a known standard concentration; dilution steps without a start concentration are relative only')
            if detail.fit_diagnostics.get('at_parameter_bound') or detail.fit_diagnostics.get('jacobian_condition',0)>=1e10 or detail.fit_diagnostics.get('jacobian_rank',0)<detail.fit_diagnostics.get('n_parameters',0):
                raise ValueError('selected standard parameters are not identifiable; inverse quantitation suppressed')
            log_value = float(inverse_four_param_logistic(corrected_od,**asdict(detail.params)))
            outside = not float(group['x'].min()) <= log_value <= float(group['x'].max())
            if outside and not options['allow_extrapolation']:
                row['Status'] = 'Out of range'
                raise ValueError('OD maps outside the measured standard dose range; quantitation suppressed (extrapolation disabled)')
            if outside:
                row['warning_list'].append('extrapolated outside the measured standard dose range; not validated for quantitation')
            fraction = (corrected_od-detail.params.A)/(detail.params.D-detail.params.A)
            if fraction < .01 or fraction > .99:
                row['warning_list'].append('OD is near a fitted asymptote; inverse concentration is highly sensitive to measurement and fit uncertainty')
            concentration, corrected = safe_power10(log_value), safe_power10(log_value+math.log10(dilution))
            if not np.all(np.isfinite([concentration,corrected])):
                raise ValueError('inverse concentration cannot be represented as a finite positive number')
            row.update(Log_concentration=log_value,Concentration=concentration,Corrected_concentration=corrected,
                       Status='Extrapolated' if outside else 'Success')
            if len(values)>1:
                row['warning_list'].append('replicate ODs averaged before inversion; dilution correction applied after inversion')
            row['warning_list'].append('inverse estimate is point-only; calibration, OD and dilution uncertainty are not propagated')
            if detail.warning_list:
                row['warning_list'].append('review standard-curve fit warnings before interpreting this estimate')
        except (ValueError,TypeError) as exc:
            row['warning_list'].append(str(exc))
        row['Warning'] = '; '.join(row['warning_list'])
        results.append(row)
    return results


def build_calculation_report(prepared, fit_result):
    options = prepared['options']
    summary, details = [], []
    for group in prepared['groups']:
        notes = list(group['pre_notes'])
        row = {'Group': group['group_name'],'N': group['n_points'],'N_observations': group['n_observations'],
               'N_distinct_doses':group['n_distinct_doses'],'EC50':np.nan,'LogEC50':np.nan,'EC50_step':np.nan,
               'EC50_unit':group['coordinate']['dose_unit'],'EC50_ratio':np.nan,'Relative_stock_potency_X':np.nan,
               'EC50_ratio_CI_low':np.nan,'EC50_ratio_CI_high':np.nan,'Relative_stock_potency_X_CI_low':np.nan,
               'Relative_stock_potency_X_CI_high':np.nan,'LogEC50_SE':np.nan,'LogEC50_CI_low':np.nan,
               'LogEC50_CI_high':np.nan,'EC50_CI_low':np.nan,'EC50_CI_high':np.nan,
               'Slope':np.nan,'A':np.nan,'D':np.nan,'Global_A':fit_result.global_A,'Global_D':fit_result.global_D,
               'R2':np.nan,'RMSE':np.nan,'X_min':np.nan,'X_max':np.nan,'Y_min':np.nan,'Y_max':np.nan,
               'Status':'Skipped','Warning':'','warning_list':notes}
        detail = GroupCalculationDetail(group['group_name'],group['x'],group['y'],None,'Skipped',notes,
                  skip_reason=group['skip_reason'],raw_x=group['raw_x'],raw_y=group['raw_y'],
                  processed_points=group['processed_points'],coordinate=group['coordinate'])
        estimate = fit_result.estimates.get(group['group_index'])
        if estimate is not None:
            params = estimate['params']
            y_pred = four_param_logistic(group['x'],**asdict(params))
            metrics = compute_fit_metrics(group['y'],y_pred)
            notes += build_group_warning_notes(group['x'],group['y'],params.C,metrics['r2'])
            notes += estimate['diagnostics']['warning_list']
            fraction = (group['y']-params.A)/(params.D-params.A)
            if float(np.min(fraction))>.15 or float(np.max(fraction))<.85:
                notes.append('both plateaus are not well bracketed; EC50 and asymptotes may be weakly identifiable')
            if len(group['x'])<6:
                notes.append('fewer than 6 observations; 4PL uncertainty is poorly supported')
            linear = safe_power10(params.C)
            if not np.isfinite(linear):
                notes.append('EC50 linear value overflows/underflows; inspect logEC50')
            low,high = estimate['log_ec50_ci']
            if np.isfinite(low) and high-low > float(np.ptp(group['x'])):
                notes.append('wide logEC50 confidence interval exceeds the measured log-dose span')
            row.update(EC50=linear,LogEC50=params.C,EC50_step=dose_to_step(params.C,group['coordinate']),
                       LogEC50_SE=estimate['log_ec50_se'],LogEC50_CI_low=low,LogEC50_CI_high=high,
                       EC50_CI_low=safe_power10(low),EC50_CI_high=safe_power10(high),
                       Slope=params.B,A=params.A,D=params.D,R2=metrics['r2'],RMSE=metrics['rmse'],
                       X_min=float(group['x'].min()),X_max=float(group['x'].max()),Y_min=float(group['y'].min()),
                       Y_max=float(group['y'].max()),Status='Success')
            detail.y_pred,detail.params,detail.status = y_pred,params,'Success'
            detail.r2,detail.rmse = metrics['r2'],metrics['rmse']
            detail.residuals = group['y']-y_pred
            for point in detail.processed_points:
                if point['included']:
                    point['fitted_y'] = float(four_param_logistic(point['log_dose'],**asdict(params)))
                    point['residual'] = point['processed_y'] - point['fitted_y']
            detail.log_ec50_se,detail.log_ec50_ci = estimate['log_ec50_se'],estimate['log_ec50_ci']
            detail.fit_diagnostics = estimate['diagnostics']
        else:
            reason = group['skip_reason'] or fit_result.failures.get(group['group_index'],fit_result.error)
            notes.append(reason)
            detail.skip_reason = reason
        row['warning_list'] = list(dict.fromkeys(n for n in notes if n))
        row['Warning'] = '; '.join(row['warning_list'])
        detail.warning_list = list(row['warning_list'])
        summary.append(row)
        details.append(detail)
    comparison = _comparison(prepared,fit_result,summary,details)
    unknowns = _quantitate_unknowns(options,prepared['groups'],details)
    report_warnings = []
    if options['fit_mode']=='shared':
        report_warnings.append('shared A/D assumes common assay background and maximum response; group slopes remain independently fitted')
    if any(d.status!='Success' for d in details):
        report_warnings.append('one or more groups were skipped or failed; inspect per-group results')
    if options['workflow']=='standard_curve' and not options['unknown_samples']:
        report_warnings.append('standard curve fitted; no unknown samples supplied')
    metadata = {'schema_version':2,'software_versions': {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__, 'pandas': pd.__version__},'model':'Y=A+(D-A)*expit(ln(10)*B*(log10dose-C)); C=log10(EC50)',
                'input_mode':options['input_mode'],'fit_mode':options['fit_mode'],'workflow':options['workflow'],
                'axis_label':prepared['groups'][0]['coordinate']['axis_label'] if prepared['groups'] else 'log10 dose',
                'ec50_definition':'EC50=10^C in the fitted dose unit; EC50_step is the interpolated ordinal midpoint',
                'blank_correction':'none' if options['blank_mode']=='none' else f"subtract {options['blank_value']}",
                'replicate_policy':options['replicate_mode'],'fit_diagnostics':fit_result.diagnostics,
                'fit_covariance':fit_result.covariance,
                'uncertainty_note':'Approximate conditional 95% CIs; no plate/run, dilution-factor, starting-concentration or reference assignment uncertainty included.',
                'comparability_note':'No automatic unit conversion. Matching units and dose domains are required.'}
    return CalculationReport(prepared,fit_result.success,fit_result.error,
              {'A':fit_result.global_A,'D':fit_result.global_D,'mode':options['fit_mode']},summary,details,
              options,metadata,comparison,unknowns,report_warnings)


def calculate_ec50_global_df(df, x_col_name=None, y_cols_names=None, analysis_options=None):
    prepared,status,removed = prepare_group_data(df,x_col_name,y_cols_names,analysis_options)
    if prepared is None:
        return [],status,removed,None
    fit_result = fit_prepared_groups(prepared)
    report = build_calculation_report(prepared,fit_result)
    return report.summary_rows, 'Success' if fit_result.success else f'fitting failed: {fit_result.error}', removed, report
