import type { ViewType } from '../../types/layout'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import { IconData, IconTable, IconChart } from '../common/Icon'
import './ActivityBar.css'

const views: { id: ViewType; label: string; Icon: typeof IconData }[] = [
  { id: 'data', label: '数据', Icon: IconData },
  { id: 'results', label: '结果', Icon: IconTable },
  { id: 'plots', label: '图表', Icon: IconChart },
]

export default function ActivityBar() {
  const { activeView } = useAppState()
  const dispatch = useDispatch()

  return (
    <div className="activity-bar">
      <div className="activity-bar__items">
        {views.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`activity-bar__btn ${id === activeView ? 'activity-bar__btn--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', view: id })}
            title={label}
          >
            <Icon />
          </button>
        ))}
      </div>
    </div>
  )
}
