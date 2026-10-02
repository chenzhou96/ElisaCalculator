import type {
  AnalysisOptions,
  HeaderMode,
  Page,
  ParseResponse,
  RunResponse,
  UnknownInput,
} from "./types";

import { createPlate, compilePlate, curveGroups, plateExample, type PlateDocument } from "./plate.ts";

export const defaultOptions: AnalysisOptions = {
  workflow: "comparative",
  input_mode: "dilution_step",
  dilution_factor: 2,
  dilution_direction: "increasing",
  first_step: 1,
  start_concentration: null,
  concentration_unit: "ng/mL",
  fit_mode: "shared",
  reference_group: null,
  reference_assigned_value: 1,
  blank_mode: "none",
  blank_value: 0,
  replicate_mode: "individual",
  replicate_groups: {},
  standard_group: null,
  allow_extrapolation: false,
  unknown_samples: [],
};
export interface PlateSnapshot { plate: PlateDocument; options: AnalysisOptions }
export interface Workspace {
  page: Page;
  inputView: "plate" | "table";
  plate: PlateDocument;
  platePast: PlateSnapshot[];
  plateFuture: PlateSnapshot[];
  rawText: string;
  source: string;
  headerMode: HeaderMode;
  xColumn: string;
  options: AnalysisOptions;
  viewOptions: Record<"plate" | "table", AnalysisOptions>;
  replicateText: string;
  unknowns: UnknownInput[];
  saveOutputs: boolean;
  parsed: ParseResponse | null;
  result: RunResponse | null;
  error: string;
  version: number;
  request: number | null;
  busy: "load" | "parse" | "run" | null;
  status: string;
}
export const initialWorkspace: Workspace = {
  page: "data",
  inputView: "plate",
  plate: createPlate(),
  platePast: [],
  plateFuture: [],
  rawText: "",
  source: "未导入数据",
  headerMode: "auto",
  xColumn: "",
  options: defaultOptions,
  viewOptions: {plate: {...defaultOptions}, table: {...defaultOptions}},
  replicateText: "",
  unknowns: [{ id: "sample-1", sample: "样品 1", od: "", dilution: "1" }],
  saveOutputs: false,
  parsed: null,
  result: null,
  error: "",
  version: 0,
  request: null,
  busy: null,
  status: "准备开始",
};
type InputPatch = Partial<
  Pick<
    Workspace,
    | "rawText"
    | "source"
    | "headerMode"
    | "xColumn"
    | "replicateText"
    | "unknowns"
    | "saveOutputs"
  >
>;
export type Action =
  | { type: "view"; view: Workspace["inputView"] }
  | { type: "plate"; plate: PlateDocument }
  | { type: "plate-selection"; selected: string[]; anchor: string }
  | { type: "plate-undo" }
  | { type: "plate-redo" }
  | { type: "plate-example"; workflow: AnalysisOptions["workflow"] }
  | { type: "page"; page: Page }
  | { type: "input"; patch: InputPatch }
  | { type: "options"; patch: Partial<AnalysisOptions> }
  | { type: "example"; workflow: AnalysisOptions["workflow"] }
  | { type: "reset" }
  | {
      type: "restore";
      request: number;
      version: number;
      workspace: Pick<
        Workspace,
        | "rawText"
        | "source"
        | "headerMode"
        | "xColumn"
        | "options"
        | "replicateText"
        | "unknowns"
        | "saveOutputs"
      > & Partial<Pick<Workspace, "plate" | "inputView" | "viewOptions">>;
    }
  | { type: "begin"; request: number; busy: Workspace["busy"] }
  | {
      type: "parsed";
      request: number;
      version: number;
      response: ParseResponse;
    }
  | { type: "ran"; request: number; version: number; response: RunResponse }
  | {
      type: "loaded";
      request: number;
      version: number;
      text: string;
      source: string;
    }
  | { type: "error"; error: string; request?: number; version?: number }
  | { type: "end"; request: number };

