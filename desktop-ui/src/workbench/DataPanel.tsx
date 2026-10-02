import { useState, type Dispatch } from "react";
import type { Action, Workspace } from "./model";
import { Card, Field, Pager } from "./Primitives";

export default function DataPanel({
  state,
  dispatch,
  parse,
  load,
}: {
  state: Workspace;
  dispatch: Dispatch<Action>;
  parse: () => void;
  load: () => void;
}) {
  const [page, setPage] = useState(0);
  const columns =
    state.parsed?.preview_columns ?? state.parsed?.meta?.columns ?? [];
  const rows = state.parsed?.preview_rows ?? [];
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 5) - 1));
  return (
    <div className="data-layout">
      <Card
        title="原始数据"
        subtitle="每列一个曲线；重复孔可在分析设置中显式合并"
        action={
          <div className="button-row">
            <button onClick={load} disabled={!!state.busy}>
              导入文件
            </button>
            <button
              onClick={() =>
                dispatch({ type: "example", workflow: state.options.workflow })
              }
              disabled={!!state.busy}
            >
              载入示例
            </button>
          </div>
        }
      >
        <textarea
          aria-label="原始 ELISA 数据"
          className="raw-data"
          spellCheck={false}
          value={state.rawText}
          placeholder={
            "从 Excel 粘贴，或导入 CSV / TSV / TXT\n\nStep\tReference\tSample A\n1\t2.375\t2.524\n2\t2.140\t2.360\n…"
          }
          onChange={(event) =>
            dispatch({
              type: "input",
              patch: {
                rawText: event.target.value.replace(/\r\n?/g, "\n"),
                source: "粘贴 / 编辑数据",
              },
            })
          }
        />
        <div className="data-toolbar">
          <Field label="首行表头">
            <select
              value={state.headerMode}
              onChange={(event) =>
                dispatch({
                  type: "input",
                  patch: {
                    headerMode: event.target.value as Workspace["headerMode"],
                  },
                })
              }
            >
              <option value="auto">自动识别</option>
              <option value="present">第一行是表头</option>
              <option value="absent">第一行是数据</option>
            </select>
          </Field>
          <span className="muted file-source" title={state.source}>
            {state.source}
          </span>
          <button
            className="secondary"
            onClick={parse}
            disabled={!!state.busy || !state.rawText.trim()}
          >
            {state.busy === "parse" ? "正在解析…" : "解析预览"}
          </button>
        </div>
      </Card>
      <Card
        title="结构化预览"
        subtitle={
          state.parsed?.ok
            ? `共 ${state.parsed.row_count ?? rows.length} 行 · ${columns.length} 列${(state.parsed.row_count ?? rows.length) > rows.length ? ` · 仅预览前 ${rows.length} 行` : ""} · ${state.parsed.meta?.header_note ?? "请检查列名与数据"}`
            : "先解析数据，再确认 X 轴列与组名"
        }
        className="preview-card"
        action={
          columns.length > 0 && (
            <Field label="X 轴列">
              <select
                aria-label="X 轴列"
                value={state.xColumn}
                onChange={(event) =>
                  dispatch({
                    type: "input",
                    patch: { xColumn: event.target.value },
                  })
                }
              >
                {columns.map((column) => (
                  <option key={column}>{column}</option>
                ))}
              </select>
            </Field>
          )
        }
      >
        {rows.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="row-index">#</th>
                    {columns.map((column) => (
                      <th
                        key={column}
                        className={
                          column === state.xColumn ? "axis-column" : ""
                        }
                      >
                        {column}
                        {column === state.xColumn && (
                          <span className="mini-tag">X</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice(safePage * 5, safePage * 5 + 5)
                    .map((row, index) => (
                      <tr key={index}>
                        <td className="row-index">
                          {safePage * 5 + index + 1}
                        </td>
                        {columns.map((column, colIndex) => (
                          <td key={column}>
                            {String(
                              (Array.isArray(row)
                                ? row[colIndex]
                                : row[column]) ?? "—",
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={safePage}
              count={rows.length}
              size={5}
              onChange={setPage}
            />
          </>
        ) : (
          <div className="preview-placeholder">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <span>解析后的数据会出现在这里</span>
          </div>
        )}
      </Card>
    </div>
  );
}
