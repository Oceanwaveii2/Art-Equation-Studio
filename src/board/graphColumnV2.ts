import type { BoardConnector, BoardModel, BoardNode, ProjectAsset } from '../model/project'
import { modelEqual } from '../state/modelEquality'
import { diagramState, diagramProjectionStates } from './diagramStructureCore'

export type GraphRecord = { objectId: string; kind: BoardNode['kind']; title: string; html?: string; assetId?: string;
  attributes: Readonly<{ width: number; height: number; color?: string; textColor?: string; strokeColor?: string; opacity?: number; fonts: readonly string[] }>;
  media?: Readonly<{ status: ProjectAsset['status'] | 'unresolved'; format?: string; byteLength?: number; resolution?: Readonly<{ width: number; height: number }> }> }
export type GraphValue = { type: 'records'; value: readonly GraphRecord[] } | { type: 'number'; value: number } | { type: 'text'; value: string }
type Entry = { key: string; value: GraphValue; revision: number }

export function graphColumnRows(node: BoardNode, nodes: readonly BoardNode[]): string[] {
  const graph = node.graphColumn!
  const children = nodes.filter(n => n.groupId === node.id)
  const operation = graph.operation === 'count' ? 'Count records' : graph.operation === 'text' ? 'Extract text' : 'Collect records'
  return children.length ? [`${operation} · ${children.length} items · ${graph.inputs.length} inputs`]
    : [operation, `${graph.inputs.length} connected input${graph.inputs.length === 1 ? '' : 's'}`, ...graph.inputs.slice(0,8).map(i => nodes.find(n => n.id === i.sourceId)?.title || 'Missing source')]
}

export function graphPlainText(html: string): string {
  const entities: Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity:string)=>{
    if(entity[0]!=='#')return entities[entity.toLowerCase()]
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10)
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�'
  }).replace(/\n+$/,'')
}

/** Headless dataflow vertical slice. Immutable records/asset references are passed,
 * never DOM nodes or image bytes. Camera/position do not change record values;
 * authored dimensions and media quality do. Indexes follow immutable revisions. */