function changed(state: Workspace, clearParsed = false): Workspace {
  return {
    ...state,
    version: state.version + 1,
    result: null,
    parsed: clearParsed ? null : state.parsed,
    error: "",
    status: state.result ? "输入已更改，请重新计算" : "输入待检查",
  };
}
function current(
  state: Workspace,
  action: { request: number; version: number },
) {
  return state.request === action.request && state.version === action.version;
}
function savedViewOptions(state: Workspace) {
  return {...state.viewOptions, [state.inputView]: state.options};
}
export function reducer(state: Workspace, action: Action): Workspace {
  switch (action.type) {
    case "view":
      return state.inputView === action.view ? state : {...changed(state, true), inputView: action.view, viewOptions: savedViewOptions(state), options: state.viewOptions[action.view], page: "data", status: "已切换输入视图；两份原始输入分别保留，请重新检查"};
    case "plate-selection":
      return {...state, plate: {...state.plate, selected: action.selected, anchor: action.anchor}};
    case "plate":
      return {...changed(state, true), plate: action.plate, platePast: [...state.platePast.slice(-39), {plate: state.plate, options: state.options}], plateFuture: []};
    case "plate-undo": {
      if (!state.platePast.length) return state;
      return {...changed(state, true), plate: state.platePast.at(-1)!.plate, options: state.platePast.at(-1)!.options, platePast: state.platePast.slice(0, -1), plateFuture: [{plate: state.plate, options: state.options}, ...state.plateFuture]};
    }
    case "plate-redo": {
      if (!state.plateFuture.length) return state;
      return {...changed(state, true), plate: state.plateFuture[0].plate, options: state.plateFuture[0].options, platePast: [...state.platePast.slice(-39), {plate: state.plate, options: state.options}], plateFuture: state.plateFuture.slice(1)};
    }
    case "plate-example":
      return {...changed(state, true), inputView: "plate", viewOptions: savedViewOptions(state), plate: plateExample(action.workflow), platePast: [...state.platePast.slice(-39), {plate: state.plate, options: state.options}], plateFuture: [], options: {...defaultOptions, workflow: action.workflow, reference_group: "Reference", reference_assigned_value: 10, standard_group: "Standard", fit_mode: action.workflow === "comparative" ? "shared" : "independent"}, status: "合成孔板示例已载入；请检查映射"};
    case "page":
      return { ...state, page: action.page };
    case "input":
      return {
        ...changed(
          state,
          "rawText" in action.patch || "headerMode" in action.patch,
        ),
        ...action.patch,
      };
    case "options":
      return {
        ...changed(state, state.inputView === "plate"),
        options: { ...state.options, ...action.patch },
        ...(state.inputView === "plate" ? {platePast: [...state.platePast.slice(-39), {plate: state.plate, options: state.options}], plateFuture: []} : {}),
      };
    case "restore":
      return current(state, action)
        ? {
            ...initialWorkspace,
            ...action.workspace,
            inputView: action.workspace.inputView ?? "table",
            plate: action.workspace.plate ?? createPlate(),
            viewOptions: action.workspace.viewOptions ?? {plate: (action.workspace.inputView === "plate" ? action.workspace.options : {...defaultOptions}), table: (action.workspace.inputView !== "plate" ? action.workspace.options : {...defaultOptions})},
            platePast: [],
            plateFuture: [],
            version: state.version + 1,
            status: "分析记录已恢复，请重新解析和计算",
          }
        : state;
    case "reset":
      return { ...initialWorkspace, plate: createPlate(), version: state.version + 1 };
    case "example": {
      const standard = action.workflow === "standard_curve";
      return {
        ...initialWorkspace,
        inputView: "table",
        viewOptions: savedViewOptions(state),
        plate: state.plate,
        platePast: state.platePast,
        plateFuture: state.plateFuture,
        version: state.version + 1,
        source: standard ? "示例 · 标准曲线" : "示例 · 两倍连续稀释",
        rawText: standard ? STANDARD_EXAMPLE : COMPARISON_EXAMPLE,
        options: {
          ...defaultOptions,
          workflow: action.workflow,
          input_mode: standard ? "raw_concentration" : "dilution_step",
          reference_group: "Reference",
          standard_group: "Standard",
          fit_mode: standard ? "independent" : "shared",
        },
        unknowns: [
          { id: "sample-1", sample: "样品 A", od: "0.82; 0.86", dilution: "5" },
          {
            id: "sample-2",
            sample: "样品 B",
            od: "1.48; 1.52",
            dilution: "10",
          },
        ],
        status: "示例已载入，请预览数据",
      };
    }
    case "begin":
      return {
        ...state,
        request: action.request,
        busy: action.busy,
        error: "",
        status:
          action.busy === "run"
            ? "正在计算…"
            : action.busy === "load"
              ? "正在读取文件…"
              : "正在解析…",
        ...(action.busy === "run" ? { result: null } : {}),
      };
    case "end":
      return state.request === action.request
        ? { ...state, request: null, busy: null }
        : state;
    case "loaded":
      return current(state, action)
        ? {
            ...changed(state, true),
            inputView: "table",
            viewOptions: savedViewOptions(state),
            options: state.inputView === "table" ? state.options : state.viewOptions.table,
            rawText: action.text,
            source: action.source,
            xColumn: "",
            status: "文件已载入，请预览数据",
          }
        : state;
    case "parsed":
      return current(state, action)
        ? {
            ...state,
            parsed: action.response,
            xColumn: state.inputView === "plate" ? state.xColumn : action.response.meta?.columns?.includes(state.xColumn)
              ? state.xColumn
              : (action.response.meta?.columns?.[0] ?? ""),
            error: action.response.ok
              ? ""
              : (action.response.error ?? "解析失败"),
            status: action.response.ok ? "数据已解析" : "解析失败",
          }
        : state;
    case "ran":
      return current(state, action)
        ? {
            ...state,
            result: action.response,
            error: action.response.ok
              ? ""
              : (action.response.error ?? "计算失败"),
            page: action.response.ok ? "results" : state.page,
            status: action.response.ok
              ? action.response.export_error
                ? "计算完成 · 导出失败"
                : "计算完成"
              : "计算失败",
          }
        : state;
    case "error":
      return action.request !== undefined &&
        !current(state, {
          request: action.request,
          version: action.version ?? state.version,
        })
        ? state
        : { ...state, error: action.error, status: "需要检查" };
  }
}

