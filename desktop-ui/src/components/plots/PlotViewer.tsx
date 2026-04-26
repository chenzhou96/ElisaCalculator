import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppState } from '../../context/AppStateContext'
import './PlotViewer.css'

function PlotImage({ path, name }: { path: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<string>('read_file_base64', { path })
      .then(setSrc)
      .catch((err: Error) => setError(err.message ?? String(err)))
  }, [path])

  if (error) {
    return <div className="plot-viewer__card-error">加载失败: {error}</div>
  }
  if (!src) {
    return <div className="plot-viewer__card-loading">加载中...</div>
  }
  return <img src={src} alt={name} className="plot-viewer__img" />
}

export default function PlotViewer() {
  const { runResult, selectedPlotPath } = useAppState()
  const plotFiles = (runResult?.saved_files?.filter(
    (f) => f.toLowerCase().endsWith('.png'),
  ) ?? []).sort((a, b) => {
    const aName = a.replace(/^.*[\\/]/, '')
    const bName = b.replace(/^.*[\\/]/, '')
    const aOverview = aName === 'EC50_AllGroups_Overview.png'
    const bOverview = bName === 'EC50_AllGroups_Overview.png'
    if (aOverview && !bOverview) return -1
    if (!aOverview && bOverview) return 1
    return aName.localeCompare(bName)
  })
  const activePath = selectedPlotPath && plotFiles.includes(selectedPlotPath)
    ? selectedPlotPath
    : plotFiles[0]

  if (plotFiles.length === 0) {
    return (
      <div className="plot-viewer__empty">
        暂无拟合图。运行计算并导出结果后，此处将显示拟合曲线图。
      </div>
    )
  }

  if (!activePath) {
    return <div className="plot-viewer__empty">未选中图表。</div>
  }

  const activeName = activePath.replace(/^.*[\\/]/, '')

  return (
    <div className="plot-viewer">
      <div className="plot-viewer__single">
        <div className="plot-viewer__card-header">{activeName}</div>
        <div className="plot-viewer__single-body">
          <PlotImage path={activePath} name={activeName} />
        </div>
      </div>
    </div>
  )
}
