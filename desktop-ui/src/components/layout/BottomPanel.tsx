import { useRef, useEffect } from 'react'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import { IconChevronDown, IconTerminal } from '../common/Icon'
import './BottomPanel.css'

export default function BottomPanel() {
  const { bottomPanelOpen, bottomLog } = useAppState()
  const dispatch = useDispatch()
  const logEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomPanelOpen && logEnd.current) {
      logEnd.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [bottomLog, bottomPanelOpen])

  return (
    <div className={`bottom-panel ${bottomPanelOpen ? 'bottom-panel--open' : 'bottom-panel--closed'}`}>
      <div className="bottom-panel__tabs">
        <div className="bottom-panel__tab bottom-panel__tab--active">
          <IconTerminal size={13} />
          <span>输出</span>
        </div>
        <button
          className="bottom-panel__toggle"
          onClick={() => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' })}
          title={bottomPanelOpen ? '折叠面板' : '展开面板'}
        >
          <IconChevronDown size={14} />
        </button>
      </div>
      {bottomPanelOpen && (
        <div className="bottom-panel__body">
          {bottomLog.length === 0 ? (
            <div className="bottom-panel__empty">尚未运行。运行计算后此处显示日志输出。</div>
          ) : (
            bottomLog.map((line, i) => (
              <div key={i} className="bottom-panel__line">{line}</div>
            ))
          )}
          <div ref={logEnd} />
        </div>
      )}
    </div>
  )
}
