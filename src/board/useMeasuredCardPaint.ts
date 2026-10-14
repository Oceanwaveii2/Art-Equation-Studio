import { appUpdateClock, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { captureMeasuredCardPaint, type MeasuredCardPaintSnapshot } from './measuredCardPaint'
import { withCanonicalStageCardPaint } from './completeMeasuredCardPaint'
import type { CanvasSceneSnapshot, CanvasViewport } from '../canvas-engine/contracts'

/** Independent disposable layout invalidation. Measurements never change
 * documents, history, DOM paint ownership or the accepted renderer frame. */
export function observeMeasuredCardPaint(stage: HTMLElement, current: () => { scene: CanvasSceneSnapshot; viewport: CanvasViewport }, publish: (snapshot: MeasuredCardPaintSnapshot) => void) {
  let disposed=false, pending:number|undefined, timer:number|undefined, revision=0, fingerprint=''
  const observed=new Set<Element>()
  const schedule=()=> {
    if (disposed || pending!==undefined || timer!==undefined || document.hidden) return
    // This observational derivative is not on the drawing/presentation path.
    // Coalesce hot gesture/camera mutations instead of measuring every frame.
    timer=window.setTimeout(()=>{timer=undefined;if(!disposed)pending=appUpdateClock.request(measure)},100)
  }
  const resize=new ResizeObserver(schedule)
  function measure() {
    pending=undefined
    if (disposed || document.hidden) return
    const input=current()
    const measured=withCanonicalStageCardPaint(stage,()=>captureMeasuredCardPaint(stage,input.scene,input.viewport,revision+1))
    const next=JSON.stringify({...measured,layoutRevision:0})
    // Bounds/layout/style/fonts/resources can change independently of the
    // board revision. Equal measurements do not trigger a publication loop.
    if (next!==fingerprint) { fingerprint=next;revision++;publish({...measured,layoutRevision:revision}) }
    const mounted=new Set<Element>(stage.querySelectorAll<HTMLElement>('.board-world>.board-object-layer>article.board-node'))
    for (const article of [...mounted]) for (const element of article.querySelectorAll<HTMLElement>('.node-drag-handle,.column-header-copy>small,.node-copy,.board-rich-text,.node-document,.transformed-image,.board-link-card')) {
      if (mounted.size<4096) mounted.add(element)
    }
    for (const element of observed) if (!mounted.has(element)) { resize.unobserve(element);observed.delete(element) }
    for (const element of mounted) if (!observed.has(element)) { resize.observe(element);observed.add(element) }
  }
  const mutation=new MutationObserver(schedule)
  mutation.observe(stage,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','src','hidden','data-node-id']})
  const theme=new MutationObserver(schedule)
  for (let parent=stage.parentElement,count=0;parent && count<16;parent=parent.parentElement,count++) theme.observe(parent,{attributes:true,attributeFilter:['class','style','data-theme']})
  stage.addEventListener('load',schedule,true)
  stage.addEventListener('scroll',schedule,true)
  stage.addEventListener('canvas-camera-presented',schedule)
  for (const event of ['pointerover','pointerout','focusin','focusout','transitionend','animationend']) stage.addEventListener(event,schedule,true)
  document.addEventListener('visibilitychange',schedule)
  document.fonts?.addEventListener('loadingdone',schedule)
  document.fonts?.addEventListener('loadingerror',schedule)
  void document.fonts?.ready.then(schedule)
  schedule()
  return { invalidate:schedule, dispose(){
    disposed=true
    if (pending!==undefined) cancelAppFrame(pending)
    if (timer!==undefined) window.clearTimeout(timer)
    mutation.disconnect();theme.disconnect();resize.disconnect();observed.clear()
    stage.removeEventListener('load',schedule,true)
    stage.removeEventListener('scroll',schedule,true)
    stage.removeEventListener('canvas-camera-presented',schedule)
    for (const event of ['pointerover','pointerout','focusin','focusout','transitionend','animationend']) stage.removeEventListener(event,schedule,true)
    document.removeEventListener('visibilitychange',schedule)
    document.fonts?.removeEventListener('loadingdone',schedule)
    document.fonts?.removeEventListener('loadingerror',schedule)
  } }
}
