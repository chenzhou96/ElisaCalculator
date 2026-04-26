import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { IconMinimize, IconMaximize, IconRestore, IconClose } from '../common/Icon'
import { useAppState, useDispatch } from '../../context/AppStateContext'
import './TitleBar.css'

export default function TitleBar() {
  const appWindow = getCurrentWindow()
  const { isMaximized, busy } = useAppState()
  const dispatch = useDispatch()

  useEffect(() => {
    appWindow.isMaximized().then((val) => dispatch({ type: 'SET_IS_MAXIMIZED', maximized: val }))
    const unlisten = appWindow.onResized(async () => {
      const val = await appWindow.isMaximized()
      dispatch({ type: 'SET_IS_MAXIMIZED', maximized: val })
    })
    return () => {
      unlisten.then((fn: () => void) => fn())
    }
  }, [appWindow, dispatch])

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar__label" data-tauri-drag-region>
        <span className="title-bar__brand" data-tauri-drag-region>
          <img
            src="/Ab.ico"
            alt="ELISA Calculator Logo"
            className="title-bar__logo"
            draggable={false}
          />
          <span>ELISA Calculator</span>
        </span>
        {busy && <span className="title-bar__busy"> — 处理中…</span>}
      </div>
      <div className="title-bar__controls">
        <button
          className="title-bar__btn"
          onClick={() => appWindow.minimize()}
          title="最小化"
        >
          <IconMinimize />
        </button>
        <button
          className="title-bar__btn"
          onClick={() => appWindow.toggleMaximize()}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <IconRestore /> : <IconMaximize />}
        </button>
        <button
          className="title-bar__btn title-bar__btn--close"
          onClick={() => appWindow.close()}
          title="关闭"
        >
          <IconClose />
        </button>
      </div>
    </div>
  )
}
