"""Reference reassignment from a pristine, unrounded fit without refitting.

The versioned context is captured before the first comparison mutates warnings.
It contains fitted rows, dose domains, full covariance matrices and their C
parameter indexes. Every edit starts there, so repeated reference changes are
history-independent. Saved reports without this context are deliberately not
upgraded from rounded ratios, marginal SEs or other display values.
"""
from copy import deepcopy
import math

import numpy as np

from .coordinates import finite_number


REFERENCE_CONTEXT_SCHEMA = 'elisa-reference-fit-context/1'
REFERENCE_RESULT_KEYS = (
    'Normalized_midpoint_X', 'Normalized_midpoint_X_CI_low',
    'Normalized_midpoint_X_CI_high', 'EC50_ratio', 'EC50_ratio_CI_low',
    'EC50_ratio_CI_high', 'Relative_stock_potency_X',
    'Relative_stock_potency_X_CI_low', 'Relative_stock_potency_X_CI_high',
    'warning_list', 'Warning',
)


def build_reference_fit_context(prepared, fit_result, summary_rows, detailed_rows):
    """Copy fit artifacts before any reference-dependent fields are populated."""
    groups = prepared['groups']
    return deepcopy({
        'schema': REFERENCE_CONTEXT_SCHEMA,
        'options': prepared['options'],
        'groups': [{key: group[key] for key in
                    ('group_index', 'group_name', 'x', 'coordinate')} for group in groups],
        'summary_rows': summary_rows,
        'detailed_rows': [detail.to_dict() for detail in detailed_rows],
        'parameter_c_indexes': {
            group['group_name']: fit_result.estimates[group['group_index']]['q_c_index']
            for group in groups if group['group_index'] in fit_result.estimates
        },
        # Retain full original matrices, not only marginal midpoint variances.
        # Independent fits have one matrix per group and exactly zero cross-
        # group covariance; shared fits retain their fitted cross terms.
        'fit_covariance': fit_result.covariance,
        'batch_covariances': fit_result.batch_covariances,
    })


def _unavailable(message):
    return ValueError('reference editing unavailable: ' + message)


def _restore_fit_context(report):
    """Validate and hydrate serialized artifacts; no input parsing or fitting."""
    from .processing import FitParameters, GlobalFitResult, GroupCalculationDetail

    if not isinstance(report, dict):
        raise _unavailable('report must be an object')
    if report.get('fit_success') is not True:
        raise _unavailable('the stored analysis has no successful fit')
    context = report.get('metadata', {}).get('reference_fit_context')
    if not isinstance(context, dict) or context.get('schema') != REFERENCE_CONTEXT_SCHEMA:
        raise _unavailable('saved report has no pristine fit context; run the analysis again')
    context = deepcopy(context)
    options = context.get('options')
    if not isinstance(options, dict) or options.get('workflow') != 'comparative':
        raise _unavailable('only comparative analyses support reference reassignment')
    if options.get('fit_mode') not in ('shared', 'independent'):
        raise _unavailable('saved fit mode is invalid')
    current_options = report.get('options')
    reference_keys = {'reference_group', 'reference_assigned_value'}
    if (not isinstance(current_options, dict)
            or {k: v for k, v in current_options.items() if k not in reference_keys}
            != {k: v for k, v in options.items() if k not in reference_keys}):
        raise _unavailable('scientific settings differ from the saved fit; run the analysis again')
    groups, rows, detail_records = (context.get(key) for key in
                                    ('groups', 'summary_rows', 'detailed_rows'))
    if (not isinstance(groups, list) or not groups or not isinstance(rows, list)
            or not isinstance(detail_records, list) or len(groups) != len(rows)
            or len(groups) != len(detail_records)):
        raise _unavailable('saved pristine fit rows are incomplete; run the analysis again')
    current_rows, current_details = report.get('summary_rows'), report.get('detailed_rows')
    if (not isinstance(current_rows, list) or not isinstance(current_details, list)
            or len(current_rows) != len(rows) or len(current_details) != len(detail_records)):
        raise _unavailable('stored result rows do not match the pristine fit context')
    for original, current in zip(rows, current_rows):
        if (not isinstance(original, dict) or not isinstance(current, dict)
                or {k: v for k, v in original.items() if k not in REFERENCE_RESULT_KEYS}
                != {k: v for k, v in current.items() if k not in REFERENCE_RESULT_KEYS}):
            raise _unavailable('stored fitted results differ from the pristine context; run the analysis again')
    for original, current in zip(detail_records, current_details):
        if (not isinstance(original, dict) or not isinstance(current, dict)
                or {k: v for k, v in original.items() if k != 'warning_list'}
                != {k: v for k, v in current.items() if k != 'warning_list'}):
            raise _unavailable('stored fit details differ from the pristine context; run the analysis again')
    names, indexes, details = set(), set(), []
    for group, row, record in zip(groups, rows, detail_records):
        if not all(isinstance(item, dict) for item in (group, row, record)):
            raise _unavailable('saved pristine fit rows are invalid')
        name, index = group.get('group_name'), group.get('group_index')
        if (not isinstance(name, str) or name in names or not isinstance(index, int)
                or isinstance(index, bool) or index in indexes
                or row.get('Group') != name or record.get('group_name') != name
                or not isinstance(group.get('coordinate'), dict)):
            raise _unavailable('saved group identities or dose coordinates are invalid')
        names.add(name)
        indexes.add(index)
        group['x'] = np.asarray(group.get('x'), dtype=float)
        params = record.get('params')
        if params is not None:
            params = FitParameters(**params)
        record['params'] = params
        detail = GroupCalculationDetail(**record)
        if row.get('Status') == 'Success':
            if (detail.status != 'Success' or params is None
                    or not all(math.isfinite(float(value)) for value in
                               (params.A, params.B, params.C, params.D, row.get('LogEC50')))
                    or params.B == 0 or params.D <= params.A
                    or params.C != row['LogEC50']
                    or group['x'].ndim != 1 or not len(group['x'])
                    or not np.all(np.isfinite(group['x']))):
                raise _unavailable('saved successful group has incomplete unrounded fit parameters')
        details.append(detail)

    # Extract midpoint covariance from the complete fitted matrices by the
    # original optimization indexes; never infer missing covariance from CIs.
    c_indexes, batches = context.get('parameter_c_indexes'), context.get('batch_covariances')
    if not isinstance(c_indexes, dict) or not isinstance(batches, dict):
        raise _unavailable('saved full covariance context is incomplete')
    covariance_by_batch = {}
    for name, matrix in batches.items():
        if matrix is None:
            covariance_by_batch[name] = None
            continue
        values = np.asarray(matrix, dtype=float)
        if (values.ndim != 2 or values.shape[0] != values.shape[1]
                or not np.all(np.isfinite(values))):
            raise _unavailable('saved full covariance matrix is invalid')
        covariance_by_batch[name] = values
    successful = [g for g, row in zip(groups, rows) if row.get('Status') == 'Success']
    midpoint_covariance = {}
    for left in successful:
        for right in successful:
            left_name, right_name = left['group_name'], right['group_name']
            left_index, right_index = c_indexes.get(left_name), c_indexes.get(right_name)
            batch_name = 'shared' if options['fit_mode'] == 'shared' else left_name
            if (batch_name not in covariance_by_batch
                    or any(not isinstance(index, int) or isinstance(index, bool)
                           or index < 0 for index in (left_index, right_index))):
                raise _unavailable('saved midpoint covariance indexes are incomplete')
            matrix = covariance_by_batch[batch_name]
            if options['fit_mode'] == 'independent' and left_name != right_name:
                covariance = 0.0
            elif matrix is None:
                covariance = np.nan  # The original fit could not support CIs.
            elif max(left_index, right_index) >= matrix.shape[0]:
                raise _unavailable('saved midpoint covariance index is out of range')
            else:
                covariance = float(matrix[left_index, right_index])
            midpoint_covariance[(left['group_index'], right['group_index'])] = covariance
    fit_result = GlobalFitResult(True, '', {}, None, c_covariance=midpoint_covariance)
    return {'options': options, 'groups': groups}, fit_result, rows, details


