import numpy as np
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt

from ..core.model import four_param_logistic
from .fonts import CN_FONT_PROP, font_kwargs


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
        xmin = float(np.min(x))
        xmax = float(np.max(x))
        if xmax <= xmin:
            xmax = xmin + 1.0
        xfit = np.linspace(xmin, xmax, 300)
        yfit = four_param_logistic(xfit, p['A'], p['B'], p['C'], p['D'])
        plt.plot(xfit, yfit, linewidth=2, label='4PL Fit')
        plt.axvline(p['C'], linestyle='--', linewidth=1.2, label=f"EC50={p['C']:.4g}")
        title += f"\nEC50={p['C']:.4g}, R²={detail_row.get('r2', np.nan):.3f}"
    else:
        title += '\n拟合未完成'

    plt.xlabel('Log Concentration', **font_kwargs())
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
            xmin = float(np.min(x))
            xmax = float(np.max(x))
            if xmax <= xmin:
                xmax = xmin + 1.0
            xfit = np.linspace(xmin, xmax, 300)
            yfit = four_param_logistic(xfit, p['A'], p['B'], p['C'], p['D'])
            ax.plot(xfit, yfit, linewidth=1.8)
            ax.axvline(p['C'], linestyle='--', linewidth=1.0)
            title += f"\nEC50={p['C']:.4g}, R²={d.get('r2', np.nan):.3f}"
        else:
            title += '\n拟合未完成'

        ax.set_xlabel('Log Concentration', **font_kwargs())
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
