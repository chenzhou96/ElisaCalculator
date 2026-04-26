import { useAppState, useDispatch } from '../../context/AppStateContext'
import { IconChevronLeft, IconChevronRight } from '../common/Icon'
import FilePanel from '../data/FilePanel'
import GroupList from '../results/GroupList'
import PlotThumbList from '../plots/PlotThumbList'
import ResizableHandle from '../common/ResizableHandle'
import './LeftSidebar.css'

export default function LeftSidebar() {
  const { activeView, leftSidebarOpen, sidebarWidth } = useAppState()
  const dispatch = useDispatch()

  if (!leftSidebarOpen) {
    return (
      <div className="left-sidebar left-sidebar--closed">
        <button
          className="left-sidebar__expand"
          onClick={() => dispatch({ type: 'TOGGLE_LEFT_SIDEBAR' })}
          title="展开侧栏"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="left-sidebar" style={{ width: sidebarWidth }}>
        <div className="left-sidebar__header">
          <span className="left-sidebar__title">
            {activeView === 'data' ? '数据输入' : activeView === 'results' ? '分组列表' : '图表列表'}
          </span>
          <button
            className="left-sidebar__collapse"
            onClick={() => dispatch({ type: 'TOGGLE_LEFT_SIDEBAR' })}
            title="折叠侧栏"
          >
            <IconChevronLeft size={14} />
          </button>
        </div>
        <div className="left-sidebar__body">
          {activeView === 'data' && <FilePanel />}
          {activeView === 'results' && <GroupList />}
          {activeView === 'plots' && <PlotThumbList />}
        </div>
      </div>
      <ResizableHandle />
    </>
  )
}
