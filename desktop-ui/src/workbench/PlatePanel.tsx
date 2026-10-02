import { useEffect, useRef, useState, type Dispatch, type CSSProperties } from "react";
import type { Action, Workspace } from "./model";
import { formatNumber } from "./model";
import { Field } from "./Primitives";
import { applyPaste, assignWells, compilePlate, coordinates, curveGroups, KIND_LABELS, numericOD, plateExample, previewPaste, rectangleIds, ROWS, selectWells, WELL_IDS, type Assignment, type PlateDocument, type PlateWell, type WellKind } from "./plate";

const DEFAULT_ASSIGNMENT: Assignment = {kind: "comparison", group: "Reference", start: 1, factor: 2, direction: "decreasing", axis: "column", spacing: "physical", dilution: 1};
const symbol: Record<WellKind, string> = {unassigned: "·", comparison: "C", standard: "S", unknown: "U", blank: "B", excluded: "×"};
function color(plate: PlateDocument, well: PlateWell): CSSProperties {
  if (well.kind === "excluded") return {background: "#f0f1f0", color: "#9ca39e"};
  if (well.kind === "unassigned") return {background: "#fafbf9"};
  if (well.kind === "blank") return {background: "#eee8f4", color: "#705b87"};
  let hash = 0;
  for (const character of well.group) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = [144, 207, 32, 283, 175, 355, 82][hash % 7];
  const doses = plate.wells.filter(w => w.group === well.group && w.dose && w.kind !== "excluded").map(w => Math.log10(w.dose!));
  const low = Math.min(...doses), high = Math.max(...doses);
  const strength = well.dose && high > low ? (Math.log10(well.dose) - low) / (high - low) : 0.45;
  return {background: `hsl(${hue} 36% ${93 - strength * 21}%)`, color: `hsl(${hue} 30% 24%)`};
}
export function PlateAnalysisControls({state, dispatch}: {state: Workspace; dispatch: Dispatch<Action>}) {
  const p = state.plate, groups = curveGroups(p), standard = state.options.workflow === "standard_curve";
  const update = (patch: Partial<PlateDocument>) => dispatch({type: "plate", plate: {...p, ...patch}});
  return <div className="plate-analysis-controls">
    <div className="field-grid">
      <Field label="孔板剂量单位"><select value={p.basis} onChange={e => update({basis: e.target.value as PlateDocument["basis"]})}><option value="relative">相对原液分数（1 = 原液）</option><option value="absolute">已知绝对浓度</option></select></Field>
      <Field label="板图浓度单位"><input value={p.basis === "relative" ? "无量纲（原液 = 1）" : p.unit} disabled={p.basis === "relative"} onChange={e => update({unit: e.target.value})} placeholder="ng/mL、nM" /></Field>
      <Field label={standard ? "板图标准曲线引用" : "板图参比组"}><select value={(standard ? state.options.standard_group : state.options.reference_group) ?? ""} onChange={e => dispatch({type: "options", patch: standard ? {standard_group: e.target.value || null} : {reference_group: e.target.value || null}})}><option value="">请选择组</option>{groups.map(g => <option key={g}>{g}</option>)}</select></Field>
      {!standard && <Field label="板图参比赋值（X）"><input type="number" min="0" step="any" value={state.options.reference_assigned_value} onChange={e => dispatch({type: "options", patch: {reference_assigned_value: Number(e.target.value)}})} /></Field>}
      <Field label="板图4PL拟合模式"><select value={state.options.fit_mode} onChange={e => dispatch({type: "options", patch: {fit_mode: e.target.value as "shared" | "independent"}})}><option value="shared">共享上下平台 A / D</option><option value="independent">各组独立 4PL</option></select></Field>
      <Field label="复孔拟合策略"><select value={p.replicateMode} onChange={e => update({replicateMode: e.target.value as PlateDocument["replicateMode"]})}><option value="individual">逐孔拟合 · 观测等权</option><option value="mean">每剂量均值 · 均值等权</option></select></Field>
    </div>
    <Field label="空白校正作用域"><select value={p.blankMode} onChange={e => update({blankMode: e.target.value as PlateDocument["blankMode"]})}><option value="none">不扣空白</option><option value="global">全板空白均值 → 所有曲线及未知样品</option><option value="group">同名组空白均值 → 仅该组</option></select></Field>
    <p className="plate-policy">{p.blankMode === "none" ? "原始 OD 直接送入引擎，空白孔不参与拟合。" : p.blankMode === "global" ? "所有有效空白孔取均值，每个拟合/未知孔仅扣一次。原始读数永久保留，负值不裁零。" : "空白孔的组名指定作用对象（曲线组或未知样品名）。缺少同名空白会阻止计算，不回退全板。"}</p>
    <p className="plate-policy">{p.replicateMode === "individual" ? "同组重复列显式合并，保留逐孔身份；每个有效观测等权，技术复孔不等于独立实验。" : "保留逐孔审计，先取每剂量 OD 均值，再等权拟合各剂量；不按复孔数加权。"}</p>
    {standard && <label className="plate-checkbox"><input type="checkbox" checked={state.options.allow_extrapolation} onChange={e => dispatch({type: "options", patch: {allow_extrapolation: e.target.checked}})} />允许超范围外推（标记警告）</label>}
    <p className="plate-policy">剂量由各孔已确认的梯度生成；各组独立。相对模式的 1 明确代表原液分数 1；绝对浓度没有原液浓度时只比较 EC50，不计算原液 X。中点倍率不证明恒定效价。板图和表格分别保留。</p>
  </div>;
}
export default function PlatePanel({state, dispatch, parse}: {state: Workspace; dispatch: Dispatch<Action>; parse: () => void}) {
  const p = state.plate;
  const [panel, setPanel] = useState<"assign" | "analysis">("assign");
  const [draft, setDraft] = useState<Assignment>({...DEFAULT_ASSIGNMENT, kind: state.options.workflow === "standard_curve" ? "standard" : "comparison"});
  const [paste, setPaste] = useState<{text: string; origin: string; delimiter: "tab" | "csv"} | null>(null);
  const [overwrite, setOverwrite] = useState(false), [allowInvalid, setAllowInvalid] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [confirmation, setConfirmation] = useState<{plate: PlateDocument; version: number; label: string; example?: Workspace["options"]["workflow"]} | null>(null);
  const drag = useRef<{anchor: string; base: string[]; additive: boolean} | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const compiled = compilePlate(p, state.options), selected = p.wells.filter(w => p.selected.includes(w.id));
  const preview = paste ? previewPaste(paste.text, paste.origin, paste.delimiter) : null;
  const existing = preview?.cells.filter(c => p.wells.find(w => w.id === c.id)?.raw !== "").length ?? 0;
  const invalid = preview?.cells.filter(c => c.issue === "invalid").length ?? 0;
  const missing = preview?.cells.filter(c => c.issue === "missing").length ?? 0;
  const curve = draft.kind === "comparison" || draft.kind === "standard";
  let proposed: PlateDocument | null = null, draftError = "";
  try {if (selected.length) proposed = assignWells(p, p.selected, draft);} catch (e) {draftError = e instanceof Error ? e.message : String(e);}
  const previewDoses = proposed && curve ? proposed.wells.filter(w => p.selected.includes(w.id)).map(w => `${w.id}=${formatNumber(w.dose, 4)}`).join(" · ") : "";
  useEffect(() => {
    const end = () => {drag.current = null;};
    window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    return () => {window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);};
  }, []);
  const selection = (next: PlateDocument) => dispatch({type: "plate-selection", selected: next.selected, anchor: next.anchor});
  function choose(id: string, shift = false, additive = false) {selection(selectWells(p, id, shift ? "range" : additive ? "toggle" : "single"));}
  function openPaste(text = "", origin = p.selected[0] ?? "A1") {setOverwrite(false); setAllowInvalid(false); setError(""); setPaste({text, origin, delimiter: "tab"});}
  function commit(plate: PlateDocument) {dispatch({type: "plate", plate}); setError("");}
  function applyAssignment() {
    if (!proposed) {setError(draftError || "先选择孔位"); return;}
    const changesAssigned = selected.some(w => w.kind !== "unassigned" && JSON.stringify(w) !== JSON.stringify(proposed!.wells.find(n => n.id === w.id)));
    if (changesAssigned) setConfirmation({plate: proposed, version: state.version, label: `覆盖 ${selected.length} 个选中孔的类型、组别或梯度；原始读数保留，其余孔位不变。`});
    else commit(proposed);
  }
  function beginDrag(id: string, shift: boolean, additive: boolean) {
    choose(id, shift, additive);
    drag.current = {anchor: shift ? p.anchor : id, base: additive ? p.selected : [], additive};
  }
  async function loadPlate(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.currentTarget.files?.[0]; e.currentTarget.value = "";
    if (!f) return;
    try {
      if (f.size > 1024 * 1024) throw new Error("孔板文本超过 1 MB，请只导出一个板的读数");
      const text = new TextDecoder("utf-8", {fatal: true}).decode(await f.arrayBuffer());
      openPaste(text); setPaste({text, origin: p.selected[0] ?? "A1", delimiter: f.name.toLowerCase().endsWith(".csv") ? "csv" : "tab"});
    } catch (e) {setError(e instanceof Error ? e.message : String(e));}
  }
  return <div className="plate-workbench" onKeyDown={e => {
    const input = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (!input && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {e.preventDefault(); dispatch({type: e.shiftKey ? "plate-redo" : "plate-undo"});}
    if (!input && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {e.preventDefault(); dispatch({type: "plate-redo"});}
    if (e.key === "Escape") {setPaste(null); setReview(false); setConfirmation(null); drag.current = null;}
  }} onPaste={e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    e.preventDefault(); openPaste(e.clipboardData.getData("text/plain"));
  }}>
    <section className="card plate-board-card">
      <header className="plate-toolbar"><div><h2>96 孔板 <span className="mini-tag">8 × 12</span></h2><p>Excel 原始读数 → 明确孔位 → 检查映射</p></div><div className="button-row">
        <button onClick={() => openPaste()}>粘贴读数</button><button onClick={() => file.current?.click()} disabled={!!state.busy}>导入板读数</button>
        <button onClick={() => {const next = {type: "plate-example", workflow: state.options.workflow} as const; if (p.wells.some(w => w.raw || w.kind !== "unassigned")) setConfirmation({plate: plateExample(state.options.workflow), version: state.version, label: "载入合成示例将替换当前板图及分析约定；可用撤销恢复原板图。", example: state.options.workflow}); else dispatch(next);}}>载入板示例</button>
      </div></header>
      <input ref={file} hidden type="file" accept=".csv,.tsv,.txt" aria-label="导入板读数文件" onChange={e => void loadPlate(e)} />
      <div className="plate-selection-bar"><span aria-live="polite">已选 <b>{selected.length}</b> 孔 {selected.length ? `· ${p.selected[0]}${selected.length > 1 ? `–${p.selected.at(-1)}` : ""}` : "· 单击选择，拖动框选"}</span><div className="button-row"><button aria-label="撤销孔板操作" disabled={!state.platePast.length} onClick={() => dispatch({type: "plate-undo"})}>↶ 撤销</button><button aria-label="重做孔板操作" disabled={!state.plateFuture.length} onClick={() => dispatch({type: "plate-redo"})}>↷ 重做</button><button onClick={() => selection({...p, selected: [], anchor: "A1"})}>清除选择</button></div></div>
      <div className="plate-grid" role="grid" aria-label="96 孔板" aria-rowcount={8} aria-colcount={12} onPointerMove={e => {
        if (!drag.current || !e.buttons) return;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-well]");
        if (!target?.dataset.well) return;
        const range = rectangleIds(drag.current.anchor, target.dataset.well);
        selection({...p, anchor: drag.current.anchor, selected: WELL_IDS.filter(id => range.includes(id) || (drag.current!.additive && drag.current!.base.includes(id)))});
      }}>
        <div className="plate-grid-row plate-column-row" role="row"><span className="plate-corner">OD</span>{Array.from({length: 12}, (_, c) => <button className="plate-column" key={c} aria-label={`选择第 ${c + 1} 列`} onClick={e => selection({...p, selected: e.metaKey || e.ctrlKey ? WELL_IDS.filter(id => p.selected.includes(id) || coordinates(id)[1] === c) : [...ROWS].map(r => `${r}${c + 1}`), anchor: `A${c + 1}`})}>{c + 1}</button>)}</div>
        {[...ROWS].map((r, row) => <div className="plate-grid-row" role="row" key={r}><button className="plate-row" aria-label={`选择 ${r} 行`} onClick={() => selection({...p, selected: Array.from({length: 12}, (_, c) => `${r}${c + 1}`), anchor: `${r}1`})}>{r}</button>{p.wells.slice(row * 12, row * 12 + 12).map(w => {
          const valid = numericOD(w.raw), selected = p.selected.includes(w.id);
          const label = `${w.id} ${KIND_LABELS[w.kind]} ${w.group} OD ${w.raw.trim() || "缺失"}${w.dose !== null ? ` 剂量 ${w.dose}` : w.kind === "unknown" ? ` 稀释校正 ${w.dilution}` : ""}`;
          return <div className="plate-cell" role="gridcell" aria-selected={selected} key={w.id}><button data-well={w.id} tabIndex={p.anchor === w.id ? 0 : -1} className={`well ${selected ? "selected" : ""} ${w.raw.trim() && valid === null ? "invalid" : ""} ${w.kind === "excluded" ? "excluded" : ""}`} style={color(p, w)} aria-label={label} title={label} onPointerDown={e => {if (e.button !== 0) return; beginDrag(w.id, e.shiftKey, e.metaKey || e.ctrlKey);}} onClick={e => {if (e.detail === 0) choose(w.id, e.shiftKey, e.metaKey || e.ctrlKey);}} onKeyDown={e => {
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
            e.preventDefault(); const [r, c] = coordinates(w.id), nextRow = Math.max(0, Math.min(7, r + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0))), nextCol = Math.max(0, Math.min(11, c + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0)));
            const id = `${ROWS[nextRow]}${nextCol + 1}`; choose(id, e.shiftKey); e.currentTarget.closest(".plate-grid")?.querySelector<HTMLButtonElement>(`[data-well="${id}"]`)?.focus();
          }}><span className="well-top"><small>{w.id}</small><em>{symbol[w.kind]}</em></span><strong>{valid === null ? w.raw.trim() ? "!" : "—" : formatNumber(valid, 4)}</strong><span className="well-label">{w.kind === "excluded" ? "排除" : w.dose !== null ? `${formatNumber(w.dose, 3)}` : w.kind === "unknown" ? `DF ${w.dilution}` : w.group || (w.kind === "blank" ? "空白" : "")}</span></button></div>;
        })}</div>)}
      </div>
      <div className="plate-legend">{curveGroups(p).map(group => <span key={group} title={group}><i style={color(p, p.wells.find(w => w.group === group)!)} />{group}</span>)}<span><i className="legend-blank" />B 空白</span><span>U 未知</span><span>× 排除</span><small>同组同色 · 深色剂量高 · C 比较 / S 标准</small></div>
      <footer className="plate-check-bar"><div><b>{compiled.ok ? "映射可计算" : `${compiled.errors.length} 项待检查`}</b><span>{p.wells.filter(w => numericOD(w.raw) !== null).length} / 96 有效读数 · {compiled.groups.length} 拟合组 · 原始值保留</span><small title={compiled.errors.join("\n")}>{compiled.errors[0] || compiled.warnings[0] || "孔位、组别、浓度和复孔已明确"}</small></div><button className="secondary" onClick={() => setReview(true)}>检查孔位映射</button></footer>
    </section>
    <aside className="card plate-editor"><div className="plate-editor-tabs" role="tablist" aria-label="孔板设置"><button role="tab" aria-selected={panel === "assign"} onClick={() => setPanel("assign")}>标记选中孔</button><button role="tab" aria-selected={panel === "analysis"} onClick={() => setPanel("analysis")}>分析约定</button></div><div className="plate-editor-body">
      {panel === "analysis" ? <PlateAnalysisControls state={state} dispatch={dispatch} /> : <>
        <Field label="孔类型"><select value={draft.kind} onChange={e => setDraft({...draft, kind: e.target.value as WellKind})}>{Object.entries(KIND_LABELS).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></Field>
        {!["unassigned", "excluded"].includes(draft.kind) && <Field label={draft.kind === "blank" ? "空白作用组（同组模式必填）" : "组名 / 样品名"}><input value={draft.group} onChange={e => setDraft({...draft, group: e.target.value})} /></Field>}
        {curve && <><div className="field-grid"><Field label="起始量 / 浓度"><input type="number" min="0" step="any" value={draft.start} onChange={e => setDraft({...draft, start: Number(e.target.value)})} /></Field><Field label="梯度稀释倍数"><input type="number" min="2" max="10" step="any" value={draft.factor} onChange={e => setDraft({...draft, factor: Number(e.target.value)})} /></Field></div>
          <Field label="梯度板方向"><select value={draft.axis} onChange={e => setDraft({...draft, axis: e.target.value as Assignment["axis"]})}><option value="column">每列从上到下 · 各列重新起始</option><option value="row">每行从左到右 · 各行重新起始</option></select></Field>
          <div className="field-grid"><Field label="浓度方向"><select value={draft.direction} onChange={e => setDraft({...draft, direction: e.target.value as Assignment["direction"]})}><option value="decreasing">浓度递减 ↓</option><option value="increasing">浓度递增 ↑</option></select></Field><Field label="跨空位处理"><select value={draft.spacing} onChange={e => setDraft({...draft, spacing: e.target.value as Assignment["spacing"]})}><option value="physical">按物理位置保留间隔</option><option value="compact">仅选中孔连续编号</option></select></Field></div>
          <div className="gradient-preview" title={previewDoses}><small>应用前梯度预览 · 不依赖点击次序</small><p>{draftError || previewDoses || "选择一列或区域即可预览梯度"}</p></div>
        </>}
        {draft.kind === "unknown" && <><Field label="未知样品稀释校正倍数"><input type="number" min="1" step="any" value={draft.dilution} onChange={e => setDraft({...draft, dilution: Number(e.target.value)})} /></Field><p className="plate-policy">同名未知孔作为 OD 复孔；仅经明确标准曲线反算，稀释倍数最后乘一次，不进入标曲拟合。</p></>}
        {draft.kind === "blank" && <p className="plate-policy">空白孔不进入拟合。是否扣除与作用域，请在“分析约定”明确选择。</p>}
        <button className="primary assign-button" disabled={!selected.length || !!draftError} onClick={applyAssignment}>应用到选中孔</button>
        <div className="well-edit"><h3>原始读数</h3>{selected.length === 1 ? <Field label={`${selected[0].id} 原始 OD`}><input aria-label={`${selected[0].id} 原始 OD`} value={selected[0].raw} onChange={e => commit({...p, wells: p.wells.map(w => w.id === selected[0].id ? {...w, raw: e.target.value} : w)})} /><small>空白输入是缺失，0 是有效读数；可保留非法文本后排除。</small></Field> : <p>选择单孔可编辑；多孔粘贴先预览后整体应用。</p>}
        {selected.length > 0 && <button onClick={() => {const w = selected[0]; setDraft({...DEFAULT_ASSIGNMENT, kind: w.kind, group: w.group, dilution: w.dilution, ...(w.gradient ?? {})});}}>读取选中孔标记设置</button>}</div>
      </>}
    </div><p className="plate-keyboard">⌘ / Ctrl 单击多选 · Shift 矩形扩选<br />拖动框选 · 列号整列选 · 箭头键移动</p></aside>
    {error && <div className="plate-inline-error" role="alert">{error}<button aria-label="关闭孔板提示" onClick={() => setError("")}>×</button></div>}
    {paste && preview && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="粘贴读数预览" className="modal plate-modal"><h2>粘贴读数预览</h2><p>保持 A–H / 1–12 坐标，不自动转置、压缩空单元或把空值当 0。</p><div className="plate-paste-fields"><Field label="粘贴起始孔"><select value={paste.origin} onChange={e => setPaste({...paste, origin: e.target.value})}>{WELL_IDS.map(id => <option key={id}>{id}</option>)}</select></Field><Field label="读数分隔方式"><select value={paste.delimiter} onChange={e => setPaste({...paste, delimiter: e.target.value as "tab" | "csv"})}><option value="tab">Excel 制表符</option><option value="csv">CSV 逗号</option></select></Field></div><textarea autoFocus aria-label="Excel 孔板读数" value={paste.text} onChange={e => {setPaste({...paste, text: e.target.value}); setOverwrite(false); setAllowInvalid(false);}} spellCheck={false} placeholder="从 Excel 复制 8 行 × 12 列读数；也可从选定起始孔导入小矩形。" />
      <div className="paste-summary" role="status">{preview.error || `${preview.rows} × ${preview.columns} · ${preview.cells[0]?.id}–${preview.cells.at(-1)?.id} · ${missing} 缺失 · ${invalid} 非法 · ${existing} 现有读数将被覆盖`}</div>
      {!!preview.cells.length && <div className="paste-preview-table"><table><thead><tr><th>孔位</th>{Array.from({length: preview.columns}, (_, c) => <th key={c}>{coordinates(paste.origin)[1] + c + 1}</th>)}</tr></thead><tbody>{Array.from({length: preview.rows}, (_, r) => <tr key={r}><th>{ROWS[coordinates(paste.origin)[0] + r]}</th>{preview.cells.slice(r * preview.columns, (r + 1) * preview.columns).map(cell => <td key={cell.id} className={cell.issue ?? ""} title={`${cell.id}: ${cell.raw || "缺失"}`}>{cell.raw || "—"}</td>)}</tr>)}</tbody></table></div>}
      {!!invalid && <label className="plate-checkbox"><input type="checkbox" checked={allowInvalid} onChange={e => setAllowInvalid(e.target.checked)} />保留非法文本及其坐标（计算前必须修正或排除）</label>}
      {!!existing && <label className="plate-checkbox"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />确认覆盖现有读数，保留孔位标记与梯度</label>}
      <div className="button-row"><button onClick={() => setPaste(null)}>取消粘贴</button><button className="primary" disabled={!!preview.error || (!!invalid && !allowInvalid) || (!!existing && !overwrite)} onClick={() => {try {commit(applyPaste(p, preview, overwrite, allowInvalid)); setPaste(null);} catch (e) {setError(String(e));}}}>确认导入读数</button></div></section></div>}
    {confirmation && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="覆盖孔位标记？"><h2>覆盖孔位标记？</h2><p>{confirmation.label}</p><div className="button-row"><button onClick={() => setConfirmation(null)}>取消覆盖</button><button className="primary" onClick={() => {if (confirmation.version !== state.version) setError("板图已变化，请重新预览后应用"); else if (confirmation.example) dispatch({type: "plate-example", workflow: confirmation.example}); else commit(confirmation.plate); setConfirmation(null);}}>确认覆盖孔位</button></div></section></div>}
    {review && <div className="modal-backdrop"><section className="modal plate-modal mapping-modal" role="dialog" aria-modal="true" aria-label="孔位组别浓度映射检查"><h2>孔位 · 组别 · 浓度映射检查</h2><p>{compiled.mapping.blankScope}。{compiled.mapping.replicatePolicy}。</p><div className={`mapping-issues ${compiled.ok ? "ok" : ""}`}>{compiled.errors.length ? compiled.errors.map((message, i) => <p key={i}>{message}</p>) : <p>映射检查通过。拟合有效性、参比质量与曲线可比性仍由科学引擎检验。</p>}{compiled.warnings.map((message, i) => <p key={`warning-${i}`}>{message}</p>)}</div><div className="mapping-table"><table><thead><tr><th>孔位 / 类型</th><th>组别</th><th>原始 OD</th><th>剂量 / DF</th><th>空白</th><th>处理 OD</th><th>表格映射</th></tr></thead><tbody>{compiled.mapping.rows.filter(w => w.raw || w.kind !== "unassigned").map(w => <tr key={w.well}><td>{w.well}<small>{KIND_LABELS[w.kind]}</small></td><td title={w.group}>{w.group || "—"}</td><td title={w.raw}>{w.raw || "缺失"}</td><td>{w.kind === "unknown" ? `DF ${w.dilution}` : formatNumber(w.dose)}</td><td>{formatNumber(w.blank)}</td><td>{formatNumber(w.processedOD)}</td><td title={w.tableColumn ?? "不进入拟合"}>{w.tableColumn ? `行 ${w.tableRow} · ${w.tableColumn}` : w.kind === "unknown" ? "未知反算，非拟合" : "不进入拟合"}</td></tr>)}</tbody></table></div><div className="button-row"><button onClick={() => setReview(false)}>返回板图</button><button className="primary" disabled={!compiled.ok || !!state.busy} onClick={() => {setReview(false); parse();}}>确认映射并解析</button></div></section></div>}
  </div>;
}
