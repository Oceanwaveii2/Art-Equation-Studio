import { VirtualList } from '../ui/VirtualList'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BoardModel, BoardPoint, DiagramTemplate } from '../model/project'
import { mindMapBranchIds } from './diagramStructureCore'
import { captureDiagramTemplate, diagramObjectRows, instantiateDiagramTemplate, runDiagramWorkflow, type DiagramWorkflowCommand, type DiagramWorkflowResult } from './diagramWorkflow'

export type DiagramStructurePanelProps = {
  board: BoardModel
  selectedIds: readonly string[]
  templates: readonly DiagramTemplate[]
  origin: BoardPoint
  readOnly?: boolean
  onPublish: (board: BoardModel, selectedIds: string[]) => boolean
  onSaveTemplate: (template: DiagramTemplate) => boolean
  onSelect: (ids: string[]) => void
  onClose: () => void
}

/** A controlled nonmodal editing surface. Content and template persistence go
 * through the caller's existing publication/history; there is no local journal.
 */
export function DiagramStructurePanel({ board, selectedIds, templates, origin, readOnly = false, onPublish, onSaveTemplate, onSelect, onClose }: DiagramStructurePanelProps) {
  const labelId = useId(), helperId = useId(), createLabelRef = useRef<HTMLInputElement>(null)
  const [newTitle, setNewTitle] = useState('New idea')
  const [nodeLabel, setNodeLabel] = useState('')
  const [parentId, setParentId] = useState('')
  const [templateTitle, setTemplateTitle] = useState('My diagram')
  const [status, setStatus] = useState('')
  const selectedNode = board.nodes.find(node => node.id === selectedIds.at(-1))
  const rows = useMemo(() => diagramObjectRows(board.nodes), [board.nodes])
  const selectedRow = rows.ok ? rows.value.find(row => row.node.id === selectedNode?.id) : undefined
  const editable = !readOnly && selectedRow && !selectedRow.locked && !selectedRow.hidden
  const branch = selectedNode?.mindMap ? mindMapBranchIds(board.nodes, selectedNode.id) : undefined
  const descendants = new Set(branch?.ok ? branch.value : [])
  useEffect(() => { createLabelRef.current?.focus() }, [])
  useEffect(() => { setNodeLabel(selectedNode?.title || ''); setParentId('') }, [selectedNode?.id, selectedNode?.title])

  const namespace = () => `diagram-${crypto.randomUUID()}`
  function publish(result: ReturnType<typeof runDiagramWorkflow> | ReturnType<typeof instantiateDiagramTemplate>, successText: string) {
    if (!result.ok) { setStatus(result.issues[0]?.detail || 'The diagram command was cancelled.'); return false }
    if (!onPublish(result.value.board, result.value.selectedIds)) { setStatus('The board changed or an edit was refused. Your selection and diagram were kept.'); return false }
    setStatus(successText)
    return true
  }
  const run = (command: DiagramWorkflowCommand, text: string) => publish(runDiagramWorkflow(board, command, readOnly), text)
  const createBranch = (kind: 'add-child' | 'add-sibling') => {
    if (!selectedNode) return
    run({ kind, id: selectedNode.id, namespace: namespace(), title: newTitle }, kind === 'add-child' ? 'Child branch added.' : 'Sibling branch added.')
  }
  function saveTemplate() {
    if (readOnly) { setStatus('This workspace is read-only.'); return }
    const result = captureDiagramTemplate(board, selectedIds, `template-${crypto.randomUUID()}`, templateTitle)
    if (!result.ok) { setStatus(result.issues[0]?.detail || 'The template could not be captured.'); return }
    if (!onSaveTemplate(result.value)) { setStatus('The template was not saved; your diagram was kept.'); return }
    setStatus(`Saved ${result.value.title}: ${result.value.nodes.length} objects and ${result.value.connectors.length} internal connections. External links remain on the original board.`)
  }
  function enterBranch(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault(); event.stopPropagation()
    if (selectedNode?.mindMap) {
      if (!editable) { setStatus('Show and unlock the selected branch before editing it.'); return }
      createBranch(event.shiftKey ? 'add-sibling' : 'add-child')
    } else if (!event.shiftKey) run({ kind: 'new-root', title: newTitle, namespace: namespace(), origin }, 'Mind-map root added.')
  }

  return <aside className="diagram-structure-panel" aria-label="Diagram structure" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header>
      <h2 id={labelId}>Diagram structure</h2>
      <button type="button" aria-label="Close diagram structure" onClick={onClose}>Close</button>
    </header>
    <p id={helperId}>Diagram relationships stay on this board. They do not create folders or subboards.</p>
    {readOnly && <p role="status">This workspace is read-only. You can inspect visible objects.</p>}
    <section aria-label="Create diagram">
      <h3>Create</h3>
      <label>New diagram label<input ref={createLabelRef} aria-describedby={helperId} value={newTitle} maxLength={160} disabled={readOnly} onChange={event => setNewTitle(event.target.value)} onKeyDown={enterBranch} /></label>
      <p className="diagram-keyboard-help">In this label field: Enter adds a child to the selected branch; Shift+Enter adds its sibling. With no branch selected, Enter creates a root. Tab moves focus normally.</p>
      <div className="diagram-actions">
        <button type="button" disabled={readOnly} onClick={() => run({ kind: 'new-root', title: newTitle, namespace: namespace(), origin }, 'Mind-map root added.')}>New mind-map root</button>
        <button type="button" disabled={readOnly} onClick={() => run({ kind: 'starter-map', namespace: namespace(), origin }, '20-node mind map added.')}>Add 20-node mind map</button>
        <button type="button" disabled={readOnly} onClick={() => run({ kind: 'process-map', namespace: namespace(), origin }, '10-node process map added.')}>Add process map</button>
        <button type="button" disabled={readOnly} onClick={() => run({ kind: 'swimlane', namespace: namespace(), origin, title: newTitle || 'Workflow' }, 'Swimlane with Research, Production and Review frames added.')}>Add named swimlane</button>
      </div>
      <p>Swimlanes use frame membership. Frames do not clip artwork or automatically rearrange members. Moving a frame carries its members; resizing changes its boundary.</p>
    </section>
    {selectedNode && <section aria-label="Selected diagram object">
      <h3>{selectedNode.title || 'Selected object'}</h3>
      <label>Object label<input value={nodeLabel} maxLength={160} disabled={!editable} onChange={event => setNodeLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); run({ kind: 'rename', id: selectedNode.id, title: nodeLabel }, 'Object label updated.') } }} /></label>
      <button type="button" disabled={!editable} onClick={() => run({ kind: 'rename', id: selectedNode.id, title: nodeLabel }, 'Object label updated.')}>Rename object</button>
      {selectedNode.mindMap && <>
        <div className="diagram-actions">
          <button type="button" disabled={!editable || selectedNode.mindMap.collapsed === true} onClick={() => createBranch('add-child')}>Add child branch</button>
          <button type="button" disabled={!editable || !selectedNode.mindMap.parentId} onClick={() => createBranch('add-sibling')}>Add sibling branch</button>
          <button type="button" disabled={!editable} onClick={() => run({ kind: 'layout', id: selectedNode.id }, 'Visible mind-map branches arranged.')}>Arrange mind map</button>
          <button type="button" disabled={!editable} onClick={() => run({ kind: 'collapse', id: selectedNode.id, collapsed: !selectedNode.mindMap?.collapsed }, selectedNode.mindMap?.collapsed ? 'Branch expanded.' : 'Branch collapsed.')}>{selectedNode.mindMap.collapsed ? 'Expand branch' : 'Collapse branch'}</button>
        </div>
        <label>Branch parent<select aria-label="Branch parent" value={parentId} disabled={!editable || !selectedNode.mindMap.parentId} onChange={event => setParentId(event.target.value)}>
          <option value="">Choose a parent</option>
          {board.nodes.filter(node => node.mindMap?.treeId === selectedNode.mindMap?.treeId && !descendants.has(node.id)).map(node => <option key={node.id} value={node.id}>{node.title || node.id}</option>)}
        </select></label>
        <button type="button" disabled={!editable || !selectedNode.mindMap.parentId || !parentId} onClick={() => run({ kind: 'reparent', id: selectedNode.id, parentId }, 'Branch reparented; labels and connection identities retained.')}>Reparent branch</button>
        <div className="diagram-actions" aria-label="Move whole branch">
          {([['Left', -40, 0], ['Right', 40, 0], ['Up', 0, -40], ['Down', 0, 40]] as const).map(([label, x, y]) => <button type="button" key={label} disabled={!editable} aria-label={`Move whole branch ${label.toLowerCase()}`} onClick={() => run({ kind: 'move-branch', id: selectedNode.id, delta: { x, y } }, `Branch moved ${label.toLowerCase()}.`)}>{label}</button>)}
        </div>
      </>}
      {!selectedNode.mindMap && (selectedNode.kind === 'group' || selectedNode.kind === 'column') && <button type="button" disabled={!editable} onClick={() => run({ kind: 'collapse', id: selectedNode.id, collapsed: !selectedNode.collapsed }, selectedNode.collapsed ? 'Container expanded.' : 'Container collapsed.')}>{selectedNode.collapsed ? 'Expand container' : 'Collapse container'}</button>}
      <div className="diagram-actions">
        <button type="button" disabled={!editable} onClick={() => run({ kind: 'layer', id: selectedNode.id, direction: 'front' }, 'Object moved ahead of its siblings.')}>Bring ahead of siblings</button>
        <button type="button" disabled={!editable} onClick={() => run({ kind: 'layer', id: selectedNode.id, direction: 'back' }, 'Object moved behind its siblings.')}>Send behind siblings</button>
      </div>
    </section>}
    <section aria-label="Diagram objects and layers">
      <h3>Objects and layers</h3>
      <p>Layers order siblings. Owned members stay above their container. Hide and lock are saved states; collapse keeps the owner visible.</p>
      {!rows.ok ? <p role="alert">{rows.issues[0]?.detail}</p> : <div className="diagram-object-list">
        <VirtualList items={rows.value} itemKey={row => row.node.id} label="Diagram objects and layers" renderItem={row => <div className="diagram-object-row" key={row.node.id} style={{ paddingInlineStart: row.depth * 12 }}>
          <button type="button" disabled={row.hidden} aria-pressed={selectedIds.includes(row.node.id)} aria-label={`Select diagram object ${row.node.title || row.node.id}`} onClick={() => onSelect([row.node.id])}>{row.node.title || row.node.id}</button>
          <span className="diagram-object-state">{row.node.diagramRole || (row.node.mindMap ? 'branch' : row.node.containerRole || row.node.kind)}{row.hidden ? ' · hidden' : ''}{row.locked ? ' · locked' : ''}</span>
          <label><input type="checkbox" aria-label={`Show diagram object ${row.node.title || row.node.id}`} checked={!row.node.hidden} disabled={readOnly || row.inheritedHidden || row.locked} onChange={event => run({ kind: 'visibility', id: row.node.id, hidden: !event.target.checked }, event.target.checked ? 'Object shown.' : 'Object hidden.')} />Show</label>
          <label><input type="checkbox" aria-label={`Lock diagram object ${row.node.title || row.node.id}`} checked={Boolean(row.node.locked)} disabled={readOnly || row.inheritedLock || row.hidden} onChange={event => run({ kind: 'lock', id: row.node.id, locked: event.target.checked }, event.target.checked ? 'Object locked.' : 'Object unlocked.')} />Lock</label>
          {(row.inheritedLock || row.inheritedHidden) && <span>Owner state applies</span>}
        </div>} />
      </div>}
    </section>
    <section aria-label="Saved diagram templates">
      <h3>Saved local templates</h3>
      <label>Template name<input value={templateTitle} maxLength={160} disabled={readOnly} onChange={event => setTemplateTitle(event.target.value)} /></label>
      <button type="button" disabled={readOnly || selectedIds.length === 0} onClick={saveTemplate}>Save selected diagram as template</button>
      <p>Complete owned regions and branches are captured with internal connections. Board portals and interchange imports are unsupported. Referenced assets stay in this project.</p>
      {templates.length === 0 ? <p>No saved diagrams yet.</p> : <ul>{templates.map(template => <li key={template.id}><span>{template.title}</span><button type="button" aria-label={`Insert diagram template ${template.title}`} disabled={readOnly} onClick={() => publish(instantiateDiagramTemplate(board, template, namespace(), origin, readOnly), `Inserted ${template.title} with fresh object and connection identities.`)}>Insert</button></li>)}</ul>}
    </section>
    <p className="diagram-structure-status" role="status" aria-live="polite">{status}</p>
  </aside>
}

export type { DiagramWorkflowResult }
