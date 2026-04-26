import { useAppState, useDispatch } from '../../context/AppStateContext'
import './RawDataEditor.css'

export default function RawDataEditor() {
  const { rawText, busy } = useAppState()
  const dispatch = useDispatch()

  return (
    <textarea
      className="raw-editor"
      value={rawText}
      onChange={(e) => dispatch({ type: 'SET_RAW_TEXT', text: e.target.value })}
      placeholder="在此粘贴或编辑 ELISA 原始数据…"
      disabled={busy}
      spellCheck={false}
    />
  )
}
