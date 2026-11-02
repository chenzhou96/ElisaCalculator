"""Four-parameter logistic model on a log10 dose axis.

A is the lower plateau, D the upper plateau and C is log10(EC50).
B > 0 describes increasing response with dose; B < 0 decreasing response.
"""
import numpy as np
from scipy.special import expit


def four_param_logistic(x, A, B, C, D):
    x = np.asarray(x, dtype=float)
    # expit avoids overflow even for very wide dose ranges or steep curves.
    return A + (D - A) * expit(np.log(10.0) * B * (x - C))


def inverse_four_param_logistic(y, A, B, C, D):
    """Return log10 dose, rejecting plateaus/out-of-domain responses."""
    y = np.asarray(y, dtype=float)
    if not np.all(np.isfinite([A, B, C, D])) or B == 0 or D <= A:
        raise ValueError('inverse requires finite parameters, D > A and nonzero slope')
    if not np.all(np.isfinite(y)) or np.any(y <= A) or np.any(y >= D):
        raise ValueError('OD must lie strictly between fitted asymptotes')
    return C + (np.log10(y - A) - np.log10(D - y)) / B


def global_four_param_logistic_model(x, group_indices, n_groups, A, D, *bc_flat):
    """Evaluate shared-platform curves with finite, integer-valued group IDs.

    Group IDs may use an integer or floating numeric array; every value must
    identify a group. Reject invalid IDs before allocating the output so no
    observation can be left with an uninitialized value.
    """
    if isinstance(n_groups, (bool, np.bool_)) or not isinstance(n_groups, (int, np.integer)) or n_groups <= 0:
        raise ValueError('n_groups must be a positive integer')
    n_groups = int(n_groups)
    x = np.asarray(x, dtype=float)
    # A mixed Python list would otherwise coerce False/True into numeric IDs.
    has_boolean_index = any(
        isinstance(value, (bool, np.bool_))
        for value in np.asarray(group_indices, dtype=object).flat
    )
    group_indices = np.asarray(group_indices)
    if len(bc_flat) != 2 * n_groups:
        raise ValueError('bc_flat length should be 2 * n_groups')
    if (
        x.shape != group_indices.shape
        or has_boolean_index
        or group_indices.dtype.kind not in 'iuf'
        or not np.all(np.isfinite(group_indices))
        or np.any(group_indices != np.floor(group_indices))
        or np.any(group_indices < 0)
        or np.any(group_indices >= n_groups)
    ):
        raise ValueError('group_indices must match x and identify valid groups')
    result = np.empty_like(x)
    for i, (B, C) in enumerate(np.asarray(bc_flat, dtype=float).reshape(n_groups, 2)):
        mask = group_indices == i
        result[mask] = four_param_logistic(x[mask], A, B, C, D)
    return result