export const COMPARISON_EXAMPLE =
  "Step\tReference\tSample A\tSample B\n1\t2.375\t2.524\t2.16\n2\t2.14\t2.36\t1.806\n3\t1.79\t2.119\t1.371\n4\t1.36\t1.792\t0.948\n5\t0.94\t1.347\t0.615\n6\t0.61\t0.949\t0.395\n7\t0.39\t0.618\t0.263\n8\t0.26\t0.396\t0.19";
export const STANDARD_EXAMPLE =
  "Concentration\tStandard\n100\t2.345\n50\t2.1\n25\t1.739\n12.5\t1.319\n6.25\t0.91\n3.125\t0.578\n1.5625\t0.365\n0.78125\t0.242";

export function formatNumber(
  value: number | null | undefined,
  digits = 5,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return Number(value.toPrecision(digits)).toString();
}
export function parseReplicateGroups(text: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const line of text.split("\n").filter((line) => line.trim())) {
    const equal = line.indexOf("=");
    if (equal < 1)
      throw new Error("重复孔映射应为：组名 = 列 1, 列 2（每组一行）");
    const name = line.slice(0, equal).trim();
    const columns = line
      .slice(equal + 1)
      .split(/[,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!name || !columns.length || result[name])
      throw new Error("重复孔映射需要唯一组名和至少一列");
    result[name] = columns;
  }
  return result;
}
export function availableGroups(state: Workspace): string[] {
  if (state.inputView === "plate") return curveGroups(state.plate);
  const columns = (state.parsed?.meta?.columns ?? []).filter(
    (name) => name !== state.xColumn,
  );
  try {
    const mappings = parseReplicateGroups(state.replicateText);
    const grouped = new Set(Object.values(mappings).flat());
    return [
      ...Object.keys(mappings),
      ...columns.filter((name) => !grouped.has(name)),
    ];
  } catch {
    return columns;
  }
}
export function buildOptions(state: Workspace): AnalysisOptions {
  if (state.inputView === "plate") {
    const compiled = compilePlate(state.plate, state.options);
    if (!compiled.ok) throw new Error(compiled.errors.slice(0, 3).join("；"));
    return compiled.options;
  }
  const options = {
    ...state.options,
    replicate_groups: parseReplicateGroups(state.replicateText),
  };
  const columns = state.parsed?.meta?.columns ?? [];
  const used = new Set<string>();
  for (const group of Object.values(options.replicate_groups))
    for (const column of group) {
      if (!columns.includes(column) || column === state.xColumn)
        throw new Error(`重复孔列不存在或是 X 轴列：${column}`);
      if (used.has(column))
        throw new Error(`重复孔列不能属于多个组：${column}`);
      used.add(column);
    }
  if (
    options.input_mode === "dilution_step" &&
    (!Number.isFinite(options.dilution_factor) ||
      options.dilution_factor < 2 ||
      options.dilution_factor > 10)
  )
    throw new Error("连续稀释倍数应在 2–10 之间");
  if (!Number.isFinite(options.first_step))
    throw new Error("首个级数必须为有效数字");
  if (
    options.start_concentration !== null &&
    (!Number.isFinite(options.start_concentration) ||
      options.start_concentration <= 0)
  )
    throw new Error("起始浓度必须大于 0；未知时请留空");
  if (!Number.isFinite(options.blank_value))
    throw new Error("空白 OD 必须为有效数字");
  if (options.workflow === "comparative") {
    if (
      !options.reference_group ||
      !availableGroups(state).includes(options.reference_group)
    )
      throw new Error("请在分析设置中选择参考组");
    if (
      !Number.isFinite(options.reference_assigned_value) ||
      options.reference_assigned_value <= 0
    )
      throw new Error("参考组赋值必须大于 0");
  } else {
    if (
      !options.standard_group ||
      !availableGroups(state).includes(options.standard_group)
    )
      throw new Error("请选择用于反算的标准曲线");
    if (
      options.input_mode === "dilution_step" &&
      options.start_concentration === null
    )
      throw new Error("标准曲线反算需要已知起始浓度；请填写或改用原始浓度");
    if (!options.concentration_unit.trim())
      throw new Error("标准曲线反算需要浓度单位");
    if (!state.unknowns.length) throw new Error("请添加至少一个未知样品");
    const names = new Set<string>();
    options.unknown_samples = state.unknowns.map((sample) => {
      const od = sample.od
        .split(/[;,，；\s]+/)
        .filter(Boolean)
        .map(Number);
      if (!sample.sample.trim() || names.has(sample.sample.trim()))
        throw new Error("未知样品名称不能为空或重复");
      names.add(sample.sample.trim());
      if (!od.length || od.some((value) => !Number.isFinite(value)))
        throw new Error(`${sample.sample}：请输入有效 OD；重复孔用分号分隔`);
      const dilution = Number(sample.dilution);
      if (!Number.isFinite(dilution) || dilution < 1)
        throw new Error(`${sample.sample}：稀释校正倍数必须至少为 1`);
      return { sample_id: sample.sample.trim(), od, dilution_factor: dilution };
    });
  }
  return options;
}
