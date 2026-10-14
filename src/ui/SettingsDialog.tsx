import { useEffect, useRef, useState, type ReactNode } from 'react'
import './settingsDialog.css'
export function SettingsDialog({sections,onClose}:{sections:{id:string;label:string;content:ReactNode}[];onClose:()=>void}){
 const [active,setActive]=useState(sections[0].id),root=useRef<HTMLElement>(null)
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLElement>('[role=tab]')?.focus();return ()=>previous?.focus()},[])
 return <div className="settings-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <aside ref={root} className="settings-panel settings-dialog" role="dialog" aria-modal="true" aria-label="Application settings" onKeyDown={e=>{
   if(e.key!=='Tab')return
   const controls=[...root.current!.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.closest('[hidden]')&&!(el as HTMLButtonElement).disabled&&el.getClientRects().length)
   if(!controls.length)return;const first=controls[0],last=controls.at(-1)!
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }}>
   <header><div><strong>Settings</strong><small>Workspace, saving and app inspection</small></div><button type="button" aria-label="Close settings" onClick={onClose}>×</button></header>
   <div className="settings-dialog-body"><nav role="tablist" aria-label="Settings sections" aria-orientation="vertical">
    {sections.map((s,i)=><button type="button" role="tab" id={'settings-tab-'+s.id} aria-controls={'settings-content-'+s.id} aria-selected={active===s.id} tabIndex={active===s.id?0:-1} key={s.id} onClick={()=>setActive(s.id)} onKeyDown={e=>{let n=e.key==='ArrowDown'?(i+1)%sections.length:e.key==='ArrowUp'?(i+sections.length-1)%sections.length:e.key==='Home'?0:e.key==='End'?sections.length-1:undefined;if(n!==undefined){e.preventDefault();setActive(sections[n].id);root.current?.querySelector<HTMLElement>('#settings-tab-'+sections[n].id)?.focus()}}}>{s.label}</button>)}
   </nav><div className="settings-dialog-content">{sections.map(s=><div key={s.id} id={'settings-content-'+s.id} role="tabpanel" aria-labelledby={'settings-tab-'+s.id} hidden={active!==s.id}>{s.content}</div>)}</div></div>
  </aside>
 </div>
}

