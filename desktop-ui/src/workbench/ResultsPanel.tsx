import { useState, type Dispatch } from "react";
import type { Action, Workspace } from "./model";
import { formatNumber as fmt } from "./model";
import { Card, Empty, Pager, Field } from "./Primitives";
import type { SummaryRow } from "./types";
import NumericInput from "./NumericInput";

export default function ResultsPanel({
  state,
  onSelect,
  selected,
  dispatch,
  normalizationPending = false,
}: {
  state: Workspace;
  onSelect: (group: string) => void;
  selected: string;
  dispatch: Dispatch<Action>;
  normalizationPending?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<"unknown" | "curves">("unknown");
  const rows = state.result?.report?.summary_rows ?? [];
  const unknowns = state.result?.report?.unknown_results ?? [];
  if (!rows.length)
    return (
      <Empty title="结果还未生成">
        完成孔板标记与右侧分析约定，然后点击“运行分析”
      </Empty>
    );
  const dimensionless = state.result?.report?.options?.dose_basis === "dimensionless";
  const stockRelative = !dimensionless && rows.some(row => typeof row.Relative_stock_potency_X === "number" && Number.isFinite(row.Relative_stock_potency_X) && row.Relative_stock_potency_X > 0);
  const showRelativeX = dimensionless || stockRelative;
  const supportsReferenceEdit = (state.result?.report?.metadata?.reference_fit_context as {schema?: string} | undefined)?.schema === "elisa-reference-fit-context/1";
  const standard = state.options.workflow === "standard_curve";
  const showUnknown = standard && tab === "unknown";
  const count = showUnknown ? unknowns.length : rows.length;
  const safePage = Math.min(page, Math.max(0, Math.ceil(count / 4) - 1));
  const warnings =
    rows.filter((row) => row.Warning || row.Status !== "Success").length +
    unknowns.filter((row) => row.Warning || row.Status !== "Success").length;
  return (
    <div className="results-layout">
      {state.resultOrigin === "historical" && <div className="notice warning">历史结果快照{state.recordSavedAt ? ` · ${state.recordSavedAt}` : ""} · 恢复时未重新计算</div>}
      {!standard && <div className="reference-controls">
        <Field label="结果参比组"><select value={state.options.reference_group ?? ""} disabled={!supportsReferenceEdit || !!state.busy} onChange={event => dispatch({type: "options", patch: {reference_group: event.target.value || null}})}>{rows.filter(row => row.Status === "Success" && Number.isFinite(row.LogEC50)).map(row => <option key={row.Group} value={row.Group}>{row.Group}</option>)}</select></Field>
        <Field label="结果参比赋值（X）"><NumericInput value={state.options.reference_assigned_value} disabled={!supportsReferenceEdit || !!state.busy} onValueChange={value => dispatch({type: "options", patch: {reference_assigned_value: value ?? NaN}})} /></Field>
        <p role="status">{normalizationPending ? "正在更新参比归一 · 拟合参数保持不变" : supportsReferenceEdit ? "修改参比立即归一，不重新拟合" : "旧版快照缺少原始协方差；需重新分析后才能修改参比"}</p>
      </div>}
      <div className="result-context" aria-label="分析概况">
        <span>{rows.length} 组曲线 · {state.options.fit_mode === "shared" ? "共享 A / D 全局 4PL" : "独立 4PL 拟合"}</span>
        <span className={warnings ? "result-quality-warning" : ""}>{warnings ? `${warnings} 个条目需检查` : "未触发自动警告；仍需实验验证"}</span>
      </div>
      {state.result?.export_error && (
        <div className="notice warning" role="alert">
          <strong>计算已完成，但导出失败</strong>
          <span>{state.result.export_error}</span>
          <span>下方计算结果与曲线预览仍可查看；可保存分析记录。</span>
        </div>
      )}
      {state.result?.preview_warnings?.map((warning, index) => (
        <div key={index} className="notice warning">
          图像预览：{warning}
        </div>
      ))}
      {!standard && <section className="comparison-summary" aria-labelledby="comparison-title" aria-busy={normalizationPending}>
        <div className="comparison-heading"><h2 id="comparison-title">{dimensionless ? "各组相对参比 · 中点相对值 X" : stockRelative ? "各组相对参比 · 表观原液强度 X" : "各组相对参比 · EC50 比较"}</h2>
          <p>{dimensionless ? "X = 参比赋值 × EC50(参比) / EC50(本组)；未证明曲线平行或恒定生物效价。" : stockRelative ? "原液 X 按声明的起始浓度和中点原液分数比较；未证明曲线平行或恒定生物效价。" : "EC50 比值 = 本组 / 参比；未声明原液浓度时，不推断原液 X。"} 条件置信区间仅为局部拟合近似。</p>
        </div>
        <div className="comparison-table-scroll"><table className="comparison-table" aria-label="各组相对参比结果">
          <thead><tr><th>组名</th><th>{showRelativeX ? "参比归一 X" : "EC50 比值"}<small>{showRelativeX ? `参比赋值 ${fmt(state.options.reference_assigned_value)} X` : "本组 / 参比"}</small></th><th>{showRelativeX ? "条件 95% CI（X）" : "EC50 · 95% CI"}</th><th>拟合 / 比较检查</th></tr></thead>
          <tbody>{rows.map(row => {
            const value = dimensionless ? row.Normalized_midpoint_X : stockRelative ? row.Relative_stock_potency_X : row.EC50_ratio;
            const relativeToReference = stockRelative ? (typeof row.Relative_stock_potency_X === "number" && (state.result?.report?.options?.reference_assigned_value ?? 0) > 0 ? row.Relative_stock_potency_X / state.result!.report!.options!.reference_assigned_value : null) : typeof row.EC50_ratio === "number" && Number.isFinite(row.EC50_ratio) && row.EC50_ratio > 0 ? 1 / row.EC50_ratio : null;
            const usable = row.Status === "Success" && typeof value === "number" && Number.isFinite(value) && value > 0;
            const low = dimensionless ? row.Normalized_midpoint_X_CI_low : stockRelative ? row.Relative_stock_potency_X_CI_low : row.EC50_CI_low;
            const high = dimensionless ? row.Normalized_midpoint_X_CI_high : stockRelative ? row.Relative_stock_potency_X_CI_high : row.EC50_CI_high;
            const hasCI = typeof low === "number" && Number.isFinite(low) && typeof high === "number" && Number.isFinite(high);
            // Only routine replication/dose-basis notices collapse. Scientific qualification stays expanded.
            const warningParts = (row.warning_list?.length ? row.warning_list : [row.Warning]).flatMap(warning => warning.split(";"));
            const criticalWarning = warningParts.some(warning => warning.trim() && !/replicate observations|technical replicates|EC50 is on a dimensionless dose scale|no original.stock fraction or absolute concentration is inferred|^midpoint comparison only: parallel response curves and constant biological potency have not been established\.?$/i.test(warning.trim()));
            return <tr key={row.Group} className={selected === row.Group ? "selected-row" : ""}>
              <td className="name-cell"><button className="result-group-button" onClick={() => onSelect(row.Group)} aria-pressed={selected === row.Group}>{row.Group}</button>{row.Group === state.options.reference_group && <span className="mini-tag">参比</span>}</td>
              <td className="comparison-value">{normalizationPending ? <span className="comparison-unavailable">更新中…</span> : usable ? <>{fmt(value)}{showRelativeX && <small> X</small>}{showRelativeX && relativeToReference !== null && Number.isFinite(relativeToReference) && <span className="relative-reference">{stockRelative ? "原液相对值" : "中点比值"} {fmt(relativeToReference)} 倍于参比</span>}</> : <span className="comparison-unavailable">—<small>不可比较</small></span>}</td>
              <td className="comparison-ci">{!showRelativeX && <span>{fmt(row.EC50)} {row.EC50_unit}<br /></span>}{normalizationPending ? "更新中…" : usable && hasCI ? `${fmt(low)} – ${fmt(high)}` : "不提供区间"}</td>
              <td>{row.Status !== "Success" ? <div className="comparison-warning"><strong>拟合失败 · 不提供倍数</strong><p>{row.Warning || row.Status}</p></div> : row.Warning ? <details className="comparison-warning" open={!usable || criticalWarning}><summary>{!usable ? "比较不可用 · 查看原因" : criticalWarning ? "比较条件警告 · 请审阅" : "需检查 · 查看警告"}</summary><p>{row.Warning}</p></details> : <span>{usable ? "拟合成功" : "比较不可用"}<small>{usable ? "仍需核对曲线与实验设计" : "请查看拟合详情及适用条件"}</small></span>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>}
      <details className="result-fit-details" open={standard || undefined}><summary>拟合参数与比较明细 · EC50、R²、状态</summary><Card
        title={showUnknown ? "未知样品浓度" : "曲线参数与比较"}
        subtitle={
          showUnknown
            ? "孔内值与稀释校正值分别列出；不可反算项显示为空"
            : dimensionless ? "无量纲剂量；中点相对值 = 参考赋值 × 参考 EC50 / 样品 EC50" : "EC50 比值 = 样品 / 参考；X 为表观中点强度，平行性与恒定效价未被证明"
        }
        className="results-card"
        action={
          standard && (
            <div className="segmented">
              <button
                className={showUnknown ? "selected" : ""}
                onClick={() => {
                  setTab("unknown");
                  setPage(0);
                }}
              >
                未知样品
              </button>
              <button
                className={!showUnknown ? "selected" : ""}
                onClick={() => {
                  setTab("curves");
                  setPage(0);
                }}
              >
                标准拟合
              </button>
            </div>
          )
        }
      >
        <div className="table-scroll">
          <table>
            <thead>
              {showUnknown ? (
                <tr>
                  <th>样品</th>
                  <th>处理后 OD</th>
                  <th>孔内浓度</th>
                  <th>稀释倍数</th>
                  <th>原样浓度</th>
                  <th>状态 / 警告</th>
                </tr>
              ) : (
                <tr>
                  <th>组名</th>
                  <th>
                    EC50<small>线性剂量</small>
                  </th>
                  <th>EC50 级数</th>
                  <th>
                    EC50 比值<small>样品 / 参考</small>
                  </th>
                  <th>
                    {dimensionless ? "中点相对值" : "中点原液强度"}<small>参考归一 X</small>
                  </th>
                  <th>R²</th>
                  <th>状态</th>
                </tr>
              )}
            </thead>
            <tbody>
              {showUnknown
                ? unknowns
                    .slice(safePage * 4, safePage * 4 + 4)
                    .map((row, index) => (
                      <tr key={`${row.Sample}-${index}`}>
                        <td className="name-cell">{row.Sample}</td>
                        <td>{fmt(row.OD_processed)}</td>
                        <td>
                          {fmt(row.Concentration)}
                          <small>{row.Concentration_unit}</small>
                        </td>
                        <td>{fmt(row.Dilution_factor)} ×</td>
                        <td className="value-cell">
                          {fmt(row.Corrected_concentration)}
                          <small>{row.Concentration_unit}</small>
                        </td>
                        <td>
                          <span
                            className={
                              row.Status === "Success"
                                ? "badge good"
                                : "badge caution"
                            }
                          >
                            {row.Status}
                          </span>
                          {row.Warning && (
                            <span className="row-warning" title={row.Warning}>
                              {row.Warning}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                : rows.slice(safePage * 4, safePage * 4 + 4).map((row) => (
                    <tr
                      key={row.Group}
                      className={selected === row.Group ? "selected-row" : ""}
                      onClick={() => onSelect(row.Group)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onSelect(row.Group);
                      }}
                    >
                      <td className="name-cell">
                        {row.Group}
                        {row.Group === state.options.reference_group && (
                          <span className="mini-tag">REF</span>
                        )}
                      </td>
                      <td>
                        {fmt(row.EC50)}
                        <small>{row.EC50_unit}</small>
                      </td>
                      <td>{fmt(row.EC50_step)}</td>
                      <td>{normalizationPending ? "更新中" : fmt(row.EC50_ratio)}</td>
                      <td className="value-cell">
                        {normalizationPending ? "更新中" : fmt(dimensionless ? row.Normalized_midpoint_X : row.Relative_stock_potency_X)}
                        {!normalizationPending && (dimensionless ? row.Normalized_midpoint_X : row.Relative_stock_potency_X) != null ? " X" : ""}
                      </td>
                      <td>{fmt(row.R2, 4)}</td>
                      <td>
                        <span
                          className={
                            row.Warning || row.Status !== "Success"
                              ? "badge caution"
                              : "badge good"
                          }
                        >
                          {row.Warning ? "需检查" : row.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <Pager page={safePage} count={count} size={4} onChange={setPage} />
      </Card></details>
      <div className="result-note">
        <strong>解读边界</strong>
        <p>
          {standard
            ? "标准曲线只支持当前单位和校准范围。稀释、基质效应与拟合不确定性仍需实验验证。"
            : dimensionless ? "剂量是无量纲正数，可以大于 1。中点相对值仅比较当前剂量标尺下的 EC50，不推断原液分数、物理浓度或恒定效价。" : "相对原液强度只适用于可比较的连续稀释设计；原始浓度曲线未声明原液浓度时，该项不推断。EC50 比值不等同于活性或亲和力的完整结论。"}
        </p>
      </div>
    </div>
  );
}
export function ResultInspector({ row }: { row: SummaryRow }) {
  return (
    <>
      <h3>{row.Group}</h3>
      <div className="inspector-stats">
        <div>
          <span>Log10 EC50</span>
          <b>{fmt(row.LogEC50)}</b>
        </div>
        <div>
          <span>EC50 95% CI {row.EC50_unit}</span>
          <b>
            {fmt(row.EC50_CI_low)} – {fmt(row.EC50_CI_high)}
          </b>
        </div>
        <div>
          <span>斜率 B</span>
          <b>{fmt(row.Slope)}</b>
        </div>
        <div>
          <span>下平台 A</span>
          <b>{fmt(row.A)}</b>
        </div>
        <div>
          <span>上平台 D</span>
          <b>{fmt(row.D)}</b>
        </div>
        <div>
          <span>RMSE</span>
          <b>{fmt(row.RMSE)}</b>
        </div>
        <div>
          <span>有效点数</span>
          <b>{row.N}</b>
        </div>
      </div>
      <h4>检查项</h4>
      {row.Warning ? (
        <p className="inspector-warning">{row.Warning}</p>
      ) : (
        <p>未触发自动警告不等于模型已获验证。</p>
      )}
      <p className="muted">置信区间为局部拟合近似，不能覆盖所有实验误差。</p>
    </>
  );
}
