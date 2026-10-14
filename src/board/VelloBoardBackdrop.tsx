import {subsetPaintScene} from '../canvas-engine/visiblePaintScene'
import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { recordMetric, canvasInputsFor } from '../diagnostics/performance'
import type { PaintInput } from '../diagnostics/canvasInput'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CanvasSceneObject, CanvasSceneSnapshot, CanvasViewport } from '../canvas-engine/contracts'
import type { LiveCamera } from '../canvas-engine/liveCamera'
import type { LiveCanvasScene } from '../canvas-engine/liveScene'
import { createVelloPresenter } from '../project-b/p0-surface/presenter'
import {qualifiedSvgFlow} from '../project-b/p0-surface/svgEffects'
import { eligibleVelloObjects } from './velloEligibility'
import {withEnvironmentPaint} from '../canvas-engine/environmentPaint'
import {canRetainModelFrame,ownsModelPaint} from '../canvas-engine/frameHandoff'
import type {PreparedPaintDisplayList} from '../canvas-engine/paintDisplayList'
import { compileVectorPaintList } from '../canvas-engine/paintDisplayList'
import { RetainedPaintCompiler } from '../canvas-engine/retainedPaintCompiler'
import { cardPaintIds, paintMutationScope } from './paintInvalidation'
import type {createEngineScenePaint} from '../project-b/p0-surface/engineScenePaint'
import './VelloBoardBackdrop.css'

type Props = {
  camera?: LiveCamera
  scene: CanvasSceneSnapshot
  sceneSource?: LiveCanvasScene
  viewport: CanvasViewport
  selectedIds?: readonly string[]
  /** Canonical spatial-index membership, independent of mounted card elements. */
  visibleObjectIdsKey?: string
  /** Isolated verification can observe the presenter without product test UI. */
  onCardOwnership?: (sceneId:string, ids:readonly string[])=>void
  onPresenter?: (presenter: ReturnType<typeof createVelloPresenter> | null) => void
}

function commands(object: CanvasSceneObject) {
  const points = object.vectorPath?.points
  if (!points?.length) return undefined
  const result: (string | number)[][] = [['M', points[0].x, points[0].y]]
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], point = points[index]
    if (previous.handleOut || point.handleIn) result.push(['C', previous.x + (previous.handleOut?.x || 0), previous.y + (previous.handleOut?.y || 0), point.x + (point.handleIn?.x || 0), point.y + (point.handleIn?.y || 0), point.x, point.y])
    else result.push(['L', point.x, point.y])
  }
  if (object.vectorPath?.closed) {
    const previous = points.at(-1)!, point = points[0]
    // ClosePath alone draws a straight last-to-first segment. Preserve the
    // authored closing curve just as the canonical SVG presenter does.
    if (previous.handleOut || point.handleIn) result.push(['C', previous.x + (previous.handleOut?.x || 0), previous.y + (previous.handleOut?.y || 0), point.x + (point.handleIn?.x || 0), point.y + (point.handleIn?.y || 0), point.x, point.y])
    result.push(['Z'])
  }
  return result
}

export function velloVectorRecord(object: CanvasSceneObject, cameraScale: number) {
  const geometry = object.preparedVectorGeometry
  const prepared = geometry?.status === 'ready' ? geometry : undefined
  const pathCommands = prepared?.commands ?? commands(object)
  return {
    id: object.id, order: object.order, kind: 'vector' as const, bounds: object.bounds,
    transform: prepared ? [1, 0, 0, 1, 0, 0] : object.vectorPath ? [1, 0, 0, 1, object.localBounds?.x ?? object.bounds.x, object.localBounds?.y ?? object.bounds.y] : [1, 0, 0, 1, 0, 0],
    visible: true, locked: object.locked, opacity: object.appearance.opacity, blendMode: 'normal',
    payload: {
      ...(pathCommands ? { commands: pathCommands } : {}),
      fill: (prepared ? !prepared.hasFill : object.vectorPath && !object.vectorPath.closed) ? '#00000000' : (object.appearance.fill || '#00000000'),
      stroke: object.appearance.stroke || '#b9d4e7', strokeWidth: (object.appearance.strokeWidth ?? 2) / (object.appearance.strokeScaling === 'scene' ? 1 : cameraScale),
      vectorFillRule: prepared?.fillRule ?? object.appearance.vectorFillRule ?? 'nonzero',
      vectorStrokeJoin: object.appearance.vectorStrokeJoin ?? 'miter',
      vectorStrokeCap: object.appearance.vectorStrokeCap ?? 'butt',
    },
  }
}

