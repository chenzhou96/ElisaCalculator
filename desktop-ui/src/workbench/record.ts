import { defaultOptions, type Workspace } from "./model.ts";
import type { AnalysisOptions, ParseResponse, RunResponse, UnknownInput } from "./types";
import { createPlate, validatePlate } from "./plate.ts";

export const RECORD_SCHEMA = "elisa-analysis/2";
export const LEGACY_RECORD_SCHEMA = "elisa-analysis/1";
export const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_TEXT = 4 * 1024 * 1024;
const MAX_ROWS = 4096;

type JsonObject = Record<string, unknown>;
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`记录中的${label}无效`);
  return value as JsonObject;
}
function string(value: unknown, label: string, limit = 16384): string {
  if (typeof value !== "string" || value.length > limit) throw new Error(`记录中的${label}无效或过长`);
  return value;
}
function finite(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`记录中的${label}不是有限数值`);
}
function array(value: unknown, label: string, limit = MAX_ROWS): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`记录中的${label}无效或过多`);
  return value;
}
function strings(value: unknown, label: string): void {
  array(value, label).forEach(item => string(item, label));
}
function rawScalars(value: unknown, label: string): void {
  array(value, label, 65536).forEach(item => {
    if (item === null || typeof item === "string") return;
    finite(item, label);
  });
}
function numbers(value: unknown, label: string): void {
  array(value, label, 65536).forEach(item => finite(item, label));
}
/** Reject non-JSON values before JSON.stringify can silently turn NaN/Infinity into null. */
function validateJson(value: unknown, depth = 0, budget = {remaining: 1000000}): void {
  if (depth > 40 || --budget.remaining < 0) throw new Error("分析记录结构过深或过大");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {finite(value, "数值"); return;}
  if (Array.isArray(value)) {value.forEach(item => validateJson(item, depth + 1, budget)); return;}
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      // Optional response properties may be undefined in memory, but are absent in JSON.
      if (item !== undefined) validateJson(item, depth + 1, budget);
    }
    return;
  }
  throw new Error("分析记录含非 JSON 数据");
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left = Object.keys(a), right = Object.keys(b);
    return left.length === right.length && left.every(key => Object.hasOwn(b, key) && sameJson((a as JsonObject)[key], (b as JsonObject)[key]));
  }
  return false;
}
function parseOptions(value: unknown): AnalysisOptions {
  const input = value == null ? {} : object(value, "分析选项");
  const opts = {...defaultOptions, replicate_groups: {}, unknown_samples: [], ...input} as AnalysisOptions;
  for (const key of Object.keys(defaultOptions) as (keyof AnalysisOptions)[])
    if (input[key] !== undefined) Object.assign(opts, {[key]: input[key]});
  if (!['comparative', 'standard_curve'].includes(opts.workflow) || !['dilution_step', 'raw_concentration', 'log_concentration'].includes(opts.input_mode)) throw new Error("记录中的分析模式无效");
  if (!['stock_fraction', 'dimensionless'].includes(opts.dose_basis ?? 'stock_fraction') || !['shared', 'independent'].includes(opts.fit_mode) || !['increasing', 'decreasing'].includes(opts.dilution_direction) || !['none', 'constant'].includes(opts.blank_mode) || !['individual', 'mean'].includes(opts.replicate_mode)) throw new Error("记录中的分析选项无效");
  for (const key of ['dilution_factor', 'first_step', 'reference_assigned_value', 'blank_value'] as const) finite(opts[key], key);
  finite(opts.start_concentration, '起始浓度', true);
  string(opts.concentration_unit, '浓度单位');
  if (opts.reference_group !== null) string(opts.reference_group, '参考组');
  if (opts.standard_group !== null) string(opts.standard_group, '标准组');
  if (typeof opts.allow_extrapolation !== 'boolean') throw new Error('记录中的外推选项无效');
  const groups = object(opts.replicate_groups, '重复孔映射');
  if (Object.keys(groups).length > MAX_ROWS) throw new Error('重复孔映射过多');
  for (const [key, columns] of Object.entries(groups)) {string(key, '重复孔组名'); strings(columns, '重复孔列');}
  array(opts.unknown_samples, '未知样品选项').forEach(value => {
    const row = object(value, '未知样品选项');
    string(row.sample_id, '未知样品名'); numbers(row.od, '未知样品 OD'); finite(row.dilution_factor, '未知样品稀释倍数');
  });
  return opts;
}
function validateSummary(value: unknown): void {
  const row = object(value, '结果行');
  for (const key of ['Group', 'Status', 'Warning']) string(row[key], `结果 ${key}`);
  finite(row.N, '结果 N');
  if (!Number.isInteger(row.N) || (row.N as number) < 0) throw new Error('结果 N 必须是非负整数');
  for (const key of ['EC50', 'Slope', 'Global_A', 'Global_D', 'R2', 'RMSE']) finite(row[key], `结果 ${key}`, true);
  for (const key of ['LogEC50', 'EC50_step', 'EC50_ratio', 'Normalized_midpoint_X', 'Normalized_midpoint_X_CI_low', 'Normalized_midpoint_X_CI_high', 'Relative_stock_potency_X', 'LogEC50_SE', 'LogEC50_CI_low', 'LogEC50_CI_high', 'EC50_CI_low', 'EC50_CI_high', 'Relative_stock_potency_X_CI_low', 'Relative_stock_potency_X_CI_high', 'A', 'D']) if (row[key] !== undefined) finite(row[key], `结果 ${key}`, true);
  if (row.EC50_unit !== undefined) string(row.EC50_unit, 'EC50 单位');
  if (row.warning_list !== undefined) strings(row.warning_list, '结果警告');
}
function validateParsed(value: unknown): ParseResponse | null {
  if (value == null) return null;
  const response = object(value, '解析响应');
  if (typeof response.ok !== 'boolean') throw new Error('记录中的解析状态无效');
  for (const key of ['error', 'source_label', 'preview_text']) if (response[key] !== undefined) string(response[key], `解析 ${key}`, MAX_TEXT);
  for (const key of ['row_count', 'column_count']) if (response[key] !== undefined) finite(response[key], `解析 ${key}`);
  if (response.preview_columns !== undefined) strings(response.preview_columns, '预览列');
  if (response.preview_rows !== undefined) array(response.preview_rows, '预览行');
  if (response.meta !== undefined) {
    const meta = object(response.meta, '解析元数据');
    if (meta.columns !== undefined) strings(meta.columns, '解析列');
  }
  return response as unknown as ParseResponse;
}
/** Full computed responses are validated and retained exactly; no fit is fabricated here. */
export function validateStoredResult(value: unknown): RunResponse | null {
  if (value == null) return null;
  const response = object(value, '计算响应');
  validateParsed(response);
  if (response.results !== undefined) array(response.results, '结果列表').forEach(validateSummary);
  if (response.ok && (response.results === undefined || response.report == null)) throw new Error('完整历史结果缺少报告或结果列表');
  if (response.report != null) {
    const report = object(response.report, '计算报告');
    if (typeof report.fit_success !== 'boolean') throw new Error('记录中的拟合状态无效');
    string(report.fit_error, '拟合错误');
    const globals = object(report.global_params, '全局参数');
    for (const key of ['A', 'D']) if (globals[key] !== undefined) finite(globals[key], `全局 ${key}`, true);
    array(report.summary_rows, '完整结果列表').forEach(validateSummary);
    if (response.results !== undefined && !sameJson(response.results, report.summary_rows)) throw new Error('历史结果列表与完整报告不一致，不能恢复为可信快照');
    array(report.detailed_rows, '拟合详情').forEach(value => {
      const row = object(value, '拟合详情');
      for (const key of ['group_name', 'status', 'skip_reason']) string(row[key], `拟合 ${key}`);
      strings(row.warning_list, '拟合警告');
      numbers(row.x, '拟合 X'); numbers(row.y, '拟合 Y');
      if ((row.x as unknown[]).length !== (row.y as unknown[]).length) throw new Error('历史拟合 X/Y 长度不一致');
      for (const key of ['raw_x', 'raw_y']) if (row[key] !== undefined) rawScalars(row[key], `拟合 ${key}`);
      if (row.y_pred !== null) {
        numbers(row.y_pred, '拟合预测值');
        if ((row.y_pred as unknown[]).length !== (row.x as unknown[]).length) throw new Error('历史拟合预测值长度不一致');
      }
      for (const key of ['r2', 'rmse']) finite(row[key], `拟合 ${key}`, true);
      if (row.params != null) {
        const params = object(row.params, '4PL 参数');
        for (const key of ['A', 'B', 'C', 'D']) finite(params[key], `4PL ${key}`);
      }
      if (row.processed_points !== undefined) array(row.processed_points, '处理后点', 65536).forEach(value => {
        const point = object(value, '处理后点');
        for (const key of ['source_row', 'log_dose', 'processed_y']) finite(point[key], `处理后点 ${key}`, true);
        for (const key of ['raw_x', 'raw_y']) rawScalars([point[key]], `处理后点 ${key}`);
        string(point.source_column, '来源列'); string(point.exclusion_reason, '排除原因');
        if (typeof point.included !== 'boolean') throw new Error('记录中的纳入状态无效');
      });
    });
    if (report.unknown_results !== undefined) array(report.unknown_results, '未知样品结果').forEach(value => {
      const row = object(value, '未知样品结果');
      for (const key of ['Sample', 'Standard_group', 'Concentration_unit', 'Status', 'Warning']) string(row[key], `未知结果 ${key}`);
      numbers(row.OD_raw, '未知样品原始 OD');
      for (const key of ['OD_processed', 'Dilution_factor', 'Log_concentration', 'Concentration', 'Corrected_concentration']) finite(row[key], `未知结果 ${key}`, true);
      if (row.warning_list !== undefined) strings(row.warning_list, '未知结果警告');
    });
    if (report.options !== undefined) parseOptions(report.options);
    if (report.metadata !== undefined) object(report.metadata, '报告元数据');
  }
  if (response.previews !== undefined) array(response.previews, '曲线预览').forEach(value => {
    const preview = object(value, '曲线预览');
    string(preview.id, '预览标识');
    if (preview.group_name !== null) string(preview.group_name, '预览组名');
    const data = string(preview.data_url, '预览图像', 16 * 1024 * 1024);
    if (!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data) || (data.length - 'data:image/png;base64,'.length) % 4 !== 0) throw new Error('历史预览必须是内嵌 PNG 图像');
  });
  for (const key of ['warnings', 'preview_warnings', 'export_warnings', 'saved_files']) if (response[key] !== undefined) strings(response[key], key);
  for (const key of ['status_msg', 'export_error', 'output_dir']) if (response[key] !== undefined && response[key] !== null) string(response[key], key);
  return response as unknown as RunResponse;
}
export type RestoredRecord = Pick<Workspace,
  'rawText' | 'source' | 'headerMode' | 'xColumn' | 'options' | 'replicateText' | 'unknowns' | 'saveOutputs' | 'plate' | 'inputView' | 'viewOptions'
