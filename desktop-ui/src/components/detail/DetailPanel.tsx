import { useAppState } from '../../context/AppStateContext'
import './DetailPanel.css'

function formatNum(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

export default function DetailPanel() {
  const { runResult, selectedGroupIndex } = useAppState()
  const detailRows = runResult?.report?.detailed_rows ?? []
  const detail = detailRows[selectedGroupIndex] ?? null

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
