import { useAppState, useDispatch } from '../../context/AppStateContext'
import './RawDataEditor.css'

function normalizeClipboardText(text: string) {
  return text
    .replace(/﻿/g, '')
    .replace(/[​-‍⁠]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export default function RawDataEditor() {
  const { rawText, busy } = useAppState()
  const dispatch = useDispatch()

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const plainText = event.clipboardData.getData('text/plain')
    if (!plainText) {
      return
    }

    event.preventDefault()
    const normalized = normalizeClipboardText(plainText)
    const target = event.currentTarget
    const start = target.selectionStart ?? rawText.length
    const end = target.selectionEnd ?? rawText.length
    const next = `${rawText.slice(0, start)}${normalized}${rawText.slice(end)}`
    dispatch({ type: 'SET_RAW_TEXT', text: next })

    const caret = start + normalized.length
    requestAnimationFrame(() => {
      target.setSelectionRange(caret, caret)
    })
  }

  return (
    <textarea
      className="raw-editor"
      value={rawText}
      onChange={(e) => dispatch({ type: 'SET_RAW_TEXT', text: e.target.value })}
      onPaste={handlePaste}
      placeholder="在此粘贴或编辑 ELISA 原始数据…"
      disabled={busy}
      spellCheck={false}
    />
  )
}
