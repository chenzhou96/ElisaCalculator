import os
import sys

import matplotlib

from ..common import resource_path


def configure_matplotlib_chinese_font():
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
    matplotlib.rcParams['font.family'] = 'sans-serif'
    matplotlib.rcParams['font.sans-serif'] = candidate_font_names + ['DejaVu Sans']
    matplotlib.rcParams['axes.unicode_minus'] = False
    if getattr(sys, 'frozen', False):
        return 'sans-serif (frozen safe mode)', resource_path(''), None
    return 'sans-serif', os.path.dirname(os.path.abspath(__file__)), None


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