> & {
  result: RunResponse | null;
  parsed: ParseResponse | null;
  resultOrigin: 'historical' | null;
  recordSavedAt: string | null;
  compatibilityMessage: string;
};
export function serializeRecord(state: Workspace, savedAt = new Date().toISOString()): string {
  const record = {
    schema: RECORD_SCHEMA,
    app_version: '0.3.1',
    saved_at: savedAt,
    inputs: {
      inputView: state.inputView, plate: state.plate, rawText: state.rawText, source: state.source,
      headerMode: state.headerMode, xColumn: state.xColumn, options: state.options,
      viewOptions: {...state.viewOptions, [state.inputView]: state.options}, replicateText: state.replicateText,
      unknowns: state.unknowns, saveOutputs: state.saveOutputs,
    },
    parsed: state.parsed,
    result: state.result,
  };
  validateJson(record);
  const text = JSON.stringify(record);
  parseRecord(text); // The same validation applies to writes and external imports.
  return text;
}
export function parseRecord(text: string): RestoredRecord {
  if (typeof text !== 'string' || text.length > MAX_RECORD_BYTES || new TextEncoder().encode(text).byteLength > MAX_RECORD_BYTES) throw new Error('分析记录超过 64 MiB 限制');
  const record = object(JSON.parse(text), '记录');
  validateJson(record);
  if (![RECORD_SCHEMA, LEGACY_RECORD_SCHEMA].includes(record.schema as string)) throw new Error('这不是兼容的 ELISA 分析记录（elisa-analysis/1 或 /2）');
  const legacy = record.schema === LEGACY_RECORD_SCHEMA;
  const input = object(record.inputs, '输入');
  const rawText = string(input.rawText, '原始文本', MAX_TEXT);
  if (input.inputView != null && !['plate', 'table'].includes(input.inputView as string)) throw new Error('记录中的输入视图无效');
  const inputView = (input.inputView ?? 'table') as 'plate' | 'table';
  const plate = input.plate == null ? createPlate() : validatePlate(input.plate);
  const options = parseOptions(input.options);
  const storedViews = input.viewOptions == null ? {} : object(input.viewOptions, '视图分析约定');
  const viewOptions = {plate: parseOptions(storedViews.plate), table: parseOptions(storedViews.table)};
  viewOptions[inputView] = options;
  const unknowns = array(input.unknowns ?? [], '未知样品输入').map((value, index): UnknownInput => {
    const row = object(value, '未知样品输入');
    return {id: `restored-${index}`, sample: string(row.sample, '未知样品名'), od: string(row.od, '未知样品读数'), dilution: string(row.dilution, '未知样品稀释倍数')};
  });
  if (input.headerMode != null && !['auto', 'present', 'absent'].includes(input.headerMode as string)) throw new Error('记录中的表头模式无效');
  if (input.saveOutputs != null && typeof input.saveOutputs !== 'boolean') throw new Error('记录中的导出选项无效');
  let recordSavedAt: string | null = null;
  if (record.saved_at !== undefined) {
    recordSavedAt = string(record.saved_at, '保存时间', 64);
    if (!/^\d{4}-\d\d-\d\dT/.test(recordSavedAt) || !Number.isFinite(Date.parse(recordSavedAt))) throw new Error('记录中的保存时间无效');
  } else if (!legacy) throw new Error('完整分析记录缺少保存时间');
  const result = legacy ? null : validateStoredResult(record.result);
  const parsed = legacy ? null : validateParsed(record.parsed);
  const notices: string[] = [];
  if (legacy) notices.push('旧版 v1 记录仅恢复输入；未保存可信的完整计算快照，不能据此显示历史拟合结果');
  if (inputView === 'table') notices.push('此记录保留旧版表格原始数据与设置；当前仅支持孔板比较工作流，旧表格输入保留为只读');
  if (options.workflow === 'standard_curve' || plate.wells.some(w => w.kind === 'standard' || w.kind === 'unknown')) notices.push('此记录保留标准曲线、未知样品及其设置；当前工作流不会重算这些旧版数据，请新建孔板或明确重新标记');
  return {
    inputView, viewOptions, plate, rawText, options, unknowns,
    source: string(input.source ?? '分析记录', '数据来源'),
    headerMode: (input.headerMode ?? 'auto') as RestoredRecord['headerMode'],
    xColumn: string(input.xColumn ?? '', 'X 列'),
    replicateText: string(input.replicateText ?? '', '重复孔编辑文本', MAX_TEXT),
    saveOutputs: input.saveOutputs === true,
    result, parsed, resultOrigin: result ? 'historical' : null, recordSavedAt,
    compatibilityMessage: notices.join('。'),
  };
}
