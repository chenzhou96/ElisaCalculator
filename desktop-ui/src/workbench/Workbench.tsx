import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { callBridge } from "../hooks/useBridge";
import { buildOptions, initialWorkspace, reducer, formatNumber } from "./model";
import type { Page, ParseResponse, RunResponse, Workflow } from "./types";
import { Icon } from "./Primitives";
import DataPanel from "./DataPanel";
import PlatePanel from "./PlatePanel";
import { compilePlate } from "./plate";
import SettingsPanel from "./SettingsPanel";
import UnknownPanel from "./UnknownPanel";
import ResultsPanel, { ResultInspector } from "./ResultsPanel";
import PlotsPanel from "./PlotsPanel";
import GuidePanel from "./GuidePanel";
import { parseRecord, serializeRecord } from "./record";

const pageNames: Record<Page, string> = {
  data: "原始数据",
  settings: "分析设置",
  unknowns: "未知样品",
  results: "结果汇总",
  plots: "曲线预览",
  guide: "使用说明",
};
const pageSubtitles: Record<Page, string> = {
  data: "粘贴、检查，然后明确每条曲线的含义",
  settings: "让输入坐标、参考组和实验设计保持一致",
  unknowns: "从标准曲线反算，并校正样品稀释",
  results: "保留单位、模型假设和质量提示",
  plots: "观察拟合、响应平台与剂量覆盖",
  guide: "两个工作流，各自清晰的计算边界",
};
export default function Workbench() {
  const [state, dispatch] = useReducer(reducer, initialWorkspace);
  const [menu, setMenu] = useState<"file" | "view" | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [inspector, setInspector] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [compact, setCompact] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recordRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const lockRef = useRef(false);
  const native = isTauri();
  useEffect(() => {
    if (!menu) return;
    function close(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  async function analyze(kind: "parse" | "run") {
    if (lockRef.current) return;
    let options;
    const plate = state.inputView === "plate" ? compilePlate(state.plate, state.options) : null;
    try {
      if (plate && !plate.ok) throw new Error(plate.errors.slice(0, 3).join("；"));
      if (kind === "run") options = buildOptions(state);
    } catch (error) {
      dispatch({
        type: "error",
        error: String(error instanceof Error ? error.message : error),
      });
      dispatch({ type: "page", page: state.inputView === "plate" ? "data" : "settings" });
      return;
    }
    lockRef.current = true;
    const request = ++requestRef.current;
    const version = state.version;
    dispatch({ type: "begin", request, busy: kind });
    try {
      const payload = {
        command: kind,
        raw_text: plate?.rawText ?? state.rawText,
        source_label: plate ? "96 孔板 · 明确孔位映射" : state.source,
        header_mode: plate ? "present" : state.headerMode,
        preview_rows: 200,
        x_col_name: plate ? "Dose" : state.xColumn || undefined,
        ...(plate ? {plate_mapping: plate.mapping} : {}),
        ...(kind === "run"
          ? { analysis_options: options, save_outputs: state.saveOutputs }
          : {}),
      };
      if (kind === "parse")
        dispatch({
          type: "parsed",
          request,
          version,
          response: await callBridge<ParseResponse>(payload),
        });
      else
        dispatch({
          type: "ran",
          request,
          version,
          response: await callBridge<RunResponse>(payload),
        });
    } catch (error) {
      dispatch({
        type: "error",
        request,
        version,
        error: String(error instanceof Error ? error.message : error),
      });
    } finally {
      lockRef.current = false;
      dispatch({ type: "end", request });
    }
  }
  async function importFile(
    event: ChangeEvent<HTMLInputElement>,
    record = false,
  ) {
    const target = event.currentTarget;
    const file = target.files?.[0];
    target.value = "";
    if (!file || lockRef.current) return;
    lockRef.current = true;
    const request = ++requestRef.current;
    const version = state.version;
    dispatch({ type: "begin", request, busy: "load" });
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("文件超过 20 MB，请先按实验拆分后导入");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      let encoding = "";
      for (const candidate of ["utf-8", "gb18030", "gbk"])
        try {
          text = new TextDecoder(candidate, { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, "");
          encoding = candidate;
          break;
        } catch {
          continue;
        }
      if (!encoding)
        throw new Error("无法可靠识别文件编码，请另存为 UTF-8 CSV 后导入");
      if (record) {
        const workspace = parseRecord(text);
        dispatch({ type: "restore", request, version, workspace });
      } else
        dispatch({
          type: "loaded",
          request,
          version,
          text,
          source: `${file.name} · ${encoding}`,
        });
    } catch (error) {
      dispatch({
        type: "error",
        request,
        version,
        error: String(error instanceof Error ? error.message : error),
      });
    } finally {
      lockRef.current = false;
      dispatch({ type: "end", request });
    }
  }
  function saveRecord() {
    try {
      const blob = new Blob([serializeRecord(state)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ELISA-analysis-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMenu(null);
    } catch (error) {
      dispatch({ type: "error", error: `保存记录失败：${String(error)}` });
    }
  }
  function changeWorkflow(workflow: Workflow) {
    dispatch({ type: "options", patch: { workflow } });
    dispatch({ type: "page", page: "data" });
  }
  function reset() {
    setMenu(null);
    if (state.rawText || state.result || state.plate.wells.some(w => w.raw || w.kind !== "unassigned")) setConfirmReset(true);
    else dispatch({ type: "reset" });
  }
  const hasInputs = Boolean(state.rawText || state.plate.wells.some(w => w.raw || w.kind !== "unassigned"));
  const activePlate = state.inputView === "plate" ? compilePlate(state.plate, state.options) : null;
  const row =
    state.result?.report?.summary_rows.find(
      (row) => row.Group === selectedGroup,
    ) ?? state.result?.report?.summary_rows[0];
  const pages: Page[] =
    state.options.workflow === "standard_curve"
      ? state.inputView === "plate" ? ["data", "settings", "results", "plots"] : ["data", "settings", "unknowns", "results", "plots"]
      : ["data", "settings", "results", "plots"];
  return (
    <div
      className={`workbench ${compact ? "compact" : ""} ${sidebar ? "" : "sidebar-hidden"} ${state.inputView === "plate" && state.page === "data" ? "plate-active" : ""}`}
    >
      <header className="app-bar" data-tauri-drag-region>
        <div className="app-brand" data-tauri-drag-region>
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span data-tauri-drag-region>
            ELISA
            <span className="brand-secondary" data-tauri-drag-region>
              {" "}
              Calculator
            </span>
          </span>
        </div>
        <div className="app-menus" ref={menuRef}>
          <button
            className={menu === "file" ? "active" : ""}
            onClick={() => setMenu(menu === "file" ? null : "file")}
          >
            文件
          </button>
          <button
            className={menu === "view" ? "active" : ""}
            onClick={() => setMenu(menu === "view" ? null : "view")}
          >
            视图
          </button>
          {menu && (
            <div className={`menu-popover menu-${menu}`} role="menu">
              {menu === "file" ? (
                <>
                  <button
                    role="menuitem"
                    onClick={reset}
                    disabled={!!state.busy}
                  >
                    新建分析
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      fileRef.current?.click();
                      setMenu(null);
                    }}
                    disabled={!!state.busy}
                  >
                    导入数据…
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      recordRef.current?.click();
                      setMenu(null);
                    }}
                    disabled={!!state.busy}
                  >
                    恢复分析记录…
                  </button>
                  <hr />
                  <button
                    role="menuitem"
                    onClick={saveRecord}
                    disabled={!hasInputs}
                  >
                    保存分析记录…
                  </button>
                </>
              ) : (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSidebar((value) => !value);
                      setMenu(null);
                    }}
                  >
                    {sidebar ? "隐藏" : "显示"}侧边栏
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setInspector((value) => !value);
                      setMenu(null);
                    }}
                  >
                    {inspector ? "隐藏" : "显示"}检查面板
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setCompact((value) => !value);
                      setMenu(null);
                    }}
                  >
                    {compact ? "舒适" : "紧凑"}密度
                  </button>
                  <hr />
                  <button
                    role="menuitem"
                    onClick={() => {
                      dispatch({ type: "page", page: "guide" });
                      setMenu(null);
                    }}
                  >
                    公式与说明
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="app-caption" data-tauri-drag-region>
          研究分析工作台
        </div>
        <span className="version-tag">v0.2.0</span>
        {native && (
          <div className="window-buttons">
            <button
              title="最小化"
              onClick={() => void getCurrentWindow().minimize()}
            >
              −
            </button>
            <button
              title="最大化"
              onClick={() => void getCurrentWindow().toggleMaximize()}
            >
              □
            </button>
            <button
              title="关闭窗口"
              onClick={() => void getCurrentWindow().close()}
            >
              ×
            </button>
          </div>
        )}
      </header>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt"
        hidden
        onChange={(event) => void importFile(event)}
      />
      <input
        ref={recordRef}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => void importFile(event, true)}
      />
      <div className="workspace-body">
        {sidebar && (
          <aside className="navigation">
            <div className="workspace-label">工作流</div>
            <div className="workflow-switch">
              <button
                className={
                  state.options.workflow === "comparative" ? "selected" : ""
                }
                onClick={() => changeWorkflow("comparative")}
              >
                <Icon name="plots" />
                <span>
                  曲线比较<small>EC50 · 相对原液强度</small>
                </span>
              </button>
              <button
                className={
                  state.options.workflow === "standard_curve" ? "selected" : ""
                }
                onClick={() => changeWorkflow("standard_curve")}
              >
                <Icon name="unknowns" />
                <span>
                  标准曲线<small>未知样品浓度反算</small>
                </span>
              </button>
            </div>
            <div className="workspace-label nav-label">当前分析</div>
            <nav aria-label="分析导航">
              {pages.map((page, index) => (
                <button
                  key={page}
                  className={state.page === page ? "selected" : ""}
                  onClick={() => dispatch({ type: "page", page })}
                >
                  <Icon name={page} />
                  <span>{pageNames[page]}</span>
                  {page === "results" && state.result?.ok ? (
                    <i className="ready-dot" />
                  ) : (
                    <small>{String(index + 1).padStart(2, "0")}</small>
                  )}
                </button>
              ))}
            </nav>
            <div className="nav-bottom">
              <button
                className={state.page === "guide" ? "selected" : ""}
                onClick={() => dispatch({ type: "page", page: "guide" })}
              >
                <Icon name="guide" />
                使用说明
              </button>
              <div className="local-note">
                <span className="tiny-dot" />
                本地计算 · 数据不上传
              </div>
            </div>
          </aside>
        )}
        <main className="main-workspace">
          <div className="page-heading">
            <div>
              {!sidebar && (
                <button
                  className="show-sidebar icon-button"
                  title="显示侧边栏"
                  onClick={() => setSidebar(true)}
                >
                  <Icon name="menu" />
                </button>
              )}
              <span className="eyebrow">
                {state.options.workflow === "comparative"
                  ? "COMPARATIVE ANALYSIS"
                  : "STANDARD CURVE"}
              </span>
              <div className="data-heading-title"><h1>{pageNames[state.page]}</h1>{state.page === "data" && <div className="input-tabs" role="tablist" aria-label="输入视图">
                <button role="tab" aria-selected={state.inputView === "plate"} onClick={() => dispatch({type: "view", view: "plate"})}>96 孔板</button>
                <button role="tab" aria-selected={state.inputView === "table"} onClick={() => dispatch({type: "view", view: "table"})}>表格输入</button>
              </div>}</div>
              <p>{pageSubtitles[state.page]}</p>
            </div>
            <div className="page-actions">
              <button
                title="下载包含原始输入、配置与结果的 JSON"
                onClick={saveRecord}
                disabled={!hasInputs}
              >
                <Icon name="download" />
                保存记录
              </button>
              <button
                className="primary"
                onClick={() => void analyze("run")}
                disabled={
                  !!state.busy || !state.parsed?.ok || (activePlate ? !activePlate.ok : !state.rawText.trim())
                }
              >
                <Icon name="play" size={13} />
                {state.busy === "run" ? "正在计算…" : "运行分析"}
              </button>
            </div>
          </div>
          {state.error && (
            <div className="notice error" role="alert">
              <span>{state.error}</span>
              <button
                aria-label="关闭错误"
                onClick={() => dispatch({ type: "error", error: "" })}
              >
                ×
              </button>
            </div>
          )}
          <div className="workspace-content">
            <div className="page-content">
              {state.page === "data" && state.inputView === "table" && (
                <DataPanel
                  state={state}
                  dispatch={dispatch}
                  parse={() => void analyze("parse")}
                  load={() => fileRef.current?.click()}
                />
              )}{" "}
              {state.page === "data" && state.inputView === "plate" && <PlatePanel state={state} dispatch={dispatch} parse={() => void analyze("parse")} />}
              {state.page === "settings" && (
                <SettingsPanel state={state} dispatch={dispatch} />
              )}{" "}
              {state.page === "unknowns" && (
                <UnknownPanel state={state} dispatch={dispatch} />
              )}{" "}
              {state.page === "results" && (
                <ResultsPanel
                  state={state}
                  selected={row?.Group ?? ""}
                  onSelect={setSelectedGroup}
                />
              )}{" "}
              {state.page === "plots" && <PlotsPanel state={state} />}{" "}
              {state.page === "guide" && <GuidePanel />}
            </div>
            {inspector && state.page !== "guide" && !(state.inputView === "plate" && state.page === "data") && (
              <aside className="inspector">
                <div className="inspector-heading">
                  <h2>
                    {(state.page === "results" || state.page === "plots") && row
                      ? "拟合详情"
                      : "分析摘要"}
                  </h2>
                  <button
                    aria-label="隐藏检查面板"
                    className="icon-button"
                    onClick={() => setInspector(false)}
                  >
                    ›
                  </button>
                </div>
                <div className="inspector-body">
                  {(state.page === "results" || state.page === "plots") &&
                  row ? (
                    <ResultInspector row={row} />
                  ) : (
                    <>
                      <div className="inspector-step">
                        <span>01</span>
                        <div>
                          <strong>
                            {state.options.workflow === "comparative"
                              ? "比较相对强度"
                              : "反算未知浓度"}
                          </strong>
                          <p>
                            {state.options.workflow === "comparative"
                              ? "明确参考组与归一赋值"
                              : "使用已知浓度的标准曲线"}
                          </p>
                        </div>
                      </div>
                      <div className="inspector-stats">
                        <div>
                          <span>输入坐标</span>
                          <b>
                            {state.options.input_mode === "dilution_step"
                              ? "稀释级数"
                              : state.options.input_mode === "raw_concentration"
                                ? "原始浓度"
                                : "Log10 浓度"}
                          </b>
                        </div>
                        {state.options.input_mode === "dilution_step" && (
                          <>
                            <div>
                              <span>每级稀释</span>
                              <b>
                                {formatNumber(state.options.dilution_factor)} ×
                              </b>
                            </div>
                            <div>
                              <span>起始浓度</span>
                              <b>
                                {state.options.start_concentration === null
                                  ? "未知 · 相对剂量"
                                  : `${formatNumber(state.options.start_concentration)} ${state.options.concentration_unit}`}
                              </b>
                            </div>
                          </>
                        )}
                        <div>
                          <span>拟合模型</span>
                          <b>
                            {state.options.fit_mode === "shared"
                              ? "共享 A / D"
                              : "独立 4PL"}
                          </b>
                        </div>
                        <div>
                          <span>空白校正</span>
                          <b>
                            {state.options.blank_mode === "none"
                              ? "未启用"
                              : formatNumber(state.options.blank_value)}
                          </b>
                        </div>
                      </div>
                      <div className="inspector-tip">
                        <Icon name="guide" />
                        <p>
                          {state.options.workflow === "comparative"
                            ? "无起始浓度时，可以比较可比稀释序列的相对强度；不能报告绝对浓度。"
                            : "默认只在标准实测范围内反算。超范围值需重新稀释或扩展校准曲线。"}
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          dispatch({ type: "page", page: "guide" })
                        }
                      >
                        查看公式与示例 <Icon name="arrow" size={13} />
                      </button>
                    </>
                  )}
                  <div className="export-settings">
                    <h4>输出</h4>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={state.saveOutputs}
                        onChange={(event) =>
                          dispatch({
                            type: "input",
                            patch: { saveOutputs: event.target.checked },
                          })
                        }
                      />
                      运行后导出 CSV / PNG
                    </label>
                    <p>
                      导出写入应用缓存。长期保存请下载分析记录，或将导出文件移至归档位置。
                    </p>
                    {state.result?.output_dir && (
                      <details>
                        <summary>导出目录</summary>
                        <code className="output-path">
                          {state.result.output_dir}
                        </code>
                      </details>
                    )}
                  </div>
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>
      <footer className="status-bar" role="status" aria-live="polite">
        <span>
          <i className={state.busy ? "busy-dot" : "tiny-dot"} />
          {state.status}
          {state.busy && " · 更改输入会使正在计算的结果失效"}
        </span>
        <span>
          {state.parsed?.ok
            ? `${state.parsed.row_count ?? "—"} 行 · ${state.parsed.column_count ?? state.parsed.meta?.columns?.length ?? "—"} 列`
            : "CSV · TSV · TXT"}
          <i className="status-separator" />
          {native
            ? "桌面计算引擎"
            : import.meta.env.DEV &&
                import.meta.env.VITE_ELISA_DEV_BRIDGE === "1"
              ? "本地 Python 开发引擎"
              : "浏览器预览 · 计算需桌面版"}
        </span>
      </footer>
      {confirmReset && (
        <div
          className="modal-backdrop"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmReset(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <h2 id="reset-title">新建分析？</h2>
            <p>当前输入与结果将清空。未保存的分析记录请先下载。</p>
            <div className="button-row">
              <button onClick={() => setConfirmReset(false)}>取消</button>
              <button
                className="primary"
                onClick={() => {
                  dispatch({ type: "reset" });
                  setConfirmReset(false);
                }}
              >
                新建并清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
