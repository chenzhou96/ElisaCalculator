import { useAppState, useDispatch } from '../../context/AppStateContext'
import { callBridge } from '../../hooks/useBridge'
import './RawDataEditor.css'

function stripInvisibleChars(text: string) {
  return text
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
}

async function normalizePastedText(text: string) {
  const cleaned = stripInvisibleChars(text)
  try {
    const response = await callBridge<{ ok: boolean; raw_text?: string }>(
      {
        command: 'normalize_text',
        raw_text: cleaned,
      },
    )
    if (response?.ok && typeof response.raw_text === 'string') {
      return response.raw_text
    }
    return cleaned
  } catch {
    return cleaned
  }
}

export default function RawDataEditor() {
  const { rawText, busy } = useAppState()
  const dispatch = useDispatch()

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const plainText = event.clipboardData.getData('text/plain')
    if (!plainText) {
      return
    }

    event.preventDefault()
    const normalized = await normalizePastedText(plainText)
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
