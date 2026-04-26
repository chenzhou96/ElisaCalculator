from dataclasses import dataclass
from typing import Callable, Optional

from ..common import make_output_dir
from ..core.processing import calculate_ec50_global_df
from ..io.readers import read_table_from_raw_text
from ..io.writers import save_outputs


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
    output_dir: Optional[str]
    saved_files: list
    source_label: str
    encoding_used: Optional[str]


def run_calculation_workflow(
    raw_text,
    source_label='Paste',
    encoding_used=None,
    table_reader: Callable = read_table_from_raw_text,
    calculator: Callable = calculate_ec50_global_df,
    output_dir_factory: Callable = make_output_dir,
    output_saver: Callable = save_outputs,
):
    df, meta = table_reader(raw_text)
    if df is None:
        return WorkflowResult(
            ok=False,
            error=meta.get('error', 'unknown parse error'),
            df=None,
            meta=meta,
            results=[],
            status_msg='ParseFailed',
            removed_count=0,
            detail=None,
            output_dir=None,
            saved_files=[],
            source_label=source_label,
            encoding_used=encoding_used,
        )

    results, status_msg, removed_count, detail = calculator(df)

    output_dir = None
    saved_files = []
    if results and detail:
        output_dir = output_dir_factory(source_label)
        saved_files = output_saver(detail, output_dir)

    return WorkflowResult(
        ok=True,
        error='',
        df=df,
        meta=meta,
        results=results,
        status_msg=status_msg,
        removed_count=removed_count,
        detail=detail,
        output_dir=output_dir,
        saved_files=saved_files,
        source_label=source_label,
        encoding_used=encoding_used,
    )
