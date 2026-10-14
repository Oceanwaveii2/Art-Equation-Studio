import { useEffect, useMemo, useRef } from 'react'
import type { ProjectModel } from '../model/project'
import { searchProject, type ProjectSearchKind } from './projectSearchModel'
export type { ProjectSearchKind } from './projectSearchModel'

type SearchProps = {
  project: ProjectModel
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (kind: ProjectSearchKind, id: string, nodeId?: string) => void
  searchOriginTitle?: string
  onReturn?: () => void
}

export function ProjectSearch({ project, query, onQueryChange, onNavigate, searchOriginTitle, onReturn }: SearchProps) {
  const results = useMemo(() => searchProject(project, query), [project, query])
  const container = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!query.trim()) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target)) onQueryChange('') }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [query, onQueryChange])
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (query.trim()) {
        onQueryChange('')
        input.current?.focus()
      } else if (onReturn) {
        onReturn()
      }
      return
    }
    const buttons = [...(container.current?.querySelectorAll<HTMLButtonElement>('.project-search-results button') || [])]
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, index + 1)
    if (event.key === 'ArrowUp') { if (index <= 0) { event.preventDefault(); input.current?.focus(); return }; next = index - 1 }
    if (index >= 0 && event.key === 'Home') next = 0
    if (index >= 0 && event.key === 'End') next = buttons.length - 1
    if (next !== undefined) { event.preventDefault(); buttons[next].focus() }
  }
  return <div className={`project-search ${searchOriginTitle ? 'has-return' : ''}`} ref={container} onKeyDown={keys}>
    {searchOriginTitle && onReturn && (
      <button
        className="project-search-return"
        type="button"
        onClick={onReturn}
        title={`Return to ${searchOriginTitle} (Esc)`}
        aria-label={`Return to ${searchOriginTitle}`}
      >
        <span className="return-arrow" aria-hidden="true">↩</span>
        <span className="return-label">Return to <strong>{searchOriginTitle}</strong></span>
      </button>
    )}
    <input ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search project…" aria-label="Search project" aria-describedby="project-search-scope" aria-controls={query.trim() ? 'project-search-results' : undefined} />
    <span className="project-search-scope" id="project-search-scope">This project</span>
    {query.trim() && <div className="project-search-results" id="project-search-results" role="region" aria-label="Project search results">
      <span className="sr-only" role="status">{results.length ? results.length + ' project matches' : 'No project matches'}</span>
      {results.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{results.map((result) => <li key={result.key}><button type="button" onClick={() => onNavigate(result.kind, result.id, result.nodeId)}><strong>{result.title}</strong><small>{result.context}</small></button></li>)}</ul> : <p>No project matches.</p>}
    </div>}
  </div>
}
