import {
  useEffect,
  useCallback,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { callBridge } from "../hooks/useBridge";
import { buildOptions, initialWorkspace, reducer, formatNumber, type Action } from "./model";
import type { Page, ParseResponse, RunResponse } from "./types";
import { Icon } from "./Primitives";
import PlatePanel from "./PlatePanel";
import { compilePlate } from "./plate";
import ResultsPanel, { ResultInspector } from "./ResultsPanel";
import PlotsPanel from "./PlotsPanel";
import GuidePanel from "./GuidePanel";
import { parseRecord, serializeRecord, MAX_RECORD_BYTES } from "./record";
import { defaultHistoryService, type HistoryEntry } from "./history";
import { applyTheme, readTheme } from "./theme";
import { locateProblem, type InputProblem } from "./validation";

const pageNames: Record<Page, string> = {
  data: "原始数据",
  settings: "分析设置",
  unknowns: "未知样品",
  results: "结果汇总",
  plots: "曲线预览",
  guide: "使用说明",
};
const pageSubtitles: Record<Page, string> = {
  data: "粘贴读数、标记组别，然后直接运行分析",
  settings: "让输入坐标、参考组和实验设计保持一致",
  unknowns: "从标准曲线反算，并校正样品稀释",
  results: "保留单位、模型假设和质量提示",
  plots: "观察拟合、响应平台与剂量覆盖",
  guide: "孔板比较、参比归一与清晰的计算边界",
};
export default function Workbench() {
  const [state, baseDispatch] = useReducer(reducer, initialWorkspace);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const dispatch = useCallback((action: Action) => {if (!closingRef.current) baseDispatch(action);}, []);
  const [menu, setMenu] = useState<"file" | "view" | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [inspector, setInspector] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [compact, setCompact] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const recoveryBlockedRef = useRef(false);
  const recoveryReadyRef = useRef(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [recoveryChoice, setRecoveryChoice] = useState<"retry" | "replace" | null>(null);
  const [storageError, setStorageError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [retrySave, setRetrySave] = useState(0);
  const normalizationPending = Boolean(state.result?.ok && state.result.report?.options?.workflow === "comparative" && (state.options.reference_group !== state.result.report.options.reference_group || state.options.reference_assigned_value !== state.result.report.options.reference_assigned_value));

  const [theme, setTheme] = useState(readTheme);
  const menuRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const normalizationRequestRef = useRef(0);
  const lockRef = useRef(false);
  const native = isTauri();
  const [problemState, setProblem] = useState<(InputProblem & {version: number}) | null>(null);
  const problem = problemState?.version === state.version && state.error ? problemState : null;
  const latest = useRef(state);
  const snapshotSaved = useRef<RunResponse | null>(null);
  useEffect(() => {latest.current = state;}, [state]);
  useEffect(() => {
    let cancelled = false;
    const request = ++requestRef.current;
    const version = latest.current.version;
    defaultHistoryService.restoreSession().then(async workspace => {
      if (!cancelled && workspace && latest.current.version === version && latest.current.request === null) {
        snapshotSaved.current = workspace.result;
        dispatch({type: "begin", request, busy: "load"});
        dispatch({type: "restore", request, version, workspace});
        dispatch({type: "end", request});
      } else if (!cancelled && workspace) {
        await defaultHistoryService.save({...initialWorkspace, ...workspace});
        if (!cancelled) setSaveStatus("上次会话已保留在历史，当前编辑未覆盖");
      }
      if (!cancelled) {recoveryReadyRef.current = true; recoveryBlockedRef.current = false; setRecoveryBlocked(false); setStorageError(""); setStorageReady(true);}
    }).catch(error => {if (!cancelled) {recoveryBlockedRef.current = true; setRecoveryBlocked(true); setStorageError(`自动恢复失败：${String(error)}。旧恢复记录已保留，自动保存暂停；请重试恢复或明确选择替换。`);}});
    return () => {cancelled = true;};
  }, [recoveryAttempt, dispatch]);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested(async event => {
      event.preventDefault();
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      try {
        if (!recoveryReadyRef.current && !recoveryBlockedRef.current) throw new Error("上次会话仍在恢复，请等待恢复完成再关闭");
        if (recoveryBlockedRef.current) throw new Error("上次会话恢复失败，旧记录尚未覆盖；请先处理恢复选项，或另存当前 JSON");
        const closing = latest.current;
        if (closing.busy || (closing.result?.ok && (closing.options.reference_group !== closing.result.report?.options?.reference_group || closing.options.reference_assigned_value !== closing.result.report?.options?.reference_assigned_value))) throw new Error("计算或参比更新仍在进行，请完成后再关闭");
        await defaultHistoryService.saveSession(closing);
        if (closing.result?.ok && snapshotSaved.current !== closing.result) {await defaultHistoryService.save(closing); snapshotSaved.current = closing.result;}
        await getCurrentWindow().destroy();
      } catch (error) {closingRef.current = false; setClosing(false); setStorageError(`关闭前保存失败：${String(error)}。窗口已保留，请重试保存。`);}
    }).then(stop => {if (disposed) stop(); else unlisten = stop;}).catch(error => setStorageError(`关闭保护无法启用：${String(error)}`));
    return () => {disposed = true; unlisten?.();};
  }, [native]);
  useEffect(() => {
    if (!storageReady || state.busy || normalizationPending) return;
    const captured = latest.current;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await defaultHistoryService.saveSession(captured);
        if (captured.result?.ok && snapshotSaved.current !== captured.result) {
          await defaultHistoryService.save(captured);
          snapshotSaved.current = captured.result;
        }
        if (!cancelled) {setStorageError(""); setSaveStatus("已自动保存到本机");}
      } catch (error) {
        if (!cancelled) {setStorageError(`自动保存失败：${String(error)}。当前输入和结果仍在窗口中，请重试或保存记录后再关闭。`); setSaveStatus("未保存");}
      }
    }, 250);
    return () => {cancelled = true; window.clearTimeout(timer);};
  }, [storageReady, state.version, state.result, state.busy, normalizationPending, retrySave]);
  useEffect(() => {
    if (!normalizationPending || !state.result?.ok) return;
    const version = state.version;
    const request = ++normalizationRequestRef.current;
    const referenceGroup = state.options.reference_group;
    const referenceValue = state.options.reference_assigned_value;
    let cancelled = false;
    const current = () => !cancelled && normalizationRequestRef.current === request && latest.current.version === version && latest.current.options.reference_group === referenceGroup && Object.is(latest.current.options.reference_assigned_value, referenceValue);
    callBridge<RunResponse>({command: "renormalize", run_response: state.result, reference_group: referenceGroup, reference_assigned_value: referenceValue}).then(response => {
      if (!current()) return;
      if (!response.ok) throw new Error(response.error ?? "参比更新失败");
      const normalizedOptions = response.report?.options;
      if (normalizedOptions?.reference_group !== referenceGroup || !Object.is(normalizedOptions?.reference_assigned_value, referenceValue)) throw new Error("参比响应与当前请求不匹配");
      dispatch({type: "renormalized", version, response});
    }).catch(error => {if (current()) dispatch({type: "reference-failed", version, error: `参比归一失败：${String(error)}。已有拟合和归一已保留。`});});
    return () => {cancelled = true;};
  }, [normalizationPending, state.version, state.options.reference_group, state.options.reference_assigned_value, state.result, dispatch]);
  async function openHistory() {
    try {setHistoryEntries(await defaultHistoryService.list()); setHistoryOpen(true); setMenu(null);}
    catch (error) {setStorageError(`读取历史失败：${String(error)}`);}
  }
  async function recallHistory(id: string) {
    if (lockRef.current) return;
    lockRef.current = true;
    const request = ++requestRef.current, version = state.version;
    dispatch({type: "begin", request, busy: "load"});
    try {
      const workspace = await defaultHistoryService.recall(id);
      snapshotSaved.current = workspace.result;
      dispatch({type: "restore", request, version, workspace});
      setHistoryOpen(false);
    } catch (error) {setStorageError(`恢复历史失败：${String(error)}`);}
    finally {lockRef.current = false; dispatch({type: "end", request});}
  }

  useEffect(() => {
    if (!problem || state.page !== problem.page) return;
    const marked: HTMLElement[] = [];
    const timer = window.setTimeout(() => {
      for (const label of problem.fields) {
        const field = [...document.querySelectorAll<HTMLElement>(".page-content [data-field]")].find(node => node.dataset.field === label);
        const control = field?.querySelector<HTMLElement>("input,select,textarea") ?? [...document.querySelectorAll<HTMLElement>(".page-content [aria-label]")].find(node => node.getAttribute("aria-label") === label);
        if (control) {control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-describedby", "input-error"); marked.push(control);}
      }
      const target = marked[0] ?? document.querySelector<HTMLElement>(".well[aria-invalid=true]");
      target?.focus();
      target?.scrollIntoView?.({block: "nearest"});
    }, 0);
    return () => {window.clearTimeout(timer); marked.forEach(node => {node.removeAttribute("aria-invalid"); node.removeAttribute("aria-describedby");});};
  }, [problem, state.page]);
  useEffect(() => applyTheme(theme), [theme]);
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
    if (state.inputView !== "plate" || state.options.workflow !== "comparative") {
      dispatch({type: "error", error: "旧版表格和标准反算输入已保留，仅供历史查看。请新建 96 孔板比较分析；不会自动转换或丢弃原数据。"});
      return;
    }
    const plate = state.inputView === "plate" ? compilePlate(state.plate, state.options) : null;
    function showProblem(messages: string[], request?: number) {
      if (request !== undefined && latest.current.version !== state.version) return;
      const location = locateProblem(state, messages);
      setProblem({...location, version: state.version});
      dispatch({type: "error", error: messages.slice(0, 3).join("；"), request, version: state.version});
      dispatch({type: "page", page: location.page});
      if (location.wells.length) dispatch({type: "plate-selection", selected: [location.wells[0]], anchor: location.wells[0]});
    }
    if (plate && !plate.ok) {showProblem(plate.errors); return;}
    // Already previewed inputs validate synchronously; new table data is parsed below.
    if (kind === "run" && (plate || state.parsed?.ok)) {
      try {buildOptions(state);} catch (error) {showProblem([error instanceof Error ? error.message : String(error)]); return;}
    }
    lockRef.current = true;
    const request = ++requestRef.current, version = state.version;
    setProblem(null);
    dispatch({type: "begin", request, busy: kind});
    try {
      let working = state;
      const input = {
        raw_text: plate?.rawText ?? state.rawText,
        source_label: plate ? "96 孔板 · 明确孔位映射" : state.source,
        header_mode: plate ? "present" : state.headerMode,
        preview_rows: 200,
        x_col_name: plate ? "Dose" : state.xColumn || undefined,
        ...(plate ? {plate_mapping: plate.mapping} : {}),
      };
      if (kind === "parse" || (!plate && !state.parsed?.ok)) {
        const response = await callBridge<ParseResponse>({command: "parse", ...input});
        if (latest.current.version !== version) return;
        dispatch({type: "parsed", request, version, response});
        if (!response.ok) {showProblem([response.error ?? "解析失败"], request); return;}
        if (kind === "parse") return;
        working = reducer({...state, request}, {type: "parsed", request, version, response});
      }
      const options = buildOptions(working);
      const response = await callBridge<RunResponse>({command: "run", ...input, x_col_name: plate ? "Dose" : working.xColumn || undefined, analysis_options: options, save_outputs: state.saveOutputs});
      if (latest.current.version !== version) return;
      dispatch({type: "ran", request, version, response});
      if (!response.ok) showProblem([response.error ?? "计算失败"], request);
    } catch (error) {
      showProblem([error instanceof Error ? error.message : String(error)], request);
    } finally {
      lockRef.current = false;
      dispatch({type: "end", request});
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
      if (file.size > (record ? MAX_RECORD_BYTES : 1024 * 1024))
        throw new Error(record ? "分析记录超过 64 MiB，请先按实验拆分" : "孔板文本超过 1 MiB");
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
  function reset() {
    setMenu(null);
    if (state.rawText || state.result || state.plate.wells.some(w => w.raw || w.kind !== "unassigned")) setConfirmReset(true);
    else dispatch({ type: "reset" });
  }
  const hasInputs = Boolean(state.rawText || state.plate.wells.some(w => w.raw || w.kind !== "unassigned"));
  const row =
    state.result?.report?.summary_rows.find(
      (row) => row.Group === selectedGroup,
    ) ?? state.result?.report?.summary_rows[0];
  const pages: Page[] = ["data", "results", "plots"];
  return (
    <div
      className={`workbench ${compact ? "compact" : ""} ${sidebar ? "" : "sidebar-hidden"} ${state.inputView === "plate" && state.page === "data" ? "plate-active" : ""}`}
    >
      <header className="app-bar" data-tauri-drag-region inert={closing}>
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
                      recordRef.current?.click();
                      setMenu(null);
                    }}
                    disabled={!!state.busy}
                  >
                    恢复分析记录…
                  </button>
                  <button role="menuitem" onClick={() => void openHistory()} disabled={!!state.busy}>分析历史…</button>
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
                    role="menuitemcheckbox"
                    aria-checked={theme === "dark"}
                    onClick={() => {
                      setTheme((value) => value === "dark" ? "light" : "dark");
                      setMenu(null);
                    }}
                  >
                    <Icon name={theme === "dark" ? "sun" : "moon"} />
                    夜间模式{theme === "dark" ? " ✓" : ""}
                  </button>
                  <hr />
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
        <button
          className="theme-toggle"
          aria-label={theme === "dark" ? "切换到日间模式" : "切换到夜间模式"}
          title={theme === "dark" ? "切换到日间模式" : "切换到夜间模式"}
          onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
          {theme === "dark" ? "日间" : "夜间"}
        </button>
        <span className="version-tag">v0.3.1</span>
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
        ref={recordRef}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => void importFile(event, true)}
      />
      <div className="workspace-body" inert={closing}>
        {sidebar && (
          <aside className="navigation">
            <div className="workspace-label">96 孔板比较分析</div>
            <div className="workflow-switch"><div className="local-note">连续稀释 · EC50 · 参比归一 X</div></div>
            <div className="workspace-label nav-label">当前分析</div>
            <nav aria-label="分析导航">
              {pages.map((page, index) => (
                <button
                  key={page}
                  aria-label={pageNames[page]}
                  title={pageNames[page]}
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
                aria-label="使用说明"
                title="使用说明"
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
              <span className="eyebrow">96-WELL COMPARATIVE ANALYSIS</span>
              <div className="data-heading-title"><h1>{pageNames[state.page]}</h1></div>
              <p>{pageSubtitles[state.page]}</p>
            </div>
            <div className="page-actions">
              <button onClick={() => void openHistory()} disabled={!!state.busy}>分析历史</button>
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
                  !!state.busy
                }
              >
                <Icon name="play" size={13} />
                {state.busy === "run" ? "正在计算…" : "运行分析"}
              </button>
            </div>
          </div>
          {storageError && <div className="notice error" role="alert"><span>{storageError}</span>{recoveryBlocked ? <><button onClick={() => setRecoveryChoice("retry")}>重试恢复</button><button onClick={() => setRecoveryChoice("replace")}>替换旧恢复记录…</button></> : <button onClick={() => setRetrySave(value => value + 1)}>重试自动保存</button>}</div>}
          {state.compatibilityMessage && <div className="notice warning">{state.compatibilityMessage}</div>}
          {state.error && (
            <div className="notice error" role="alert" id="input-error">
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
              {state.page === "data" && state.inputView === "plate" && <PlatePanel state={state} dispatch={dispatch} problem={problem} parse={() => void analyze("parse")} />}
              {state.page === "data" && state.inputView !== "plate" && <section className="card legacy-input"><h2>旧版输入已完整保留</h2><p>该记录使用独立表格或标准反算流程。当前版本只编辑 96 孔板比较分析；可查看历史结果或保存原记录。开始新实验请使用“文件 → 新建分析”，再粘贴 Excel 孔板读数。</p><pre aria-label="保留的旧版输入">{state.rawText}</pre></section>}
              {state.page === "results" && (
                <ResultsPanel
                  state={state}
                  selected={row?.Group ?? ""}
                  onSelect={setSelectedGroup}
                  dispatch={dispatch}
                  normalizationPending={normalizationPending}
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
          {state.status}{saveStatus && ` · ${saveStatus}`}
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
      {recoveryChoice && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="recovery-choice-title"><h2 id="recovery-choice-title">{recoveryChoice === "retry" ? "重试恢复上次会话？" : "替换旧恢复记录？"}</h2><p>{recoveryChoice === "retry" ? "成功后将载入上次会话，替换窗口中的当前输入。需要保留的新输入请先保存 JSON。" : "将以窗口中的当前输入与结果覆盖无法恢复的旧会话记录。旧记录可能仍有可修复内容，请先独立备份；只有确认后才恢复自动保存。"}</p><div className="button-row"><button onClick={() => setRecoveryChoice(null)}>取消恢复操作</button><button className="primary" onClick={() => {if (recoveryChoice === "retry") {setStorageReady(false); setRecoveryAttempt(value => value + 1);} else {recoveryReadyRef.current = true; recoveryBlockedRef.current = false; setRecoveryBlocked(false); setStorageReady(true); setRetrySave(value => value + 1); setStorageError("");} setRecoveryChoice(null);}}>{recoveryChoice === "retry" ? "确认重试恢复" : "确认替换旧恢复记录"}</button></div></div></div>}
      {closing && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="关闭前自动保存"><h2>正在保存到本机…</h2><p>保存完成后关闭窗口；保存失败会保留窗口和当前内容。</p></div></div>}
      {historyOpen && <div className="modal-backdrop" onKeyDown={event => {if (event.key === "Escape") setHistoryOpen(false);}}><div className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title"><h2 id="history-title">分析历史</h2><p>恢复完整历史快照，不重新拟合。修改孔板或模型后需重新分析。</p><p>{defaultHistoryService.description}</p><div className="history-list">{historyEntries.length ? historyEntries.map(entry => <button key={entry.id} onClick={() => void recallHistory(entry.id)} disabled={!!state.busy || !!entry.error} title={entry.error}><span>{entry.savedAt || entry.label}</span><span>{entry.error ? `损坏：${entry.error}` : entry.hasResult ? "计算结果快照" : "输入记录"}</span></button>) : <p>暂无已保存分析</p>}</div><button onClick={() => setHistoryOpen(false)}>关闭历史</button></div></div>}
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
            <p>当前输入与显示将清空，已保存的分析历史保留。需要独立备份的记录请先下载 JSON。</p>
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
