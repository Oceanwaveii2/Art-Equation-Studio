import { installDiagnostics, recordMetric } from './diagnostics/performance'
import { Component, Profiler, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import App from './App.tsx'
import './glass.css'
import './p1V2Shell.css'
import './ui/WorkspaceChrome.css'

function recordDiagnostic(kind: string, value: unknown) {
  const message = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ''}` : String(value)
  void invoke('record_frontend_diagnostic', { message: `${kind}: ${message}` }).catch(() => undefined)
}

installDiagnostics()

window.addEventListener('error', (event) => recordDiagnostic('window.error', event.error || event.message))
window.addEventListener('unhandledrejection', (event) => recordDiagnostic('unhandledrejection', event.reason))

class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDiagnostic('react.render', `${error.name}: ${error.message}\n${error.stack || ''}\n${info.componentStack || ''}`)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error" role="alert">
      <span>ART EQUATION / RECOVERY</span>
      <h1>The workspace interface could not finish loading.</h1>
      <p>Your portable project files were not deleted. A diagnostic was written to the <strong>logs</strong> folder beside the application.</p>
      <pre>{this.state.error.message}</pre>
      <button type="button" onClick={() => window.location.reload()}>Reload workspace</button>
    </main>
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><Profiler id="workspace" onRender={(_id, phase, actualDuration, baseDuration) => { if (actualDuration > 8) recordMetric('react.commit', { phase, actualMs: Math.round(actualDuration), baseMs: Math.round(baseDuration) }) }}><App /></Profiler></AppErrorBoundary>
  </StrictMode>,
)
