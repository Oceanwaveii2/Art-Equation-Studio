import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { viewportWarmup } from './project-b/p0-surface/viewportWarmup'
import { LaunchHardwareSettings } from './ui/LaunchHardwareSettings'
import { launchLanguages, saveLaunchPreferences, useLaunchPreferences, readLaunchLayout, saveLaunchLayout, type LaunchLayout } from './ui/launchPreferences'
import { launchText } from './ui/launchTranslations'
import './BootLoader.css'
const SHOWCASE_MINIMUM_MS = 5_000
const SHOWCASE_MAXIMUM_MS = 10_000
type Props = { image: string; title: string; ready: boolean; onComplete: (layout:LaunchLayout) => void; theme: 'navy'|'dark'|'light'; onThemeChange: (theme:'navy'|'dark'|'light')=>void }
/** Boot controls stay independent from documents and canvas editing. */
export function BootLoader(props: Props) {
  const warmup = useSyncExternalStore(viewportWarmup.subscribe, viewportWarmup.getSnapshot)
  const startupReady = props.ready && warmup.pending === 0
  const [layout,setLayout]=useState<LaunchLayout>(readLaunchLayout),[layoutOpen,setLayoutOpen]=useState(false),[layoutAbove,setLayoutAbove]=useState(false)
  const layoutRef=useRef(layout),layoutMenuRef=useRef<HTMLDivElement>(null)
  const layouts: {id:LaunchLayout;label:string}[]=[{id:'milinotes',label:'Milinotes'},{id:'graphing',label:'Graphing'},{id:'advanced-split',label:'Advanced Split'}]
  const dialogRef=useRef<HTMLElement>(null)
  const completeRef = useRef(props.onComplete), readyRef = useRef(props.ready)
  const completedRef = useRef(false), interactingRef = useRef(false)
  const [minimumElapsed, setMinimumElapsed] = useState(false), [interacting, setInteracting] = useState(false)
  const preferences = useLaunchPreferences(), t = launchText[preferences.language]
  const [hardwareStatus,setHardwareStatus]=useState<'checking'|'ready'|'failed'|'preview'>('checking'),[saveError,setSaveError]=useState(false)
  const labels={en:['UI theme','Navy','Dark','Light'],'zh-CN':['界面主题','海蓝','深色','浅色'],ja:['UIテーマ','ネイビー','ダーク','ライト'],'pt-BR':['Tema da interface','Azul-marinho','Escuro','Claro'],'pt-PT':['Tema da interface','Azul-marinho','Escuro','Claro'],es:['Tema de interfaz','Azul marino','Oscuro','Claro']}[preferences.language]
  useEffect(() => { completeRef.current = props.onComplete; readyRef.current = startupReady }, [props.onComplete, startupReady])
  const complete = () => { if (!completedRef.current) { completedRef.current = true; completeRef.current(layoutRef.current) } }
  const interact = () => { interactingRef.current = true; setInteracting(true) }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if(event.key==='Tab'){
        const controls=[...(dialogRef.current?.querySelectorAll<HTMLElement>('select,button,summary')||[])].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden')
        const index=controls.indexOf(document.activeElement as HTMLElement)
        if(controls.length&&(index===-1||event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1)){event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus()}
        return
      }
      if (target?.closest('input,select,textarea,button,summary')) return
      if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); complete() }
    }
    const minimumTimer = window.setTimeout(() => { setMinimumElapsed(true); if (readyRef.current && !interactingRef.current) complete() }, SHOWCASE_MINIMUM_MS)
    const maximumTimer = window.setTimeout(() => { if (!interactingRef.current) complete() }, SHOWCASE_MAXIMUM_MS)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.clearTimeout(minimumTimer); window.clearTimeout(maximumTimer); window.removeEventListener('keydown', onKeyDown) }
    // Timers use refs to current startup state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (minimumElapsed && startupReady && !interactingRef.current) complete() }, [minimumElapsed, startupReady])
  useEffect(()=>{const outside=(event:PointerEvent)=>{if(!layoutMenuRef.current?.contains(event.target as Node))setLayoutOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[])
  const status = startupReady ? t.ready : minimumElapsed ? t.finishing : t.preparing
  return <section ref={dialogRef} className="boot-loader" role="dialog" aria-modal="true" aria-label={t.starting} lang={preferences.language}>
    <div className="boot-loader-card">
      <div className="boot-loader-art"><img className="boot-loader-image" src={props.image} alt="Art Equation" draggable={false} /></div>
      <div className="boot-loader-setup" onPointerDown={interact} onFocusCapture={interact}>
        <details className="boot-hardware" onKeyDown={e=>{if(e.key==='Escape'&&e.currentTarget.open){e.preventDefault();e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}}><summary aria-label={t.hardware}><span>{hardwareStatus==='checking'?t.checking:t.hardware}</span><i className={`boot-status-dot ${hardwareStatus}`} aria-hidden="true" /></summary><div className="boot-hardware-panel"><LaunchHardwareSettings compact onInteract={interact} onHardwareStatus={setHardwareStatus}/><div className="boot-colour-themes" role="group" aria-label={labels[0]}>{(['navy','dark','light'] as const).map((theme,i)=><button type="button" key={theme} aria-pressed={props.theme===theme} onClick={()=>props.onThemeChange(theme)}>{labels[i+1]}</button>)}</div></div></details>
        <div className="boot-selectors"><label><span>{t.language}</span><select aria-label={t.language} value={preferences.language} onChange={e=>{setSaveError(false);void saveLaunchPreferences({...preferences,language:e.target.value as typeof preferences.language}).catch(()=>setSaveError(true))}}>{launchLanguages.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
        <div className="boot-layout-row" ref={layoutMenuRef}><span id="boot-layout-label">{labels[0]}</span><button className="boot-layout-trigger" type="button" role="combobox" aria-labelledby="boot-layout-label" aria-expanded={layoutOpen} aria-controls="boot-layout-options" aria-haspopup="listbox" onClick={()=>(setLayoutAbove((layoutMenuRef.current?.getBoundingClientRect().bottom||0)+120>innerHeight),setLayoutOpen(!layoutOpen))} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setLayoutOpen(true);requestAnimationFrame(()=>layoutMenuRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus())}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setLayoutOpen(false)}}}>{layouts.find(l=>l.id===layout)?.label}<span aria-hidden="true">⌄</span></button>{layoutOpen&&<div className={`boot-layout-options ${layoutAbove?'above':''}`} id="boot-layout-options" role="listbox" aria-labelledby="boot-layout-label" onKeyDown={e=>{const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setLayoutOpen(false);layoutMenuRef.current?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus()}}}>{layouts.map(l=><button type="button" role="option" aria-selected={l.id===layout} key={l.id} onClick={()=>{layoutRef.current=l.id;setLayout(l.id);saveLaunchLayout(l.id);setLayoutOpen(false);layoutMenuRef.current?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus()}}>{l.label}<span aria-hidden="true">{l.id===layout?'✓':''}</span></button>)}</div>}</div></div>
        <button type="button" className="boot-loader-skip" onClick={complete}>{t.enter}</button>
        <p className="boot-loader-note" aria-live="polite">{saveError?t.saveError:status} {interacting && t.continue}</p>
      </div>
    </div>
  </section>
}
