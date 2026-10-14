import {nodeGraphPorts} from './nodeColumnCommands'
import {computePortPosition,PORT_SEMANTIC_COLORS} from './cardPorts'
import type { BoardConnector, BoardModel, BoardNode, ProjectAsset } from '../model/project'
import type { CanvasAssetHandle, CanvasObjectKind, CanvasSceneConnection, CanvasSceneObject, CanvasSceneSnapshot } from '../canvas-engine/contracts'
import { DEFAULT_CANVAS_GRID_OPACITY } from '../canvasTheme'
import { prepareVelloVectorGeometry } from './velloVectorGeometry'
import { containerPaintOrder, diagramProjectionStates, type DiagramProjectionState } from './diagramStructureCore'
import { projectGraphColumns, GraphColumnRuntime, graphColumnRows } from './graphColumnV2'
import { connectorGeometry } from './connectors'
import { projectModelArtwork } from './modelArtwork'

const objectCache = new WeakMap<readonly BoardNode[], WeakMap<readonly ProjectAsset[], {sources: ReadonlyMap<string,string>; objects: readonly CanvasSceneObject[]}>>()
const noSources = new Map<string,string>()
const artworkProjections = new WeakMap<BoardNode, {asset?: ProjectAsset; source?: string; value: CanvasSceneObject['modelArtwork']}>()
// Immutable drag replacements must not reparse unchanged saved prose or give
// an unchanged embedded image a fresh upload revision. Weak references retain
// no historical board/media payloads; this index stores bounded identities only.
const latestArtworkNodes = new Map<string, WeakRef<BoardNode>>()
function artworkInputs(node:BoardNode) {
  return JSON.stringify([node.kind,node.textMode,node.title,node.color,node.textColor,node.imagePresentation,node.imageTransform,node.columnPresentation,node.columnBodyColor,Boolean(node.graphColumn),node.coverAssetId,node.containerRole,node.assetId])
}
const assetPaintSources = new WeakMap<ProjectAsset, {source: string; revision: number}>()
const connectionCache = new WeakMap<readonly BoardNode[], WeakMap<readonly BoardConnector[], readonly CanvasSceneConnection[]>>()
const objectRevisions = new WeakMap<BoardNode, Map<string, number>>()
// Immutable node identity plus derived state defines paint identity. Keep only
// the latest projection per node so moving a peer cannot invalidate its paint.
const nodeProjections = new WeakMap<BoardNode, { key: string; object: CanvasSceneObject }>()
const connectorProjections = new WeakMap<BoardConnector, CanvasSceneConnection>()
let lastEnvironment: CanvasSceneSnapshot['environment'] | undefined
const graphRuntimes = new Map<string, GraphColumnRuntime>()

const revisions = new WeakMap<object, number>()
let nextRevision = 1

function revisionFor(value: object) {
  const existing = revisions.get(value)
  if (existing) return existing
  const revision = nextRevision++
  revisions.set(value, revision)
  return revision
}

function objectKind(node: BoardNode): CanvasObjectKind {
  if (node.kind === 'column' || node.kind === 'group') return 'container'
  if (node.kind === 'image') return 'raster'
  if (node.kind === 'shape') return 'vector'
  if (node.kind === 'note' || node.kind === 'text') return 'text'
  if (node.kind === 'clip') return 'capture'
  if (node.kind === 'board-link') return 'link'
  return node.kind
}

function assetHandle(node: BoardNode, assets: ReadonlyMap<string, ProjectAsset>): CanvasAssetHandle | undefined {
  if (!node.assetId) return undefined
  const asset = assets.get(node.assetId)
  if (!asset) return undefined
  const kind = asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'model' || asset.kind === 'document' ? asset.kind : 'other'
  return { id: asset.id, kind, revision: revisionFor(asset) }
}

function rotatedBounds(node: BoardNode) {
  const angle = Math.abs((node.rotation || 0) % 180) * Math.PI / 180
  if (angle === 0) return { x: node.x, y: node.y, width: node.width, height: node.height }
  const width = Math.abs(node.width * Math.cos(angle)) + Math.abs(node.height * Math.sin(angle))
  const height = Math.abs(node.width * Math.sin(angle)) + Math.abs(node.height * Math.cos(angle))
  return { x: node.x + (node.width - width) / 2, y: node.y + (node.height - height) / 2, width, height }
}

function unionBounds(a: CanvasSceneObject['bounds'], b: CanvasSceneObject['bounds'] | null) {
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return Object.freeze({ x, y, width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y })
}

