import { useAppState } from '../../context/AppStateContext'
import type { SummaryRow } from '../../types/bridge'
import './DetailPanel.css'

function formatNum(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

export default function DetailPanel() {
  const { activeView, runResult, selectedGroupIndex, selectedPlotPath } = useAppState()
  const summaryRows: SummaryRow[] = runResult?.report?.summary_rows ?? []
  const detailRows = runResult?.report?.detailed_rows ?? []
  const detail = detailRows[selectedGroupIndex] ?? null

  const selectedPlotName = String(selectedPlotPath ?? '').replace(/^.*[\\/]/, '')
  const isOverviewPlot = activeView === 'plots' && selectedPlotName === 'EC50_AllGroups_Overview.png'

  if (isOverviewPlot) {
    if (summaryRows.length === 0) {
      return (
        <div className="detail-panel">
          <div className="detail-panel__empty">暂无分组汇总数据。</div>
        </div>
      )
    }

    return (
      <div className="detail-panel">
        <div className="detail-panel__group">
          <span className="detail-panel__name">全部分组汇总</span>
          <span className="detail-panel__status detail-panel__status--success">Overview</span>
        </div>

        <div className="detail-panel__section">
          <h4 className="detail-panel__heading">汇总表</h4>
          <div className="detail-panel__table-wrap">
            <table className="detail-panel__table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>EC50</th>
                  <th>斜率</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr key={row.Group}>
                    <td>{row.Group}</td>
                    <td className="detail-panel__table-num">{formatNum(row.EC50)}</td>
                    <td className="detail-panel__table-num">{formatNum(row.Slope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="detail-panel">
        <div className="detail-panel__empty">选择结果表中的一行以查看详情。</div>
      </div>
    )
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel__group">
        <span className="detail-panel__name">{detail.group_name}</span>
        <span className={`detail-panel__status detail-panel__status--${detail.status === 'Success' ? 'success' : detail.status === 'Skipped' ? 'skipped' : 'warn'}`}>
          {detail.status}
        </span>
      </div>

      <div className="detail-panel__section">
        <h4 className="detail-panel__heading">拟合参数</h4>
        <div className="detail-panel__params">
          <div className="detail-panel__param">
            <span className="detail-panel__param-label">A (上限)</span>
            <span className="detail-panel__param-value">{formatNum(detail.params?.A)}</span>
          </div>
          <div className="detail-panel__param">
            <span className="detail-panel__param-label">B (斜率)</span>
            <span className="detail-panel__param-value">{formatNum(detail.params?.B)}</span>
          </div>
          <div className="detail-panel__param">
            <span className="detail-panel__param-label">C (EC50)</span>
            <span className="detail-panel__param-value">{formatNum(detail.params?.C)}</span>
          </div>
          <div className="detail-panel__param">
            <span className="detail-panel__param-label">D (下限)</span>
            <span className="detail-panel__param-value">{formatNum(detail.params?.D)}</span>
          </div>
        </div>
      </div>

      <div className="detail-panel__section">
        <h4 className="detail-panel__heading">拟合质量</h4>
        <div className="detail-panel__params">
          <div className="detail-panel__param">
            <span className="detail-panel__param-label">R²</span>
            <span className="detail-panel__param-value">{formatNum(detail.r2)}</span>
          </div>
          <div className="detail-panel__param">
            <span className="detail-panel__param-label">RMSE</span>
            <span className="detail-panel__param-value">{formatNum(detail.rmse)}</span>
          </div>
        </div>
      </div>

      <div className="detail-panel__section">
        <h4 className="detail-panel__heading">警告</h4>
        {detail.warning_list.length > 0 ? (
          <ul className="detail-panel__warnings">
            {detail.warning_list.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : (
          <span className="detail-panel__none">无</span>
        )}
      </div>

      <div className="detail-panel__section">
        <h4 className="detail-panel__heading">数据点</h4>
        <div className="detail-panel__data">
          <div className="detail-panel__data-row">
            <span className="detail-panel__data-label">X</span>
            <code className="detail-panel__data-code">{detail.x.join(', ')}</code>
          </div>
          <div className="detail-panel__data-row">
            <span className="detail-panel__data-label">Y</span>
            <code className="detail-panel__data-code">{detail.y.join(', ')}</code>
          </div>
          {detail.y_pred && (
            <div className="detail-panel__data-row">
              <span className="detail-panel__data-label">Y_pred</span>
              <code className="detail-panel__data-code">{detail.y_pred.map((v) => formatNum(v)).join(', ')}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
