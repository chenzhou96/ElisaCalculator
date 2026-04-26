import { useMemo } from 'react'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import type { SummaryRow } from '../../types/bridge'
import './GroupList.css'

function statusBadge(status: string) {
  if (status === 'Success') return 'group-list__badge--success'
  if (status === 'Skipped') return 'group-list__badge--skipped'
  return 'group-list__badge--warn'
}

export default function GroupList() {
  const { runResult, selectedGroupIndex } = useAppState()
  const dispatch = useDispatch()

  const rows: SummaryRow[] = runResult?.report?.summary_rows ?? []

  const stats = useMemo(() => {
    const success = rows.filter((r) => r.Status === 'Success').length
    const warn = rows.filter((r) => r.Warning).length
    return { total: rows.length, success, warn }
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="group-list">
        <div className="group-list__empty">暂无结果。请先在数据视图中运行计算。</div>
      </div>
    )
  }

  return (
    <div className="group-list">
      <div className="group-list__stats">
        <span>{stats.total} 组</span>
        <span className="group-list__stat--success">{stats.success} 成功</span>
        {stats.warn > 0 && <span className="group-list__stat--warn">{stats.warn} 警告</span>}
      </div>
      <div className="group-list__items">
        {rows.map((row, i) => (
          <button
            key={row.Group}
            className={`group-list__item ${i === selectedGroupIndex ? 'group-list__item--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SELECTED_GROUP_INDEX', index: i })}
          >
            <span className="group-list__name">{row.Group}</span>
            <span className={`group-list__badge ${statusBadge(row.Status)}`}>
              {row.Status}
            </span>
            {row.Warning && <span className="group-list__warn-icon" title={row.Warning}>!</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