export class GraphColumnRuntime {
  private cache = new Map<string, Entry>()
  private sources = new Map<string, { node: BoardNode; asset?: ProjectAsset; body?: string; key: string; record: GraphRecord; value: GraphValue }>()
  private sourceRevision = 0
  private indexedNodes?: readonly BoardNode[]
  private byId = new Map<string, BoardNode>()
  private children = new Map<string, BoardNode[]>()
  private indexedAssets?: readonly ProjectAsset[]
  private byAsset = new Map<string, ProjectAsset>()
  evaluations = 0
  evaluate(board: Pick<BoardModel, 'nodes'>, id: string, assets: readonly ProjectAsset[] = []): GraphValue {
    if (board.nodes !== this.indexedNodes) {
      this.indexedNodes = board.nodes
      this.byId = new Map(board.nodes.map(n => [n.id, n]))
      this.children = new Map()
      for (const node of board.nodes) {
        if (!node.groupId) continue
        const members = this.children.get(node.groupId) || []
        members.push(node); this.children.set(node.groupId, members)
      }
      for (const members of this.children.values()) members.sort((a,b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0) || a.y - b.y)
      for (const key of this.cache.keys()) if (!this.byId.has(key)) this.cache.delete(key)
      for (const key of this.sources.keys()) if (!this.byId.has(key)) this.sources.delete(key)
    }
    if (assets !== this.indexedAssets) { this.indexedAssets = assets; this.byAsset = new Map(assets.map(asset => [asset.id, asset])) }
    const byId = this.byId
    const visiting = new Set<string>()
    const read = (sourceId: string): { key: string; value: GraphValue } => {
      const node = byId.get(sourceId)
      if (!node) throw new Error(`Missing graph source: ${sourceId}`)
      if (visiting.has(sourceId)) throw new Error(`Graph cycle at ${sourceId}`)
      if (!node.graphColumn) {
        const asset = node.assetId ? this.byAsset.get(node.assetId) : undefined
        const previous = this.sources.get(sourceId)
        if (previous?.node === node && previous.asset === asset) return previous
        // Authored font declarations are metadata, not proof of a resolved face.
        const styles = [...String(node.body || '').matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)].map(m => m[2].replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'"))
        const fonts = previous && previous.body === node.body ? previous.record.attributes.fonts : Object.freeze([...new Set(styles.flatMap(style => [...style.matchAll(/font-family\s*:\s*([^;]+)/gi)].map(m => m[1].trim())))])
        const attributes = Object.freeze({width:node.width,height:node.height,color:node.color,textColor:node.textColor,strokeColor:node.strokeColor,opacity:node.opacity,fonts})
        const media = node.assetId ? Object.freeze({status:asset?.status || 'unresolved' as const,format:asset?.extension,byteLength:asset?.byteLength,...(asset?.imageDimensions ? {resolution:Object.freeze({...asset.imageDimensions})} : {})}) : undefined
        const record: GraphRecord = { objectId: node.id, kind: node.kind, title: node.title, attributes, ...(node.body ? { html: node.body } : {}), ...(node.assetId ? { assetId: node.assetId, media } : {}) }
        const entry = previous && modelEqual(previous.record, record)
          ? { ...previous, node, asset }
          : { node, asset, body: node.body, key: `source:${++this.sourceRevision}`, record, value: { type: 'records' as const, value: [Object.freeze(record)] } }
        this.sources.set(sourceId, entry)
        return entry
      }
      const definition = node.graphColumn
      if (definition.version !== 2 || !['collect', 'count', 'text'].includes(definition.operation)) throw new Error(`Unsupported graph operation on ${sourceId}`)
      if (new Set(definition.inputs.map(i => i.id)).size !== definition.inputs.length) throw new Error(`Duplicate input port on ${sourceId}`)
      if (new Set(definition.inputs.map(i => i.sourceId)).size !== definition.inputs.length) throw new Error(`Duplicate source on ${sourceId}`)
      if (definition.inputs.length > 256) throw new Error('Graph input limit is 256 sources per item')
      visiting.add(sourceId)
      // Containment is independent of wiring. Ordered children feed this item
      // directly, while external sources continue to use stable input ports.
      const children = this.children.get(sourceId) || []
      const childIds = new Set(children.map(n => n.id))
      const inputs = [...children.map(n => read(n.id)), ...definition.inputs.filter(i => !childIds.has(i.sourceId)).map(i => read(i.sourceId))]
      visiting.delete(sourceId)
      const key = JSON.stringify([definition, inputs.map(i => i.key)])
      const cached = this.cache.get(sourceId)
      if (cached?.key === key) return { key: `computed:${sourceId}:${cached.revision}`, value: cached.value }
      if (inputs.some(i => i.value.type !== 'records')) throw new Error(`${definition.operation} inputs require records; number/text output is incompatible`)
      const records = inputs.flatMap(i => i.value.type === 'records' ? i.value.value : [])
      const value: GraphValue = definition.operation === 'count' ? { type: 'number', value: records.length }
        : definition.operation === 'text' ? { type: 'text', value: records.map(r => r.html ? graphPlainText(r.html) : r.title).join('\n') }
        : { type: 'records', value: Object.freeze(records) }
      this.evaluations++
      const entry = { key, value: Object.freeze(value), revision: this.evaluations }; this.cache.set(sourceId, entry)
      return { key: `computed:${sourceId}:${entry.revision}`, value: entry.value }
    }
    return read(id).value
  }
}

export function createGraphColumnItem(id: string, origin: { x: number; y: number }, sourceIds: readonly string[]): BoardNode {
  return { id, kind: 'group', ...origin, width: 320, height: Math.max(160, 64 + sourceIds.length * 24), title: 'Graph Column 2', color: '#34546c', columnImageSizing: 'responsive', graphColumn: {
    version: 2, operation: 'collect', inputs: [...new Set(sourceIds)].map((sourceId, index) => ({ id: 'input-' + index, sourceId })),
  } }
}

const graphProjections=new WeakMap<readonly BoardNode[],{ports:BoardNode[];connections:BoardConnector[]}>()
/** Disposable scene projection. Connection definitions live in graph inputs;
 * this manager derives geometry without storing renderer coordinates in dataflow. */
export function projectGraphColumns(board: Pick<BoardModel, 'nodes'>): { ports: BoardNode[]; connections: BoardConnector[] } {
  const cached=graphProjections.get(board.nodes);if(cached)return cached
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const states = diagramProjectionStates(board.nodes)
  const ports: BoardNode[] = [], connections: BoardConnector[] = []
  const point = (node: BoardNode, x: number, y: number) => {
    const a = (node.rotation || 0) * Math.PI / 180, dx = x - node.width / 2, dy = y - node.height / 2
    return { x: node.x + node.width / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: node.y + node.height / 2 + dx * Math.sin(a) + dy * Math.cos(a) }
  }
  const pin = (id: string, p: {x:number;y:number}, hidden?: boolean): BoardNode => ({ id, kind: 'shape', shapeType: 'ellipse', title: '', x: p.x - 4, y: p.y - 4, width: 8, height: 8, color: '#67d5cd', strokeWidth: 0, locked: true, hidden, layoutBackground: true })
  for (const graph of board.nodes) {
    if (!graph.graphColumn) continue
    const hidden = !states.ok || states.value.get(graph.id)?.hidden !== false
    ports.push({ ...pin(graph.id + ':output', point(graph, graph.width, graph.height / 2), hidden), groupId: graph.id })
    graph.graphColumn.inputs.forEach((input, index) => {
      const source = byId.get(input.sourceId)
      const targetPoint = point(graph, 0, graph.height * (index + 1) / (graph.graphColumn!.inputs.length + 1))
      ports.push({ ...pin(graph.id + ':' + input.id, targetPoint, hidden), groupId: graph.id })
      if (!source) return
      const sourcePoint = point(source, source.width, source.height / 2)
      connections.push({ id: graph.id + ':edge:' + input.id, sourceId: source.id, targetId: graph.id, sourcePoint, targetPoint, sourcePort: 'right', targetPort: 'left', sourcePortMode: 'fixed', targetPortMode: 'fixed', style: 'curve', color: '#67d5cd', width: 1.5, dashed: false, startArrow: false, endArrow: false, animated: false, relationshipStyle: 'graph-v2' })
    })
  }
  const result={ports,connections};graphProjections.set(board.nodes,result);return result
}

