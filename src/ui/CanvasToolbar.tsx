import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CanvasToolStack, type CanvasToolItemProps } from './CanvasToolStack'
import { appUpdateClock } from '../canvas-engine/appFrameClock'
import './CanvasToolbar.css'

// The controller supplies the real actions. This view only arranges them.
const captions: Record<string, string> = {
  'Select and move':'Select', 'Node tool':'Direct select', 'Pen tool':'Pen', 'Pencil tool':'Pencil', 'Vector Eraser':'Eraser',
  'Draw line':'Line', 'Draw arrow':'Arrow', 'Draw connector':'Connector', 'Draw rectangle':'Rectangle', 'Draw ellipse':'Ellipse', 'Type tool':'Type',
  'Create subboard':'Subboard', 'Add card column':'Column', 'Add Node Column':'Node Column', 'Create Graph Column':'Graph', 'Insert image':'Image', 'Diagram shapes':'Shapes', 'Drawing canvas':'Canvas', 'Group or frame':'Frame',
  'Hand tool':'Hand', 'Zoom tool':'Zoom', 'Fit board':'Fit board', 'Actual size 1:1':'Actual size', 'Fit selection':'Fit selection', 'Previous zoom':'Previous zoom',
  'Minimap':'Minimap', 'Show grid':'Grid', 'Snap to grid':'Snap to grid', 'Show diagram structure':'Structure', 'Canvas board information':'Board info',
  'Import canvas assets':'Import', 'Export canvas artwork':'Export', 'Undo board change':'Undo', 'Redo board change':'Redo', 'More canvas tools':'More', 'Hide canvas tool rail':'Hide',
}
const shortcuts: Record<string,string> = {'Select and move':'V','Node tool':'A','Pen tool':'P','Pencil tool':'N','Vector Eraser':'Shift+E','Draw line':'L','Draw arrow':'Shift+A','Draw rectangle':'R','Draw ellipse':'O','Type tool':'T','Hand tool':'H','Zoom tool':'Z','Fit board':'Ctrl+0','Actual size 1:1':'Ctrl+1','Fit selection':'Ctrl+2','Undo board change':'Ctrl+Z','Redo board change':'Ctrl+Shift+Z'}
const glyphs: Record<string, ReactNode> = {
  'Vector Eraser':<path d="m4 14 9-10 7 7-9 10H7zM9 9l7 7M11 21h10"/>,
  'Add Node Column':<><path d="m6 4 4 4-4 4-4-4zM10 8h9v13H5v-7M8 16h8M8 19h8"/></>,
  'Create Graph Column':<><rect x="3" y="14" width="4" height="7"/><rect x="10" y="9" width="4" height="12"/><rect x="17" y="3" width="4" height="18"/></>,
  'Diagram shapes':<><rect x="3" y="3" width="6" height="6"/><circle cx="17" cy="6" r="3"/><path d="m6 14 4 4-4 4-4-4zM14 21l3-7 4 7z"/></>,
  'Drawing canvas':<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 17 6-6 4 4 3-3 4 5"/><circle cx="16" cy="8" r="1"/></>,
  'Actual size 1:1':<><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 9v6M16 9v6"/><circle cx="12" cy="10" r=".5"/><circle cx="12" cy="14" r=".5"/></>,
  'Fit selection':<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5M9 9h6v6H9z"/>,
  'Previous zoom':<path d="m8 4-5 5 5 5M3 9h9a8 8 0 1 1-5 14"/>,
  'Minimap':<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>,
  'Show grid':<path d="M7 3v18M12 3v18M17 3v18M3 7h18M3 12h18M3 17h18"/>,
  'Snap to grid':<><path d="M4 4h6v6H4zM14 14h6v6h-6zM17 4v6M14 7h6M7 14v6M4 17h6"/></>,
  'Show diagram structure':<path d="M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4"/>,
  'Canvas board information':<><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
  'Export canvas artwork':<path d="M12 15V3m-4 4 4-4 4 4M4 14v7h16v-7"/>,
  'Import canvas assets':<path d="M12 3v12m-4-4 4 4 4-4M4 14v7h16v-7"/>,
  'Hide canvas tool rail':<path d="m8 9 4 4 4-4"/>,
}
function iconFor(name:string, original:ReactNode) {
  return glyphs[name] ? <svg viewBox="0 0 24 24" aria-hidden="true">{glyphs[name]}</svg> : original
}
export function CanvasToolbar({children}:{children:ReactNode}) {
  const ref=useRef<HTMLElement>(null)
  const [paneWidth,setPaneWidth]=useState(0)
  const wide=paneWidth>=1120
  const narrow=paneWidth<560
  useEffect(()=>{
    const host=ref.current?.parentElement
    if(!host)return
    let resizeFrame:number|undefined
    let width=host.clientWidth
    const observer=new ResizeObserver(entries=>{
      width=entries[0].contentRect.width
      if(resizeFrame===undefined)resizeFrame=appUpdateClock.request(()=>{
        resizeFrame=undefined
        setPaneWidth(width)
        for(const menu of ref.current?.querySelectorAll<HTMLDetailsElement>('details[open]')||[])menu.open=false
      })
    })
    observer.observe(host)
    return()=>{observer.disconnect();if(resizeFrame!==undefined)appUpdateClock.cancel(resizeFrame)}
  },[])
  const actions=new Map<string,ReactElement<CanvasToolItemProps>>()
  Children.forEach(children,child=>{if(isValidElement(child)){const button=child as ReactElement<CanvasToolItemProps>;const name=button.props['aria-label'];if(name)actions.set(name,button)}})
  const item=(name:string,menu=false)=>{
    const button=actions.get(name)
    if(!button)return null
    const icon=iconFor(name,button.props.children)
    return cloneElement(button,{key:name,'data-shortcut':shortcuts[name],title:name+(shortcuts[name]?` · ${shortcuts[name]}`:''),className:`canvas-command ${button.props.className||''}`},menu?icon:<><span className="canvas-command-icon">{icon}</span><span className="canvas-command-caption">{captions[name]||name}</span></>)
  }
  const stack=(label:string,caption:string,names:string[])=>{
    const current=names.find(name=>(label!=='Navigation and view tools'||['Hand tool','Zoom tool'].includes(name))&&actions.get(name)?.props['aria-pressed'])
    const first=actions.get(current||names[0])
    return <CanvasToolStack key={label} label={label} title={label.replace(' tools','').toUpperCase()} caption={label==='Drawing tools'&&wide&&current?captions[current]:caption} followSelection={false} icon={iconFor(current||names[0],first?.props.children)} active={!!current}>{names.map(name=>item(name,true))}</CanvasToolStack>
  }
  return <aside ref={ref} className={`canvas-tool-rail ocean-toolbar ${wide?'expanded':'compact'}`} aria-label="Canvas tools" data-toolbar-layout={wide?'expanded':'compact'} onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),summary')].filter(el=>el.getClientRects().length)
    const index=controls.indexOf(document.activeElement as HTMLElement)
    if(index<0)return
    event.preventDefault();event.stopPropagation()
    controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowRight'?1:-1)+controls.length)%controls.length]?.focus()
  }}>
    <div className="canvas-command-row" role="group" aria-label="Drawing and objects">
      <div className="canvas-command-group" role="group" aria-label="Edit and draw">
        {stack('Selection tools','Select',['Select and move','Node tool'])}
        {stack('Drawing tools',wide?'Pen':'Draw',wide?['Pen tool','Pencil tool','Vector Eraser','Type tool']:['Pen tool','Pencil tool','Vector Eraser','Draw line','Type tool'])}
        {wide&&item('Draw line')}
        {stack('Shape tools','Shapes',['Draw rectangle','Draw ellipse','Diagram shapes'])}
      </div>
      <div className="canvas-command-group" role="group" aria-label="Create and add">
        {stack('Board tools','Add',['Create subboard','Add card column','Insert image','Group or frame'])}
        {item('Drawing canvas')}
      </div>
      <div className="canvas-command-group" role="group" aria-label="Graphing">{stack('Graphing tools',wide?'Graph column':'Graph',['Create Graph Column','Add Node Column','Draw connector','Draw arrow'])}{item('More canvas tools')}</div>
    </div>
    <div className="canvas-command-row" role="group" aria-label="View and board actions">
      <div className="canvas-command-group" role="group" aria-label="Navigation and view">
        {stack('Navigation and view tools','View',['Hand tool','Zoom tool','Fit board','Actual size 1:1','Fit selection','Previous zoom','Minimap'])}
      </div>
      <div className="canvas-command-group" role="group" aria-label="Structure and board">{stack('Canvas options',wide?'Canvas options':'Board',['Show grid','Snap to grid','Show diagram structure','Canvas board information'])}</div>
      <div className="canvas-command-group" role="group" aria-label="Import and export">{narrow?stack('Import and export tools','Files',['Import canvas assets','Export canvas artwork']):<>{item('Import canvas assets')}{item('Export canvas artwork')}</>}</div>
      <div className="canvas-command-group" role="group" aria-label="History tools">{item('Undo board change')}{item('Redo board change')}</div>
      {item('Hide canvas tool rail')}
    </div>
  </aside>
}