function sceneObject(node: BoardNode, order: number, assets: ReadonlyMap<string, ProjectAsset>, state: DiagramProjectionState, structuredCard?: CanvasSceneObject['structuredCard']): CanvasSceneObject {
  const asset = assetHandle(node, assets)
  const key = `${order}:${state.locked}:${state.hidden}:${asset?.revision ?? ''}:${structuredCard ? JSON.stringify(structuredCard) : ''}`
  const cached = nodeProjections.get(node)
  if (cached?.key === key) return cached.object
  const hasDiagramCaption = Boolean(node.diagramShape)
  const hasShapeCaption = node.kind === 'shape' && node.shapeType === 'ellipse' && Boolean(node.body)
  // Prepare the authored path independently of its DOM caption. This derivative
  // serves canonical picking/indexing; hasDiagramCaption still excludes the
  // complete object from Vello paint ownership until text layout is supported.
  const preparedVectorGeometry = node.kind === 'shape'
    ? prepareVelloVectorGeometry(hasDiagramCaption ? { ...node, diagramShape: undefined } : node)
    : undefined
  // Broad-phase visibility follows authored world geometry, independently of
  // the saved editing frame. The current .diagram-caption-svg is clipped to its
  // own saved-frame SVG viewport (SVG UA overflow:hidden), then node-rotated;
  // its inner affine can move glyphs but cannot expand that viewport. Include
  // this frame even for empty Boolean paths without resurrecting path geometry.
  // Ellipse captions have overflow:visible, so this union is only an editing
  // frame/index bound; eligibility refuses their unmeasured mixed paint batch.
  const bounds = preparedVectorGeometry?.status === 'ready'
    ? hasDiagramCaption || hasShapeCaption ? unionBounds(rotatedBounds(node), preparedVectorGeometry.bounds)
      : preparedVectorGeometry.bounds ?? { x: node.x, y: node.y, width: 0, height: 0 }
    : rotatedBounds(node)
  // A parent may change while the child's saved record retains its identity.
  // Scene deltas compare revisions, so derived state and paint order need one too.
  let versions = objectRevisions.get(node)
  if (!versions) { versions = new Map(); objectRevisions.set(node, versions) }
  let revision = versions.get(key)
  if (!revision) { revision = nextRevision++; versions.set(key, revision) }
  const object: CanvasSceneObject = {
    id: node.id,
    revision,
    order,
    kind: objectKind(node),
    ...(node.kind === 'column' ? { role: 'column' as const } : node.kind === 'group' ? { role: node.containerRole === 'frame' || /\bframe\b/i.test(node.title) ? 'frame' as const : 'group' as const } : {}),
    bounds,
    localBounds: { x: node.x, y: node.y, width: node.width, height: node.height },
    zIndex: order,
    ...(node.parentColumnId ? { parentId: node.parentColumnId } : node.groupId ? { parentId: node.groupId } : {}),
    locked: state.locked,
    hidden: state.hidden,
    ...(structuredCard ? { structuredCard } : {}),
    appearance: {
      fill: node.color,
      stroke: node.strokeColor,
      text: node.textColor,
      opacity: node.opacity ?? 1,
      strokeWidth: node.strokeWidth,
      vectorFillRule: node.vectorFillRule,
      vectorStrokeJoin: node.vectorStrokeJoin,
      vectorStrokeCap: node.vectorStrokeCap,
      cornerRadius: node.cornerRadius,
      rotation: node.rotation || 0,
      ...(preparedVectorGeometry?.status === 'ready' ? preparedVectorGeometry.effectivePaint : {}),
    },
    ...(node.vectorPath ? { vectorPath: node.vectorPath } : {}),
    ...(node.kind === 'shape' ? {
      ...(node.shapeType ? { shapeType: node.shapeType } : {}),
      hasDiagramCaption,
      hasShapeCaption,
      preparedVectorGeometry,
    } : {}),
    ...(node.vectorBoolean ? { vectorBoolean: node.vectorBoolean } : {}),
    ...(node.vectorTransform ? { vectorTransform: node.vectorTransform } : {}),
    ...(asset ? { asset } : {}),
  }
  nodeProjections.set(node, { key, object })
  return object
}

