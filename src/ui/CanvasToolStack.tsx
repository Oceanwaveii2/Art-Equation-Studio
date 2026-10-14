import {Children,cloneElement,isValidElement,useEffect,useRef,useState,type ReactElement,type ReactNode,type CSSProperties} from 'react'
import './CanvasToolStack.css'

export interface CanvasToolItemProps {
  'aria-label'?: string
  shortcut?: string
  children?: ReactNode
  [key: string]: any
}

export function CanvasToolStack({label,title,caption,icon,active,followSelection=true,children}:{label:string;title?:string;caption?:string;icon:ReactNode;active?:boolean;followSelection?:boolean;children:ReactNode}){
 const ref=useRef<HTMLDetailsElement>(null)
 const [placement,setPlacement]=useState<CSSProperties>({})
 const positionMenu=(details:HTMLDetailsElement)=>{
   const toolbar=details.closest('.canvas-tool-rail')
   if(!caption||!toolbar)return
   const trigger=details.querySelector('summary')!.getBoundingClientRect(),rail=toolbar.getBoundingClientRect(),stage=toolbar.parentElement!.getBoundingClientRect()
   setPlacement({position:'absolute',left:Math.max(stage.left+8,Math.min(trigger.left,stage.right-268))-trigger.left,bottom:trigger.bottom-rail.top+10,transform:'none',maxHeight:Math.max(64,Math.min(360,rail.top-stage.top-18))})
 }
 const selected=followSelection?Children.toArray(children).find(child=>isValidElement(child)&&(child.props as {'aria-pressed'?:boolean})['aria-pressed']) as ReactElement<{children:ReactNode}>|undefined:undefined
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node)&&ref.current)ref.current.open=false}
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){event.preventDefault();event.stopPropagation();ref.current.open=false;ref.current.querySelector('summary')?.focus()}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true)
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true)}
 },[])
 return <details ref={ref} className={`canvas-tool-stack ${active?'active':''}`} onToggle={event=>{if(event.currentTarget.open){
   const toolbar=event.currentTarget.closest('.canvas-tool-rail')
   for(const other of toolbar?.querySelectorAll<HTMLDetailsElement>('.canvas-tool-stack[open]')||[])if(other!==event.currentTarget)other.open=false
   positionMenu(event.currentTarget)
 }}}>
  <summary aria-label={label} title={label} onClick={()=>{if(ref.current)positionMenu(ref.current)}} onKeyDown={event=>{if(event.key==='ArrowDown'&&ref.current){event.preventDefault();event.stopPropagation();positionMenu(ref.current);ref.current.open=true;ref.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()}}}><span className="canvas-command-icon">{selected?.props.children||icon}</span>{caption&&<span className="canvas-command-caption">{caption}</span>}</summary>
  <div className="canvas-tool-stack-menu" style={placement} role="group" aria-label={label} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}} onClick={event=>{if((event.target as Element).closest('button:not(:disabled)')&&ref.current){ref.current.open=false;ref.current.querySelector('summary')?.focus()}}}>
   {title && <header className="canvas-tool-stack-header"><span>{title}</span></header>}
   <div className="canvas-tool-stack-items">
     {Children.map(children,child=>{
       if(!isValidElement(child))return child
       const button=child as ReactElement<CanvasToolItemProps>
       const shortcut=button.props['data-shortcut'] || button.props.shortcut
       return cloneElement(button,{},<>
         <span className="canvas-tool-item-icon">{button.props.children}</span>
         <span className="canvas-tool-item-label">{button.props['aria-label']}</span>
         {shortcut && <kbd className="canvas-tool-shortcut">{shortcut}</kbd>}
       </>)
     })}
   </div>
  </div>
 </details>
}

