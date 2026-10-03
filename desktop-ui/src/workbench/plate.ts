import { evaluateNumber } from "./arithmetic.ts";
import type { AnalysisOptions } from "./types";

export const ROWS = "ABCDEFGH";
export const WELL_IDS = [...ROWS].flatMap(row => Array.from({length: 12}, (_, c) => `${row}${c + 1}`));
export type WellKind = "unassigned" | "comparison" | "standard" | "unknown" | "blank" | "excluded";
export const KIND_LABELS: Record<WellKind, string> = {unassigned: "未分配", comparison: "比较曲线", standard: "标准曲线", unknown: "未知样品", blank: "空白", excluded: "排除"};
export interface Gradient {
  start: number;
  factor: number;
  direction: "decreasing" | "increasing";
  axis: "column" | "row";
  spacing: "physical" | "compact";
}
export interface PlateWell {
  id: string;
  raw: string;
  kind: WellKind;
  group: string;
  dose: number | null;
  dilution: number;
  gradient: Gradient | null;
}
export interface PlateDocument {
  schema: "elisa-plate/1";
  wells: PlateWell[];
  selected: string[];
  anchor: string;
  basis: "relative" | "absolute";
  unit: string;
  blankMode: "none" | "global" | "group";
  replicateMode: "individual" | "mean";
}
export interface Assignment extends Gradient {
  kind: WellKind;
  group: string;
  dilution: number;
}
export function createPlate(): PlateDocument {
  return {schema: "elisa-plate/1", wells: WELL_IDS.map(id => ({id, raw: "", kind: "unassigned", group: "", dose: null, dilution: 1, gradient: null})), selected: [], anchor: "A1", basis: "relative", unit: "ng/mL", blankMode: "none", replicateMode: "individual"};
}
export function coordinates(id: string): [number, number] {
  const index = WELL_IDS.indexOf(id);
  if (index < 0) throw new Error(`无效孔位：${id}`);
  return [Math.floor(index / 12), index % 12];
}
export function rectangleIds(start: string, end: string): string[] {
  const [r1, c1] = coordinates(start), [r2, c2] = coordinates(end);
  return WELL_IDS.filter(id => {const [r, c] = coordinates(id); return r >= Math.min(r1, r2) && r <= Math.max(r1, r2) && c >= Math.min(c1, c2) && c <= Math.max(c1, c2);});
}
export function selectWells(plate: PlateDocument, id: string, mode: "single" | "toggle" | "range"): PlateDocument {
  coordinates(id);
  const selected = mode === "range" ? rectangleIds(plate.anchor, id) : mode === "toggle" ? (plate.selected.includes(id) ? plate.selected.filter(w => w !== id) : [...plate.selected, id]) : [id];
  return {...plate, selected: WELL_IDS.filter(w => selected.includes(w)), anchor: mode === "range" ? plate.anchor : id};
}
/** Empty strings are missing; zero is a real measurement. No locale/transpose inference. */
export function numericOD(raw: string): number | null {
  try {return evaluateNumber(raw);} catch {return null;}
}
export interface PastePreview {
  rows: number;
  columns: number;
  cells: {id: string; raw: string; issue: "missing" | "invalid" | null}[];
  error: string;
}
export function previewPaste(text: string, origin = "A1", delimiter: "tab" | "csv" = "tab"): PastePreview {
  const failure = (error: string): PastePreview => ({rows: 0, columns: 0, cells: [], error});
  let start: [number, number];
  try {start = coordinates(origin);} catch {return failure("请选择有效起始孔位");}
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!normalized.length) return failure("请粘贴 Excel 读数；空单元需要保留制表符");
  const rows = normalized.split("\n").map(row => row.split(delimiter === "tab" ? "\t" : ","));
  const columns = rows[0].length;
  if (rows.some(row => row.length !== columns)) return failure("各行列数不一致；请保留空单元和尾空列，不会压缩或部分导入");
  if (rows.length + start[0] > 8 || columns + start[1] > 12) return failure(`区域 ${rows.length}×${columns} 超出 8×12 孔板；不会自动转置或部分导入`);
  return {rows: rows.length, columns, error: "", cells: rows.flatMap((row, r) => row.map((raw, c) => ({id: `${ROWS[r + start[0]]}${c + start[1] + 1}`, raw, issue: !raw.trim() ? "missing" as const : numericOD(raw) === null ? "invalid" as const : null})))};
}
export function applyPaste(plate: PlateDocument, preview: PastePreview, overwrite: boolean, allowInvalid: boolean): PlateDocument {
  if (preview.error || !preview.cells.length) throw new Error(preview.error || "没有可导入的区域");
  if (!allowInvalid && preview.cells.some(cell => cell.issue === "invalid")) throw new Error("非法读数需要明确选择保留后整体导入");
  if (!overwrite && preview.cells.some(cell => plate.wells.find(w => w.id === cell.id)?.raw !== "")) throw new Error("覆盖现有读数需要确认");
  const cells = new Map(preview.cells.map(cell => [cell.id, cell.raw]));
  return {...plate, wells: plate.wells.map(w => cells.has(w.id) ? {...w, raw: cells.get(w.id)!} : w)};
}
export function assignWells(plate: PlateDocument, ids: string[], assignment: Assignment): PlateDocument {
  if (!ids.length || ids.some(id => !WELL_IDS.includes(id))) throw new Error("先选择需要标记的孔位");
  const curve = assignment.kind === "comparison" || assignment.kind === "standard";
  if (!["unassigned", "excluded", "blank"].includes(assignment.kind) && !assignment.group.trim()) throw new Error("组名 / 样品名不能为空");
  if (/[\t\r\n]/.test(assignment.group)) throw new Error("组名不能包含换行或制表符");
  if (curve && (!Number.isFinite(assignment.start) || assignment.start <= 0 || !Number.isFinite(assignment.factor) || assignment.factor < 2 || assignment.factor > 10)) throw new Error("起始量须大于 0，梯度倍数须为 2–10");
  if (assignment.kind === "unknown" && (!Number.isFinite(assignment.dilution) || assignment.dilution < 1)) throw new Error("未知样品稀释校正倍数须至少为 1");
  const selected = new Set(ids), group = assignment.group.trim();
  const gradient: Gradient = {start: assignment.start, factor: assignment.factor, direction: assignment.direction, axis: assignment.axis, spacing: assignment.spacing};
  const doses = new Map<string, number>();
  if (curve) {
    const lines = new Map<number, {id: string; position: number}[]>();
    for (const id of WELL_IDS.filter(w => selected.has(w))) {
      const [r, c] = coordinates(id), line = assignment.axis === "column" ? c : r, position = assignment.axis === "column" ? r : c;
      lines.set(line, [...(lines.get(line) ?? []), {id, position}]);
    }
    for (const entries of lines.values()) entries.sort((a, b) => a.position - b.position).forEach((entry, index) => {
      const step = assignment.spacing === "physical" ? entry.position - entries[0].position : index;
      const dose = assignment.start * assignment.factor ** (assignment.direction === "decreasing" ? -step : step);
      if (!Number.isFinite(dose) || dose <= 0) throw new Error("生成的浓度超出有效数值范围");
      doses.set(entry.id, dose);
    });
  }
  return {...plate, wells: plate.wells.map(w => {
    if (!selected.has(w.id)) return w;
    if (assignment.kind === "excluded") return {...w, kind: "excluded"};
    return {...w, kind: assignment.kind, group: assignment.kind === "unassigned" ? "" : group, dose: doses.get(w.id) ?? null, gradient: curve ? gradient : null, dilution: assignment.kind === "unknown" ? assignment.dilution : 1};
  })};
}
export function curveGroups(plate: PlateDocument): string[] {
  return [...new Set(plate.wells.filter(w => w.kind === "comparison" || w.kind === "standard").map(w => w.group).filter(Boolean))];
}
export interface PlateMapping {
  schema: "elisa-plate-mapping/1";
  plate: PlateDocument;
  rows: {well: string; group: string; kind: WellKind; raw: string; dose: number | null; processedOD: number | null; blank: number; tableColumn: string | null; tableRow: number | null; dilution: number}[];
  coordinateEncoding: string;
  blankScope: string;
  replicatePolicy: string;
}
export interface CompiledPlate {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rawText: string;
  options: AnalysisOptions;
  mapping: PlateMapping;
  groups: string[];
}
/** Produce an explicit wide table for the existing Python engine. Raw plate cells never change. */
export function compilePlate(plate: PlateDocument, options: AnalysisOptions): CompiledPlate {
  const errors: string[] = [], warnings: string[] = [];
  const curveKinds = options.workflow === "comparative" ? ["comparison", "standard"] : ["standard"];
  const curves = plate.wells.filter(w => curveKinds.includes(w.kind));
  const unknowns = plate.wells.filter(w => w.kind === "unknown");
  const groups = [...new Set(curves.map(w => w.group))];
  if (!curves.length) errors.push("尚未标记拟合曲线孔位");
  if (options.workflow === "standard_curve" && plate.basis !== "absolute") errors.push("标准反算必须使用已知绝对浓度和单位");
  if (plate.basis === "absolute" && !plate.unit.trim()) errors.push("绝对浓度需要明确单位");
  for (const w of plate.wells) {
    if (w.kind === "unassigned" && w.raw.trim()) errors.push(`${w.id}：有读数但未分配；请标记或明确排除`);
    if (w.kind !== "unassigned" && w.kind !== "excluded" && numericOD(w.raw) === null) errors.push(`${w.id}：${w.raw.trim() ? "非法读数" : "缺失读数"}；不能当作 0`);
    if ((w.kind === "comparison" || w.kind === "standard" || w.kind === "unknown") && !w.group.trim()) errors.push(`${w.id}：缺少组名`);
    if (curves.includes(w) && (!Number.isFinite(w.dose) || w.dose === null || w.dose <= 0)) errors.push(`${w.id}：缺少有效正浓度 / 相对剂量`);
    if (options.workflow === "standard_curve" && w.kind === "comparison") errors.push(`${w.id}：比较孔不能进入标准拟合；请重标记或排除`);
    if (options.workflow === "comparative" && w.kind === "unknown") errors.push(`${w.id}：未知样品需要标准反算工作流`);
  }
  for (const group of groups) {
    const wells = curves.filter(w => w.group === group);
    if (new Set(wells.map(w => w.dose)).size < 4) errors.push(`${group}：4PL 至少需要 4 个不同剂量`);
    if (new Set(wells.map(w => w.kind)).size > 1) errors.push(`${group}：同组孔类型不一致`);
  }
  const validBlanks = plate.wells.filter(w => w.kind === "blank" && numericOD(w.raw) !== null);
  const blankCache = new Map<string, number>();
  const affected = [...new Set([...groups, ...unknowns.map(w => w.group)])];
  for (const group of affected) {
    const blanks = plate.blankMode === "global" ? validBlanks : validBlanks.filter(w => w.group === group);
    if (plate.blankMode !== "none" && !blanks.length) errors.push(`${group}：${plate.blankMode === "group" ? "没有同组空白，不会回退到全板空白" : "没有有效空白孔"}`);
    blankCache.set(group, plate.blankMode === "none" || !blanks.length ? 0 : blanks.reduce((sum, w) => sum + numericOD(w.raw)!, 0) / blanks.length);
  }
  if (options.workflow === "comparative") {
    if (!options.reference_group || !groups.includes(options.reference_group)) errors.push("请选择板图中的参比组");
    if (!Number.isFinite(options.reference_assigned_value) || options.reference_assigned_value <= 0) errors.push("参比赋值必须大于 0");
  } else {
    if (!options.standard_group || !groups.includes(options.standard_group)) errors.push("请选择板图中的标准曲线引用");
    if (!unknowns.length) errors.push("请标记至少一个未知样品孔");
  }
  const unit = plate.basis === "relative" ? "relative dose" : plate.unit.trim();
  const mappedOptions: AnalysisOptions = {...options, dose_basis: plate.basis === "relative" ? "dimensionless" : "stock_fraction", input_mode: plate.basis === "relative" ? "dilution_step" : "raw_concentration", dilution_factor: 2, dilution_direction: "increasing", first_step: 1, start_concentration: null, concentration_unit: unit, blank_mode: "none", blank_value: 0, replicate_mode: plate.replicateMode, replicate_groups: {}, unknown_samples: []};
  for (const group of [...new Set(unknowns.map(w => w.group))]) {
    const wells = unknowns.filter(w => w.group === group);
    if (groups.includes(group)) errors.push(`${group}：未知样品名不能与拟合组相同`);
    if (new Set(wells.map(w => w.dilution)).size !== 1 || !Number.isFinite(wells[0].dilution) || wells[0].dilution < 1) errors.push(`${group}：重复未知孔需要一致且至少为 1 的稀释校正倍数`);
    mappedOptions.unknown_samples.push({sample_id: group, od: wells.map(w => (numericOD(w.raw) ?? NaN) - (blankCache.get(group) ?? 0)), dilution_factor: wells[0].dilution});
  }
  const doses = [...new Set(curves.map(w => w.dose).filter((d): d is number => d !== null && Number.isFinite(d) && d > 0))].sort((a, b) => b - a);
  const columns: {name: string; group: string; values: Map<number, string>}[] = [];
  const positions = new Map<string, {column: string; row: number}>();
  for (const w of curves) {
    if (w.dose === null || !Number.isFinite(w.dose) || w.dose <= 0) continue;
    const base = `${w.group} · 列 ${coordinates(w.id)[1] + 1}`;
    let column = columns.find(c => c.group === w.group && c.name.startsWith(base + " · 复孔 ") && !c.values.has(w.dose!));
    if (!column) {
      const serial = columns.filter(c => c.group === w.group && c.name.startsWith(base + " · 复孔 ")).length + 1;
      column = {name: `${base} · 复孔 ${serial}`, group: w.group, values: new Map()}; columns.push(column);
    }
    const value = numericOD(w.raw);
    column.values.set(w.dose, value === null ? w.raw : String(value - (blankCache.get(w.group) ?? 0)));
    positions.set(w.id, {column: column.name, row: doses.indexOf(w.dose) + 1});
  }
  mappedOptions.replicate_groups = Object.fromEntries(groups.map(group => [group, columns.filter(c => c.group === group).map(c => c.name)]));
  const rawText = ["Dose\t" + columns.map(c => c.name.includes('"') ? '"' + c.name.replace(/"/g, '""') + '"' : c.name).join("\t"), ...doses.map(dose => [plate.basis === "relative" ? 1 - Math.log2(dose) : dose, ...columns.map(c => c.values.get(dose) ?? "")].join("\t"))].join("\n");
  const mapping: PlateMapping = {schema: "elisa-plate-mapping/1", plate, coordinateEncoding: plate.basis === "relative" ? "Canonical X = 1 - log2(dimensionless dose); engine uses a reversible dimensionless dilution_step encoding, factor 2, first_step 1. This encoding preserves every confirmed dose and group gradient." : "Canonical X is the confirmed absolute dose in the explicit plate unit; stock concentration is unspecified, so original-stock X is unavailable.", blankScope: plate.blankMode === "none" ? "不扣空白" : plate.blankMode === "global" ? "全板有效空白均值；所有拟合组和未知样品各扣一次" : "每组仅使用同名空白均值；缺组空白阻止计算，不回退", replicatePolicy: plate.replicateMode === "individual" ? "逐孔拟合，每个有效观测等权；技术复孔不视为独立实验" : "每组每剂量均值拟合，剂量均值等权；不按复孔数加权", rows: plate.wells.map(w => {
    const value = numericOD(w.raw), included = curveKinds.includes(w.kind) || w.kind === "unknown", blank = included ? blankCache.get(w.group) ?? 0 : 0;
    const processedOD = value === null || !included ? null : value - blank;
    if (processedOD !== null && processedOD < 0) warnings.push(`${w.id}：空白校正后为负值，保留原值不裁零`);
    return {well: w.id, group: w.group, kind: w.kind, raw: w.raw, dose: w.dose, processedOD, blank, tableColumn: positions.get(w.id)?.column ?? null, tableRow: positions.get(w.id)?.row ?? null, dilution: w.dilution};
  })};
  if (columns.length > 1 && doses.length > 0 && columns.some(c => c.values.size < doses.length)) warnings.push("各组剂量不同：表格保留空位；引擎只纳入各组实际有效观测");
  if (plate.basis === "relative") warnings.push("剂量为无量纲正数，不推断原液分数或绝对浓度；中点相对值 = 参比赋值 × 参比 EC50 / 样品 EC50。曲线平行性和恒定效价未被证明");
  return {ok: errors.length === 0, errors, warnings, rawText, options: mappedOptions, mapping, groups};
}
/** Strict persisted document shape: 96 unique coordinates in row-major order. */
export function validatePlate(value: unknown): PlateDocument {
  if (!value || typeof value !== "object") throw new Error("孔板记录无效");
  const p = value as PlateDocument;
  if (p.schema !== "elisa-plate/1" || !Array.isArray(p.wells) || p.wells.length !== 96 || !["relative", "absolute"].includes(p.basis) || !["none", "global", "group"].includes(p.blankMode) || !["individual", "mean"].includes(p.replicateMode) || typeof p.unit !== "string" || !Array.isArray(p.selected) || p.selected.some(id => !WELL_IDS.includes(id)) || !WELL_IDS.includes(p.anchor)) throw new Error("孔板尺寸或分析设置无效");
  const wells = p.wells.map((w, i) => {
    if (!w || w.id !== WELL_IDS[i] || typeof w.raw !== "string" || !(typeof w.kind === "string" && Object.hasOwn(KIND_LABELS, w.kind)) || typeof w.group !== "string" || /[\t\r\n]/.test(w.group) || (w.dose !== null && (typeof w.dose !== "number" || !Number.isFinite(w.dose) || w.dose <= 0)) || typeof w.dilution !== "number" || !Number.isFinite(w.dilution) || w.dilution < 1) throw new Error(`孔板记录 ${WELL_IDS[i]} 无效`);
    if (w.gradient !== null) {
      const g = w.gradient;
      if (!g || typeof g.start !== "number" || !Number.isFinite(g.start) || g.start <= 0 || typeof g.factor !== "number" || !Number.isFinite(g.factor) || g.factor < 2 || g.factor > 10 || !["increasing", "decreasing"].includes(g.direction) || !["row", "column"].includes(g.axis) || !["physical", "compact"].includes(g.spacing)) throw new Error(`${w.id} 梯度设置无效`);
    }
    return {...w, gradient: w.gradient ? {...w.gradient} : null};
  });
  return {schema: "elisa-plate/1", wells, selected: [...new Set(p.selected)], anchor: p.anchor, basis: p.basis, unit: p.unit, blankMode: p.blankMode, replicateMode: p.replicateMode};
}
export function plateExample(workflow: AnalysisOptions["workflow"]): PlateDocument {
  let p = createPlate();
  const reference = [2.761493605490578,2.5065680393449,1.903051103311573,1.0569488966884268,0.4534319606551,0.198506394509422,0.11509069081396901,0.09016798947914616];
  const sample = [2.8698320105208537,2.844909309186031,2.761493605490578,2.5065680393449,1.903051103311573,1.0569488966884268,0.4534319606551,0.198506394509422];
  const standard = [2.8610853483082472,2.815221552802209,2.666678572555401,2.2553070830280655,1.48,0.7046929169719343,0.29332142744459927,0.1447784471977907];
  p = {...p, basis: workflow === "standard_curve" ? "absolute" : "relative", blankMode: "global"};
  const a: Assignment = {kind: workflow === "comparative" ? "comparison" : "standard", group: workflow === "comparative" ? "Reference" : "Standard", start: workflow === "comparative" ? 1 : 128, factor: 2, direction: "decreasing", axis: "column", spacing: "physical", dilution: 1};
  for (const column of [1, 2]) {
    p = assignWells(p, [...ROWS].map(r => `${r}${column}`), a);
    p = {...p, wells: p.wells.map(w => coordinates(w.id)[1] === column - 1 ? {...w, raw: String((workflow === "comparative" ? reference : standard)[coordinates(w.id)[0]] + 0.02)} : w)};
  }
  if (workflow === "comparative") for (const column of [3, 4]) {
    p = assignWells(p, [...ROWS].map(r => `${r}${column}`), {...a, group: "Sample_4X"});
    p = {...p, wells: p.wells.map(w => coordinates(w.id)[1] === column - 1 ? {...w, raw: String(sample[coordinates(w.id)[0]] + 0.02)} : w)};
  } else {
    p = assignWells(p, ["A3", "B3"], {...a, kind: "unknown", group: "Known_truth_12", dilution: 5});
    p = assignWells(p, ["C3"], {...a, kind: "unknown", group: "Below_range"});
    p = {...p, wells: p.wells.map(w => ["A3", "B3"].includes(w.id) ? {...w, raw: String(1.9693547261121727 + 0.02)} : w.id === "C3" ? {...w, raw: String(0.08105058953949439 + 0.02)} : w)};
  }
  p = assignWells(p, ["A5", "B5"], {...a, kind: "blank", group: ""});
  return {...p, wells: p.wells.map(w => ["A5", "B5"].includes(w.id) ? {...w, raw: "0.02"} : w), selected: [...ROWS].map(r => `${r}1`)};
}
