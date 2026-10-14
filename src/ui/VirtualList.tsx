import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { appUpdateClock, requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { virtualRange } from './virtualRange'

function scrollOwner(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return document.documentElement
}
/** Keeps small lists unchanged. Large lists share their existing scroll owner;
 * no nested scrollbars. Focus stays mounted and keyboard traversal reveals the
 * next row before focus moves. No document data or ordering is discarded. */
export function VirtualList<T>({ items, itemKey, renderItem, label, estimate = 42, tree = false }: {
  items: readonly T[]; itemKey: (item: T) => string; renderItem: (item: T, index: number) => ReactNode; label: string; estimate?: number; tree?: boolean
}) {
  const root = useRef<HTMLDivElement>(null), owner = useRef<HTMLElement | null>(null)
  const heights = useRef(new Map<string, number>())
  const origin = useRef(0), queued = useRef<number | undefined>(undefined)
  const [view, setView] = useState({ top: 0, height: 600, revision: 0 })
  const [focused, setFocused] = useState<string | undefined>(undefined)
  const keys = items.map(itemKey), keyStamp = keys.join('\n'), large = items.length > 80
  const range = useMemo(() => virtualRange(keys.map(key => heights.current.get(key) || estimate), view.top, view.height), [keyStamp, view, estimate])
  useLayoutEffect(() => {
    const host = root.current; if (!host || !large) return
    const parent = scrollOwner(host); owner.current = parent
    const refresh = () => {
      const top = Math.max(0, parent.scrollTop - origin.current)
      const height = parent.clientHeight || window.innerHeight
      setView(previous => previous.top === top && previous.height === height ? previous : { ...previous, top, height })
    }
    const measure = () => {
      // Only layout invalidation reads geometry. Scroll uses the cached origin.
      origin.current = host.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
      refresh()
    }
    const scroll = () => { if (queued.current === undefined) queued.current = requestAppFrame(() => { queued.current = undefined; refresh() }) }
    let resizeFrame: number | undefined
    const scheduleMeasure = () => {
      if (resizeFrame === undefined) resizeFrame = appUpdateClock.request(() => { resizeFrame = undefined; measure() })
    }
    const resize = new ResizeObserver(scheduleMeasure)
    resize.observe(parent); resize.observe(host); measure()
    parent.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', scheduleMeasure)
    return () => {
      resize.disconnect(); parent.removeEventListener('scroll', scroll); window.removeEventListener('resize', scheduleMeasure)
      if (resizeFrame !== undefined) cancelAppFrame(resizeFrame)
      if (queued.current !== undefined) cancelAppFrame(queued.current)
      queued.current = undefined; owner.current = null
    }
  }, [large])
  useLayoutEffect(() => {
    const host = root.current; if (!host || !large) return
    let notification: number | undefined
    const sizes = new Map<string, number>()
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualKey
        const size = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (key && size > 0) sizes.set(key, size)
      }
      // Publish after observer delivery, avoiding synchronous layout feedback.
      if (notification === undefined) notification = appUpdateClock.request(() => {
        notification = undefined
        let changed = false
        for (const [key, size] of sizes) {
          if (Math.abs((heights.current.get(key) || estimate) - size) > .5) { heights.current.set(key, size); changed = true }
        }
        sizes.clear()
        if (changed) setView(previous => ({ ...previous, revision: previous.revision + 1 }))
      })
    })
    host.querySelectorAll<HTMLElement>('[data-virtual-key]').forEach(row => observer.observe(row))
    const valid = new Set(keys); for (const key of heights.current.keys()) if (!valid.has(key)) heights.current.delete(key)
    return () => { observer.disconnect(); if (notification !== undefined) cancelAppFrame(notification) }
  }, [large, keyStamp, range.first, range.last, focused])
  const indexes = !large ? items.map((_, index) => index) : Array.from({ length: range.last - range.first }, (_, index) => index + range.first)
  const focusIndex = focused ? keys.indexOf(focused) : -1
  if (large && focusIndex >= 0 && !indexes.includes(focusIndex)) indexes.push(focusIndex)
  indexes.sort((a, b) => a - b)
  let previousEnd = 0
  return <div ref={root} role={tree ? 'tree' : 'list'} aria-label={label} data-virtual-total={items.length} data-virtual-mounted={indexes.length}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(undefined) }}
    onKeyDown={event => {
      if (event.defaultPrevented || !large || !['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      if (event.key !== 'Tab' && (event.target as HTMLElement).closest('input,select,textarea,[contenteditable]')) return
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]'); if (!row) return
      const index = Number(row.dataset.virtualIndex), controls = [...row.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')]
      const backward = event.shiftKey || event.key === 'ArrowUp'
      if (event.key === 'Tab' && event.target !== controls[backward ? 0 : controls.length - 1]) return
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (backward ? -1 : 1)
      if (next < 0 || next >= items.length) return
      event.preventDefault(); setFocused(keys[next])
      const parent = owner.current
      if (parent) parent.scrollTop = origin.current + range.offsets[next]
      requestAppFrame(() => {
        const target = root.current?.querySelector<HTMLElement>(`[data-virtual-index="${next}"]`)
        const buttons = target?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')
        buttons?.[backward ? buttons.length - 1 : 0]?.focus()
      })
    }}>
    {indexes.map(index => {
      const gap = large ? Math.max(0, range.offsets[index] - previousEnd) : 0
      previousEnd = range.offsets[index + 1]
      return <div key={keys[index]} style={{ paddingTop: gap }}>
        <div role={tree ? 'none' : 'listitem'} style={{display:'flow-root'}} aria-posinset={tree ? undefined : index + 1} aria-setsize={tree ? undefined : items.length} data-virtual-key={keys[index]} data-virtual-index={index} onFocus={() => setFocused(keys[index])}>
          {renderItem(items[index], index)}
        </div>
      </div>
    })}
    {large && <div style={{ height: Math.max(0, range.total - previousEnd) }} />}
  </div>
}
