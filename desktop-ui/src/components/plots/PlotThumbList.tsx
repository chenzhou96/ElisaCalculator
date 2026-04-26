import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import './PlotThumbList.css'

function PlotThumb({ path, name }: { path: string; name: string }) {
  const [src, setSrc] = useState<string>('')
  const [error, setError] = useState('')

  useEffect(() => {
    setSrc('')
    setError('')
    invoke<string>('read_file_base64', { path })
      .then((data) => setSrc(data))
      .catch((err: Error) => setError(err.message ?? String(err)))
  }, [path])

  if (error) {
    return <div className="plot-thumb-list__thumb-state">加载失败</div>
  }
  if (!src) {
    return <div className="plot-thumb-list__thumb-state">加载中</div>
  }
  return <img src={src} alt={name} className="plot-thumb-list__thumb-img" />
}

export default function PlotThumbList() {
  const { runResult, selectedPlotPath } = useAppState()
  const dispatch = useDispatch()

  const plotFiles = runResult?.saved_files?.filter((file) => file.toLowerCase().endsWith('.png')) ?? []

  if (plotFiles.length === 0) {
    return <div className="plot-thumb-list__empty">暂无图表。请先运行计算并勾选导出结果。</div>
  }

  return (
    <div className="plot-thumb-list">
      {plotFiles.map((path) => {
        const name = path.replace(/^.*[\\/]/, '')
        const active = selectedPlotPath === path
        return (
          <button
            key={path}
            className={`plot-thumb-list__item ${active ? 'plot-thumb-list__item--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SELECTED_PLOT_PATH', path })}
            title={name}
          >
            <div className="plot-thumb-list__thumb-wrap">
              <PlotThumb path={path} name={name} />
            </div>
            <span className="plot-thumb-list__name">{name}</span>
          </button>
        )
      })}
    </div>
  )
}
