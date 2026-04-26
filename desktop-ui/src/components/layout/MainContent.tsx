import type { TabType } from '../../types/layout'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import TabBar from '../common/TabBar'
import RawDataEditor from '../data/RawDataEditor'
import ResultsTable from '../results/ResultsTable'
import PlotViewer from '../plots/PlotViewer'
import './MainContent.css'

const tabs: { id: TabType; label: string }[] = [
  { id: 'editor', label: '编辑器' },
  { id: 'table', label: '结果表' },
  { id: 'plot', label: '拟合图' },
]

export default function MainContent() {
  const { activeTab } = useAppState()
  const dispatch = useDispatch()

  return (
    <div className="main-content">
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => dispatch({ type: 'SET_ACTIVE_TAB', tab })}
      />
      <div className="main-content__area">
        {activeTab === 'editor' && <RawDataEditor />}
        {activeTab === 'table' && <ResultsTable />}
        {activeTab === 'plot' && <PlotViewer />}
      </div>
    </div>
  )
}
