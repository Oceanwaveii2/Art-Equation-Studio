import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

// Bridge to the Eclipse DEV Miner local service (01_Mining_App/dev_miner).
// UI-only integration per MINER_UI_ON_ART_EQUATION_STUDIO_WORK_ORDER_2026-09-09:
// the service keeps owning jobs, lanes, and the engine queue; the studio only
// opens it as a shell window and sends canvas captures to it.

const MINER_BASE = 'http://127.0.0.1:8765'
const MINER_WINDOW = 'eclipse-miner'

export async function minerOnline(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${MINER_BASE}/api/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

export function openMinerWindow(): void {
  // Same pattern as openViewOnlyBoard: native webview when available,
  // browser tab as a fallback outside the Tauri shell.
  try {
    new WebviewWindow(MINER_WINDOW, { url: MINER_BASE, title: 'Eclipse DEV Miner', width: 1360, height: 900 })
  } catch {
    window.open(MINER_BASE, '_blank', 'noopener')
  }
}

export type MinerCaptureSource = {
  sourceLabel?: string
  author?: string
  sourceUrl?: string
  kind?: string
  articleHtml?: string
  commentsHtml?: string
  transcriptHtml?: string
}

function htmlToText(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  return container.textContent?.trim() || ''
}

/** Send a canvas capture card to the miner as a markdown document job. */
export async function ingestCapture(title: string, source: MinerCaptureSource): Promise<string> {
  const lines = [
    `# ${title}`,
    '',
    `- Captured from: ${source.sourceLabel || 'Art Equation Studio canvas'}`,
    `- Author: ${source.author || 'unknown'}`,
    `- Source URL: ${source.sourceUrl || '(none saved)'}`,
    `- Capture kind: ${source.kind || 'capture'}`,
    '- Imported by: Art Equation Studio "Mine this capture" (2026-09-09)',
    '',
  ]
  const section = (heading: string, html?: string) => {
    const text = html ? htmlToText(html) : ''
    if (text) lines.push(`## ${heading}`, '', text, '')
  }
  section('Article / caption', source.articleHtml)
  section('Comments', source.commentsHtml)
  section('Transcript', source.transcriptHtml)

  const fileName = `${title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().slice(0, 60) || 'capture'}.md`
  const form = new FormData()
  form.append('file', new Blob([lines.join('\n')], { type: 'text/markdown' }), fileName)
  form.append('name', title)
  const response = await fetch(`${MINER_BASE}/api/jobs`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`miner service rejected the capture (${response.status})`)
  const payload = (await response.json()) as { job?: string }
  return payload.job || title
}
