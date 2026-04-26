export interface ParseMeta {
  header_mode?: string
  header_note?: string
  separator?: string
  columns?: string[]
}

export interface SummaryRow {
  Group: string
  N: number
  EC50: number | null
  Slope: number | null
  Global_A: number | null
  Global_D: number | null
  R2: number | null
  RMSE: number | null
  X_min: number | null
  X_max: number | null
  Y_min: number | null
  Y_max: number | null
  Status: string
  Warning: string
}

export interface DetailRow {
  group_name: string
  x: number[]
  y: number[]
  y_pred: number[] | null
  status: string
  warning_list: string[]
  skip_reason: string
  params?: {
    A: number
    B: number
    C: number
    D: number
  } | null
  r2: number | null
  rmse: number | null
}

export interface ParseResponse {
  ok: boolean
  error: string
  meta?: ParseMeta
  source_label?: string
  encoding_used?: string | null
  preview_text?: string
  row_count?: number
  column_count?: number
}

export interface RunResponse {
  ok: boolean
  error: string
  meta?: ParseMeta
  source_label?: string
  encoding_used?: string | null
  status_msg?: string
  removed_count?: number
  results?: SummaryRow[]
  report?: {
    fit_success: boolean
    fit_error: string
    global_params: {
      A?: number
      D?: number
    }
    summary_rows: SummaryRow[]
    detailed_rows: DetailRow[]
  } | null
  output_dir?: string | null
  saved_files?: string[]
  export_error?: string
  export_warnings?: string[]
  exports_skipped?: boolean
}
