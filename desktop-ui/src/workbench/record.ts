import { defaultOptions, type Workspace } from "./model.ts";
import type { AnalysisOptions, UnknownInput } from "./types";
import { createPlate, validatePlate } from "./plate.ts";
export const RECORD_SCHEMA = "elisa-analysis/1";
export function serializeRecord(state: Workspace) {
  return JSON.stringify(
    {
      schema: RECORD_SCHEMA,
      app_version: "0.2.0",
      saved_at: new Date().toISOString(),
      inputs: {
        inputView: state.inputView,
        plate: state.plate,
        rawText: state.rawText,
        source: state.source,
        headerMode: state.headerMode,
        xColumn: state.xColumn,
        options: state.options,
        replicateText: state.replicateText,
        unknowns: state.unknowns,
        saveOutputs: state.saveOutputs,
      },
      result: state.result,
    },
    null,
    2,
  );
}
/** Import only validated inputs. Stored results never become current without re-running Python. */
export function parseRecord(
  text: string,
): Pick<
  Workspace,
  | "rawText"
  | "source"
  | "headerMode"
  | "xColumn"
  | "options"
  | "replicateText"
  | "unknowns"
  | "saveOutputs"
  | "plate"
  | "inputView"
> {
  const record = JSON.parse(text);
  if (
    record?.schema !== RECORD_SCHEMA ||
    !record.inputs ||
    typeof record.inputs.rawText !== "string"
  )
    throw new Error("这不是兼容的 ELISA 分析记录（elisa-analysis/1）");
  const input = record.inputs;
  if (input.inputView != null && !["plate", "table"].includes(input.inputView)) throw new Error("记录中的输入视图无效");
  const plate = input.plate == null ? createPlate() : validatePlate(input.plate);
  if (
    input.options != null &&
    (typeof input.options !== "object" || Array.isArray(input.options))
  )
    throw new Error("记录中的分析选项无效");
  const opts: AnalysisOptions = { ...defaultOptions };
  for (const key of Object.keys(defaultOptions) as (keyof AnalysisOptions)[])
    if (input.options?.[key] !== undefined)
      Object.assign(opts, { [key]: input.options[key] });
  if (
    !["comparative", "standard_curve"].includes(opts.workflow) ||
    !["dilution_step", "raw_concentration", "log_concentration"].includes(
      opts.input_mode,
    )
  )
    throw new Error("记录中的分析模式无效");
  if (
    !["shared", "independent"].includes(opts.fit_mode) ||
    !["increasing", "decreasing"].includes(opts.dilution_direction) ||
    !["none", "constant"].includes(opts.blank_mode) ||
    !["individual", "mean"].includes(opts.replicate_mode)
  )
    throw new Error("记录中的分析选项无效");
  for (const key of [
    "dilution_factor",
    "first_step",
    "reference_assigned_value",
    "blank_value",
  ] as const)
    if (typeof opts[key] !== "number" || !Number.isFinite(opts[key]))
      throw new Error(`记录中的数值无效：${key}`);
  if (
    opts.start_concentration !== null &&
    (typeof opts.start_concentration !== "number" ||
      !Number.isFinite(opts.start_concentration))
  )
    throw new Error("记录中的起始浓度无效");
  if (
    typeof opts.concentration_unit !== "string" ||
    typeof opts.allow_extrapolation !== "boolean" ||
    (opts.reference_group !== null &&
      typeof opts.reference_group !== "string") ||
    (opts.standard_group !== null && typeof opts.standard_group !== "string")
  )
    throw new Error("记录中的单位或参考组无效");
  if (
    input.unknowns &&
    (!Array.isArray(input.unknowns) ||
      input.unknowns.some(
        (row: UnknownInput) =>
          !row ||
          typeof row.sample !== "string" ||
          typeof row.od !== "string" ||
          typeof row.dilution !== "string",
      ))
  )
    throw new Error("记录中的未知样品表无效");
  // These fields are reconstructed from explicit editor inputs immediately before each run.
  opts.replicate_groups = {};
  opts.unknown_samples = [];
  return {
    inputView: input.inputView ?? "table",
    plate,
    rawText: input.rawText,
    source: String(input.source ?? "分析记录"),
    headerMode: ["auto", "present", "absent"].includes(input.headerMode)
      ? input.headerMode
      : "auto",
    xColumn: String(input.xColumn ?? ""),
    options: opts,
    replicateText: String(input.replicateText ?? ""),
    unknowns: (input.unknowns ?? []).map(
      (row: UnknownInput, index: number) => ({
        sample: row.sample,
        od: row.od,
        dilution: row.dilution,
        id: `restored-${index}`,
      }),
    ),
    saveOutputs: Boolean(input.saveOutputs),
  };
}