function sceneConnection(connection: BoardConnector): CanvasSceneConnection {
  const cached = connectorProjections.get(connection)
  if (cached) return cached
  const object: CanvasSceneConnection = {
    id: connection.id,
    revision: revisionFor(connection),
    sourceId: connection.sourceId,
    targetId: connection.targetId,
    sourcePoint: connection.sourcePoint,
    targetPoint: connection.targetPoint,
    sourcePort: connection.sourcePort,
    targetPort: connection.targetPort,
    sourcePortMode: connection.sourcePortMode,
    targetPortMode: connection.targetPortMode,
    style: connection.style,
    color: connection.color,
    width: connection.width,
    dashed: connection.dashed,
    startArrow: connection.startArrow,
    endArrow: connection.endArrow,
    animated: connection.animated,
    label: connection.label,
    bendPoints: connection.bendPoints,
    labelPosition: connection.labelPosition,
    relationshipStyle: connection.relationshipStyle,
    linePattern: connection.linePattern,
  }
  connectorProjections.set(connection, object)
  return object
}

export function createArtEquationCanvasScene(
  board: Pick<BoardModel, 'id' | 'nodes' | 'connectors' | 'gridVisible' | 'gridOpacity' | 'gridSpacing'>,
  assets: readonly ProjectAsset[],
  colors: { background: string; grid: string },
  sources: ReadonlyMap<string,string> = noSources,
): CanvasSceneSnapshot {
  let byAssets = objectCache.get(board.nodes)
  if (!byAssets) { byAssets = new WeakMap(); objectCache.set(board.nodes, byAssets) }
  const entry = byAssets.get(assets)
  let objects = entry?.sources === sources ? entry.objects : undefined
  if (!objects) {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
    const states = diagramProjectionStates(board.nodes)
    const paint = containerPaintOrder(board.nodes)
    const nodesById = new Map(board.nodes.map((node) => [node.id, node]))
    const ordered = paint.ok ? paint.value.orderedIds.map((id) => nodesById.get(id)!) : board.nodes
    let runtime = graphRuntimes.get(board.id)
    if (!runtime) { if(graphRuntimes.size>=32)graphRuntimes.delete(graphRuntimes.keys().next().value!);runtime=new GraphColumnRuntime();graphRuntimes.set(board.id,runtime) }
    objects = ordered.map((node, index) => {
      let structuredCard: CanvasSceneObject['structuredCard']
      if (node.graphColumn) {
        let result: string
        try { const value = runtime.evaluate(board, node.id, assets); result = value.type === 'records' ? `${value.value.length} records` : value.type === 'number' ? `${value.value} records` : value.value.slice(0, 200) } catch (e) { result = 'Input error: ' + String(e) }
        structuredCard = { title: node.title, rows: graphColumnRows(node, board.nodes), result, fill: node.columnBodyColor || node.color || '#34546c', headerFill: node.color || '#34546c', text: node.textColor || '#ffffff', ports: [{x:node.width,y:node.height/2}, ...node.graphColumn.inputs.map((_,i)=>({x:0,y:node.height*(i+1)/(node.graphColumn!.inputs.length+1)}))] }
      }
      const object = sceneObject(node, index, assetsById, states.ok && paint.ok ? states.value.get(node.id)! : { locked: true, hidden: true }, structuredCard)
      const asset = node.assetId ? assetsById.get(node.assetId) : undefined
      const source = node.assetId ? sources.get(node.assetId) : node.body?.startsWith('data:image/') ? node.body : undefined
      let artwork = artworkProjections.get(node)
      const artworkSlot=JSON.stringify([board.id,node.id]),previousNode=latestArtworkNodes.get(artworkSlot)?.deref(),previousArtwork=previousNode&&artworkProjections.get(previousNode)
      if(!artwork && previousNode && previousArtwork && previousArtwork.asset===asset && previousArtwork.source===source && (previousArtwork.value?.kind!=='image'||previousArtwork.value.tilesSource===(node.assetId?sources.get(node.assetId+':tiles'):undefined)) && previousNode.body===node.body && previousNode.captured?.articleHtml===node.captured?.articleHtml && previousNode.captured?.transcriptHtml===node.captured?.transcriptHtml && artworkInputs(previousNode)===artworkInputs(node)) {
        artwork=previousArtwork;artworkProjections.set(node,artwork)
      }
      if (!artwork || artwork.asset !== asset || artwork.source !== source || (artwork.value?.kind==='image' && artwork.value.tilesSource!==(node.assetId?sources.get(node.assetId+':tiles'):undefined))) {
        let value = projectModelArtwork(node, asset, source, node.assetId?sources.get(node.assetId+":tiles"):undefined)
        if (value?.kind === 'image') {
          let sourceRevision = revisionFor(node)
          if(asset) {
            let accepted=assetPaintSources.get(asset)
            if(!accepted||accepted.source!==value.source){
              // A host may change its resolved URL without replacing metadata.
              // Give that source a fresh immutable resource revision as well.
              accepted={source:value.source,revision:accepted?nextRevision++:revisionFor(asset)}
              assetPaintSources.set(asset,accepted)
            }
            sourceRevision=accepted.revision
          }
          value = {...value, sourceRevision}
        }
        artwork = {asset,source,value}; artworkProjections.set(node,artwork)
      }
      latestArtworkNodes.delete(artworkSlot)
      if(latestArtworkNodes.size>=512)latestArtworkNodes.delete(latestArtworkNodes.keys().next().value!)
      latestArtworkNodes.set(artworkSlot,new WeakRef(node))
      // Keep projection identity stable across camera/peer changes. Source or
      // asset replacements must never reuse a previously accepted image.
      if (artwork.value) {
        const projection = nodeProjections.get(node)!
        if (projection.object.modelArtwork !== artwork.value) projection.object = {...object,modelArtwork:artwork.value}
        return projection.object
      }
      if(object.modelArtwork){const projection=nodeProjections.get(node)!;projection.object={...object,modelArtwork:undefined};return projection.object}
      return object
    })
    const graphProjection = projectGraphColumns(board)
    // Ports are part of the canonical structured card paint, not extra unsupported
    // child objects. Derived edges are independent vectors below ordinary objects.
    for (let index=0;index<graphProjection.connections.length;index++) {
      const edge=graphProjection.connections[index],geometry=connectorGeometry(edge,board.nodes)
      if(!geometry||objects.find(o=>o.id===edge.sourceId)?.hidden||objects.find(o=>o.id===edge.targetId)?.hidden)continue
      const coords=geometry.commands.flatMap(command=>command.slice(1) as number[]),xs=coords.filter((_,i)=>i%2===0),ys=coords.filter((_,i)=>i%2===1)
      const bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
      objects = [...objects, {id:edge.id,revision:revisionFor(edge),order:-graphProjection.connections.length+index,zIndex:-1,kind:'vector',bounds,localBounds:bounds,locked:true,hidden:false,appearance:{fill:'#00000000',stroke:edge.color,strokeWidth:edge.width,strokeScaling:'scene',opacity:1,rotation:0},preparedVectorGeometry:{status:'ready',commands:geometry.commands,bounds,fillRule:'nonzero',hasFill:false,strokeOutsetCssPx:1}}]
    }

    const ports=new Map<string,{x:number;y:number;color:string}[]>()
    for(const node of board.nodes){
      const items=nodeGraphPorts(board,node,nodesById).map(port=>{const p=computePortPosition(port,node);return {x:p.x-node.x,y:p.y-node.y,color:PORT_SEMANTIC_COLORS[port.semanticType]}})
      if(items.length)ports.set(node.id,items)
    }
    for(const edge of graphProjection.connections){
      const node=nodesById.get(edge.sourceId!),geometry=connectorGeometry(edge,board.nodes)
      if(!node||!geometry)continue
      const a=-(node.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=geometry.source.x-node.x-node.width/2,dy=geometry.source.y-node.y-node.height/2
      const p={x:node.width/2+c*dx-s*dy,y:node.height/2+s*dx+c*dy,color:edge.color}
      const items=ports.get(node.id)||[];if(!items.some(old=>Math.hypot(old.x-p.x,old.y-p.y)<.001))items.push(p);ports.set(node.id,items)
    }
    objects=objects.map(object=>object.modelArtwork&&ports.has(object.id)?{...object,modelPorts:ports.get(object.id)}:object)
    byAssets.set(assets, {sources,objects})
  }
  let byConnectors = connectionCache.get(board.nodes)
  if (!byConnectors) { byConnectors = new WeakMap(); connectionCache.set(board.nodes, byConnectors) }
  let connections = byConnectors.get(board.connectors)
  if (!connections) {
    const visible = new Set(objects.filter((object) => !object.hidden).map((object) => object.id))
    connections = [...board.connectors, ...projectGraphColumns(board).connections].filter((connection) => (!connection.sourceId || visible.has(connection.sourceId)) && (!connection.targetId || visible.has(connection.targetId))).map(sceneConnection)
    byConnectors.set(board.connectors, connections)
  }
  const environment = {
    background: colors.background,
    grid: {
      visible: board.gridVisible !== false,
      color: colors.grid,
      opacity: Math.max(.05, Math.min(1, board.gridOpacity ?? DEFAULT_CANVAS_GRID_OPACITY)),
      spacing: Math.max(12, Math.min(120, board.gridSpacing || 44)),
    },
  }
  if (!lastEnvironment || JSON.stringify(lastEnvironment) !== JSON.stringify(environment)) lastEnvironment = environment
  return {
    id: board.id,
    revision: revisionFor(board),
    objects,
    connections,
    environment: lastEnvironment,
  }
}


