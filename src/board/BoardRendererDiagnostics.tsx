import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export type BoardRendererSnapshot = {
  state: 'loading' | 'ready' | 'fallback' | 'unknown'
  renderer: string | null
  rawState: string | null
  detail: string
  error: string | null
}

const unknown = (detail: string): BoardRendererSnapshot => ({ state: 'unknown', renderer: null, rawState: null, detail, error: null })

function reportedAttribute(host: HTMLElement, name: string, limit: number) {
  const value = host.getAttribute(name)?.trim()
  return value ? value.length > limit ? value.slice(0, limit) + '…' : value : null
}

function visible(element: HTMLElement) {
  if (element.hidden || !element.getClientRects().length) return false
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse'
}

/** Observe only the production backdrop directly owned by this visible canvas.
 * A configured edition, nested media renderer or hidden old host cannot prove readiness.
 */
export function readBoardRendererDiagnostics(stage: HTMLElement | null): BoardRendererSnapshot {
  if (!stage?.matches('.canvas-stage')) return unknown('Current canvas is unavailable.')
  const pane = stage.closest<HTMLElement>('.canvas-pane')
  if (!pane || !visible(pane) || !visible(stage)) return unknown('Current canvas is hidden.')
  const hosts = Array.from(stage.children).filter((child) => child.matches('.gpu-board') && visible(child as HTMLElement)) as HTMLElement[]
  if (hosts.length !== 1) return unknown(hosts.length ? 'Multiple visible backdrop hosts; readiness is ambiguous.' : 'No visible reporting backdrop in this canvas.')
  const host = hosts[0]
  const rawState = reportedAttribute(host, 'data-render-state', 48)
  const renderer = reportedAttribute(host, 'data-renderer', 80)
  const error = reportedAttribute(host, 'data-render-error', 600)
  const retainedError = reportedAttribute(host, 'data-retained-fallback', 600)
  const result: BoardRendererSnapshot = { state: 'unknown', renderer, rawState, detail: 'Backdrop has not reported readiness.', error: error || retainedError }
  if (rawState === 'loading' || rawState === 'scheduled') {
    result.state = 'loading'; result.detail = rawState === 'scheduled' ? 'Render scheduled.' : 'Render loading.'
  } else if (rawState === 'fallback' || rawState === 'context-lost' || retainedError || (!rawState && error)) {
    result.state = 'fallback'; result.detail = rawState === 'context-lost' ? 'WebGL context lost.' : retainedError ? 'Retained content reported fallback.' : 'Backdrop reported fallback.'
  } else if (rawState === 'ready' && renderer === 'vello-webgpu') {
    result.state = 'ready'; result.detail = 'Vello host reports ready.'
  } else if (rawState === 'idle') {
    let renders = 0
    try { renders = JSON.parse(host.getAttribute('data-render-metrics') || '{}').renders } catch { /* Unknown metrics cannot establish a completed render. */ }
    if (Number.isFinite(renders) && renders > 0) {
      result.state = 'ready'; result.detail = 'Host idle after a reported render.'
    } else result.detail = 'Host idle; completed render is unreported.'
  } else if (rawState) result.detail = `Host state: ${rawState}. Readiness is unreported.`
  return result
}

/** Track lazy mounting, replacement, removal and host reports without polling or
 * changing renderer state. Cleanup rejects even already queued observer callbacks.
 */
export function observeBoardRendererDiagnostics(stage: HTMLElement | null, publish: (value: BoardRendererSnapshot) => void) {
  let active = true
  let previous = ''
  const refresh = () => {
    if (!active) return
    const snapshot = readBoardRendererDiagnostics(stage)
    const key = JSON.stringify(snapshot)
    if (key !== previous) { previous = key; publish(snapshot) }
  }
  refresh()
  const view = stage?.ownerDocument.defaultView
  if (!stage || !view) return () => { active = false }
  const pane = stage.closest<HTMLElement>('.canvas-pane')
  const observer = new view.MutationObserver((records) => {
    if (records.some((record) => record.type === 'childList' || record.target === stage || record.target === pane || (record.target as Element).matches?.('.gpu-board'))) refresh()
  })
  observer.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-render-state', 'data-renderer', 'data-render-error', 'data-retained-fallback', 'data-render-metrics', 'hidden', 'class', 'style'] })
  if (pane) observer.observe(pane, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] })
  view.addEventListener('resize', refresh)
  return () => { active = false; observer.disconnect(); view.removeEventListener('resize', refresh) }
}

export function BoardRendererDiagnosticRows({ configuredRenderer, snapshot }: { configuredRenderer: string, snapshot: BoardRendererSnapshot }) {
  const state = snapshot.state[0].toUpperCase() + snapshot.state.slice(1)
  return <>
    <div><dt>Renderer configuration</dt><dd>{configuredRenderer}</dd></div>
    <div><dt>Backdrop status</dt><dd data-observed-render-state={snapshot.state}>{state} · {snapshot.renderer === 'vello-webgpu' ? 'Vello WebGPU' : snapshot.renderer || 'Renderer unreported'}</dd></div>
    <div><dt>Renderer observation</dt><dd>{snapshot.detail}</dd></div>
    {snapshot.error && <div><dt>Last reported renderer error</dt><dd style={{ overflowWrap: 'anywhere' }}>{snapshot.error}</dd></div>}
  </>
}

export function BoardRendererDiagnostics({ stageRef, configuredRenderer }: { stageRef: RefObject<HTMLDivElement | null>, configuredRenderer: string }) {
  const [snapshot, setSnapshot] = useState<BoardRendererSnapshot>(() => unknown('Renderer observation is starting.'))
  useEffect(() => observeBoardRendererDiagnostics(stageRef.current, setSnapshot), [stageRef])
  return <BoardRendererDiagnosticRows configuredRenderer={configuredRenderer} snapshot={snapshot} />
}
