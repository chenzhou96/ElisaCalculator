import { useRef, type ChangeEvent } from 'react'
import { useAppState, useDispatch, useAppActions } from '../../context/AppStateContext'
import './FilePanel.css'

const CANDIDATE_ENCODINGS = ['utf-8', 'gb18030', 'gbk'] as const

async function readFileWithFallback(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  for (const encoding of CANDIDATE_ENCODINGS) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes)
      return { text: decoded.replace(/^\uFEFF/, ''), encoding }
    } catch {
      continue
    }
  }
  return {
    text: new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''),
    encoding: 'utf-8',
  }
}

export default function FilePanel() {
  const { rawText, sourceLabel, selectedFileName, selectedXColumn, saveOutputs, busy, parseResult } = useAppState()
  const dispatch = useDispatch()
  const { handleParse, handleRun } = useAppActions()
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const { text, encoding } = await readFileWithFallback(file)
      dispatch({ type: 'SET_RAW_TEXT', text })
      dispatch({ type: 'SET_SOURCE_LABEL', label: `${file.name} (${encoding})` })
      dispatch({ type: 'SET_SELECTED_FILE_NAME', name: file.name })
      dispatch({ type: 'SET_SELECTED_X_COLUMN', column: '' })
      dispatch({ type: 'SET_ERROR', error: '' })
      dispatch({ type: 'SET_PARSE_RESULT', result: null })
      dispatch({ type: 'SET_RUN_RESULT', result: null })
    } finally {
      // Allow selecting the same file path again to retrigger onChange.
      event.currentTarget.value = ''
    }
  }

  return (
    <div className="file-panel">
      <div className="file-panel__section">
        <label className="file-panel__label">数据来源</label>
        <label className="file-panel__file-btn">
          <input ref={fileInputRef} type="file" accept=".csv,.txt,.tsv" onChange={onFileChange} />
          加载本地文件
        </label>
        <div className="file-panel__meta">
          <span>来源：{selectedFileName || sourceLabel}</span>
          <span>编码：{parseResult?.encoding_used ?? '自动'}</span>
          <span>分隔符：{parseResult?.meta?.separator ?? '自动'}</span>
        </div>
      </div>

      <div className="file-panel__section">
        <label className="file-panel__label">数据操作</label>
        <div className="file-panel__actions">
          <button
            className="file-panel__btn file-panel__btn--clear"
            onClick={() => {
              dispatch({ type: 'SET_RAW_TEXT', text: '' })
              dispatch({ type: 'SET_SOURCE_LABEL', label: 'Paste' })
              dispatch({ type: 'SET_SELECTED_FILE_NAME', name: '' })
              dispatch({ type: 'SET_SELECTED_X_COLUMN', column: '' })
              dispatch({ type: 'SET_SELECTED_PLOT_PATH', path: '' })
              dispatch({ type: 'SET_PARSE_RESULT', result: null })
              dispatch({ type: 'SET_RUN_RESULT', result: null })
              if (fileInputRef.current) {
                fileInputRef.current.value = ''
              }
            }}
            disabled={busy}
          >
            清空
          </button>
        </div>
      </div>

      <div className="file-panel__section">
        <label className="file-panel__label">解析信息</label>
        <div className="file-panel__info">
          {parseResult?.meta?.columns ? (
            <>
              <label className="file-panel__inline-label" htmlFor="x-column-select">X 轴列（浓度）</label>
              <select
                id="x-column-select"
                className="file-panel__select"
                value={selectedXColumn}
                onChange={(e) => dispatch({ type: 'SET_SELECTED_X_COLUMN', column: e.target.value })}
              >
                {parseResult.meta.columns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <ul className="file-panel__columns">
                {parseResult.meta.columns.map((col) => (
                  <li key={col} className="file-panel__column-item">{col}</li>
                ))}
              </ul>
            </>
          ) : (
            <span className="file-panel__hint">尚未解析 — 粘贴数据后点击下方按钮</span>
          )}
        </div>
      </div>

      <div className="file-panel__section file-panel__section--bottom">
        <label className="file-panel__toggle">
          <input
            type="checkbox"
            checked={saveOutputs}
            onChange={(e) => dispatch({ type: 'SET_SAVE_OUTPUTS', save: e.target.checked })}
          />
          <span>运行后导出结果</span>
        </label>
        <div className="file-panel__actions">
          <button
            className="file-panel__btn file-panel__btn--parse"
            onClick={handleParse}
            disabled={busy || !rawText.trim()}
          >
            解析预览
          </button>
          <button
            className="file-panel__btn file-panel__btn--run"
            onClick={handleRun}
            disabled={busy || !rawText.trim()}
          >
            运行计算
          </button>
        </div>
      </div>
    </div>
  )
}
