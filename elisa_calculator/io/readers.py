from io import StringIO
import re

import pandas as pd
from ..arithmetic import evaluate_number

def _is_number(value):
    try:
        evaluate_number(value)
        return True
    except (ValueError, TypeError, OverflowError):
        return False



def _token_count(line, sep):
    if sep == r'\s+':
        tokens = [item for item in re.split(r'\s+', line.strip()) if item]
        return len(tokens)
    return len(line.split(sep))


def infer_separator(raw_text):
    sample_lines = [line for line in raw_text.splitlines() if line.strip()][:8]
    if not sample_lines:
        return ','

    candidates = [',', '\t', r'\s+']
    best_sep = ','
    best_score = float('-inf')

    for sep in candidates:
        counts = [_token_count(line, sep) for line in sample_lines]
        if not counts or max(counts) < 2:
            continue

        avg_count = sum(counts) / len(counts)
        spread = max(counts) - min(counts)
        score = avg_count - (spread * 0.75)
        if sep == r'\s+':
            # Prefer explicit delimiters when scores are close.
            score -= 0.1

        if score > best_score:
            best_score = score
            best_sep = sep

    return best_sep


def build_default_columns(n_cols):
    if n_cols < 2:
        return []
    return ['concentration'] + [f'col_{i}' for i in range(1, n_cols)]


def read_table_from_raw_text(raw_text, header_mode='auto'):
    if header_mode not in ('auto', 'present', 'absent'):
        return None, {'error': 'header_mode must be auto, present, or absent'}
    if not isinstance(raw_text, str) or not raw_text.strip():
        return None, {'error': '输入为空'}

    lines = [line for line in raw_text.splitlines() if line.strip()]
    if not lines:
        return None, {'error': '输入为空'}

    raw = '\n'.join(lines)
    sep = infer_separator(raw)

    try:
        preview_df = pd.read_csv(StringIO(raw), sep=sep, engine='python', header=None, dtype=str, keep_default_na=False)
    except Exception as e:
        return None, {'error': f'无法解析数据: {e}'}

    if preview_df is None or preview_df.empty or preview_df.shape[1] < 2:
        return None, {'error': '列数不足，至少需要 2 列'}

    # Inspect the first row rather than requiring every later x to be valid.
    # Later bad/missing cells belong in the input audit, not in header inference.
    first = preview_df.iloc[0]
    numeric_first_x = _is_number(first.iloc[0])
    numeric_responses = any(_is_number(value) for value in first.iloc[1:])
    has_header = header_mode == 'present' or (header_mode == 'auto' and not numeric_first_x and not numeric_responses)
    warnings = []
    if header_mode == 'auto' and not numeric_first_x and numeric_responses:
        warnings.append('First row mixes text x with numeric responses; preserved as data. Select header mode explicitly if it is a header.')
    if not has_header:
        df = preview_df.copy()
        df.columns = build_default_columns(df.shape[1])
        detected_mode = 'auto_default'
        header_note = '按无表头数据处理；所有数据行保留。可显式选择表头模式。'
    else:
        names = [str(value).strip() if pd.notna(value) else '' for value in first]
        if any(not name for name in names) or len(set(names)) != len(names):
            return None, {'error': '表头不能为空或重复；请为每列提供唯一名称'}
        df = preview_df.iloc[1:].copy().reset_index(drop=True)
        df.columns = names
        if df.empty:
            return None, {'error': '表头后没有数据'}
        detected_mode = 'user_header'
        header_note = '已按用户原始列名处理。'
    header_mode = detected_mode

    df.attrs['header_mode'] = header_mode
    df.attrs['header_note'] = header_note
    df.attrs['separator'] = sep
    return df, {
        'header_mode': header_mode,
        'header_note': header_note,
        'separator': sep,
        'columns': list(df.columns),
        'warnings': warnings,
    }


def read_text_file_with_fallbacks(file_path):
    encodings = ['utf-8-sig', 'utf-8', 'gbk', 'gb18030', 'latin1']
    last_error = None
    for enc in encodings:
        try:
            with open(file_path, 'r', encoding=enc) as f:
                text = f.read()
            if text and text.strip():
                return text, enc, None
        except Exception as e:
            last_error = e
    return None, None, last_error


def preview_dataframe_text(df, n=5):
    try:
        return df.head(n).to_string(index=False)
    except Exception:
        return ''
