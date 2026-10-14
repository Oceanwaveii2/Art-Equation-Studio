import { useState } from 'react'
import type { BoardModel } from '../model/project'
import { appendSvgDrawing, inspectSvgDrawing, type SvgDrawingImport } from './svgDrawingImport'
import './SvgDrawingPanel.css'
import { validateBoardMutation } from './boardMutationSafety'
import { vectorNodeSvgMarkup } from './vectorSvg'
import { diagramProjectionStates, containerPaintOrder } from './diagramStructureCore'
import { DrawingPaintInspector } from './DrawingPaintInspector'

export function SvgDrawingPanel({ board,onChange,onClose,selectedIds=[],onSelect,onPaint,readOnly=false }: { readOnly?:boolean;board: BoardModel;onChange:(board:BoardModel)=>void;onClose:()=>void;selectedIds?:string[];onSelect?:(id:string)=>void;onPaint?:(id:string,patch:Partial<BoardModel['nodes'][number]>)=>void }) {
  const [restore,setRestore]=useState<BoardModel|null>(null)
  const download=(text:string,extension:string,type:string)=>{const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=(board.title||'drawing').replace(/[^a-z0-9_-]/gi,'_')+extension;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const [drawing,setDrawing]=useState<SvgDrawingImport|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  return <section className="svg-drawing-panel" aria-label="SVG drawing study">
    <header><h2>Editable artwork</h2><button type="button" onClick={onClose}>Close artwork tools</button></header>
    <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0}}><p>Inspect SVG geometry before importing it as editable paths and named layers. Original files stay unchanged.</p>
    <label>Choose SVG <input type="file" accept=".svg,image/svg+xml" aria-label="Choose editable SVG" disabled={busy||readOnly} onChange={async event=>{
      const file=event.target.files?.[0]; if(!file)return;setBusy(true);setMessage('Inspecting artwork…');setDrawing(null)
      try {const next=inspectSvgDrawing(await file.text(),file.name.replace(/\.svg$/i,''));setDrawing(next);setMessage(next.warnings.length?'Additional drawing features are required before a complete import.':'Ready to import editable paths.')}catch(error){setMessage(String(error))}finally{setBusy(false)}
    }}/></label>
    <button type="button" onClick={()=>download(JSON.stringify(board),'.drawing.json','application/json')}>Save editable drawing board</button>
    <button type="button" onClick={()=>{const state=diagramProjectionStates(board.nodes);if(!state.ok){setMessage('Resolve layer ownership before exporting.');return}const order=containerPaintOrder(board.nodes);if(!order.ok)return;const byId=new Map(board.nodes.map(n=>[n.id,n]));const nodes=order.value.orderedIds.map(id=>byId.get(id)!).filter(n=>n.vectorPath&&!state.value.get(n.id)?.hidden);if(!nodes.length)return;const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y)),w=Math.max(...nodes.map(n=>n.x+n.width))-x,h=Math.max(...nodes.map(n=>n.y+n.height))-y;download(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">${nodes.map(n=>vectorNodeSvgMarkup(n)).join('')}</svg>`,'.svg','image/svg+xml')}}>Export drawing SVG</button>
    <label>Restore saved drawing<input type="file" accept=".json,application/json" aria-label="Choose saved drawing board" onChange={async e=>{setRestore(null);try{const file=e.target.files?.[0];if(!file)return;const value=JSON.parse(await file.text());if(!Array.isArray(value.nodes)||!Array.isArray(value.connectors)||!value.viewport)throw new Error('This is not a drawing board.');const next={...value,id:board.id,title:board.title};const check=validateBoardMutation(board,next,readOnly);if(!check.ok)throw new Error(check.issues.map(i=>i.detail).join(' '));setRestore(next);setMessage('Saved drawing inspected. Restore replaces the current board and can be undone.')}catch(error){setMessage(String(error))}}}/></label>
    {restore&&<button type="button" onClick={()=>{const check=validateBoardMutation(board,restore,readOnly);if(!check.ok){setMessage(check.issues.map(i=>i.detail).join(' '));return}onChange(restore);setRestore(null);setMessage('Saved drawing restored.') }}>Restore drawing board</button>}
    <p role="status">{message}</p>
    {onSelect&&<label>Editable object<select aria-label="Choose drawing object" value={selectedIds.length===1?selectedIds[0]:''} onChange={e=>onSelect(e.target.value)}><option value="">Choose a path…</option>{board.nodes.filter(n=>n.vectorPath).map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label>}
    {onPaint&&selectedIds.length===1&&board.nodes.find(n=>n.id===selectedIds[0]&&n.vectorPath)&&<DrawingPaintInspector node={board.nodes.find(n=>n.id===selectedIds[0])!} onChange={patch=>onPaint(selectedIds[0],patch)}/>}
    {drawing&&<><dl><dt>Source shapes</dt><dd>{drawing.sourceShapes}</dd><dt>Editable objects</dt><dd>{drawing.nodes.filter(n=>n.kind==='shape').length}</dd><dt>Named layers</dt><dd>{drawing.layers.length}</dd><dt>Clipping operations</dt><dd>{drawing.clippedShapes}</dd></dl>
      <p>{drawing.layers.join(' · ')}</p>
      {drawing.warnings.length>0&&<ul aria-label="Unsupported artwork features">{drawing.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
      <button type="button" disabled={Boolean(drawing.warnings.length)||busy} onClick={()=>{const next=appendSvgDrawing(board,drawing);const valid=validateBoardMutation(board,next,readOnly);if(!valid.ok){setMessage(valid.issues.map(issue=>issue.detail).join(' '));return}onChange(next);setDrawing(null);setMessage('Editable artwork imported. Fit board to view it; Undo removes the entire import.')}}>Import editable artwork</button>
    </>}
  </fieldset></section>
}
