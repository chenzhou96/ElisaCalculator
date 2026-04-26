import { createContext, useContext, useReducer, useCallback, type Dispatch, type ReactNode } from 'react'
import type { ViewType, TabType } from '../types/layout'
import type { ParseResponse, RunResponse } from '../types/bridge'
import { callBridge } from '../hooks/useBridge'

/* ── State ── */

export interface AppState {
  activeView: ViewType
  activeTab: TabType
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  bottomPanelOpen: boolean
  sidebarWidth: number

  rawText: string
  sourceLabel: string
  selectedFileName: string
  saveOutputs: boolean

  busy: boolean
  error: string

  parseResult: ParseResponse | null
  runResult: RunResponse | null
  selectedGroupIndex: number

  isMaximized: boolean

  bottomLog: string[]
}

export const INITIAL_TEXT = `浓度,样本A,样本B
0.1,2.05,1.98
0.3,1.91,1.85
1,1.55,1.47
3,0.92,0.88
10,0.34,0.39`

const initialState: AppState = {
  activeView: 'data',
  activeTab: 'editor',
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  bottomPanelOpen: false,
  sidebarWidth: 280,

  rawText: INITIAL_TEXT,
  sourceLabel: 'Paste',
  selectedFileName: '',
  saveOutputs: true,

  busy: false,
  error: '',

  parseResult: null,
  runResult: null,
  selectedGroupIndex: 0,

  isMaximized: false,

  bottomLog: [],
}

/* ── Actions ── */

export type AppAction =
  | { type: 'SET_ACTIVE_VIEW'; view: ViewType }
  | { type: 'SET_ACTIVE_TAB'; tab: TabType }
  | { type: 'TOGGLE_LEFT_SIDEBAR' }
  | { type: 'TOGGLE_RIGHT_SIDEBAR' }
  | { type: 'TOGGLE_BOTTOM_PANEL' }
  | { type: 'SET_SIDEBAR_WIDTH'; width: number }
  | { type: 'SET_RAW_TEXT'; text: string }
  | { type: 'SET_SOURCE_LABEL'; label: string }
  | { type: 'SET_SELECTED_FILE_NAME'; name: string }
  | { type: 'SET_SAVE_OUTPUTS'; save: boolean }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'SET_PARSE_RESULT'; result: ParseResponse | null }
  | { type: 'SET_RUN_RESULT'; result: RunResponse | null }
  | { type: 'SET_SELECTED_GROUP_INDEX'; index: number }
  | { type: 'SET_IS_MAXIMIZED'; maximized: boolean }
  | { type: 'APPEND_LOG'; line: string }
  | { type: 'CLEAR_LOG' }
  | { type: 'RESET' }

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.view }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab }
    case 'TOGGLE_LEFT_SIDEBAR':
      return { ...state, leftSidebarOpen: !state.leftSidebarOpen }
    case 'TOGGLE_RIGHT_SIDEBAR':
      return { ...state, rightSidebarOpen: !state.rightSidebarOpen }
    case 'TOGGLE_BOTTOM_PANEL':
      return { ...state, bottomPanelOpen: !state.bottomPanelOpen }
    case 'SET_SIDEBAR_WIDTH':
      return { ...state, sidebarWidth: action.width }
    case 'SET_RAW_TEXT':
      return { ...state, rawText: action.text }
    case 'SET_SOURCE_LABEL':
      return { ...state, sourceLabel: action.label }
    case 'SET_SELECTED_FILE_NAME':
      return { ...state, selectedFileName: action.name }
    case 'SET_SAVE_OUTPUTS':
      return { ...state, saveOutputs: action.save }
    case 'SET_BUSY':
      return { ...state, busy: action.busy }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    case 'SET_PARSE_RESULT':
      return { ...state, parseResult: action.result }
    case 'SET_RUN_RESULT':
      return { ...state, runResult: action.result, selectedGroupIndex: 0 }
    case 'SET_SELECTED_GROUP_INDEX':
      return { ...state, selectedGroupIndex: action.index }
    case 'SET_IS_MAXIMIZED':
      return { ...state, isMaximized: action.maximized }
    case 'APPEND_LOG':
      return { ...state, bottomLog: [...state.bottomLog, action.line] }
    case 'CLEAR_LOG':
      return { ...state, bottomLog: [] }
    case 'RESET':
      return {
        ...initialState,
        sidebarWidth: state.sidebarWidth,
        isMaximized: state.isMaximized,
      }
    default:
      return state
  }
}

