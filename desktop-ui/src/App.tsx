import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type ParseMeta = {
  header_mode?: string
  header_note?: string
  separator?: string
  columns?: string[]
}

type SummaryRow = {
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

type DetailRow = {
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

type ParseResponse = {
  ok: boolean
  error: string
  meta?: ParseMeta
  source_label?: string
  encoding_used?: string | null
  preview_text?: string
  row_count?: number
  column_count?: number
}

type RunResponse = {
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
  exports_skipped?: boolean
}

const INITIAL_TEXT = `浓度,样本A,样本B
0.1,2.05,1.98
0.3,1.91,1.85
1,1.55,1.47
3,0.92,0.88
10,0.34,0.39`

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  return value.toFixed(digits)
}

function App() {
  const [rawText, setRawText] = useState(INITIAL_TEXT)
  const [sourceLabel, setSourceLabel] = useState('Paste')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [saveOutputs, setSaveOutputs] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null)
  const [runResult, setRunResult] = useState<RunResponse | null>(null)
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0)

  const summaryRows = runResult?.report?.summary_rows ?? []
  const detailRows = runResult?.report?.detailed_rows ?? []
  const selectedDetail = detailRows[selectedGroupIndex] ?? null

  const summaryCards = useMemo(() => {
    const successCount = summaryRows.filter((row) => row.Status === 'Success').length
    const warningCount = summaryRows.filter((row) => row.Warning).length
    return [
      { label: '数据列', value: parseResult?.column_count ?? parseResult?.meta?.columns?.length ?? '—' },
      { label: '分组数', value: summaryRows.length || parseResult?.meta?.columns?.slice(1).length || '—' },
      { label: '成功拟合', value: successCount || '0' },
      { label: '告警条目', value: warningCount || '0' },
    ]
  }, [parseResult, summaryRows])

  async function callBridge<T>(payload: Record<string, unknown>) {
    return invoke<T>('run_bridge', { request: payload })
  }

  async function handleParse() {
    setBusy(true)
    setError('')
    setRunResult(null)
    setSelectedGroupIndex(0)

    try {
      const response = await callBridge<ParseResponse>({
        command: 'parse',
        raw_text: rawText,
        source_label: sourceLabel,
        preview_rows: 6,
      })
      setParseResult(response)
      if (!response.ok) {
        setError(response.error)
      }
    } catch (invokeError) {
      setError(String(invokeError))
    } finally {
      setBusy(false)
    }
  }

  async function handleRun() {
    setBusy(true)
    setError('')

    try {
      const response = await callBridge<RunResponse>({
        command: 'run',
        raw_text: rawText,
        source_label: sourceLabel,
        save_outputs: saveOutputs,
      })
      setRunResult(response)
      setSelectedGroupIndex(0)
      if (!response.ok) {
        setError(response.error)
      }
      if (response.meta) {
        setParseResult((current) => ({
          ...current,
          ok: true,
          error: '',
          meta: response.meta,
          source_label: response.source_label,
          encoding_used: response.encoding_used,
          column_count: response.meta?.columns?.length,
        }))
      }
    } catch (invokeError) {
      setError(String(invokeError))
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const text = await file.text()
    setRawText(text)
    setSourceLabel(file.name)
    setSelectedFileName(file.name)
    setError('')
    setParseResult(null)
    setRunResult(null)
    setSelectedGroupIndex(0)
  }

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Modern desktop GUI</p>
          <h1>ELISA 4PL Global Fit Studio</h1>
          <p className="hero-copy">
            保留 Python 计算内核，使用 Tauri + React 重做桌面界面。
          </p>
        </div>
        <div className="hero-status">
          <span className={`status-dot ${busy ? 'busy' : 'idle'}`}></span>
          {busy ? '处理中' : '就绪'}
        </div>
      </header>

      <main className="workspace">
        <section className="panel input-panel">
          <div className="section-head">
            <div>
              <h2>数据输入</h2>
              <p>支持直接粘贴或加载 CSV / 文本文件内容。</p>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={saveOutputs}
                onChange={(event) => setSaveOutputs(event.target.checked)}
              />
              <span>运行后导出结果</span>
            </label>
          </div>

          <div className="actions-row">
            <label className="file-picker">
              <input type="file" accept=".csv,.txt,.tsv" onChange={handleFileChange} />
              加载本地文件
            </label>
            <button type="button" className="secondary" onClick={() => setRawText(INITIAL_TEXT)}>
              恢复示例
            </button>
            <button type="button" className="secondary" onClick={() => setRawText('')}>
              清空
            </button>
          </div>

          <div className="source-meta">
            <span>来源：{selectedFileName || sourceLabel}</span>
            <span>编码：{parseResult?.encoding_used ?? '自动'}</span>
            <span>分隔符：{parseResult?.meta?.separator ?? '自动'}</span>
          </div>

          <textarea
            className="editor"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="在这里粘贴 ELISA 原始数据"
          />

          <div className="actions-row">
            <button type="button" className="secondary" onClick={handleParse} disabled={busy || !rawText.trim()}>
              解析预览
            </button>
            <button type="button" className="primary" onClick={handleRun} disabled={busy || !rawText.trim()}>
              运行计算
            </button>
          </div>

          {error ? <div className="error-box">{error}</div> : null}

          <div className="preview-box">
            <div className="section-head compact">
              <h3>解析预览</h3>
              <span>{parseResult?.meta?.header_note ?? '尚未解析'}</span>
            </div>
            <pre>{parseResult?.preview_text ?? '先点击“解析预览”查看表格结构。'}</pre>
          </div>
        </section>

        <section className="results-column">
          <div className="stats-grid">
            {summaryCards.map((card) => (
              <div key={card.label} className="stat-card">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          <section className="panel">
            <div className="section-head compact">
              <div>
                <h2>计算结果</h2>
                <p>
                  状态：{runResult?.status_msg ?? '未运行'}
                  {runResult?.removed_count ? ` · 已移除 ${runResult.removed_count} 个无效浓度点` : ''}
                </p>
              </div>
              <div className="output-note">
                {runResult?.output_dir ? `导出目录：${runResult.output_dir}` : '未生成导出文件'}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>EC50</th>
                    <th>R2</th>
                    <th>Status</th>
                    <th>Warning</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        运行计算后，这里会显示每组拟合结果。
                      </td>
                    </tr>
                  ) : (
                    summaryRows.map((row, index) => (
                      <tr
                        key={row.Group}
                        className={index === selectedGroupIndex ? 'active-row' : ''}
                        onClick={() => setSelectedGroupIndex(index)}
                      >
                        <td>{row.Group}</td>
                        <td>{formatNumber(row.EC50)}</td>
                        <td>{formatNumber(row.R2)}</td>
                        <td>{row.Status}</td>
                        <td>{row.Warning || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel detail-panel">
            <div className="section-head compact">
              <div>
                <h2>选中分组详情</h2>
                <p>{selectedDetail?.group_name ?? '尚未选择结果'}</p>
              </div>
              <div className="pill">{selectedDetail?.status ?? 'N/A'}</div>
            </div>

            <div className="detail-grid">
              <div className="detail-card">
                <span>参数 A / D</span>
                <strong>
                  {formatNumber(selectedDetail?.params?.A)} / {formatNumber(selectedDetail?.params?.D)}
                </strong>
              </div>
              <div className="detail-card">
                <span>Slope / EC50</span>
                <strong>
                  {formatNumber(selectedDetail?.params?.B)} / {formatNumber(selectedDetail?.params?.C)}
                </strong>
              </div>
              <div className="detail-card">
                <span>R2 / RMSE</span>
                <strong>
                  {formatNumber(selectedDetail?.r2)} / {formatNumber(selectedDetail?.rmse)}
                </strong>
              </div>
            </div>

            <div className="detail-columns">
              <div className="detail-block">
                <h3>Warnings</h3>
                <ul>
                  {(selectedDetail?.warning_list?.length ? selectedDetail.warning_list : ['无']).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-block">
                <h3>数据点</h3>
                <pre>
                  X: {selectedDetail?.x?.join(', ') ?? '—'}
                  {'\n'}
                  Y: {selectedDetail?.y?.join(', ') ?? '—'}
                </pre>
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}

export default App
