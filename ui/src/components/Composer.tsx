import { useRef, useState } from 'react'
import { IconSend } from './icons'

interface ComposerProps {
  placeholder: string
  hint?: string
  onSend: (text: string) => void
}

export function Composer({ placeholder, hint, onSend }: ComposerProps) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  function autosize() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    requestAnimationFrame(autosize)
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            autosize()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          className="send-btn"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Send"
          title="Send"
        >
          <IconSend />
        </button>
      </div>
      {hint ? <div className="composer-hint">{hint}</div> : null}
    </div>
  )
}
