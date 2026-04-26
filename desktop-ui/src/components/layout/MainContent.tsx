import { useAppState, useDispatch } from '../../context/AppStateContext'
import RawDataEditor from '../data/RawDataEditor'
import ResultsTable from '../results/ResultsTable'
import PlotViewer from '../plots/PlotViewer'
import './MainContent.css'

export default function MainContent() {
  const { activeView, error } = useAppState()
  const dispatch = useDispatch()

  return (
    <div className="main-content">
      {error && (
        <div className="main-content__error">
          {error}
          <button
            className="main-content__error-close"
            onClick={() => dispatch({ type: 'SET_ERROR', error: '' })}
          >
            ✕
          </button>
        </div>
      )}
      <div className="main-content__area">
        {activeView === 'data' && <RawDataEditor />}
        {activeView === 'results' && <ResultsTable />}
        {activeView === 'plots' && <PlotViewer />}
      </div>
    </div>
  )
}