export function bindGraphColumnInputs(board: BoardModel, graphId: string, sourceIds: readonly string[]): BoardModel {
  const graph = board.nodes.find(n => n.id === graphId)
  if (!graph?.graphColumn) throw new Error('Select one Graph Column 2 item')
  const state = diagramState(board.nodes, graphId)
  if (!state.ok || state.value.locked) throw new Error('Unlock the graph item and its ancestors before connecting inputs')
  const ids = [...new Set(sourceIds)]
  if (ids.includes(graphId)) throw new Error('A graph item cannot connect to itself')
  const existing = new Map(graph.graphColumn.inputs.map(i => [i.sourceId, i.id]))
  const next = { ...board, nodes: board.nodes.map(n => n.id === graphId ? { ...n, graphColumn: { ...graph.graphColumn!, inputs: ids.map(sourceId => ({ sourceId, id: existing.get(sourceId) || `input-${sourceId}` })) } } : n) }
  // Validate types, missing IDs and cycles before publishing an edit.
  new GraphColumnRuntime().evaluate(next, graphId)
  return next
}

/** Reconnection retains the existing port identity and one atomic history edit. */
export function editGraphColumn(board: BoardModel, graphId: string, edit: { operation?: 'collect' | 'count' | 'text'; inputs?: NonNullable<BoardNode['graphColumn']>['inputs'] }): BoardModel {
  const graph = board.nodes.find(n => n.id === graphId)
  const state = diagramState(board.nodes, graphId)
  if (!graph?.graphColumn || !state.ok || state.value.locked) throw new Error('Unlock the graph item and its ancestors before editing')
  const next = { ...board, nodes: board.nodes.map(n => n.id === graphId ? { ...n, graphColumn: { ...graph.graphColumn!, ...edit } } : n) }
  // Changing an upstream operation must not silently invalidate a downstream graph.
  const runtime = new GraphColumnRuntime()
  const affected = new Set([graphId])
  let changed = true
  while(changed) { changed=false;for(const node of next.nodes)if(node.graphColumn&&!affected.has(node.id)&&(node.graphColumn.inputs.some(i=>affected.has(i.sourceId)) || next.nodes.some(child=>child.groupId===node.id&&affected.has(child.id)))){affected.add(node.id);changed=true} }
  for (const id of affected) runtime.evaluate(next, id)
  return next
}

/** Explicit copy-only migration. Preserve authored positions, prose, assets and
 * ordinary Columns. The source board and legacy graph remain recoverable. */
export function migrateLegacyGraphColumns(board: BoardModel, copyId: string): BoardModel {
  if (!copyId || copyId === board.id) throw new Error('Migration requires a distinct board copy ID')
  const copy = structuredClone(board)
  const columns = new Set(copy.nodes.filter(n => n.kind === 'column' && (n as BoardNode & {columnMode?:string}).columnMode === 'node').map(n => n.id))
  copy.id = copyId; copy.title += ' — Graph Column 2 migration'
  copy.nodes = copy.nodes.map(n => {
    if (columns.has(n.id)) {
      const inputs = copy.nodes.filter(child => child.parentColumnId === n.id).map(child => ({ id: 'input-' + child.id, sourceId: child.id }))
      const migrated = { ...n, kind: 'group' as const, graphColumn: { version: 2 as const, operation: 'collect' as const, inputs } }
      delete (migrated as BoardNode & {columnMode?:string}).columnMode
      return migrated
    }
    if (n.parentColumnId && columns.has(n.parentColumnId)) {
      const migrated = { ...n, groupId: n.parentColumnId }; delete migrated.parentColumnId
      return migrated
    }
    return n
  })
  // Old semantic graph is retained in this separate board's metadata for audit;
  // evaluation now uses the versioned per-item graph definitions.
  return copy
}