/* ── Context ── */

const StateContext = createContext<AppState>(initialState)
const DispatchContext = createContext<Dispatch<AppAction>>(() => {})

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  )
}

export function useAppState() {
  return useContext(StateContext)
}

export function useDispatch() {
  return useContext(DispatchContext)
}

/* ── Async actions ── */

export function useAppActions() {
  const state = useAppState()
  const dispatch = useDispatch()

  const appendLog = useCallback(
    (line: string) => dispatch({ type: 'APPEND_LOG', line }),
    [dispatch],
  )

  const handleParse = useCallback(async () => {
    dispatch({ type: 'SET_BUSY', busy: true })
    dispatch({ type: 'SET_ERROR', error: '' })
    dispatch({ type: 'SET_RUN_RESULT', result: null })
    dispatch({ type: 'CLEAR_LOG' })
    appendLog('[parse] 开始解析数据…')

    try {
      const response = await callBridge<ParseResponse>({
        command: 'parse',
        raw_text: state.rawText,
        source_label: state.sourceLabel,
        preview_rows: 6,
      })
      dispatch({ type: 'SET_PARSE_RESULT', result: response })
      if (response.ok) {
        appendLog(`[parse] 解析完成 — ${response.column_count ?? '?'} 列, 编码: ${response.encoding_used ?? '自动'}`)
      } else {
        dispatch({ type: 'SET_ERROR', error: response.error })
        appendLog(`[parse] 解析失败: ${response.error}`)
      }
    } catch (e) {
      const msg = String(e)
      dispatch({ type: 'SET_ERROR', error: msg })
      appendLog(`[parse] 桥接错误: ${msg}`)
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }, [state.rawText, state.sourceLabel, dispatch, appendLog])

  const handleRun = useCallback(async () => {
    dispatch({ type: 'SET_BUSY', busy: true })
    dispatch({ type: 'SET_ERROR', error: '' })
    dispatch({ type: 'CLEAR_LOG' })
    appendLog('[run] 开始全局 4PL 拟合…')

    try {
      const response = await callBridge<RunResponse>({
        command: 'run',
        raw_text: state.rawText,
        source_label: state.sourceLabel,
        save_outputs: state.saveOutputs,
      })
      dispatch({ type: 'SET_RUN_RESULT', result: response })

      if (response.meta) {
        dispatch({
          type: 'SET_PARSE_RESULT',
          result: {
            ...(state.parseResult ?? { ok: true, error: '' }),
            ok: true,
            error: '',
            meta: response.meta,
            source_label: response.source_label,
            encoding_used: response.encoding_used,
            column_count: response.meta?.columns?.length,
          },
        })
      }

      if (response.ok) {
        const n = response.report?.summary_rows?.length ?? 0
        const success = response.report?.summary_rows?.filter(r => r.Status === 'Success').length ?? 0
        appendLog(`[run] 拟合完成 — ${n} 组, ${success} 成功`)
        if (response.output_dir) {
          appendLog(`[run] 已导出到: ${response.output_dir}`)
        }
        dispatch({ type: 'SET_ACTIVE_VIEW', view: 'results' })
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'table' })
      } else {
        dispatch({ type: 'SET_ERROR', error: response.error })
        appendLog(`[run] 计算失败: ${response.error}`)
      }
    } catch (e) {
      const msg = String(e)
      dispatch({ type: 'SET_ERROR', error: msg })
      appendLog(`[run] 桥接错误: ${msg}`)
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }, [state.rawText, state.sourceLabel, state.saveOutputs, state.parseResult, dispatch, appendLog])

  return { handleParse, handleRun, appendLog }
}
