import { useAppState } from '../../context/AppStateContext'
import './PlotViewer.css'

export default function PlotViewer() {
  const { runResult } = useAppState()
  const plotFiles = runResult?.saved_files?.filter(
    (f) => f.endsWith('.png'),
  ) ?? []

  if (plotFiles.length === 0) {
    return (
      <div className="plot-viewer__empty">
        暂无拟合图。运行计算并导出结果后，此处将显示拟合曲线图。
      </div>
    )
  }

  return (
    <div className="plot-viewer">
      <div className="plot-viewer__list">
        {plotFiles.map((path) => {
          const name = path.replace(/^.*[\\/]/, '')
          return (
            <div key={path} className="plot-viewer__card">
              <div className="plot-viewer__card-header">{name}</div>
              <div className="plot-viewer__card-body">
                <img
                  src={`asset://localhost/${encodeURI(path)}`}
                  alt={name}
                  className="plot-viewer__img"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
