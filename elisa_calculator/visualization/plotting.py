"""Headless plots used identically by on-screen previews and durable exports."""
import base64
from io import BytesIO
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from .fonts import font_kwargs
from ..core.model import four_param_logistic


def _label(options=None):
    options = options or {}
    absolute = options.get('input_mode') != 'dilution_step' or options.get('start_concentration') is not None
    unit = options.get('concentration_unit') or 'unspecified concentration units'
    if not absolute and options.get('dose_basis') == 'dimensionless':
        return 'log10 dose (dimensionless)'
    return f'log10 dose ({unit})' if absolute else 'log10 relative dose (starting dose = 1)'


def _draw(ax, detail, options=None, overview=False):
    x = np.asarray(detail.get('x', []), dtype=float)
    y = np.asarray(detail.get('y', []), dtype=float)
    name = str(detail.get('group_name', 'Group'))
    if not len(x):
        return
    color = None
    if detail.get('params'):
        p = detail['params']
        grid = np.linspace(float(np.min(x)), float(np.max(x)), 240)
        line, = ax.plot(grid, four_param_logistic(grid, p['A'], p['B'], p['C'], p['D']),
                        lw=1.8, label=name if overview else '4PL fit')
        color = line.get_color()
        if not overview and np.isfinite(p['C']):
            ax.axvline(p['C'], color=color, ls='--', lw=1, alpha=.7,
                       label=f"logEC50 = {p['C']:.5g}")
    ax.scatter(x, y, s=24, alpha=.8, color=color,
               label=None if overview and detail.get('params') else (name if overview else 'Observed'))
    ax.set_xlabel(detail.get('coordinate', {}).get('axis_label') or _label(options), **font_kwargs())
    ax.set_ylabel('Response (after configured blank correction)', **font_kwargs())
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(alpha=.15)


def _single_figure(detail, options=None):
    fig, ax = plt.subplots(figsize=(7.2, 4.5), layout='constrained')
    _draw(ax, detail, options)
    title = str(detail.get('group_name', 'Group'))
    r2 = detail.get('r2')
    if r2 is not None and np.isfinite(r2):
        title += f'  |  R² = {r2:.4f}'
    ax.set_title(title, **font_kwargs(size=11))
    ax.legend(fontsize=8)
    warnings = detail.get('warning_list') or []
    if warnings:
        # Full warnings remain in the report; do not obscure data with long text.
        fig.supxlabel(f'{len(warnings)} quality note(s): review the results report', fontsize=8, color='#8a5a14')
    return fig


def _overview_figure(details, options=None):
    valid = [d for d in details if len(d.get('x', []))]
    if not valid:
        return None
    # Never overlay incompatible physical units or relative and absolute domains.
    domains = {}
    for detail in valid:
        coordinate = detail.get('coordinate', {})
        key = (coordinate.get('absolute'), coordinate.get('dose_unit', _label(options)))
        domains.setdefault(key, []).append(detail)
    fig, axes = plt.subplots(len(domains), 1, figsize=(8.2, 5.2 * len(domains)),
                             layout='constrained', squeeze=False)
    for ax, group in zip(axes[:, 0], domains.values()):
        for detail in group:
            _draw(ax, detail, options, overview=True)
        ax.set_title('Dose-response comparison', **font_kwargs(size=12))
        ax.legend(fontsize=8, loc='best', ncol=1 if len(group) < 8 else 2)
    return fig



def plot_single_group(detail_row, output_path, options=None):
    fig = _single_figure(detail_row, options)
    try:
        fig.savefig(output_path, dpi=180, bbox_inches='tight')
    finally:
        plt.close(fig)


def plot_overview(detail_rows, output_path, options=None):
    fig = _overview_figure(detail_rows, options)
    if fig is None:
        return False
    try:
        fig.savefig(output_path, dpi=180, bbox_inches='tight')
    finally:
        plt.close(fig)
    return True


def create_preview_plots(report):
    """Return ephemeral PNG data URLs; never writes files to obtain a preview."""
    details = report.get('detailed_rows', [])
    options = report.get('options', {})
    previews = []
    figures = [('overview', 'All groups', lambda: _overview_figure(details, options))]
    figures += [(f'group-{i}', str(d.get('group_name', 'Group')),
                 lambda detail=d: _single_figure(detail, options))
                for i, d in enumerate(details) if len(d.get('x', []))]
    for identifier, name, make_figure in figures:
        fig = make_figure()
        if fig is None:
            continue
        try:
            buffer = BytesIO()
            fig.savefig(buffer, format='png', dpi=110, bbox_inches='tight')
            previews.append({'id': identifier, 'group_name': name,
                             'data_url': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')})
        finally:
            plt.close(fig)
    return previews
