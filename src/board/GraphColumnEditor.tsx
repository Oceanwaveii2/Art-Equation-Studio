import { VirtualList } from '../ui/VirtualList'
import { useState } from 'react'
import type { BoardModel } from '../model/project'
import { bindGraphColumnInputs, editGraphColumn, GraphColumnRuntime } from './graphColumnV2'
import { writeGraphObjectAttribute, type GraphWritableAttribute } from './graphObjectCommands'
import { columnChildren, setColumnImageSizingResult } from './columns'
import { diagramState } from './diagramStructureCore'

export function GraphColumnEditor({ board, id, readOnly, onChange, onClose }: { board: BoardModel; id: string; readOnly: boolean; onChange(board: BoardModel): void; onClose(): void }) {
  const [error, setError] = useState(''), [sourceId, setSourceId] = useState('')
  const [targetId,setTargetId] = useState(''), [field,setField] = useState<GraphWritableAttribute>('title'), [value,setValue] = useState('')
  const node = board.nodes.find(n => n.id === id)
  if (!node?.graphColumn) return null
  const graph = node.graphColumn, state = diagramState(board.nodes, id)
  const disabled = readOnly || !state.ok || state.value.locked
  const apply = (work: () => BoardModel) => { try { onChange(work()); setError(''); return true } catch (e) { setError(String(e)); return false } }
  return <section className="graph-column-editor" role="dialog" aria-label="Graph connections" onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onKeyDown={event => { if(event.key==='Escape'){event.stopPropagation();onClose()} }}>
    <header><strong>{node.title}</strong><button type="button" aria-label="Close graph connections" onClick={onClose}>×</button></header>
    <label>Operation<select aria-label="Graph operation" disabled={disabled} value={graph.operation} onChange={e => apply(() => editGraphColumn(board, id, { operation: e.target.value as typeof graph.operation }))}><option value="collect">Collect records</option><option value="count">Count records</option><option value="text">Extract text</option></select></label>
    <label>Image layout<select aria-label="Graph image layout" disabled={disabled} value={node.columnImageSizing || 'responsive'} onChange={e=>apply(()=>{const result=setColumnImageSizingResult(board,id,e.target.value as 'responsive'|'minimum-height');if(!result.ok)throw Error(result.issues[0]?.detail);return result.value})}><option value="responsive">Responsive</option><option value="minimum-height">Minimum height</option></select></label>
    <p>{columnChildren(board,id).length} contained objects. Drop images or cards into the column; drag a row to reorder or move it out.</p>
    <p>Inputs stay in this order. Connections read source objects without moving or changing them.</p>
    <VirtualList items={graph.inputs} itemKey={input => input.id} label="Ordered graph inputs" estimate={46} renderItem={(input, index) => <div className="graph-input-row">
      <select aria-label={'Source for input ' + (index + 1)} disabled={disabled} value={input.sourceId} onChange={e => apply(() => editGraphColumn(board, id, { inputs: graph.inputs.map(i => i.id === input.id ? { ...i, sourceId: e.target.value } : i) }))}>
        {!board.nodes.some(n => n.id === input.sourceId) && <option value={input.sourceId}>Missing source</option>}
        {board.nodes.filter(n => n.id !== id).map(n => <option key={n.id} value={n.id}>{n.title || n.kind}</option>)}
      </select>
      <button type="button" aria-label={'Move input ' + (index + 1) + ' up'} disabled={disabled || index === 0} onClick={() => apply(() => { const inputs = [...graph.inputs]; [inputs[index - 1], inputs[index]] = [inputs[index], inputs[index - 1]]; return editGraphColumn(board, id, { inputs }) })}>↑</button>
      <button type="button" aria-label={'Disconnect input ' + (index + 1)} disabled={disabled} onClick={() => apply(() => editGraphColumn(board, id, { inputs: graph.inputs.filter(i => i.id !== input.id) }))}>×</button>
    </div>} />
    <label>Connect source<select aria-label="New graph source" disabled={disabled} value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">Choose an object</option>{board.nodes.filter(n => n.id !== id && !graph.inputs.some(i => i.sourceId === n.id)).map(n => <option key={n.id} value={n.id}>{n.title || n.kind}</option>)}</select></label>
    <button type="button" disabled={disabled || !sourceId || graph.inputs.some(i => i.sourceId === sourceId)} onClick={() => { if (apply(() => bindGraphColumnInputs(board, id, [...graph.inputs.map(i => i.sourceId), sourceId]))) setSourceId('') }}>Connect source</button>
    {graph.operation==='collect' && <fieldset><legend>Send an explicit object change</legend>
      <label>Object<select aria-label="Graph write target" disabled={disabled} value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">Choose a collected object</option>{(()=>{try{const result=new GraphColumnRuntime().evaluate(board,id);return result.type==='records'?[...new Map(result.value.map(r=>[r.objectId,r])).values()].map(r=><option key={r.objectId} value={r.objectId}>{r.title||r.kind}</option>):null}catch{return null}})()}</select></label>
      <label>Attribute<select aria-label="Graph write attribute" disabled={disabled} value={field} onChange={e=>setField(e.target.value as GraphWritableAttribute)}><option value="title">Title</option><option value="body">Text / authored HTML</option><option value="color">Fill colour</option><option value="textColor">Text colour</option><option value="opacity">Opacity (0–1)</option></select></label>
      <label>Value<input aria-label="Graph write value" disabled={disabled} value={value} onChange={e=>setValue(e.target.value)}/></label>
      <button type="button" disabled={disabled||!targetId} onClick={()=>apply(()=>writeGraphObjectAttribute(board,id,targetId,field,value,readOnly))}>Apply object change</button>
    </fieldset>}
    {disabled && <p>Read-only or locked graph.</p>}{error && <p role="alert">{error}</p>}
  </section>
}
