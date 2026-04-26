from dataclasses import dataclass
from typing import Callable, Optional

from ..common import make_output_dir
from ..core.processing import CalculationReport, calculate_ec50_global_df
from ..io.readers import read_table_from_raw_text
from ..io.writers import save_outputs


@dataclass
class ParseStageResult:
    ok: bool
    error: str
    df: object
    meta: dict
    source_label: str
    encoding_used: Optional[str]


@dataclass
class CalculationStageResult:
    ok: bool
    error: str
    results: list
    status_msg: str
    removed_count: int
    detail: Optional[dict]
    report: Optional[CalculationReport]


@dataclass
class ExportStageResult:
    ok: bool
    error: str
    output_dir: Optional[str]
    saved_files: list
    skipped: bool
    warnings: list


@dataclass
class WorkflowResult:
    ok: bool
    error: str
    df: object
    meta: dict
    results: list
    status_msg: str
    removed_count: int
    detail: Optional[dict]
    report: Optional[CalculationReport]
    output_dir: Optional[str]
    saved_files: list
    export_error: str
    export_warnings: list
    source_label: str
    encoding_used: Optional[str]


def parse_workflow_input(
    raw_text,
    source_label='Paste',
    encoding_used=None,
    table_reader: Callable = read_table_from_raw_text,
):
    df, meta = table_reader(raw_text)
    if df is None:
        return ParseStageResult(
            ok=False,
            error=meta.get('error', 'unknown parse error'),
            df=None,
            meta=meta,
            source_label=source_label,
            encoding_used=encoding_used,
        )

    return ParseStageResult(
        ok=True,
        error='',
        df=df,
        meta=meta,
        source_label=source_label,
        encoding_used=encoding_used,
    )


def calculate_workflow_report(
    df,
    calculator: Callable = calculate_ec50_global_df,
    calculator_kwargs: Optional[dict] = None,
):
    calculator_kwargs = calculator_kwargs or {}
    results, status_msg, removed_count, report = calculator(df, **calculator_kwargs)
    detail = report.to_dict() if report is not None else None
    ok = status_msg == 'Success' and report is not None and report.fit_success
    error = ''

    if not ok:
        if report is not None and not report.fit_success and report.fit_error:
            error = report.fit_error
        else:
            error = status_msg

    return CalculationStageResult(
        ok=ok,
        error=error,
        results=results,
        status_msg=status_msg,
        removed_count=removed_count,
        detail=detail,
        report=report,
    )


def export_workflow_outputs(
    report: Optional[CalculationReport],
    source_label='Paste',
    output_dir_factory: Callable = make_output_dir,
    output_saver: Callable = save_outputs,
):
    if report is None or not report.fit_success or not report.summary_rows:
        return ExportStageResult(
            ok=True,
            error='',
            output_dir=None,
            saved_files=[],
            skipped=True,
            warnings=[],
        )

    try:
        output_dir = output_dir_factory(source_label)
    except Exception as exc:
        return ExportStageResult(
            ok=True,
            error=f'导出目录创建失败: {exc}',
            output_dir=None,
            saved_files=[],
            skipped=False,
            warnings=[f'export directory creation failed: {exc}'],
        )

    saved_files = []
    warnings = []
    try:
        saver_result = output_saver(report.to_dict(), output_dir)
        if isinstance(saver_result, dict):
            saved_files = list(saver_result.get('saved_files', []))
            warnings = list(saver_result.get('warnings', []))
        elif isinstance(saver_result, tuple) and len(saver_result) == 2:
            saved_files = list(saver_result[0] or [])
            warnings = list(saver_result[1] or [])
        elif isinstance(saver_result, list):
            saved_files = saver_result
    except Exception as exc:
        warnings.append(f'export execution failed: {exc}')

    error = warnings[0] if warnings else ''
    return ExportStageResult(
        ok=True,
        error=error,
        output_dir=output_dir,
        saved_files=saved_files,
        skipped=False,
        warnings=warnings,
    )


def run_calculation_workflow(
    raw_text,
    source_label='Paste',
    encoding_used=None,
    table_reader: Callable = read_table_from_raw_text,
    calculator: Callable = calculate_ec50_global_df,
    calculator_kwargs: Optional[dict] = None,
    output_dir_factory: Callable = make_output_dir,
    output_saver: Callable = save_outputs,
):
    parse_result = parse_workflow_input(
        raw_text,
        source_label=source_label,
        encoding_used=encoding_used,
        table_reader=table_reader,
    )
    if not parse_result.ok:
        return WorkflowResult(
            ok=False,
            error=parse_result.error,
            df=None,
            meta=parse_result.meta,
            results=[],
            status_msg='ParseFailed',
            removed_count=0,
            detail=None,
            report=None,
            output_dir=None,
            saved_files=[],
            export_error='',
            export_warnings=[],
            source_label=parse_result.source_label,
            encoding_used=parse_result.encoding_used,
        )

    calculation_result = calculate_workflow_report(
        parse_result.df,
        calculator=calculator,
        calculator_kwargs=calculator_kwargs,
    )
    export_result = export_workflow_outputs(
        calculation_result.report,
        source_label=parse_result.source_label,
        output_dir_factory=output_dir_factory,
        output_saver=output_saver,
    )

    return WorkflowResult(
        ok=calculation_result.ok,
        error=calculation_result.error,
        df=parse_result.df,
        meta=parse_result.meta,
        results=calculation_result.results,
        status_msg=calculation_result.status_msg,
        removed_count=calculation_result.removed_count,
        detail=calculation_result.detail,
        report=calculation_result.report,
        output_dir=export_result.output_dir,
        saved_files=export_result.saved_files,
        export_error=export_result.error,
        export_warnings=export_result.warnings,
        source_label=parse_result.source_label,
        encoding_used=parse_result.encoding_used,
    )
