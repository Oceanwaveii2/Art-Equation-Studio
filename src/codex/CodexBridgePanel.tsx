import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { inspectApp, type AppInspectionContext } from './appInspection'
import { diagnosticsSnapshot } from '../diagnostics/performance'
import './codexBridge.css'

type Model = { id: string; model: string; displayName: string; isDefault: boolean }
type Status = { connected: boolean; signedIn: boolean; generation: string; models: Model[]; plan?: string }
type Event = { generation: string; kind: string; data: { requestId?: string; tool?: string; arguments?: unknown; text?: string; status?: string; message?: string } }
export function useCodexBridge(getContext: () => AppInspectionContext) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false), [working, setWorking] = useState(false)
  const [error, setError] = useState(''), [answer, setAnswer] = useState(''), [prompt, setPrompt] = useState(''), [model, setModel] = useState('')
  const generation = useRef(''), context = useRef(getContext)
  const [eventsReady, setEventsReady] = useState(false)
  const [autoStart, setAutoStartState] = useState(() => {
    try { return localStorage.getItem('art-equation.codex.autoStart') !== 'false' } catch { return true }
  })
  function setAutoStart(value: boolean) {
    try { localStorage.setItem('art-equation.codex.autoStart', String(value)) } catch { /* Session preference still applies. */ }
    setAutoStartState(value)
  }
  const actionBusy = useRef(false), ready = useRef(false), mounted = useRef(true)
  context.current = getContext
  useEffect(() => {
    mounted.current = true
    if (!isTauri()) return
    let disposed = false, unlisten: (() => void) | undefined
    void listen<Event>('codex-bridge', ({ payload }) => {
      if (disposed || payload.generation !== generation.current) return
      if (payload.kind === 'tool') {
        let data: unknown, success = true
        try { data = inspectApp(context.current(), payload.data.tool || '', payload.data.arguments, payload.data.tool === 'art_app_status' || ((payload.data.arguments as {domain?:string;id?:string})?.domain === 'telemetry' && !(payload.data.arguments as {id?:string})?.id) ? diagnosticsSnapshot() : undefined) }
        catch (problem) { success = false; data = { error: problem instanceof Error ? problem.message : 'App data unavailable' } }
        void invoke('codex_tool_reply', { generation: payload.generation, requestId: payload.data.requestId, data, success }).catch(() => undefined)
      } else if (payload.kind === 'delta') setAnswer(value => (value + (payload.data.text || '')).slice(0, 64_000))
      else if (payload.kind === 'answer') setAnswer((payload.data.text || '').slice(0, 64_000))
      else if (payload.kind === 'completed') { setWorking(false); if (payload.data.status !== 'completed') setError(`Codex turn ${payload.data.status || 'ended'}.`) }
      else if (payload.kind === 'closed') { generation.current = ''; setStatus(null); setWorking(false); setError('Codex disconnected. Reconnect to continue.') }
      else if (payload.kind === 'error') setError(payload.data.message || 'Codex request failed')
      else if (payload.kind === 'login') void refresh()
    }).then(stop => { if (disposed) stop(); else { unlisten = stop; ready.current = true; setEventsReady(true) } }).catch(() => { setError('Could not register Codex connection events') })
    let stopInspection: (()=>void) | undefined
    void listen<{requestId:string;tool:string;arguments:unknown}>('app-inspection-request', ({payload})=>{
      if(disposed)return
      let data:unknown
      try { data=inspectApp(context.current(),payload.tool,payload.arguments,payload.tool==='art_app_status'||((payload.arguments as {domain?:string;id?:string})?.domain==='telemetry' && !(payload.arguments as {id?:string})?.id)?diagnosticsSnapshot():undefined) }
      catch(problem){data={error:problem instanceof Error?problem.message:'App data unavailable'}}
      void invoke('app_inspection_reply',{requestId:payload.requestId,data}).catch(()=>undefined)
    }).then(stop=>{if(disposed)stop();else stopInspection=stop}).catch(()=>setError('Live app inspection listener unavailable'))
    return () => { disposed = true; mounted.current = false; ready.current = false; unlisten?.(); stopInspection?.() }
  }, [])
  useEffect(() => {
    if (!isTauri() || !eventsReady || !autoStart || getCurrentWindow().label !== 'main') return
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    async function start() {
      if (cancelled) return
      if (actionBusy.current) { timer = setTimeout(() => void start(), 1000); return }
      actionBusy.current = true; setBusy(true); setError('')
      try {
        const value = await invoke<Status>('codex_connect')
        if (!cancelled) accept(value)
      } catch (problem) {
        if (!cancelled) {
          setError(String(problem))
          // Bounded retries prevent a compatibility failure from spawning continuously.
          if (++attempts < 3) timer = setTimeout(() => void start(), attempts === 1 ? 5000 : 15000)
        }
      } finally {
        actionBusy.current = false
        if (mounted.current) setBusy(false)
      }
    }
    void start()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [eventsReady, autoStart])
  function accept(value: Status) {
    if (!mounted.current) return
    generation.current = value.generation; setStatus(value)
    setModel(previous => value.models.some(row => row.model === previous) ? previous : (value.models.find(row => row.isDefault) || value.models[0])?.model || '')
  }
  async function action(work: () => Promise<void>) {
    if (actionBusy.current) return
    actionBusy.current = true; setBusy(true); setError('')
    try { await work() } catch (problem) { if (mounted.current) setError(String(problem)) }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  async function refresh() { try { accept(await invoke<Status>('codex_status')) } catch (problem) { setError(String(problem)) } }
  return { status, busy, working, error, answer, prompt, model, setPrompt, setModel, autoStart, setAutoStart, native: isTauri(),
    connect: () => action(async () => { if (!ready.current) throw new Error('Connection events are not ready. Try again.'); accept(await invoke<Status>('codex_connect')) }),
    refresh: () => action(refresh),
    login: () => action(async () => { const url = await invoke<string>('codex_login'); await openUrl(url) }),
    disconnect: () => action(async () => { setAutoStart(false); await invoke('codex_disconnect'); generation.current = ''; setStatus(null); setWorking(false); setError('') }),
    ask: () => action(async () => {
      setAnswer(''); setWorking(true)
      try { await invoke('codex_ask', { prompt, model }) } catch (problem) { setWorking(false); throw problem }
    }),
    cancel: () => action(async () => { await invoke('codex_cancel') }) }
}
export function CodexBridgePanel({ bridge: b }: { bridge: ReturnType<typeof useCodexBridge> }) {
  return <section className="codex-bridge-settings" aria-label="Codex app inspection">
    <h2>Codex app inspection</h2>
    <small>Codex starts with the app and can inspect current project data, UI state, retained telemetry, native logs and this build’s architecture/source snapshot through live tools. Reads use current app state; large records are paginated. Inspection is read-only. Model questions run when you ask.</small>
    {!b.native ? <p>Available in the desktop app.</p> : <>
      <label><span>Start Codex automatically</span><input type="checkbox" checked={b.autoStart} disabled={b.busy || b.working} onChange={event => b.setAutoStart(event.target.checked)} /></label>
      <div className="settings-readout"><span>Connection</span><strong>{b.status ? b.status.signedIn ? 'Connected · ChatGPT' : 'Connected · sign-in required' : 'Disconnected'}</strong></div>
      <div className="codex-bridge-actions">
        {!b.status ? <button type="button" disabled={b.busy} onClick={() => void b.connect()}>Connect Codex</button> : <>
          {!b.status.signedIn && <button type="button" disabled={b.busy} onClick={() => void b.login()}>Sign in with ChatGPT</button>}
          <button type="button" disabled={b.busy || b.working} onClick={() => void b.refresh()}>Refresh connection</button>
          <button type="button" disabled={b.busy} onClick={() => void b.disconnect()}>Disconnect Codex</button>
        </>}
      </div>
      {b.status && <>
        <label><span>Inspection model</span><select aria-label="Codex inspection model" value={b.model} disabled={b.busy || b.working} onChange={event => b.setModel(event.target.value)}>{b.status.models.map(row => <option key={row.id} value={row.model}>{row.displayName || row.model}</option>)}</select></label>
        <label className="codex-bridge-question"><span>Question about this app</span><textarea aria-label="Question for Codex" value={b.prompt} maxLength={16_000} onChange={event => b.setPrompt(event.target.value)} placeholder="Inspect this board and explain its connector scaling." /></label>
        <div className="codex-bridge-actions"><button type="button" disabled={b.busy || b.working || !b.status.signedIn || !b.model || !b.prompt.trim()} onClick={() => void b.ask()}>Ask Codex</button>{b.working && <button type="button" disabled={b.busy} onClick={() => void b.cancel()}>Cancel question</button>}</div>
      </>}
    </>}
    {b.error && <p role="alert">{b.error}</p>}
    {b.working && <p role="status">Codex is inspecting the app…</p>}
    {b.answer && <div className="codex-bridge-answer" aria-label="Codex inspection answer">{b.answer}</div>}
  </section>
}
