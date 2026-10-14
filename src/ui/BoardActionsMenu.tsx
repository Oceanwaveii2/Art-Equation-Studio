import { useEffect, useRef, type ReactNode } from 'react'

/** Board actions share one compact trigger in both wide and Split layouts. */
export function BoardActionsMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const close = (focus = false) => {
    if (!ref.current?.open) return
    ref.current.open = false
    if (focus) ref.current.querySelector('summary')?.focus()
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) { event.preventDefault(); event.stopPropagation(); close(true) }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [])
  return <details ref={ref} className="filmstrip-actions">
    <summary onKeyDown={event => {
      if (event.key !== 'ArrowDown' || !ref.current) return
      event.preventDefault(); ref.current.open = true
      ref.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }}>Board actions ▾</summary>
    <div role="group" aria-label="Board actions" onClick={event => { if ((event.target as Element).closest('button:not(:disabled)')) close() }} onKeyDown={event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (!buttons.length) return
      event.preventDefault(); event.stopPropagation()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
    }}>{children}</div>
  </details>
}
