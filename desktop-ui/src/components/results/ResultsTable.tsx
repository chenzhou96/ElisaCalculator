import { useMemo, useState } from 'react'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import type { SummaryRow } from '../../types/bridge'
import './ResultsTable.css'

type SortKey = keyof SummaryRow | ''
type SortDir = 'asc' | 'desc'

function formatNum(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

export default function ResultsTable() {
  const { runResult, selectedGroupIndex } = useAppState()
  const dispatch = useDispatch()
  const [sortKey, setSortKey] = useState<SortKey>('')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const rows: SummaryRow[] = runResult?.report?.summary_rows ?? []

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  function onHeaderClick(key: SortKey) {
    if (!key) return
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null
    return <span className="results-table__sort">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
  }

  if (rows.length === 0) {
    return (
      <div className="results-table__empty">
        尚未运行计算。请在数据视图中准备数据，然后在左侧面板点击“运行计算”。
      </div>
    )
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: 'Group', label: 'Group' },
    { key: 'EC50', label: 'EC50' },
    { key: 'Slope', label: 'Slope' },
    { key: 'R2', label: 'R²' },
    { key: 'RMSE', label: 'RMSE' },
    { key: 'Status', label: 'Status' },
    { key: 'Warning', label: 'Warning' },
  ]

  return (
    <div className="results-table__wrap">
      <table className="results-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => onHeaderClick(col.key)}
                className={`results-table__th ${col.key === sortKey ? 'results-table__th--sorted' : ''}`}
              >
                {col.label}{sortIndicator(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const origIndex = rows.indexOf(row)
            return (
              <tr
                key={row.Group}
                className={`results-table__row ${origIndex === selectedGroupIndex ? 'results-table__row--active' : ''}`}
                onClick={() => dispatch({ type: 'SET_SELECTED_GROUP_INDEX', index: origIndex })}
              >
                <td>{row.Group}</td>
                <td className="results-table__num">{formatNum(row.EC50)}</td>
                <td className="results-table__num">{formatNum(row.Slope)}</td>
                <td className="results-table__num">{formatNum(row.R2)}</td>
                <td className="results-table__num">{formatNum(row.RMSE)}</td>
                <td>
                  <span className={`results-table__status results-table__status--${row.Status === 'Success' ? 'success' : row.Status === 'Skipped' ? 'skipped' : 'warn'}`}>
                    {row.Status}
                  </span>
                </td>
                <td className="results-table__warn">{row.Warning || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
