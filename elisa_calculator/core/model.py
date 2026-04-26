import numpy as np


def four_param_logistic(x, A, B, C, D):
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        return D + (A - D) / (1 + (x / C) ** B)


def global_four_param_logistic_model(x, group_indices, n_groups, A, D, *bc_flat):
    res = np.zeros_like(x, dtype=float)
    if len(bc_flat) != 2 * n_groups:
        raise ValueError('bc_flat length should be 2 * n_groups')

    bc_params = np.array(bc_flat, dtype=float).reshape((n_groups, 2))
    for i in range(n_groups):
        mask = group_indices == i
        if not np.any(mask):
            continue
        B_i, C_i = bc_params[i]
        res[mask] = four_param_logistic(x[mask], A, B_i, C_i, D)
    return res
