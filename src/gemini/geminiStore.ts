/**
 * Gemini Live Bridge & Issue Tracker Store
 *
 * Provides real-time bidirectional state, issue tracking, and feedback logging
 * for deep Gemini MCP integration into Art Equation.
 */

export interface TrackedBug {
  id: string
  title: string
  description: string
  component: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  reproductionSteps: string[]
  suggestedFix?: string
  status: 'open' | 'investigating' | 'resolved'
  createdAt: string
  updatedAt: string
}

export interface GeminiFeedbackItem {
  id: string
  message: string
  level: 'info' | 'warning' | 'error' | 'success'
  suggestedAction?: string
  timestamp: string
}

class GeminiBridgeStore {
  private bugs: Map<string, TrackedBug> = new Map()
  private feedbackLog: GeminiFeedbackItem[] = []
  private listeners: Set<() => void> = new Set()
  private connectionStatus: {
    active: boolean
    port?: number
    pid?: number
    lastPing?: string
  } = { active: false }

  constructor() {
    // Seed initial system monitor
    this.addFeedback({
      message: 'Gemini Embedded Engine Bridge initialized. MCP inspection and mutation active.',
      level: 'info'
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const listener of this.listeners) {
      try { listener() } catch {}
    }
  }

  // --- Bug & Issue Tracking ---

  trackBug(bug: Omit<TrackedBug, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): TrackedBug {
    const id = bug.id || `bug-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const now = new Date().toISOString()
    const record: TrackedBug = {
      id,
      title: bug.title,
      description: bug.description,
      component: bug.component || 'general',
      severity: bug.severity || 'medium',
      reproductionSteps: bug.reproductionSteps || [],
      suggestedFix: bug.suggestedFix,
      status: bug.status || 'open',
      createdAt: now,
      updatedAt: now,
    }
    this.bugs.set(id, record)
    this.addFeedback({
      message: `[Tracked Bug] (${record.severity.toUpperCase()}) ${record.title} [${record.component}]`,
      level: record.severity === 'critical' || record.severity === 'high' ? 'error' : 'warning'
    })
    this.notify()
    return record
  }

  updateBugStatus(id: string, status: TrackedBug['status']): TrackedBug | undefined {
    const bug = this.bugs.get(id)
    if (!bug) return undefined
    bug.status = status
    bug.updatedAt = new Date().toISOString()
    this.addFeedback({
      message: `[Bug Updated] ${bug.title} -> ${status.toUpperCase()}`,
      level: status === 'resolved' ? 'success' : 'info'
    })
    this.notify()
    return bug
  }

  getBugs(): TrackedBug[] {
    return Array.from(this.bugs.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  clearResolvedBugs(): void {
    for (const [id, bug] of this.bugs.entries()) {
      if (bug.status === 'resolved') {
        this.bugs.delete(id)
      }
    }
    this.notify()
  }

  // --- Feedback Log ---

  addFeedback(item: { message: string; level?: 'info' | 'warning' | 'error' | 'success'; suggestedAction?: string }): GeminiFeedbackItem {
    const record: GeminiFeedbackItem = {
      id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message: item.message,
      level: item.level || 'info',
      suggestedAction: item.suggestedAction,
      timestamp: new Date().toISOString()
    }
    this.feedbackLog.push(record)
    if (this.feedbackLog.length > 200) {
      this.feedbackLog.shift()
    }
    this.notify()
    return record
  }

  getFeedbackLog(): GeminiFeedbackItem[] {
    return [...this.feedbackLog].reverse()
  }

  clearFeedback(): void {
    this.feedbackLog = []
    this.notify()
  }

  // --- Connection Status ---

  setConnection(status: { active: boolean; port?: number; pid?: number }) {
    this.connectionStatus = {
      ...status,
      lastPing: new Date().toISOString()
    }
    this.notify()
  }

  getConnection() {
    return { ...this.connectionStatus }
  }

  getStatus() {
    return this.getConnection()
  }
}

export const geminiStore = new GeminiBridgeStore()
