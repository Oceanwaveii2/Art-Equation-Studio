import { requestAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useRef, useState } from 'react'

export type WorkspaceItem = { key: string; kind: 'board' | 'document'; id: string; title: string }

/** Open-work navigation only. Closing a tab never edits or deletes project data. */
export function WorkspaceTabs({ items, activeKey, onOpen }: {
  items: WorkspaceItem[]; activeKey: string; onOpen: (item: WorkspaceItem) => void
}) {
  const [opened, setOpened] = useState<string[]>([activeKey])
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    setOpened(previous => previous.includes(activeKey) ? previous : [...previous, activeKey])
  }, [activeKey])
  const lookup = new Map(items.map(item => [item.key, item]))
  const keys = [...new Set([...opened, activeKey])].filter(key => lookup.has(key))
  const focus = (key: string) => requestAppFrame(() => {
    const tab = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [])].find(button => button.dataset.workspaceKey === key)
    tab?.focus(); tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
  function close(key: string) {
    if (keys.length < 2) return
    const index = keys.indexOf(key)
    const remaining = keys.filter(candidate => candidate !== key)
    const next = key === activeKey ? remaining[Math.min(index, remaining.length - 1)] : activeKey
    setOpened(remaining)
    if (key === activeKey) onOpen(lookup.get(next)!)
    focus(next)
  }
  return <nav ref={root} className="workspace-tabs" aria-label="Open workspace items">
    <div className="workspace-tab-list" role="tablist" aria-label="Open boards and documents">
      {keys.map(key => {
        const item = lookup.get(key)!
        return <button className={`workspace-tab ${key === activeKey ? 'active' : ''}`} key={key} type="button" role="tab" data-workspace-key={key} id={`workspace-tab-${item.kind}-${item.id}`} aria-controls="workspace-surface" aria-selected={key === activeKey} tabIndex={key === activeKey ? 0 : -1} title={`${item.kind === 'board' ? 'Board' : 'Document'} · ${item.title}`} onClick={() => onOpen(item)} onKeyDown={event => {
            const index = keys.indexOf(key)
            const next = event.key === 'ArrowRight' ? (index + 1) % keys.length
              : event.key === 'ArrowLeft' ? (index + keys.length - 1) % keys.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : undefined
            if (next !== undefined) { event.preventDefault(); onOpen(lookup.get(keys[next])!); focus(keys[next]) }
            else if (event.key === 'Delete') { event.preventDefault(); close(key) }
          }}><span aria-hidden="true">{item.kind === 'board' ? '▧' : '¶'}</span><span>{item.title}</span></button>
      })}
    </div>
    <button className="workspace-tab-close" type="button" disabled={keys.length < 2} aria-label={`Close tab ${lookup.get(activeKey)?.title || ''}`} title="Close active tab · Delete while a tab is focused · leaves the item in your project" onClick={() => close(activeKey)}>×</button>
  </nav>
}
