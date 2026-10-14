import React, { useState, useEffect } from 'react'
import { geminiStore } from './geminiStore.ts'
import './geminiBridge.css'

export function useGeminiStore() {
  const [, setTick] = useState(0)

  useEffect(() => {
    return geminiStore.subscribe(() => {
      setTick(t => t + 1)
    })
  }, [])

  return {
    bugs: geminiStore.getBugs(),
    feedback: geminiStore.getFeedbackLog(),
    status: geminiStore.getStatus(),
    trackBug: geminiStore.trackBug.bind(geminiStore),
    updateBugStatus: geminiStore.updateBugStatus.bind(geminiStore),
    clearResolvedBugs: geminiStore.clearResolvedBugs.bind(geminiStore),
    addFeedback: geminiStore.addFeedback.bind(geminiStore),
    clearFeedback: geminiStore.clearFeedback.bind(geminiStore),
  }
}

interface GeminiBridgePanelProps {
  activeBoardId?: string
  onInjectNote?: (boardId: string, title: string, content: string) => void
  onExportProjectSnapshot?: () => void
}

export const GeminiBridgePanel: React.FC<GeminiBridgePanelProps> = ({
  activeBoardId,
  onInjectNote,
  onExportProjectSnapshot,
}) => {
  const store = useGeminiStore()
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newSeverity, setNewSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [newComponent, setNewComponent] = useState('canvas')
  const [showAddForm, setShowAddForm] = useState(false)
  const [copiedStatus, setCopiedStatus] = useState(false)

  const openBugs = store.bugs.filter(b => b.status === 'open')
  const investigatingBugs = store.bugs.filter(b => b.status === 'investigating')
  const resolvedBugs = store.bugs.filter(b => b.status === 'resolved')

  const handleAddBug = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return

    store.trackBug({
      title: newTitle.trim(),
      description: newDesc.trim(),
      component: newComponent,
      severity: newSeverity,
      reproductionSteps: [],
      status: 'open'
    })

    setNewTitle('')
    setNewDesc('')
    setShowAddForm(false)
  }

  const handleExportMarkdown = () => {
    const lines = [
      '# Art Equation - Tracked Bugs Report',
      `Generated: ${new Date().toISOString()}`,
      `Total Issues: ${store.bugs.length} (Open: ${openBugs.length}, Investigating: ${investigatingBugs.length}, Resolved: ${resolvedBugs.length})`,
      '',
      ...store.bugs.map(b => {
        return `### [${b.severity.toUpperCase()}] ${b.title} (${b.component})\n- **Status:** ${b.status}\n- **ID:** ${b.id}\n- **Description:** ${b.description || 'None'}\n${b.suggestedFix ? `- **Suggested Fix:** ${b.suggestedFix}\n` : ''}`
      })
    ]
    const text = lines.join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStatus(true)
      setTimeout(() => setCopiedStatus(false), 2000)
    }).catch(() => {})
  }

  const handleQuickInject = () => {
    if (onInjectNote && activeBoardId) {
      onInjectNote(
        activeBoardId,
        'Gemini Live Note',
        `Generated at ${new Date().toLocaleTimeString()}\nConnected via MCP Live Bridge.`
      )
      store.addFeedback({
        message: `Injected sample card onto active board [${activeBoardId}]`,
        level: 'success'
      })
    } else {
      store.addFeedback({
        message: 'No active board selected to inject data.',
        level: 'warning'
      })
    }
  }

  return (
    <div className="gemini-bridge-panel" aria-label="Gemini Live MCP Bridge">
      <header>
        <h2>Gemini Live MCP & Issue Tracker</h2>
        <small>
          Bidirectional integration bridge connecting Google Gemini and MCP tools directly to the Art Equation engine.
          Supports live model inspection, real-time feedback logging, and issue tracking across all levels.
        </small>
      </header>

      {/* Stats Summary */}
      <div className="gemini-stats-grid">
        <div className="gemini-stat-box">
          <span>Bridge Status</span>
          <strong style={{ color: '#86efac' }}>Active</strong>
        </div>
        <div className="gemini-stat-box">
          <span>Open Bugs</span>
          <strong style={{ color: openBugs.length ? '#fca5a5' : 'inherit' }}>{openBugs.length}</strong>
        </div>
        <div className="gemini-stat-box">
          <span>Investigating</span>
          <strong style={{ color: '#fde047' }}>{investigatingBugs.length}</strong>
        </div>
        <div className="gemini-stat-box">
          <span>Resolved</span>
          <strong style={{ color: '#86efac' }}>{resolvedBugs.length}</strong>
        </div>
      </div>

      {/* Control Actions */}
      <div className="gemini-actions-row">
        <button type="button" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel Add' : '+ Log Issue'}
        </button>
        <button type="button" onClick={handleQuickInject}>
          Inject Live Canvas Card
        </button>
        <button type="button" onClick={handleExportMarkdown}>
          {copiedStatus ? 'Copied Report!' : 'Export Bug Report'}
        </button>
        {resolvedBugs.length > 0 && (
          <button type="button" onClick={() => store.clearResolvedBugs()}>
            Clear Resolved
          </button>
        )}
        {onExportProjectSnapshot && (
          <button type="button" onClick={onExportProjectSnapshot}>
            Capture Diagnostics Snapshot
          </button>
        )}
      </div>

      {/* Quick Add Form */}
      {showAddForm && (
        <form className="gemini-bug-card" onSubmit={handleAddBug} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: '0.85rem' }}>Track New Issue</strong>
          <input
            type="text"
            placeholder="Issue summary / title"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
            required
          />
          <textarea
            placeholder="Detailed description & symptoms"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            style={{ minHeight: 60, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Component:
              <select
                value={newComponent}
                onChange={e => setNewComponent(e.target.value)}
                style={{ borderRadius: 4, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', padding: '2px 4px' }}
              >
                <option value="canvas">Canvas / Engine</option>
                <option value="vello">Vello GPU / CPU</option>
                <option value="ui">UI Shell / Controls</option>
                <option value="navigation">Navigation</option>
                <option value="export">Export / Media</option>
                <option value="persistence">Storage / Persistence</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Severity:
              <select
                value={newSeverity}
                onChange={e => setNewSeverity(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                style={{ borderRadius: 4, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', padding: '2px 4px' }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>
          <button type="submit" style={{ alignSelf: 'flex-start', padding: '4px 12px', background: 'var(--teal, #0ea5e9)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Save Issue
          </button>
        </form>
      )}

      {/* Subsections: Tracked Bugs & Feedback Feed */}
      <div className="gemini-subsections">
        {/* Tracked Bugs Section */}
        <div>
          <div className="gemini-section-header">
            <h3>Live Tracked Issues</h3>
            <span>{store.bugs.length} total</span>
          </div>
          {store.bugs.length === 0 ? (
            <div className="gemini-empty-hint">No active bugs tracked. Gemini or users can file issues in real time.</div>
          ) : (
            <div className="gemini-bug-list">
              {store.bugs.map(bug => (
                <div key={bug.id} className="gemini-bug-card">
                  <div className="gemini-bug-card-top">
                    <div className="gemini-bug-title-wrap">
                      <span className={`gemini-badge gemini-badge-${bug.severity}`}>{bug.severity}</span>
                      <span className="gemini-bug-title">{bug.title}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>[{bug.component}]</span>
                    </div>
                    <span className={`gemini-status-tag ${bug.status}`}>{bug.status}</span>
                  </div>

                  {bug.description && <div className="gemini-bug-desc">{bug.description}</div>}
                  {bug.suggestedFix && <div className="gemini-bug-fix">💡 Fix: {bug.suggestedFix}</div>}

                  <div className="gemini-bug-actions">
                    {bug.status !== 'investigating' && bug.status !== 'resolved' && (
                      <button type="button" onClick={() => store.updateBugStatus(bug.id, 'investigating')}>
                        Investigate
                      </button>
                    )}
                    {bug.status !== 'resolved' ? (
                      <button type="button" onClick={() => store.updateBugStatus(bug.id, 'resolved')}>
                        ✓ Mark Resolved
                      </button>
                    ) : (
                      <button type="button" onClick={() => store.updateBugStatus(bug.id, 'open')}>
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Feedback Feed */}
        <div>
          <div className="gemini-section-header">
            <h3>Real-Time Live Feedback Stream</h3>
            <button
              type="button"
              onClick={() => store.clearFeedback()}
              style={{ fontSize: '0.72rem', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              Clear Feed
            </button>
          </div>
          {store.feedback.length === 0 ? (
            <div className="gemini-empty-hint">No feedback events recorded yet.</div>
          ) : (
            <div className="gemini-feedback-feed">
              {store.feedback.map(item => (
                <div key={item.id} className={`gemini-feedback-item ${item.level}`}>
                  <div>{item.message}</div>
                  {item.suggestedAction && (
                    <div style={{ color: 'var(--teal, #38bdf8)', fontSize: '0.75rem' }}>
                      👉 {item.suggestedAction}
                    </div>
                  )}
                  <div className="gemini-feedback-meta">
                    <span>{item.level.toUpperCase()}</span>
                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
