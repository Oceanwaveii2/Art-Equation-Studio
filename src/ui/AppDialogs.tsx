import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useModalFocus } from './useModalFocus'

type Request = { id: number; title: string; message: string; confirmLabel: string; cancelLabel?: string; resolve: (accepted: boolean) => void }
const queue: Request[] = []
const listeners = new Set<() => void>()
let nextId = 1
const notify = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => queue[0] || null

/** Bounded, serial requests: a second error never replaces a pending safety decision. */
export function appConfirm(message: string, options: { title?: string; confirmLabel?: string } = {}): Promise<boolean> {
  if (queue.length >= 16) return Promise.resolve(false)
  return new Promise((resolve) => { queue.push({ id: nextId++, title: options.title || 'Confirm action', message, confirmLabel: options.confirmLabel || 'Continue', cancelLabel: 'Cancel', resolve }); notify() })
}
export function appAlert(message: string, title = 'Action could not finish'): void {
  if (queue.length >= 16) return
  queue.push({ id: nextId++, title, message, confirmLabel: 'Close', resolve: () => undefined }); notify()
}
function finish(id: number, accepted: boolean) {
  if (queue[0]?.id !== id) return
  const request = queue.shift()!
  notify(); request.resolve(accepted)
}

export function AppDialogHost({ onActiveChange }: { onActiveChange: (active: boolean) => void }) {
  const request = useSyncExternalStore(subscribe, snapshot, () => null)
  useEffect(() => { onActiveChange(Boolean(request)) }, [request, onActiveChange])
  return request ? <DecisionDialog key={request.id} request={request} /> : null
}
function DecisionDialog({ request }: { request: Request }) {
  const dialog = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null)
  useModalFocus(dialog, cancel)
  return <div className="text-entry-backdrop app-decision-backdrop" onPointerDown={(event) => { event.stopPropagation() }}>
    <div ref={dialog} className="text-entry-dialog app-decision-dialog" role={request.cancelLabel ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={`decision-title-${request.id}`} aria-describedby={`decision-message-${request.id}`} tabIndex={-1} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finish(request.id, false) } }}>
      <header><span>ART EQUATION</span><button type="button" aria-label="Close dialog" onClick={() => finish(request.id, false)}>×</button></header>
      <h2 id={`decision-title-${request.id}`}>{request.title}</h2>
      <p id={`decision-message-${request.id}`} className="app-decision-message">{request.message}</p>
      <footer>{request.cancelLabel && <button ref={cancel} type="button" className="quiet-button" onClick={() => finish(request.id, false)}>{request.cancelLabel}</button>}<button ref={request.cancelLabel ? undefined : cancel} type="button" className="primary-button" onClick={() => finish(request.id, true)}>{request.confirmLabel}</button></footer>
    </div>
  </div>
}