def renormalize_report(report, reference_group, reference_assigned_value):
    """Return a cloned serialized report with only reference results updated.

    A missing/failed reference is an explicit error. Incompatible dose domains,
    opposite response directions and non-identifiable fits keep their original
    scientific comparison-unavailable behavior and warnings.
    """
    from .processing import _comparison

    if not isinstance(reference_group, str) or not reference_group.strip():
        raise ValueError('reference_group must name a successfully fitted group')
    assigned = finite_number(reference_assigned_value, 'reference_assigned_value', True)
    try:
        prepared, fit_result, rows, details = _restore_fit_context(report)
    except (KeyError, TypeError, AttributeError, OverflowError) as exc:
        raise _unavailable('saved pristine fit context is incomplete or invalid') from exc
    selected = next((row for row in rows if row['Group'] == reference_group), None)
    if selected is None or selected.get('Status') != 'Success':
        raise ValueError('reference_group must name a successfully fitted group; missing, skipped or failed references cannot be selected')
    prepared['options'].update(reference_group=reference_group,
                               reference_assigned_value=assigned)
    comparison = _comparison(prepared, fit_result, rows, details)
    updated = deepcopy(report)
    if (not isinstance(updated.get('summary_rows'), list)
            or not isinstance(updated.get('detailed_rows'), list)
            or [row.get('Group') for row in updated['summary_rows']] != [row['Group'] for row in rows]
            or [detail.get('group_name') for detail in updated['detailed_rows']] != [d.group_name for d in details]):
        raise _unavailable('stored result rows do not match the pristine fit context')
    # Preserve all stored fit values, diagnostics, raw/processed audit, residuals
    # and fit uncertainty byte-for-byte after JSON serialization. Only these
    # comparison fields and warnings may change.
    for target, source in zip(updated['summary_rows'], rows):
        for key in REFERENCE_RESULT_KEYS:
            target[key] = source[key]
    for target, source in zip(updated['detailed_rows'], details):
        target['warning_list'] = list(source.warning_list)
    updated['options'].update(reference_group=reference_group,
                              reference_assigned_value=assigned)
    updated['comparison'] = comparison
    return updated
