import { useAppState, useDispatch } from '../../context/AppStateContext'
import { IconChevronRight } from '../common/Icon'
import DetailPanel from '../detail/DetailPanel'
import './RightSidebar.css'

export default function RightSidebar() {
  const { rightSidebarOpen } = useAppState()
  const dispatch = useDispatch()

  return (
    <div className={`right-sidebar ${rightSidebarOpen ? 'right-sidebar--open' : 'right-sidebar--closed'}`}>
      {rightSidebarOpen ? (
        <>
          <div className="right-sidebar__header">
            <span className="right-sidebar__title">详情</span>
            <button
              className="right-sidebar__collapse"
              onClick={() => dispatch({ type: 'TOGGLE_RIGHT_SIDEBAR' })}
              title="折叠面板"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
          <div className="right-sidebar__body">
            <DetailPanel />
          </div>
        </>
      ) : (
        <button
          className="right-sidebar__expand"
          onClick={() => dispatch({ type: 'TOGGLE_RIGHT_SIDEBAR' })}
          title="展开详情面板"
        >
          <IconChevronRight size={16} />
        </button>
      )}
    </div>
  )
}
