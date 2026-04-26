import argparse
import json
import math
import sys

import numpy as np

from .io.readers import preview_dataframe_text, read_text_file_with_fallbacks
from .services.workflow import (
    calculate_workflow_report,
    export_workflow_outputs,
    parse_workflow_input,
)


def _normalize_json_value(value):
    if isinstance(value, dict):
        return {str(key): _normalize_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize_json_value(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_normalize_json_value(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return _normalize_json_value(value.item())
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def _serialize_report(report):
    if report is None:
        return None
    return _normalize_json_value({
        'fit_success': report.fit_success,
        'fit_error': report.fit_error,
        'global_params': report.global_params,
        'summary_rows': report.summary_rows,
        'detailed_rows': [row.to_dict() for row in report.detailed_rows],
    })


def _load_request_payload(request):
    source_label = request.get('source_label') or 'Paste'
    raw_text = request.get('raw_text')
    if isinstance(raw_text, str) and raw_text.strip():
        return raw_text, source_label, request.get('encoding_used'), ''

    file_path = request.get('file_path')
    if not file_path:
        return None, source_label, None, 'raw_text 或 file_path 必须提供其一'

    raw_text, encoding_used, err = read_text_file_with_fallbacks(file_path)
    if raw_text is None:
        return None, file_path, encoding_used, f'读取文件失败: {err}'
    return raw_text, request.get('source_label') or file_path, encoding_used, ''


def _build_calculator_kwargs(request):
    calculator_kwargs = {}
    x_col_name = request.get('x_col_name')
    if x_col_name:
        calculator_kwargs['x_col_name'] = x_col_name
    y_cols_names = request.get('y_cols_names')
    if y_cols_names:
        calculator_kwargs['y_cols_names'] = y_cols_names
    return calculator_kwargs


def handle_parse_request(request):
    raw_text, source_label, encoding_used, load_error = _load_request_payload(request)
    if load_error:
        return {'ok': False, 'error': load_error}

    parse_result = parse_workflow_input(
        raw_text,
        source_label=source_label,
        encoding_used=encoding_used,
    )
    if not parse_result.ok:
        return {
            'ok': False,
            'error': parse_result.error,
            'meta': _normalize_json_value(parse_result.meta),
            'source_label': parse_result.source_label,
            'encoding_used': parse_result.encoding_used,
        }

    preview_rows = request.get('preview_rows', 5)
    return {
        'ok': True,
        'error': '',
        'meta': _normalize_json_value(parse_result.meta),
        'source_label': parse_result.source_label,
        'encoding_used': parse_result.encoding_used,
        'preview_text': preview_dataframe_text(parse_result.df, n=preview_rows),
        'row_count': int(parse_result.df.shape[0]),
        'column_count': int(parse_result.df.shape[1]),
    }


def handle_run_request(request):
    raw_text, source_label, encoding_used, load_error = _load_request_payload(request)
    if load_error:
        return {'ok': False, 'error': load_error}

    parse_result = parse_workflow_input(
        raw_text,
        source_label=source_label,
        encoding_used=encoding_used,
    )
    if not parse_result.ok:
        return {
            'ok': False,
            'error': parse_result.error,
            'meta': _normalize_json_value(parse_result.meta),
            'source_label': parse_result.source_label,
            'encoding_used': parse_result.encoding_used,
        }

    calculation_result = calculate_workflow_report(
        parse_result.df,
        calculator_kwargs=_build_calculator_kwargs(request),
    )

    save_outputs = bool(request.get('save_outputs', False))
    export_result = export_workflow_outputs(
        calculation_result.report,
        source_label=parse_result.source_label,
    ) if save_outputs else None

    return _normalize_json_value({
        'ok': calculation_result.ok,
        'error': calculation_result.error,
        'meta': parse_result.meta,
        'source_label': parse_result.source_label,
        'encoding_used': parse_result.encoding_used,
        'status_msg': calculation_result.status_msg,
        'removed_count': calculation_result.removed_count,
        'results': calculation_result.results,
        'report': _serialize_report(calculation_result.report),
        'output_dir': export_result.output_dir if export_result is not None else None,
        'saved_files': export_result.saved_files if export_result is not None else [],
        'exports_skipped': bool(export_result.skipped) if export_result is not None else True,
    })


def handle_request(request):
    command = request.get('command', 'run')
    if command == 'parse':
        return handle_parse_request(request)
    if command == 'run':
        return handle_run_request(request)
    return {'ok': False, 'error': f'不支持的命令: {command}'}


def _load_json_request(args):
    if args.request_file:
        with open(args.request_file, 'r', encoding='utf-8') as fh:
            return json.load(fh)

    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(description='ELISA Calculator JSON bridge')
    parser.add_argument('--request-file', help='Path to a UTF-8 JSON request file')
    args = parser.parse_args(argv)

    try:
        request = _load_json_request(args)
        response = handle_request(request)
    except json.JSONDecodeError as exc:
        response = {'ok': False, 'error': f'JSON 解析失败: {exc}'}
    except Exception as exc:
        response = {'ok': False, 'error': f'桥接调用失败: {exc}'}

    json.dump(_normalize_json_value(response), sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
