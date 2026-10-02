export type Workflow = "comparative" | "standard_curve";
export type InputMode =
  "dilution_step" | "raw_concentration" | "log_concentration";
export type HeaderMode = "auto" | "present" | "absent";
export type Page =
  "data" | "settings" | "unknowns" | "results" | "plots" | "guide";
export interface UnknownInput {
  id: string;
  sample: string;
  od: string;
  dilution: string;
}
export interface AnalysisOptions {
  workflow: Workflow;
  input_mode: InputMode;
  dilution_factor: number;
  dilution_direction: "increasing" | "decreasing";
  first_step: number;
  start_concentration: number | null;
  concentration_unit: string;
  fit_mode: "shared" | "independent";
  reference_group: string | null;
  reference_assigned_value: number;
  blank_mode: "none" | "constant";
  blank_value: number;
  replicate_mode: "individual" | "mean";
  replicate_groups: Record<string, string[]>;
  standard_group: string | null;
  allow_extrapolation: boolean;
  unknown_samples: {
    sample_id: string;
    od: number[];
    dilution_factor: number;
  }[];
}
export interface SummaryRow {
  Group: string;
  N: number;
  EC50: number | null;
  LogEC50?: number | null;
  EC50_step?: number | null;
  EC50_unit?: string;
  EC50_ratio?: number | null;
  Relative_stock_potency_X?: number | null;
  LogEC50_SE?: number | null;
  LogEC50_CI_low?: number | null;
  LogEC50_CI_high?: number | null;
  EC50_CI_low?: number | null;
  EC50_CI_high?: number | null;
  Relative_stock_potency_X_CI_low?: number | null;
  Relative_stock_potency_X_CI_high?: number | null;
  Slope: number | null;
  A?: number | null;
  D?: number | null;
  Global_A: number | null;
  Global_D: number | null;
  R2: number | null;
  RMSE: number | null;
  Status: string;
  Warning: string;
  warning_list?: string[];
}
export interface DetailRow {
  group_name: string;
  x: number[];
  y: number[];
  raw_x?: number[];
  raw_y?: number[];
  y_pred: number[] | null;
  status: string;
  warning_list: string[];
  skip_reason: string;
  params?: { A: number; B: number; C: number; D: number } | null;
  r2: number | null;
  rmse: number | null;
  processed_points?: {
    source_row: number;
    source_column: string;
    raw_x: number;
    raw_y: number;
    log_dose: number;
    processed_y: number;
    included: boolean;
    exclusion_reason: string;
  }[];
}
export interface UnknownResult {
  Sample: string;
  Standard_group: string;
  OD_raw: number[];
  OD_processed: number;
  Dilution_factor: number;
  Log_concentration: number | null;
  Concentration: number | null;
  Corrected_concentration: number | null;
  Concentration_unit: string;
  Status: string;
  Warning: string;
  warning_list?: string[];
}
export interface ParseResponse {
  ok: boolean;
  error?: string;
  meta?: {
    header_mode?: string;
    header_note?: string;
    separator?: string;
    columns?: string[];
  };
  source_label?: string;
  encoding_used?: string | null;
  preview_text?: string;
  preview_columns?: string[];
  preview_rows?: (
    Record<string, string | number | null> | (string | number | null)[]
  )[];
  row_count?: number;
  column_count?: number;
}
export interface RunResponse extends ParseResponse {
  status_msg?: string;
  removed_count?: number;
  results?: SummaryRow[];
  report?: {
    fit_success: boolean;
    fit_error: string;
    global_params: { A?: number; D?: number };
    summary_rows: SummaryRow[];
    detailed_rows: DetailRow[];
    unknown_results?: UnknownResult[];
    options?: AnalysisOptions;
    metadata?: Record<string, unknown>;
  } | null;
  output_dir?: string | null;
  saved_files?: string[];
  export_error?: string;
  export_warnings?: string[];
  previews?: { id: string; group_name: string | null; data_url: string }[];
  preview_warnings?: string[];
  exports_skipped?: boolean;
  warnings?: string[];
}