export function velloBoardSnapshot(scene: CanvasSceneSnapshot, selectedIds: readonly string[], cameraScale = 1, liveEdits = false) {
  // The adapter compiles exact authored paths/Boolean boundaries and transforms
  // into board-space commands. Locks are editing authority, never paint gates.
  // Active edits and unsupported/overlapping DOM artwork retain their current
  // presenter until the complete interaction/scene ownership contract is ready.
  const eligible = eligibleVelloObjects(scene, selectedIds, cameraScale, liveEdits)
  const ids = new Set(eligible.map((object) => object.id))
  return {
    ids,
    json: JSON.stringify({
      schema: 'art-equation.scene', schemaVersion: 1, documentId: scene.id, sceneId: scene.id,
      revision: String(scene.revision), coordinateSystem: { units: 'document-unit', xAxis: 'right', yAxis: 'down' },
      environment: { background: '#00000000', colorSpace: 'srgb' },
      objects: eligible.map((object) => {
        const geometry = object.preparedVectorGeometry
        const prepared = geometry?.status === 'ready' ? geometry : undefined
        const pathCommands = prepared?.commands ?? commands(object)
        return {
        id: object.id, order: object.order, kind: 'vector', bounds: object.bounds,
        transform: prepared ? [1, 0, 0, 1, 0, 0] : object.vectorPath ? [1, 0, 0, 1, object.localBounds?.x ?? object.bounds.x, object.localBounds?.y ?? object.bounds.y] : [1, 0, 0, 1, 0, 0],
        visible: true, locked: object.locked, opacity: object.appearance.opacity, blendMode: 'normal',
        payload: {
          ...(pathCommands ? { commands: pathCommands } : {}),
          fill: (prepared ? !prepared.hasFill : object.vectorPath && !object.vectorPath.closed) ? '#00000000' : (object.appearance.fill || '#00000000'),
          // SVG uses non-scaling-stroke. The render derivative cancels only the
          // CSS camera scale; backing-store resolution still scales its pixels.
          stroke: object.appearance.stroke || '#b9d4e7', strokeWidth: (object.appearance.strokeWidth ?? 2) / (object.appearance.strokeScaling === 'scene' ? 1 : cameraScale),
          vectorFillRule: prepared?.fillRule ?? object.appearance.vectorFillRule ?? 'nonzero',
          vectorStrokeJoin: object.appearance.vectorStrokeJoin ?? 'miter',
          vectorStrokeCap: object.appearance.vectorStrokeCap ?? 'butt',
        },
        }
      }),
      // Runtime connections stay DOM/SVG-owned, including edges between locked
      // GPU paths. Endpoint, bend and label previews paint synchronously there;
      // an async completed Vello frame must not retain duplicate/stale edges.
      // Native scene exports/compositor still receive canonical connections via
      // the canonical board model and are intentionally unaffected by this serializer.
      connections: [],
      assetIds: [], extensions: { renderer: 'vello-production' },
    }),
  }
}

/** Production transports now use the ordered contract; the V1 serializer is
 * retained as a compatibility oracle for existing paint/geometry checks. */
export function velloDisplayListSnapshot(scene: CanvasSceneSnapshot, selectedIds: readonly string[], cameraScale = 1, liveEdits = false, compiler?: RetainedPaintCompiler<CanvasSceneObject>) {
  if (compiler) {
    const eligible = eligibleVelloObjects(scene, selectedIds, cameraScale, liveEdits)
    const result = compiler.compile(scene.id, String(scene.revision), eligible,
      object => object.appearance.strokeScaling === 'scene' || object.appearance.strokeWidth === 0 ? 1 : cameraScale,
      object => velloVectorRecord(object, cameraScale))
    recordMetric('paint.vector-fragments', { ...result.stats, damagedBounds: result.damage.world.length, gpuFullRedraw: result.damage.gpuFullRedraw })
    return result
  }
  const legacy = velloBoardSnapshot(scene, selectedIds, cameraScale, liveEdits)
  const source = JSON.parse(legacy.json)
  return { ids: legacy.ids, json: JSON.stringify(compileVectorPaintList(source)) }
}

/** Virtualization already decides which canonical objects paint. Serialize
 * that membership, including forced selected/editing objects, before doing
 * vector eligibility and JSON work. Unmounted objects paint neither DOM nor
 * engine and cannot change the ordering of this visible transaction. */
export function mountedPaintScene(scene: CanvasSceneSnapshot, stage?: HTMLElement | null): CanvasSceneSnapshot {
  if (!stage || typeof stage.querySelectorAll !== 'function') return scene
  const ids = new Set([...stage.querySelectorAll<HTMLElement>('.board-world>.board-object-layer>article.board-node[data-node-id]')].map(element => element.dataset.nodeId))
  const edges = new Set(scene.connections.filter(edge => edge.relationshipStyle === 'graph-v2' && ids.has(edge.sourceId) && ids.has(edge.targetId)).map(edge => edge.id))
  return {...scene, objects: scene.objects.filter(object => ids.has(object.id) || edges.has(object.id))}
}

/** Engine membership comes from the model spatial index, including selected
 * and editing objects. Mounted DOM is used only for input/ownership overlays. */
export function canonicalPaintScene(scene: CanvasSceneSnapshot, ids?: ReadonlySet<string>): CanvasSceneSnapshot {
  return subsetPaintScene(scene,ids)
}
/** Oversized CSS viewports may need a resolution below one, rather than
 * exceeding the device limit or allocating an unbounded texture. */
export function velloRenderResolution(width: number, height: number, devicePixelRatio: number) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return 0
  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(2, devicePixelRatio) : 1
  return Math.min(requested, 4096 / width, 4096 / height, Math.sqrt(16_777_216 / (width * height)))
}

