import os
import sys

import matplotlib
from matplotlib import font_manager as fm

from ..common import resource_path


def configure_matplotlib_chinese_font():
    candidate_font_files = [
        'msyh.ttc',
        'msyhbd.ttc',
        'simhei.ttf',
        'simsun.ttc',
        'Deng.ttf',
        'PingFang.ttc',
        'NotoSansCJK-Regular.ttc',
        'NotoSansCJKsc-Regular.otf',
        'SourceHanSansCN-Regular.otf',
        'SourceHanSansSC-Regular.otf',
    ]

    search_dirs = []
    try:
        if getattr(sys, 'frozen', False):
            search_dirs.append(os.path.dirname(sys.executable))
    except Exception:
        pass
    try:
        search_dirs.append(os.path.dirname(os.path.abspath(__file__)))
    except Exception:
        pass
    try:
        search_dirs.append(resource_path(''))
    except Exception:
        pass

    seen = set()
    for base_dir in search_dirs:
        if not base_dir or base_dir in seen:
            continue
        seen.add(base_dir)
        for fname in candidate_font_files:
            font_path = os.path.join(base_dir, fname)
            if os.path.isfile(font_path):
                try:
                    font_prop = fm.FontProperties(fname=font_path)
                    font_name = font_prop.get_name()
                    matplotlib.rcParams['font.family'] = 'sans-serif'
                    matplotlib.rcParams['font.sans-serif'] = [font_name, 'DejaVu Sans']
                    matplotlib.rcParams['axes.unicode_minus'] = False
                    return font_name, font_path, font_prop
                except Exception:
                    pass

    installed_names = {f.name for f in fm.fontManager.ttflist}
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

    for font_name in candidate_font_names:
        if font_name in installed_names:
            try:
                font_prop = fm.FontProperties(family=font_name)
                matplotlib.rcParams['font.family'] = 'sans-serif'
                matplotlib.rcParams['font.sans-serif'] = [font_name, 'DejaVu Sans']
                matplotlib.rcParams['axes.unicode_minus'] = False
                return font_name, 'system', font_prop
            except Exception:
                pass

    matplotlib.rcParams['font.family'] = 'sans-serif'
    matplotlib.rcParams['font.sans-serif'] = candidate_font_names + ['DejaVu Sans']
    matplotlib.rcParams['axes.unicode_minus'] = False
    return 'DejaVu Sans (fallback)', 'fallback', fm.FontProperties(family='DejaVu Sans')


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
