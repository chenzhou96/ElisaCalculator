from io import StringIO

import pandas as pd


def infer_separator(raw_text):
    sample_lines = [line for line in raw_text.splitlines() if line.strip()][:8]
    if not sample_lines:
        return ','
    if any(',' in line for line in sample_lines):
        return ','
    if any('\t' in line for line in sample_lines):
        return '\t'
    return r'\s+'


def build_default_columns(n_cols):
    if n_cols < 2:
        return []
    return ['concentration'] + [f'col_{i}' for i in range(1, n_cols)]


def read_table_from_raw_text(raw_text):
    if not raw_text or not raw_text.strip():
        return None, {'error': '输入为空'}

    lines = [line for line in raw_text.splitlines() if line.strip()]
    if not lines:
        return None, {'error': '输入为空'}

    raw = '\n'.join(lines)
    sep = infer_separator(raw)

    try:
        preview_df = pd.read_csv(StringIO(raw), sep=sep, engine='python', header=None)
    except Exception as e:
        return None, {'error': f'无法解析数据: {e}'}

    if preview_df is None or preview_df.empty or preview_df.shape[1] < 2:
        return None, {'error': '列数不足，至少需要 2 列'}

    first_col = preview_df.iloc[:, 0].astype(str).str.strip()
    first_col_numeric = pd.to_numeric(first_col, errors='coerce').notna().all()

    if first_col_numeric:
        df = preview_df.copy()
        df.columns = build_default_columns(df.shape[1])
        header_mode = 'auto_default'
        header_note = '检测到首列全为数字，已按“无表头数据”处理，并自动使用默认列名。'
    else:
        try:
            df = pd.read_csv(StringIO(raw), sep=sep, engine='python', header=0)
        except Exception as e:
            return None, {'error': f'表头读取失败: {e}'}
        if df is None or df.empty or df.shape[1] < 2:
            return None, {'error': '读取失败或列数不足'}
        header_mode = 'user_header'
        header_note = '检测到表头，已按用户原始列名处理。'

    df.attrs['header_mode'] = header_mode
    df.attrs['header_note'] = header_note
    df.attrs['separator'] = sep
    return df, {
        'header_mode': header_mode,
        'header_note': header_note,
        'separator': sep,
        'columns': list(df.columns),
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
