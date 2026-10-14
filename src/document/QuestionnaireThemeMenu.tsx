import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ThemeIcon } from '../ui/ThemeIcon'
import './QuestionnaireTheme.css'

type Theme = 'navy' | 'dark' | 'light'
const choices: Theme[] = ['navy', 'dark', 'light']
const labels = { navy: 'Navy', dark: 'Night / Dark', light: 'Light' }

export function QuestionnaireThemeMenu({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  function close(restoreFocus = true) {
    setPosition(null)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }
  function open() {
    const button = trigger.current!
    const rect = button.getBoundingClientRect(), style = getComputedStyle(button)
    const palette = Object.fromEntries(['--surface-overlay', '--text', '--border-control', '--focus-ring', '--surface-hover'].map(token => [token, style.getPropertyValue(token).trim()]))
    setPosition({ ...palette, left: Math.max(8, Math.min(rect.right - 172, innerWidth - 180)), top: rect.bottom + 150 > innerHeight ? Math.max(8, rect.top - 142) : rect.bottom + 4 })
  }
  useEffect(() => {
    if (!position) return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false) }
    const dismiss = () => close()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', dismiss) }
  }, [position])
  return <>
    <button ref={trigger} className={`quiet-button compact questionnaire-theme-toggle questionnaire-theme-choice-${value}`} type="button" aria-label="Choose questionnaire theme" aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? menuId : undefined} title="Choose Navy, Night / Dark or Light" onClick={() => position ? close() : open()}><ThemeIcon theme={value} /><span>{value === 'dark' ? 'Night' : labels[value]}</span><span aria-hidden="true">⌄</span></button>
    {position && createPortal(<div ref={menu} id={menuId} className="questionnaire-theme-menu" role="menu" aria-label="Questionnaire theme" style={position} onKeyDown={event => {
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'Tab') close(false)
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next].focus()
      }
    }}>{choices.map(choice => <button key={choice} role="menuitemradio" type="button" aria-label={`Use ${choice} questionnaire theme`} aria-checked={value === choice} onClick={() => { onChange(choice); close() }}><span className={`questionnaire-theme-symbol questionnaire-theme-choice-${choice}`}><ThemeIcon theme={choice} /></span><span>{labels[choice]}</span><span aria-hidden="true">{value === choice ? '✓' : ''}</span></button>)}</div>, document.body)}
  </>
}
