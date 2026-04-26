import numpy as np
from scipy.stats import spearmanr


def compute_fit_metrics(y_true, y_pred):
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = np.nan if ss_tot == 0 else 1 - ss_res / ss_tot
    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))
    return {
        'r2': r2,
        'rmse': rmse,
    }


def build_group_warning_notes(x, y, ec50, r2):
    notes = []
    if len(x) < 4:
        notes.append('few data points')

    y_range = float(np.max(y) - np.min(y)) if len(y) else np.nan
    if np.isfinite(y_range) and y_range < 0.3:
        notes.append('small response range')

    try:
        rho, _ = spearmanr(x, y)
        if np.isfinite(rho) and abs(rho) < 0.7:
            notes.append(f'weak monotonicity(r={rho:.2f})')
    except Exception:
        pass

    x_min, x_max = np.min(x), np.max(x)
    if np.isfinite(ec50):
        if ec50 < x_min or ec50 > x_max:
            notes.append('EC50 out of concentration range')
    else:
        notes.append('EC50 unavailable')

    if np.isfinite(r2) and r2 < 0.90:
        notes.append(f'low fit quality(R2={r2:.3f})')

    return notes