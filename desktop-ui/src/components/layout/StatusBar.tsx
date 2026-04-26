import { useAppState } from '../../context/AppStateContext'
import './StatusBar.css'

export default function StatusBar() {
  const { busy, error, parseResult, runResult, sourceLabel } = useAppState()
  const summaryRows = runResult?.report?.summary_rows ?? []
  const groupCount = summaryRows.length
  const successCount = summaryRows.filter((r) => r.Status === 'Success').length

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span className={`status-bar__dot ${busy ? 'status-bar__dot--busy' : error ? 'status-bar__dot--error' : 'status-bar__dot--idle'}`} />
        <span className="status-bar__state">
          {busy ? '处理中' : error ? '错误' : '就绪'}
        </span>
      </div>
      <div className="status-bar__right">
        {parseResult?.encoding_used && (
          <span className="status-bar__item">{parseResult.encoding_used}</span>
        )}
        {sourceLabel && (
          <span className="status-bar__item">{sourceLabel}</span>
        )}
        {groupCount > 0 && (
          <span className="status-bar__item">
            共 {groupCount} 组 ({successCount} 成功)
          </span>
        )}
        {runResult?.output_dir && (
          <span className="status-bar__item" title={runResult.output_dir}>已导出</span>
        )}
      </div>
    </div>
  )
}