type Capture = {
  generation: number
  paintInput: PaintInput
  scene: CanvasSceneSnapshot
  selectionKey: string
  viewport: CanvasViewport
  cssWidth: number
  cssHeight: number
  ids: ReadonlySet<string>
  cardIds?:ReadonlySet<string>
  imageDetail?:Record<string,unknown>
}
type Completed = Capture & { canvas: HTMLCanvasElement }

export function VelloBoardBackdrop({ scene, sceneSource, viewport, camera, selectedIds = [], visibleObjectIdsKey, onPresenter, onCardOwnership }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const retryRef = useRef<(() => void) | null>(null)
  const inputRef = useRef({ scene: sceneSource?.current || scene, viewport: camera?.current || viewport, selectedIds, visibleIds: visibleObjectIdsKey === undefined ? undefined : new Set(visibleObjectIdsKey.split('\n')), liveEdits: Boolean(sceneSource) })
  const ownershipCallbackRef=useRef(onCardOwnership)
  useLayoutEffect(()=>{ownershipCallbackRef.current=onCardOwnership},[onCardOwnership])
  const presenterCallbackRef = useRef(onPresenter)
  const renderRef = useRef<((forceDom?:boolean,trigger?:string,dirtyIds?:ReadonlySet<string>) => void) | null>(null)
  const reconcileRef = useRef<(() => void) | null>(null)
  const reprojectRef = useRef<((viewport: CanvasViewport) => void) | null>(null)
  useLayoutEffect(() => {
    inputRef.current = { scene: sceneSource?.current || scene, viewport: camera?.current || viewport, selectedIds, visibleIds: visibleObjectIdsKey === undefined ? undefined : new Set(visibleObjectIdsKey.split('\n')), liveEdits: Boolean(sceneSource) }
    renderRef.current?.()
  }, [scene, sceneSource, viewport, camera, selectedIds, visibleObjectIdsKey])
  useLayoutEffect(() => sceneSource?.subscribe(current => {
    inputRef.current = { ...inputRef.current, scene: current }
    renderRef.current?.()
  }), [sceneSource])
  useLayoutEffect(() => camera?.subscribe(current => {
    inputRef.current = { ...inputRef.current, viewport: current }
    reprojectRef.current?.(current)
    renderRef.current?.()
  }), [camera])
  // Virtualization can mount new semantic/hit nodes while the completed engine
  // frame remains visible. Reconcile ownership in the same React commit.
  useLayoutEffect(() => { reconcileRef.current?.() })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Environment pixels have a screen-space lifetime. Never scale the grid
    // along with a retained artwork bitmap while preparing its replacement.
    const environmentHost = document.createElement('div')
    environmentHost.className = 'vello-environment'
    host.prepend(environmentHost)
    let environmentGeneration = 0, environmentKey = ''
    const environmentPresenter = createVelloPresenter(environmentHost, {
      accepted({canvas, frame}) {
        canvas.style.width = `${frame.width / Number(environmentHost.dataset.resolution)}px`
        canvas.style.height = `${frame.height / Number(environmentHost.dataset.resolution)}px`
        environmentHost.dataset.acceptedGeneration = String(frame.generation)
      },
      error({error}) { environmentHost.dataset.renderError = error },
    })
    let disposed = false, generation = 0, scheduled: number | undefined
    let submitted: Capture | undefined, completed: Completed | undefined
    let transportSource:string|undefined,transportSnapshot=''
    let transportList:PreparedPaintDisplayList|undefined
    let validationSources:CanvasSceneSnapshot['objects']|undefined
    let validationObjects=new Map<string,CanvasSceneObject>()
    const objectsForValidation=(objects:CanvasSceneSnapshot['objects'])=>{
      if(validationSources!==objects){validationSources=objects;validationObjects=new Map(objects.map(object=>[object.id,object]));recordMetric('paint.validation-index',{objects:objects.length})}
      return validationObjects
    }
    const ownedElements = new Set<HTMLElement>()
    const retainedVectors = new RetainedPaintCompiler<CanvasSceneObject>()
    const stage = host.parentElement
    const inputTimings = canvasInputsFor(stage || host)
    type MountedPaint=ReturnType<typeof createEngineScenePaint>
    type PaintCapture=NonNullable<Awaited<ReturnType<MountedPaint['capture']>>>
    let mountedPaint:MountedPaint|undefined,mountedPaintPromise:Promise<MountedPaint>|undefined
    let captureBusy=false,captureQueued=false,layoutRevision=0,globalRevision=0
    let revisionSceneId=inputRef.current.scene.id
    const objectRevisions=new Map<string,number>()
    const preparingFrames=new Set<number>()
    const queuedVideoIds=new Set<string>(),queuedDetailIds=new Set<string>()
    const drainCapture=()=>{
      // Give an outstanding renderer preparation/completion promise the main
      // thread instead of blocking it with another synchronous DOM capture.
      if(disposed||captureBusy||preparingFrames.size||!captureQueued)return
      queueMicrotask(()=>{
        if(disposed||captureBusy||preparingFrames.size||!captureQueued||scheduled!==undefined)return
        captureQueued=false
        if(queuedVideoIds.size){const ids=new Set(queuedVideoIds);queuedVideoIds.clear();renderRef.current?.(true,'video-frame',ids)}
        else if(queuedDetailIds.size){const ids=new Set(queuedDetailIds);queuedDetailIds.clear();renderRef.current?.(true,'image-detail',ids)}
        else renderRef.current?.()
      })
    }
    let flowTimer:number|undefined
    const motionQuery=window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const stopFlow=()=>{if(flowTimer!==undefined){window.clearTimeout(flowTimer);flowTimer=undefined}}
    const scheduleFlow=()=>{
      stopFlow()
      if(disposed||document.hidden||motionQuery?.matches)return
      const animations=[...ownedElements].flatMap(element=>element.getAnimations?.({subtree:true})??[]).filter(qualifiedSvgFlow)
      const running=animations.some(animation=>animation.playState==='running'||animation.pending)
      if(running)flowTimer=window.setTimeout(()=>{flowTimer=undefined;if(disposed||document.hidden)return;if(captureBusy||host.dataset.pending==='true')scheduleFlow();else renderRef.current?.()},33)
      // WAAPI pause/play does not necessarily emit a new CSS animationstart.
      // A paused owned flow gets a light watch without repainting frozen pixels.
      else if(animations.some(animation=>animation.playState==='paused'))flowTimer=window.setTimeout(scheduleFlow,250)
    }
    const retained=new Map<number,{paint:PaintCapture;settled:boolean;latest:boolean}>()
    let latestRetention:number|undefined
    const retire=(request:number)=>{const value=retained.get(request);if(value&&value.settled&&!value.latest){value.paint.release();retained.delete(request)}if(disposed&&!retained.size)mountedPaint?.dispose()}
    const getMountedPaint=()=>mountedPaintPromise??=import('../project-b/p0-surface/engineScenePaint').then(module=>{mountedPaint=module.createEngineScenePaint(()=>{const element=host.ownerDocument.activeElement;return element&&stage?.contains(element)&&element.closest('[contenteditable="true"]')?element.closest<HTMLElement>('article.board-node[data-node-id]')?.dataset.nodeId:undefined},ids=>{if(disposed)return;for(const id of ids)queuedDetailIds.add(id);captureQueued=true;drainCapture()});if(disposed)mountedPaint.dispose();return mountedPaint})
    // Complete capture already measures the mounted contribution. The separate
    // diagnostic observer repeated that work on camera/style mutations and its
    // publication invalidated the frame being prepared. Keep production paint
    // driven by actual scene/content/theme/font/size changes below.
    const releasePaint = () => {
      for (const element of ownedElements) {delete element.dataset.velloPaint;delete element.dataset.velloCardPaint}
      ownedElements.clear()
      host.dataset.paintOwnership = 'dom'
      if(!disposed)ownershipCallbackRef.current?.(inputRef.current.scene.id,[])
    }
    const hideStalePaint = () => {
      if (completed) completed.canvas.style.visibility = 'hidden'
      releasePaint()
    }
    const reconcilePaint = () => {
      if (disposed || !completed || host.dataset.paintOwnership !== 'vello') return
      // Scan the mounted membership, not every object in a large document.
      const mounted = new Set(stage?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])
      for (const element of ownedElements) {
        if (!mounted.has(element) || !completed.ids.has(element.dataset.nodeId ?? '')) {
          delete element.dataset.velloPaint
          delete element.dataset.velloCardPaint
          ownedElements.delete(element)
        }
      }
      for (const element of mounted) {
        if (completed.ids.has(element.dataset.nodeId ?? '')) {
          if(completed.cardIds?.has(element.dataset.nodeId??'')){element.dataset.velloCardPaint='complete';delete element.dataset.velloPaint}
          else {element.dataset.velloPaint = 'true';delete element.dataset.velloCardPaint}
          ownedElements.add(element)
        }
      }
    }
    const presenter = createVelloPresenter(host, {
      accepted(result) {
        const capture = submitted
        if (disposed || result.generation !== generation || capture?.generation !== generation) return
        // The presenter commits pixels, attaches the surface and invokes this
        // callback synchronously. Paint ownership changes in that same turn.
        recordMetric('paint.accept', { backend: result.backend, generation: result.generation, objects: capture.ids.size })
        const inputTiming = inputTimings.commit(capture.paintInput)
        if (inputTiming) recordMetric('input.commit', { ...inputTiming, backend: result.backend, generation: result.generation })
        const canvas = result.canvas
        canvas.style.width = `${capture.cssWidth}px`
        canvas.style.height = `${capture.cssHeight}px`
        canvas.style.transform = ''
        canvas.style.visibility = 'visible'
        completed = { ...capture, canvas }
        retained.get(result.generation)?.paint.present()
        host.dataset.paintOwnership = 'vello'
        reconcilePaint()
        ownershipCallbackRef.current?.(capture.scene.id,[...(capture.cardIds??[])])
        host.dataset.pending = 'false'
        host.dataset.acceptedGeneration = String(result.generation)
        host.dataset.acceptedBackend = result.backend
        host.dataset.acceptedScene = capture.scene.id
        host.dataset.acceptedRevision = String(capture.scene.revision)
        host.dataset.acceptedX = String(capture.viewport.x)
        host.dataset.acceptedY = String(capture.viewport.y)
        host.dataset.acceptedScale = String(capture.viewport.scale)
        host.dataset.acceptedCssWidth = String(capture.cssWidth)
        host.dataset.acceptedCssHeight = String(capture.cssHeight)
        host.dataset.paintedObjects = String(capture.ids.size)
        host.dataset.measuredCardComplete=String(capture.cardIds?.size??0)
        host.dataset.renderer = result.metadata.presentation==='native-wgpu'?'vello-native-wgpu':result.backend === 'gpu' ? 'vello-webgpu' : 'vello-cpu'
        host.dataset.imageDetail=JSON.stringify(capture.imageDetail||{})
        host.dataset.imageSharp=String(Object.values(capture.imageDetail||{}).every((detail:any)=>detail.state==='sharp'))
        host.dataset.frameMetadata = JSON.stringify({...result.metadata,imageDetail:capture.imageDetail||{},imageSharp:host.dataset.imageSharp==='true'})
        recordMetric('paint.image-detail-accepted',{generation:result.generation,boardId:capture.scene.id,sharp:host.dataset.imageSharp==='true',detail:JSON.stringify(capture.imageDetail||{})})
        for (const key of ['surfaceConfigurations', 'targetAllocations', 'cpuPixelReadbacks'] as const) {
          const value = result.metadata[key]
          if (value !== undefined) host.dataset[key] = String(value)
          else delete host.dataset[key]
        }
        delete host.dataset.renderError
        if (noticeRef.current) noticeRef.current.hidden = true
        scheduleFlow()
      },
      error(result) {
        if (disposed || result.generation !== generation) return
        // Recovery failure must not silently return engine-owned artwork to
        // browser paint. Retain the last engine frame and expose the failure.
        host.dataset.pending = 'false'
        host.dataset.renderState = 'error'
        host.dataset.renderError = result.error
        if (noticeRef.current) noticeRef.current.hidden = false
      },
      state(result) {
        if (disposed) return
        recordMetric('renderer.state', { backend: result.backend, state: result.state, reason: result.reason || '' })
        host.dataset.backend = result.backend
        host.dataset.renderState = result.state
        if (result.reason) host.dataset.backendReason = result.reason
        else delete host.dataset.backendReason
        // "fallback" describes the real Vello CPU backend. Keep a completed
        // GPU/CPU frame and its markers while backend recovery is pending.
      },
      preparing(request){preparingFrames.add(request)},
      settled(request){preparingFrames.delete(request);const value=retained.get(request);if(value)value.settled=true;retire(request);drainCapture()},
    })
    retryRef.current = () => { presenter.recoverGpu(); renderRef.current?.() }
    void environmentPresenter.warm()
    void presenter.warm()
    presenterCallbackRef.current?.(presenter)

    const paint = (forceDom=false,trigger='scene-or-camera',dirtyIds?:ReadonlySet<string>) => {
      if (disposed) return
      if(revisionSceneId!==inputRef.current.scene.id){revisionSceneId=inputRef.current.scene.id;globalRevision++;objectRevisions.clear();queuedVideoIds.clear()}
      if(forceDom){
        layoutRevision++
        if(dirtyIds)for(const id of dirtyIds)objectRevisions.set(id,(objectRevisions.get(id)??0)+1)
        else globalRevision++
      }
      // A scheduled generation is already invalidated and measures DOM in rAF.
      // Repeated loads/observer notifications in this frame share that capture.
      // Hide ownership immediately so changed content never uses stale pixels.
      // Viewport culling removes hit hosts, not authored members. Judge lifetime
      // against the full scene so panning past a virtualization edge does not
      // restore browser paint for an otherwise fully model-painted board.
      const currentModelScene=inputRef.current.scene
      const editorElement=host.ownerDocument.activeElement?.closest('[contenteditable="true"]')
      const editorId=editorElement?.closest<HTMLElement>('article[data-node-id]')?.dataset.nodeId
      // Once the accepted frame has excluded the active editor, its remaining
      // artwork can stay visible through typing and composition updates.
      const activeEditor=Boolean(editorElement&&stage?.contains(editorElement)&&(!editorId||completed?.ids.has(editorId)))
      const retainModel=Boolean(completed&&canRetainModelFrame(completed.scene,currentModelScene,completed.ids,activeEditor))
      if(forceDom && scheduled !== undefined){
        if(!retainModel)hideStalePaint()
        recordMetric('paint.coalesced', { trigger })
        return
      }
      const paintInput = inputTimings.begin()
      recordMetric('paint.request', { trigger, objects: inputRef.current.scene.objects.length })
      host.dataset.paintTrigger=trigger
      stopFlow()
      if (disposed) return
      // Invalidate BEFORE rAF submission. A result from an older camera/content
      // request cannot claim the surface during this scheduling gap.
      const request = ++generation
      if(latestRetention!==undefined){const value=retained.get(latestRetention);if(value)value.latest=false;retire(latestRetention);latestRetention=undefined}
      presenter.invalidateGeneration(request)
      if (scheduled !== undefined) { cancelAppFrame(scheduled); scheduled = undefined }
      const current = inputRef.current
      const selectionKey = JSON.stringify([...current.selectedIds].sort())
      const view = { ...current.viewport }
      host.dataset.generation = String(request)
      host.dataset.pending = 'true'
      host.dataset.scene = current.scene.id
      host.dataset.sceneRevision = String(current.scene.revision)
      host.dataset.cameraX = String(view.x)
      host.dataset.cameraY = String(view.y)
      host.dataset.cameraScale = String(view.scale)
      if (![view.x, view.y, view.scale].every(Number.isFinite) || view.scale <= 0) {
        hideStalePaint()
        host.dataset.pending = 'false'
        host.dataset.renderState = 'error'
        host.dataset.renderError = 'Invalid Vello camera'
        if (noticeRef.current) noticeRef.current.hidden = false
        return
      }
      host.dataset.gridColor = current.scene.environment.grid.color
      host.dataset.gridVisible = String(current.scene.environment.grid.visible)
      const visibleScene = canonicalPaintScene(current.scene, current.visibleIds)
      const nextIds = current.liveEdits ? new Set(eligibleVelloObjects(visibleScene, current.selectedIds, view.scale, true).map(object => object.id)) : undefined
      const sameBatch = completed && nextIds?.size === completed.ids.size && [...completed.ids].every(id => nextIds.has(id))
      const keepFrame = retainModel || !forceDom && completed && (completed.scene === current.scene && (current.liveEdits || completed.selectionKey === selectionKey)
        || current.liveEdits && sameBatch && completed.scene.id === current.scene.id)
      if (completed && keepFrame && host.dataset.paintOwnership === 'vello') {
        // The accepted frame was rasterized in its captured CSS camera. Reproject
        // it immediately, keeping its original CSS size until a new frame wins.
        const ratio = view.scale / completed.viewport.scale
        const dx = view.x - completed.viewport.x * ratio, dy = view.y - completed.viewport.y * ratio
        completed.canvas.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`
        if(retainModel)recordMetric('paint.last-frame-retained',{generation:request,acceptedGeneration:completed.generation,scene:current.scene.id})
        reconcilePaint()
      } else hideStalePaint()

      if (document.hidden || host.clientWidth <= 0 || host.clientHeight <= 0) {
        host.dataset.renderState = 'paused'
        return
      }
      host.dataset.renderState = 'loading'
      scheduled = requestAppFrame(() => {
        scheduled = undefined
        if (disposed || request !== generation || document.hidden) return
        const width = host.clientWidth, height = host.clientHeight
        const resolution = velloRenderResolution(width, height, window.devicePixelRatio)
        if (!resolution) { host.dataset.renderState = 'paused'; return }
        const pixelWidth = Math.min(4096, Math.max(1, Math.floor(width * resolution)))
        const pixelHeight = Math.min(4096, Math.max(1, Math.floor(height * resolution)))
        const nextEnvironmentKey=JSON.stringify([current.scene.id,current.scene.environment,view,width,height,resolution])
        if(nextEnvironmentKey!==environmentKey){
          environmentKey=nextEnvironmentKey
          environmentHost.dataset.resolution=String(resolution)
          const base:PreparedPaintDisplayList={schema:'art-equation.display-list',schemaVersion:2,sceneId:current.scene.id,revision:String(current.scene.revision),environment:{background:'#00000000',colorSpace:'srgb'},operations:[],resources:[]}
          environmentPresenter.invalidate({generation:++environmentGeneration,width:pixelWidth,height:pixelHeight,snapshot:JSON.stringify(withEnvironmentPaint(base,current.scene.environment,view,{width,height},resolution)),scale:view.scale*resolution,panX:view.x*resolution,panY:view.y*resolution})
        }
        const submit=(encoded:{ids:ReadonlySet<string>;json:string;displayList?:PreparedPaintDisplayList;cardIds?:ReadonlySet<string>;images?:PaintCapture['images'];imageDetail?:Record<string,unknown>})=>{
          submitted = { generation: request, paintInput, scene: current.scene, selectionKey, viewport: view, cssWidth: width, cssHeight: height, ids: encoded.ids,cardIds:encoded.cardIds,imageDetail:encoded.imageDetail }
          host.dataset.devicePixelRatio = String(window.devicePixelRatio || 1)
          host.dataset.renderScale = String(resolution)
          host.dataset.renderPixels = String(pixelWidth * pixelHeight)
          recordMetric('paint.submit', { boardId: current.scene.id, objects: encoded.ids.size, bytes: encoded.json.length, pixels: pixelWidth*pixelHeight })
          preparingFrames.add(request)
          let assembled=false
          if(transportSource!==encoded.json){
            const list=encoded.displayList??JSON.parse(encoded.json) as PreparedPaintDisplayList
            transportList={...list,environment:{background:'#00000000',colorSpace:'srgb'}}
            transportSnapshot=JSON.stringify(transportList)
            transportSource=encoded.json;assembled=true
          }
          const snapshot=transportSnapshot
          recordMetric('paint.transport-reuse',{generation:request,fullAssembly:assembled,bytes:assembled?snapshot.length:0})
          presenter.invalidate({ generation: request, width: pixelWidth, height: pixelHeight, snapshot, displayList:transportList, scale: view.scale * resolution, panX: view.x * resolution, panY: view.y * resolution,images:encoded.images })
        }
        // Compile authored scene content; editor and live viewer overlays retain input.
        const paintedScene = canonicalPaintScene(current.scene, current.visibleIds)
        if(paintedScene.objects.some(object=>!object.hidden&&(object.kind!=='vector'||object.hasDiagramCaption||object.hasShapeCaption||object.shapeType==='arrow'||object.preparedVectorGeometry?.status!=='ready'&&!object.vectorPath))){
          if(captureBusy||preparingFrames.size){captureQueued=true;recordMetric('paint.deferred',{generation:request,preparing:preparingFrames.size});return}
          captureQueued=false
          captureBusy=true
          const vectorScene={...paintedScene,objects:paintedScene.objects.filter(object=>object.kind==='vector').map(object=>object.preparedVectorGeometry?.status==='ready'?{...object,parentId:undefined}:object)}
          const vectors=velloDisplayListSnapshot(vectorScene,current.selectedIds,view.scale,current.liveEdits,retainedVectors)
          const invalidation={globalRevision,objectRevisions:new Map(objectRevisions)}
          const capturedEnvironment=JSON.stringify(paintedScene.environment)
          const capturedDpr=window.devicePixelRatio||1
          const contentCurrent=()=>{
            if(disposed||globalRevision!==invalidation.globalRevision||(window.devicePixelRatio||1)!==capturedDpr)return false
            const latest=inputRef.current.scene
            if(latest.id!==paintedScene.id||JSON.stringify(latest.environment)!==capturedEnvironment)return false
            const objects=objectsForValidation(latest.objects)
            return paintedScene.objects.every(object=>objects.get(object.id)===object&&(objectRevisions.get(object.id)??0)===(invalidation.objectRevisions.get(object.id)??0))
          }
          void getMountedPaint().then(controller=>controller.capture(paintedScene,view,vectors,layoutRevision,()=>!disposed&&request===generation,invalidation,contentCurrent,{width,height},window.devicePixelRatio||1)).then(encoded=>{
            if(!encoded)return
            if(disposed||request!==generation){encoded.release();return}
            encoded.stage();retained.set(request,{paint:encoded,settled:false,latest:true});latestRetention=request
            host.dataset.completePaintBlockers=JSON.stringify(encoded.blockers)
            submit(encoded)
          }).catch(error=>{
            if(disposed||request!==generation)return
            hideStalePaint();host.dataset.pending='false';host.dataset.renderState='error';host.dataset.renderError=String(error)
            if(noticeRef.current)noticeRef.current.hidden=false
          }).finally(()=>{captureBusy=false;if(disposed&&!retained.size)mountedPaint?.dispose();else drainCapture()})
        } else {
          const encoded = velloDisplayListSnapshot(paintedScene, current.selectedIds, view.scale, current.liveEdits, retainedVectors)
          submit(encoded)
        }
      })
    }
    reprojectRef.current = (view: CanvasViewport) => {
      if (disposed || !completed || host.dataset.paintOwnership !== 'vello') return
      const ratio = view.scale / completed.viewport.scale
      const dx = view.x - completed.viewport.x * ratio, dy = view.y - completed.viewport.y * ratio
      completed.canvas.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`
    }
    renderRef.current = paint
    reconcileRef.current = reconcilePaint
    // Imperative drafts and deferred child mounts may not rerender this React
    // component. Child-list observation runs before the browser's next paint;
    // marker writes are deliberately not observed.
    const membershipObserver = new MutationObserver(records=>{
      // A new provider/virtualized card changes real DOM paint independently
      // of the saved revision. Invalidate before it can cross an older engine
      // layer; ownership-only attributes deliberately do not enter this path.
      const modelIds=new Set(inputRef.current.scene.objects.filter(ownsModelPaint).map(o=>o.id))
      const relevant=records.filter(record=>{const element=record.target instanceof Element?record.target:record.target.parentElement;if(element?.closest('.canvas-tool-rail'))return false;const article=element?.closest<HTMLElement>('article[data-node-id]');return !article||!modelIds.has(article.dataset.nodeId??'')||article.contains(host.ownerDocument.activeElement)&&Boolean(host.ownerDocument.activeElement?.closest('[contenteditable="true"]'))})
      if(!relevant.length){reconcilePaint();return}
      const scope=paintMutationScope(relevant,stage!,host)
      if(scope.changed){paint(true,'membership:'+records.map(record=>record.type+':'+record.target.nodeName+':'+record.attributeName).slice(0,4).join(','),scope.global?undefined:withCoverParents(scope.ids))}
      else reconcilePaint()
    })
    if (stage) membershipObserver.observe(stage, { childList: true, characterData:true, subtree: true, attributes:true, attributeOldValue:true, attributeFilter:['class','style','src','srcset','sizes','hidden','data-theme','data-node-id','d','fill','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','opacity','transform','viewBox','href','xlink:href','visibility','clip-path','filter'] })
    const resizeChanged=()=>paint(true,'size')
    const observer = new ResizeObserver(resizeChanged)
    observer.observe(host)
    let dprQuery: MediaQueryList | undefined
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', dprChanged)
      if (typeof window.matchMedia === 'function') {
        dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        dprQuery.addEventListener('change', dprChanged)
      }
    }
    const dprChanged = () => { watchDpr(); paint(true,'device-pixel-ratio') }
    const visibilityChanged = () => paint()
    const styleChanged=()=>paint(true,'style-or-motion')
    const themeObserver=new MutationObserver(styleChanged)
    for(let parent=stage?.parentElement,count=0;parent&&count<16;parent=parent.parentElement,count++)themeObserver.observe(parent,{attributes:true,attributeFilter:['class','style','data-theme']})
    document.fonts?.addEventListener('loadingdone',styleChanged)
    document.fonts?.addEventListener('loadingerror',styleChanged)
    motionQuery?.addEventListener('change',styleChanged)
    // A frame cover derives from its first image child. Source/load edits must
    // revoke both child and ancestor paint, including same-URL reloads.
    function withCoverParents(ids:ReadonlySet<string>){
      const result=new Set(ids),parents=new Map(inputRef.current.scene.objects.map(object=>[object.id,object.parentId]))
      for(const id of ids){let parent=parents.get(id),depth=0;while(parent&&depth++<32&&!result.has(parent)){result.add(parent);parent=parents.get(parent)}}
      return result
    }
    const cardInteractionChanged=(event:Event)=>{if(event.target instanceof Node){const ids=cardPaintIds(event.target);if(ids.size){
      if(['focusin','focusout'].includes(event.type)&&event.target instanceof Element&&!event.target.closest('[contenteditable="true"]')&&inputRef.current.scene.objects.filter(object=>ids.has(object.id)).every(ownsModelPaint))return
      // Canonical model paint does not depend on CSS hover or scroll. Focus and
      // input still revoke Type ownership for the one active IME editor.
      if(['pointerover','pointerout','scroll','transitionend','animationstart','animationend','animationcancel'].includes(event.type)){
        const measured=new Set(inputRef.current.scene.objects.filter(object=>ids.has(object.id)&&!object.structuredCard&&!object.modelArtwork).map(object=>object.id))
        if(!measured.size)return
        paint(true,event.type,measured)
      }else paint(true,event.type,event.type==='load'||event.type==='error'?withCoverParents(ids):ids)
    }}}
    const videoFrameChanged=(event:Event)=>{
      if(!(event.target instanceof Node))return
      const ids=cardPaintIds(event.target)
      if(!ids.size)return
      if((event as CustomEvent<{reason:string}>).detail?.reason!=='frame'){cardInteractionChanged(event);return}
      // Decode can outrun capture/preparation. Finish the immutable captured
      // frame, then refresh the latest frame instead of canceling every pending
      // presentation forever. Source/seek/error/edit events still revoke now.
      if(captureBusy||preparingFrames.size||scheduled!==undefined){
        for(const id of ids)queuedVideoIds.add(id)
        captureQueued=true
      }else paint(true,'video-frame',ids)
    }
    stage?.addEventListener('load',cardInteractionChanged,true)
    stage?.addEventListener('error',cardInteractionChanged,true)
    stage?.addEventListener('vello-provider-frame',videoFrameChanged,true)
    for(const event of ['scroll','pointerover','pointerout','focusin','focusout','input','change','transitionend','animationstart','animationend','animationcancel'])stage?.addEventListener(event,cardInteractionChanged,true)
    watchDpr()
    window.addEventListener('resize', resizeChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
    paint()
    return () => {
      disposed = true
      stopFlow()
      motionQuery?.removeEventListener('change',styleChanged)
      presenter.invalidateGeneration(++generation)
      if (scheduled !== undefined) cancelAppFrame(scheduled)
      observer.disconnect()
      membershipObserver.disconnect()
      themeObserver.disconnect()
      document.fonts?.removeEventListener('loadingdone',styleChanged)
      document.fonts?.removeEventListener('loadingerror',styleChanged)
      stage?.removeEventListener('vello-provider-frame',videoFrameChanged,true)
      for(const event of ['scroll','pointerover','pointerout','focusin','focusout','input','change','transitionend','animationstart','animationend','animationcancel'])stage?.removeEventListener(event,cardInteractionChanged,true)
      stage?.removeEventListener('load',cardInteractionChanged,true)
      stage?.removeEventListener('error',cardInteractionChanged,true)
      dprQuery?.removeEventListener('change', dprChanged)
      window.removeEventListener('resize', resizeChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
      renderRef.current = null
      reprojectRef.current = null
      reconcileRef.current = null
      retryRef.current = null
      if (noticeRef.current) noticeRef.current.hidden = true
      releasePaint()
      presenter.dispose()
      environmentPresenter.dispose()
      environmentHost.remove()
      retainedVectors.clear()
      for(const [request,value] of retained){value.latest=false;retire(request)}
      if(!retained.size)mountedPaint?.dispose()
      presenterCallbackRef.current?.(null)
    }
  }, [])
  return <><div className="gpu-board gpu-board-select vello-board" ref={hostRef} aria-hidden="true" />
    <div className="vello-render-notice" ref={noticeRef} hidden role="status" aria-live="polite" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <span>Canvas rendering stopped. Retry to resume.</span>
      <button type="button" onClick={() => retryRef.current?.()}>Retry rendering</button>
    </div></>
}


