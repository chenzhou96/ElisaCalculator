"""Explicit dose-coordinate validation; no inferred physical concentration."""
import math
import numpy as np

DEFAULT_OPTIONS = {
    'workflow': 'comparative', 'input_mode': 'dilution_step',
    'dilution_factor': 2.0, 'dilution_direction': 'increasing', 'first_step': 1.0,
    'start_concentration': None, 'concentration_unit': '', 'fit_mode': 'shared',
    'reference_group': None, 'reference_assigned_value': 1.0,
    'blank_mode': 'none', 'blank_value': 0.0, 'replicate_mode': 'individual',
    'replicate_groups': {}, 'group_options': {}, 'standard_group': None,
    'allow_extrapolation': False, 'unknown_samples': [],
}
COORDINATE_KEYS = ('input_mode', 'dilution_factor', 'dilution_direction', 'first_step',
                   'start_concentration', 'concentration_unit')


def finite_number(value, name, positive=False):
    if isinstance(value, bool):
        raise ValueError(f'{name} must be a finite number')
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError(f'{name} must be a finite number') from None
    if not math.isfinite(number) or (positive and number <= 0):
        raise ValueError(f'{name} must be finite' + (' and positive' if positive else ''))
    return number


def normalize_options(analysis_options=None):
    if analysis_options is not None and not isinstance(analysis_options, dict):
        raise ValueError('analysis_options must be an object')
    opts = {**DEFAULT_OPTIONS, **(analysis_options or {})}
    unknown = set(opts) - set(DEFAULT_OPTIONS)
    if unknown:
        raise ValueError('unknown analysis option(s): ' + ', '.join(sorted(unknown)))
    for key, choices in {
        'workflow': ('comparative', 'standard_curve'),
        'input_mode': ('raw_concentration', 'log_concentration', 'dilution_step'),
        'fit_mode': ('shared', 'independent'), 'dilution_direction': ('increasing', 'decreasing'),
        'blank_mode': ('none', 'constant'), 'replicate_mode': ('individual', 'mean'),
    }.items():
        if opts[key] not in choices:
            raise ValueError(f'{key} must be one of: {", ".join(choices)}')
    opts['dilution_factor'] = finite_number(opts['dilution_factor'], 'dilution_factor', True)
    if not 2 <= opts['dilution_factor'] <= 10:
        raise ValueError('dilution_factor must be between 2 and 10')
    opts['first_step'] = finite_number(opts['first_step'], 'first_step')
    opts['blank_value'] = finite_number(opts['blank_value'], 'blank_value')
    opts['reference_assigned_value'] = finite_number(opts['reference_assigned_value'], 'reference_assigned_value', True)
    if opts['start_concentration'] is not None:
        opts['start_concentration'] = finite_number(opts['start_concentration'], 'start_concentration', True)
    if not isinstance(opts['concentration_unit'], str):
        raise ValueError('concentration_unit must be a string')
    opts['concentration_unit'] = opts['concentration_unit'].strip()
    for key in ('replicate_groups', 'group_options'):
        if not isinstance(opts[key], dict):
            raise ValueError(f'{key} must be an object')
    if not isinstance(opts['unknown_samples'], list):
        raise ValueError('unknown_samples must be an array')
    if not isinstance(opts['allow_extrapolation'], bool):
        raise ValueError('allow_extrapolation must be a boolean')
    return opts


def coordinate_options(options, group_name):
    overrides = options['group_options'].get(str(group_name), {})
    if not isinstance(overrides, dict) or set(overrides) - set(COORDINATE_KEYS):
        raise ValueError(f'invalid coordinate overrides for {group_name}')
    merged = normalize_options({**options, **overrides})
    coordinate = {key: merged[key] for key in COORDINATE_KEYS}
    absolute = coordinate['input_mode'] != 'dilution_step' or coordinate['start_concentration'] is not None
    coordinate['absolute'] = absolute
    coordinate['dose_unit'] = (coordinate['concentration_unit'] or 'unspecified concentration unit') if absolute else 'relative stock fraction'
    coordinate['axis_label'] = f"log10 dose ({coordinate['dose_unit']})"
    return coordinate


def to_log_dose(raw_x, coordinate):
    values = np.asarray(raw_x, dtype=float)
    mode = coordinate['input_mode']
    if not np.all(np.isfinite(values)):
        raise ValueError('x must be finite')
    if mode == 'raw_concentration':
        if np.any(values <= 0):
            raise ValueError('raw concentration must be positive; a zero-dose blank cannot be log-transformed')
        return np.log10(values)
    if mode == 'log_concentration':
        return values.copy()
    direction = -1.0 if coordinate['dilution_direction'] == 'increasing' else 1.0
    start = coordinate['start_concentration'] or 1.0
    result = math.log10(start) + direction * (values - coordinate['first_step']) * math.log10(coordinate['dilution_factor'])
    if not np.all(np.isfinite(result)):
        raise ValueError('transformed log dose is not finite')
    return result


def dose_to_step(log_dose, coordinate):
    if coordinate['input_mode'] != 'dilution_step':
        return np.nan
    direction = -1.0 if coordinate['dilution_direction'] == 'increasing' else 1.0
    return coordinate['first_step'] + (log_dose - math.log10(coordinate['start_concentration'] or 1.0)) / (direction * math.log10(coordinate['dilution_factor']))


def safe_power10(value):
    if not np.isfinite(value) or value > math.log10(np.finfo(float).max) or value < -323:
        return np.nan
    result = float(10.0 ** value)
    return result if np.isfinite(result) and result > 0 else np.nan
