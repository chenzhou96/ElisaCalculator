import { useCallback, useRef } from 'react'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import './ResizableHandle.css'

export default function ResizableHandle() {
  const { leftSidebarOpen, sidebarWidth } = useAppState()
  const dispatch = useDispatch()
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startX.current = e.clientX
      startWidth.current = sidebarWidth

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current
        const next = Math.min(
          Math.max(startWidth.current + delta, 200),
          500,
        )
        dispatch({ type: 'SET_SIDEBAR_WIDTH', width: next })
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sidebarWidth, dispatch],
  )

  if (!leftSidebarOpen) return null

  return <div className="resizable-handle" onMouseDown={onMouseDown} />
}
