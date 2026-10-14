import { useMemo, useState } from 'react'
import type { DailyTask, DailyWorksheet, ProjectModel, WorksheetLink } from '../model/project'
import './DailyWorksheets.css'

type Props = { project: ProjectModel; onChange: (worksheets: DailyWorksheet[]) => void; onClose: () => void }

const isoToday = () => new Date().toISOString().slice(0, 10)
const title = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

export function DailyWorksheets({ project, onChange, onClose }: Props) {
  const [date, setDate] = useState(isoToday)
  const [query, setQuery] = useState('')
  const worksheet = project.worksheets?.find((entry) => entry.date === date) || { date, tasks: [], notesHtml: '<p></p>', updatedAt: new Date().toISOString() }
  const links = useMemo<WorksheetLink[]>(() => [
    ...project.boards.map((entry) => ({ kind: 'board' as const, id: entry.id, label: `Board: ${entry.title}` })),
    ...project.documents.map((entry) => ({ kind: 'document' as const, id: entry.id, label: `Document: ${entry.title}` })),
    ...project.assets.map((entry) => ({ kind: 'asset' as const, id: entry.id, label: `File: ${entry.displayName}` })),
  ], [project])
  const matching = (project.worksheets || []).filter((entry) => !query || `${entry.date} ${entry.notesHtml} ${entry.tasks.map((task) => task.title).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const progress = worksheet.tasks.length ? Math.round(worksheet.tasks.filter((task) => task.completed).length / worksheet.tasks.length * 100) : 0
  const commit = (next: DailyWorksheet) => onChange([...(project.worksheets || []).filter((entry) => entry.date !== date), { ...next, updatedAt: new Date().toISOString() }].sort((a, b) => a.date.localeCompare(b.date)))
  const addTask = () => commit({ ...worksheet, tasks: [...worksheet.tasks, { id: crypto.randomUUID(), title: 'New task', completed: false, links: [] }] })
  const previous = [...(project.worksheets || [])].filter((entry) => entry.date < date).sort((a, b) => b.date.localeCompare(a.date))[0]
  const carry = () => previous && commit({ ...worksheet, tasks: [...worksheet.tasks, ...previous.tasks.filter((task) => !task.completed && !worksheet.tasks.some((current) => current.carriedFrom === task.id)).map((task) => ({ ...task, id: crypto.randomUUID(), completed: false, carriedFrom: task.id }))] })
  const exportRange = (print = false) => {
    const contents = matching.map((entry) => `<article><h2>${title(entry.date)}</h2><ul>${entry.tasks.map((task) => `<li>${task.completed ? '✓' : '○'} ${task.title}</li>`).join('')}</ul>${entry.notesHtml}</article>`).join('')
    const html = `<!doctype html><title>${project.title} worksheets</title><style>body{max-width:760px;margin:40px auto;font:16px system-ui}article{break-inside:avoid;border-bottom:1px solid #ccc;padding:16px 0}</style><h1>${project.title} — Daily worksheets</h1>${contents}`
    const blob = new Blob([html], { type: 'text/html' }); const url = URL.createObjectURL(blob)
    if (print) { const win = window.open(url, '_blank'); win?.addEventListener('load', () => win.print()) } else { const a = document.createElement('a'); a.href = url; a.download = `${project.title.replace(/[^a-z0-9]+/gi, '-')}-worksheets.html`; a.click() }
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const month = new Date(`${date}T12:00:00`); const days = Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, i) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
  return <div className="planner-backdrop"><section className="planner-dialog" aria-label="Daily worksheets"><header><div><span>PROJECT CALENDAR</span><h2>Daily worksheets</h2></div><button onClick={onClose}>×</button></header><div className="planner-toolbar"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search worksheets…" /><button onClick={() => exportRange()}>Export HTML</button><button onClick={() => exportRange(true)}>Print / PDF</button></div><div className="planner-layout"><aside><h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><div className="calendar-grid">{days.map((day) => { const entry = project.worksheets?.find((item) => item.date === day); const done = entry?.tasks.filter((task) => task.completed).length || 0; return <button className={day === date ? 'active' : ''} onClick={() => setDate(day)} key={day}>{Number(day.slice(-2))}{entry && <i style={{ '--progress': `${entry.tasks.length ? done / entry.tasks.length * 100 : 0}%` } as React.CSSProperties} />}</button> })}</div><h3>Search results</h3><div className="worksheet-search-results">{matching.slice(-12).reverse().map((entry) => <button key={entry.date} onClick={() => setDate(entry.date)}>{entry.date}<small>{entry.tasks.filter((task) => task.completed).length}/{entry.tasks.length} done</small></button>)}</div></aside><main><div className="worksheet-heading"><div><span>{title(date)}</span><strong>{progress}% complete</strong></div><div><button onClick={addTask}>＋ Task</button><button disabled={!previous || !previous.tasks.some((task) => !task.completed)} onClick={carry}>Carry unfinished</button></div></div><div className="task-list">{worksheet.tasks.map((task) => <TaskRow key={task.id} task={task} links={links} onChange={(next) => commit({ ...worksheet, tasks: worksheet.tasks.map((item) => item.id === task.id ? next : item) })} onDelete={() => commit({ ...worksheet, tasks: worksheet.tasks.filter((item) => item.id !== task.id) })} />)}</div><label className="daily-notes"><span>Rich daily notes</span><div contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: worksheet.notesHtml }} onBlur={(event) => commit({ ...worksheet, notesHtml: event.currentTarget.innerHTML })} /></label></main></div></section></div>
}

function TaskRow({ task, links, onChange, onDelete }: { task: DailyTask; links: WorksheetLink[]; onChange: (task: DailyTask) => void; onDelete: () => void }) {
  return <div className={`daily-task ${task.completed ? 'done' : ''}`}><input aria-label={`Complete ${task.title}`} type="checkbox" checked={task.completed} onChange={(event) => onChange({ ...task, completed: event.target.checked })} /><input value={task.title} onChange={(event) => onChange({ ...task, title: event.target.value })} /><select value="" aria-label="Link task" onChange={(event) => { const link = links.find((entry) => `${entry.kind}:${entry.id}` === event.target.value); if (link) onChange({ ...task, links: [...task.links, link] }); event.currentTarget.value = '' }}><option value="">Link…</option>{links.map((link) => <option key={`${link.kind}:${link.id}`} value={`${link.kind}:${link.id}`}>{link.label}</option>)}</select>{task.links.map((link) => <button className="task-link" title="Remove link" key={`${link.kind}:${link.id}`} onClick={() => onChange({ ...task, links: task.links.filter((entry) => entry !== link) })}>{link.label}</button>)}<button className="delete-task" onClick={onDelete}>×</button></div>
}
