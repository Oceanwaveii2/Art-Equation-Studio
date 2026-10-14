import { requestAppFrame } from '../canvas-engine/appFrameClock'
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { saveGeneratedImage } from '../storage/workspace'
import { managedAsset, type AssetCollection, type AssetKind, type BoardModel, type ProjectAsset } from '../model/project'
import { analyzeSemanticIndex, getSemanticIndexStatus, prepareSemanticIndex, rebuildSemanticAnn, type SemanticAnalysis, type SemanticIndexStatus } from '../storage/workspace'
import { SemanticIndexer, type SemanticIndexProgress } from '../semantic/SemanticIndexer'
import { SemanticSearchClient } from '../semantic/SemanticSearchClient'
import { SemanticClusterReview } from '../semantic/SemanticClusterReview'
import { useModalFocus } from '../ui/useModalFocus'
import './AssetManager.css'

const ApisrUpscaler = lazy(() => import('./ApisrUpscaler').then((module) => ({ default: module.ApisrUpscaler })))

class UpscalerErrorBoundary extends Component<{ onBack: () => void; children: React.ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) } }
  render() {
    if (this.state.error) return <section className="asset-manager-loading upscaler-failure" role="alert"><strong>Local upscaler was stopped safely</strong><p>The optional upscaler could not start. The project and Mini Bridge are still safe.</p><code>{this.state.error}</code><button type="button" onClick={this.props.onBack}>Back to assets</button></section>
    return this.props.children
  }
}

type AssetManagerProps = {
  projectId: string
  projectName: string
  board: BoardModel
  workspaceRoot: string
  readOnly: boolean
  onApplySemanticClusters: (clusters: Array<{ title: string; assetIds: string[] }>, target: 'groups' | 'columns') => void
  assets: ProjectAsset[]
  assetUsage: Record<string, number>
  collections: AssetCollection[]
  onCollectionsChange: (collections: AssetCollection[]) => void
  openWith: Record<string, string>
  onOpenWith: (asset: ProjectAsset, applicationPath: string) => void
  onOpenWithChange: (extension: string, applicationPath: string) => void
  onChange: (assets: ProjectAsset[]) => void
  onClose: () => void
  onPopOut?: () => void
  onImport: (kind: AssetKind) => void
  onRelink: (asset: ProjectAsset) => void
  onRelinkMany: (assets: ProjectAsset[]) => void
  onReveal: (asset: ProjectAsset) => void
  onMaterialize: (assets: ProjectAsset[]) => Promise<void>
  onCollect: () => void
  onRepairDependencies: (asset: ProjectAsset) => void
  canRollbackManaged: boolean
  onRollbackManaged: () => void
  onGenerated: (asset: ProjectAsset, addToBoard: boolean) => void
  onSetCover: (assetId?: string) => void
  onTrashAsset: (assetId: string) => void
  onRequestText: (options: { title: string; label: string; initialValue?: string; helpText?: string }) => Promise<string | null>
}

export function AssetManager({ projectId, projectName, board, workspaceRoot, readOnly, onApplySemanticClusters, assets, assetUsage, collections, onCollectionsChange, openWith, onOpenWith, onOpenWithChange, onChange, onClose, onPopOut, onImport, onRelink, onRelinkMany, onReveal, onMaterialize, onCollect, onRepairDependencies, canRollbackManaged, onRollbackManaged, onGenerated, onSetCover, onTrashAsset, onRequestText }: AssetManagerProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useModalFocus(dialogRef, searchRef)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assetMenu, setAssetMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const assetMenuRef = useRef<HTMLDivElement>(null)
  const assetMenuOriginRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!assetMenu) return
    requestAppFrame(() => assetMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.asset-item-menu')) setAssetMenu(null) }
    window.addEventListener('pointerdown', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss) }
  }, [assetMenu])
  const [undoSnapshot, setUndoSnapshot] = useState<ProjectAsset[] | null>(null)
  const [materializing, setMaterializing] = useState(false)
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null)
  const [semanticBusy, setSemanticBusy] = useState(false)
  const [semanticError, setSemanticError] = useState('')
  const [semanticProgress, setSemanticProgress] = useState<SemanticIndexProgress | null>(null)
  const semanticIndexer = useRef(new SemanticIndexer())
  const semanticSearchClient = useRef(new SemanticSearchClient())
  const [searchMode, setSearchMode] = useState<'metadata' | 'semantic'>('metadata')
  const [semanticMatches, setSemanticMatches] = useState<Record<string, number> | null>(null)
  const [semanticSearchStatus, setSemanticSearchStatus] = useState('')
  const [semanticSearching, setSemanticSearching] = useState(false)
  const [semanticAnalysis, setSemanticAnalysis] = useState<SemanticAnalysis | null>(null)
  const [sortMode, setSortMode] = useState<'name' | 'newest' | 'largest' | 'type' | 'status' | 'usage'>('name')
  const [kindFilter, setKindFilter] = useState<'all' | AssetKind>('all')
  const [catalogView, setCatalogView] = useState<'all' | 'recent' | 'attention' | 'favorites' | 'duplicates' | 'history' | 'unused' | 'moved' | 'orphaned' | 'near-duplicates'>('all')
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'preview-pending' | 'modified' | 'missing' | 'moved' | 'unused'>('all')
  const [catalogLayout, setCatalogLayout] = useState<'list' | 'grid'>('grid')
  const [scopeMode, setScopeMode] = useState<'board' | 'project' | 'unplaced' | 'unlinked'>('board')
  const [folderFilter, setFolderFilter] = useState('all')
  const [thumbnailSize, setThumbnailSize] = useState(170)
  const [activeTool, setActiveTool] = useState<'catalog' | 'upscaler'>('catalog')
  const [nearDuplicateIds, setNearDuplicateIds] = useState<string[]>([])
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!showToolsMenu) return
    requestAppFrame(() => toolsRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
    const dismiss = (event: PointerEvent) => { if (!toolsRef.current?.contains(event.target as Node)) setShowToolsMenu(false) }
    window.addEventListener('pointerdown', dismiss, true)
    return () => window.removeEventListener('pointerdown', dismiss, true)
  }, [showToolsMenu])
  const [showBatchTray, setShowBatchTray] = useState(false)
  const [showConversionTray, setShowConversionTray] = useState(false)
  const [conversionFormat, setConversionFormat] = useState<'png' | 'jpeg' | 'webp'>('png')
  const [conversionQuality, setConversionQuality] = useState(90)
  const [converting, setConverting] = useState(false)
  const [conversionStatus, setConversionStatus] = useState('')
  const [inspectorTab, setInspectorTab] = useState<'preview' | 'metadata' | 'lineage' | 'dependencies' | 'placements'>('preview')
  const assignmentExtensions = ['ztl', 'zpr', 'psd', 'ai', 'pdf', 'blend', 'obj', 'glb', 'gltf', 'jpg', 'png']
  const unusedCount = assets.filter((asset) => !assetUsage[asset.id] && !asset.generated).length
  const duplicateIds = useMemo(() => new Set(assets.filter((asset) => asset.deduplicated || assets.some((other) => other.id !== asset.id && other.originalName.toLowerCase() === asset.originalName.toLowerCase())).map((asset) => asset.id)), [assets])
  const nearDuplicateIdSet = useMemo(() => new Set(nearDuplicateIds), [nearDuplicateIds])
  const boardAssetIds = useMemo(() => new Set(board.nodes.flatMap((node) => node.assetId ? [node.assetId] : [])), [board.nodes])
  const unlinkedPlacementCount = useMemo(() => board.nodes.filter((node) => ['image','video','model','document'].includes(node.kind) && !node.assetId).length, [board.nodes])
  const orphanedIds = useMemo(() => new Set(assets.filter((asset) => asset.dependencies?.some((dependency) => dependency.status === 'missing') || (asset.generated && !assets.some((source) => source.id === asset.generated?.sourceAssetId))).map((asset) => asset.id)), [assets])
  const movedCount = assets.filter((asset) => asset.status === 'moved').length
  const missingCount = assets.filter((asset) => asset.status === 'missing').length
  const orphanCount = orphanedIds.size
  const duplicateCount = duplicateIds.size
  const nearDuplicateCount = nearDuplicateIdSet.size
  const normalizedQuery = query.trim().toLowerCase()
  const semanticScore = (assetId: string) => semanticMatches?.[`asset:${assetId}`]
  const [recentCutoff] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000)
  const filtered = useMemo(() => assets
    .filter((asset) => scopeMode === 'project' || scopeMode === 'unlinked' ? scopeMode !== 'unlinked' : scopeMode === 'board' ? boardAssetIds.has(asset.id) : !boardAssetIds.has(asset.id))
    .filter((asset) => folderFilter === 'all' || asset.virtualFolder === folderFilter)
    .filter((asset) => kindFilter === 'all' || asset.kind === kindFilter)
    .filter((asset) => collectionFilter === 'all' || asset.collectionIds?.includes(collectionFilter))
    .filter((asset) => statusFilter === 'all' || (statusFilter === 'unused' ? !assetUsage[asset.id] && !asset.generated : asset.status === statusFilter))
    .filter((asset) => catalogView === 'all' || (catalogView === 'recent' && Date.parse(asset.importedAt) >= recentCutoff) || (catalogView === 'attention' && asset.status !== 'available') || (catalogView === 'favorites' && asset.favorite) || (catalogView === 'duplicates' && duplicateIds.has(asset.id)) || (catalogView === 'history' && Boolean(asset.history?.length)) || (catalogView === 'unused' && !assetUsage[asset.id] && !asset.generated) || (catalogView === 'moved' && asset.status === 'moved') || (catalogView === 'orphaned' && orphanedIds.has(asset.id)) || (catalogView === 'near-duplicates' && nearDuplicateIdSet.has(asset.id)))
    .filter((asset) => searchMode === 'semantic' && semanticMatches ? semanticScore(asset.id) !== undefined : !normalizedQuery || [asset.displayName, asset.originalName, asset.virtualFolder, asset.kind, ...asset.aliases].some((value) => value.toLowerCase().includes(normalizedQuery)))
    .sort((a, b) => searchMode === 'semantic' && semanticMatches ? (semanticScore(b.id) || -1) - (semanticScore(a.id) || -1) : sortMode === 'newest' ? b.importedAt.localeCompare(a.importedAt) : sortMode === 'largest' ? b.byteLength - a.byteLength : sortMode === 'type' ? a.extension.localeCompare(b.extension) || a.displayName.localeCompare(b.displayName) : sortMode === 'status' ? a.status.localeCompare(b.status) || a.displayName.localeCompare(b.displayName) : sortMode === 'usage' ? (assetUsage[b.id] || 0) - (assetUsage[a.id] || 0) || a.displayName.localeCompare(b.displayName) : a.displayName.localeCompare(b.displayName)), [assets, assetUsage, boardAssetIds, scopeMode, folderFilter, duplicateIds, nearDuplicateIdSet, normalizedQuery, sortMode, kindFilter, catalogView, collectionFilter, statusFilter, orphanedIds, recentCutoff, searchMode, semanticMatches])
  const groups = useMemo(() => {
    const grouped = new Map<string, ProjectAsset[]>()
    filtered.forEach((asset) => grouped.set(asset.virtualFolder, [...(grouped.get(asset.virtualFolder) || []), asset]))
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])
  const projectFolders = useMemo(() => [...new Set(assets.map((asset) => asset.virtualFolder))].sort((a, b) => a.localeCompare(b)), [assets])
  const inspectedAsset = assets.find((asset) => asset.id === selectedIds.at(-1)) || filtered[0]

  useEffect(() => {
    let active = true
    void getSemanticIndexStatus(projectId).then(async (status) => {
      if (!active) return
      setSemanticStatus(status)
      // Existing indexes are checked against current project sources whenever the
      // catalog opens. This is intentionally metadata-only; embeddings are only
      // refreshed by the explicit local refresh command below.
      if (['ready', 'partial', 'stale'].includes(status.state)) {
        const refreshed = await prepareSemanticIndex(projectId)
        if (active) setSemanticStatus(refreshed)
      }
    }).catch((error) => { if (active) setSemanticError(String(error)) })
    return () => { active = false }
  }, [projectId])

  useEffect(() => () => semanticSearchClient.current.dispose(), [])

  async function prepareSemanticSources() {
    setSemanticBusy(true)
    setSemanticError('')
    try { setSemanticStatus(await prepareSemanticIndex(projectId)) }
    catch (error) { setSemanticError(String(error)) }
    finally { setSemanticBusy(false) }
  }

  async function buildSemanticIndex() {
    setSemanticBusy(true)
    setSemanticError('')
    try { setSemanticStatus(await semanticIndexer.current.run(projectId, workspaceRoot, setSemanticProgress)) }
    catch (error) { if (semanticProgress?.phase !== 'cancelled') setSemanticError(String(error)) }
    finally { setSemanticBusy(false) }
  }

  async function repairSemanticAnn() {
    setSemanticBusy(true); setSemanticError('')
    try { setSemanticStatus(await rebuildSemanticAnn(projectId)) }
    catch (error) { setSemanticError(String(error)) }
    finally { setSemanticBusy(false) }
  }

  function showSemanticResults(results: Array<{ recordId: string; score: number }>) {
    setSemanticMatches(Object.fromEntries(results.map((result) => [result.recordId, result.score])))
    setSearchMode('semantic')
    setKindFilter('image')
  }

  async function runSemanticSearch() {
    if (!query.trim() || semanticStatus?.state !== 'ready') return
    setSemanticSearching(true); setSemanticError(''); setSemanticSearchStatus('Preparing search…')
    try {
      const results = await semanticSearchClient.current.search(projectId, query.trim(), setSemanticSearchStatus)
      showSemanticResults(results)
      setSemanticSearchStatus(`${results.length} visual matches`)
    } catch (error) { setSemanticError(String(error)) }
    finally { setSemanticSearching(false) }
  }

  async function findSimilar(asset: ProjectAsset) {
    setSemanticSearching(true); setSemanticError(''); setSemanticSearchStatus(`Finding images similar to ${asset.displayName}…`)
    try {
      const results = await semanticSearchClient.current.findSimilar(projectId, asset.id)
      showSemanticResults(results)
      setQuery(`Similar to: ${asset.displayName}`)
      setSemanticSearchStatus(`${results.length} visually similar assets`)
    } catch (error) { setSemanticError(String(error)) }
    finally { setSemanticSearching(false) }
  }

  async function reviewSemanticClusters() {
    setSemanticSearching(true); setSemanticError(''); setSemanticSearchStatus('Analyzing visual relationships…')
    try {
      const analysis = await analyzeSemanticIndex(projectId)
      setSemanticAnalysis(analysis)
      setNearDuplicateIds([...new Set(analysis.nearDuplicates.flatMap((pair) => [pair.leftRecordId.replace(/^asset:/, ''), pair.rightRecordId.replace(/^asset:/, '')]))])
      setSemanticSearchStatus('')
    }
    catch (error) { setSemanticError(String(error)) }
    finally { setSemanticSearching(false) }
  }

  async function suggestSemanticTags() {
    if (semanticStatus?.state !== 'ready') return
    const selected = new Set(selectedIds)
    const targets = (selected.size ? assets.filter((asset) => selected.has(asset.id)) : filtered).filter((asset) => asset.kind === 'image')
    if (!targets.length) { setSemanticError('Select or show at least one indexed image before requesting suggestions.'); return }
    const defaultVocabulary = 'portrait, character, creature, landscape, city, architecture, interior, vehicle, animal, botanical, food, object, product, fashion, sculpture, concept art, illustration, photograph, cinematic, dramatic lighting, soft lighting, warm palette, cool palette, monochrome, close-up, wide shot'
    const entered = await onRequestText({ title: 'Suggest asset tags', label: 'Local vocabulary (comma separated)', initialValue: defaultVocabulary, helpText: 'The app only proposes tags. It never applies them automatically.' })
    if (!entered?.trim()) return
    const vocabulary = [...new Set(entered.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, 40)
    if (!vocabulary.length) return
    setSemanticSearching(true); setSemanticError(''); setSemanticSearchStatus(`Scoring ${vocabulary.length} local visual labels…`)
    try {
      const byAsset = new Map<string, Array<{ tag: string; score: number }>>()
      for (let index = 0; index < vocabulary.length; index += 1) {
        setSemanticSearchStatus(`Scoring label ${index + 1}/${vocabulary.length}: ${vocabulary[index]}`)
        const matches = await semanticSearchClient.current.search(projectId, `an image of ${vocabulary[index]}`, () => {})
        for (const match of matches) {
          const assetId = match.recordId.replace(/^asset:/, '')
          if (!targets.some((asset) => asset.id === assetId)) continue
          byAsset.set(assetId, [...(byAsset.get(assetId) || []), { tag: vocabulary[index], score: match.score }])
        }
      }
      const generatedAt = new Date().toISOString()
      commit(assets.map((asset) => {
        const ranked = (byAsset.get(asset.id) || []).sort((a, b) => b.score - a.score).filter((entry, index, all) => all.findIndex((candidate) => candidate.tag === entry.tag) === index).slice(0, 3)
        if (!ranked.length) return asset
        const semanticSuggestions = ranked.map((entry) => ({ ...entry, decision: 'pending' as const, generatedAt }))
        const accepted = asset.semanticSuggestions?.filter((entry) => entry.decision === 'accepted').map((entry) => entry.tag) || []
        const filenameTags = [...new Set([...accepted, ...ranked.map((entry) => entry.tag)])].slice(0, 2)
        const stem = filenameTags.map(slugify).filter(Boolean).join('_')
        return { ...asset, semanticSuggestions, semanticFilenameSuggestion: stem ? `${stem}_${slugify(asset.originalName.replace(/\.[^.]+$/, ''))}.${asset.extension.toLowerCase()}` : undefined }
      }))
      setSemanticSearchStatus(`Suggestions ready for ${byAsset.size} image${byAsset.size === 1 ? '' : 's'} — review them below.`)
    } catch (error) { setSemanticError(String(error)) }
    finally { setSemanticSearching(false) }
  }

  function decideSemanticSuggestion(asset: ProjectAsset, tag: string, decision: 'accepted' | 'rejected') {
    const semanticSuggestions = (asset.semanticSuggestions || []).map((entry) => entry.tag === tag ? { ...entry, decision } : entry)
    const tags = decision === 'accepted' ? [...new Set([...(asset.tags || []), tag])] : (asset.tags || [])
    commit(assets.map((entry) => entry.id === asset.id ? { ...entry, semanticSuggestions, tags, aliases: decision === 'accepted' ? [...new Set([...entry.aliases, tag])] : entry.aliases, history: [...(entry.history || []), { at: new Date().toISOString(), action: decision === 'accepted' ? 'Accepted semantic tag' : 'Rejected semantic tag', detail: tag }] } : entry))
  }

  function applySemanticFilename(asset: ProjectAsset) {
    const proposal = asset.semanticFilenameSuggestion
    if (!proposal) return
    const displayName = proposal.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    commit(assets.map((entry) => entry.id === asset.id ? { ...entry, displayName, history: [...(entry.history || []), { at: new Date().toISOString(), action: 'Applied semantic filename proposal', detail: proposal }] } : entry))
  }

  function commit(next: ProjectAsset[]) {
    if (!undoSnapshot) setUndoSnapshot(assets)
    onChange(next)
  }

  function updateAsset(id: string, update: Partial<ProjectAsset>) {
    commit(assets.map((asset) => asset.id === id ? { ...asset, ...update } : asset))
  }

  function autoOrganize() {
    const counters = new Map<AssetKind, number>()
    const next = assets.map((asset) => {
      const number = (counters.get(asset.kind) || 0) + 1
      counters.set(asset.kind, number)
      const label = asset.kind === 'image' ? 'Image' : asset.kind === 'video' ? 'Video' : asset.kind === 'model' ? '3D model' : asset.kind === 'document' ? 'Document' : asset.kind === 'font' ? 'Font' : 'File'
      const stem = asset.originalName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
      return { ...asset, displayName: `${label} ${String(number).padStart(3, '0')} — ${stem}`, virtualFolder: `${label}s` }
    })
    commit(next)
  }

  function numberSelected() {
    const selected = new Set(selectedIds)
    let sequence = 0
    commit(assets.map((asset) => selected.has(asset.id) ? { ...asset, displayName: `${String(++sequence).padStart(3, '0')} — ${asset.displayName.replace(/^\d+\s*[—-]\s*/, '')}` } : asset))
  }

  async function renameSelected() {
    const template = (await onRequestText({ title: 'Batch rename assets', label: 'Name template', initialValue: '{n} — {name}', helpText: 'Tokens: {n}, {name}, {type}, {ext}' }))?.trim()
    if (!template) return
    const selected = new Set(selectedIds)
    let sequence = 0
    commit(assets.map((asset) => {
      if (!selected.has(asset.id)) return asset
      sequence += 1
      const cleanName = asset.displayName.replace(/^\d+\s*[—-]\s*/, '').trim()
      return { ...asset, displayName: template.replaceAll('{n}', String(sequence).padStart(3, '0')).replaceAll('{name}', cleanName).replaceAll('{type}', asset.kind).replaceAll('{ext}', asset.extension.toLowerCase()) }
    }))
  }

  async function convertSelected() {
    const selected = assets.filter((asset) => selectedIds.includes(asset.id) && asset.kind === 'image' && asset.status === 'available')
    if (!selected.length || converting || readOnly) return
    setConverting(true)
    setConversionStatus(`Preparing ${selected.length} image${selected.length === 1 ? '' : 's'}…`)
    try {
      for (const [index, asset] of selected.entries()) {
        setConversionStatus(`Converting ${index + 1}/${selected.length}: ${asset.displayName}`)
        const response = await fetch(convertFileSrc(`${workspaceRoot.replace(/[\\/]+$/, '')}\\${asset.relativePath.replaceAll('/', '\\')}`))
        if (!response.ok) throw new Error(`Could not read ${asset.displayName}`)
        const bitmap = await createImageBitmap(await response.blob())
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('The browser could not start image conversion')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode converted image')), `image/${conversionFormat}`, conversionFormat === 'png' ? undefined : conversionQuality / 100))
        const extension = conversionFormat === 'jpeg' ? 'jpg' : conversionFormat
        const stem = asset.displayName.replace(/\.[^.]+$/, '') || 'converted-image'
        const record = await saveGeneratedImage(new Uint8Array(await blob.arrayBuffer()), { projectId, projectName, boardName: board.title, fileName: `${stem}_converted.${extension}` })
        onGenerated({
          ...managedAsset(record), displayName: record.originalName.replace(/\.[^.]+$/, ''), virtualFolder: `Generated / Converted / ${board.title}`, managedRelativePath: record.relativePath, status: 'available',
          generated: { engine: 'board-transform', sourceAssetId: asset.id, sourceRelativePath: asset.relativePath, boardId: board.id, operation: 'convert', sourceWidth: canvas.width, sourceHeight: canvas.height, outputWidth: canvas.width, outputHeight: canvas.height, generatedAt: new Date().toISOString() },
        }, false)
      }
      setConversionStatus(`Saved ${selected.length} converted image${selected.length === 1 ? '' : 's'} as disk-backed derived assets.`)
    } catch (error) {
      setConversionStatus(`Conversion stopped: ${String(error)}`)
    } finally {
      setConverting(false)
    }
  }

  async function moveSelected() {
    const currentFolders = [...new Set(assets.filter((asset) => selectedIds.includes(asset.id)).map((asset) => asset.virtualFolder))]
    const folder = (await onRequestText({ title: 'Move assets', label: 'Virtual folder', initialValue: currentFolders.length === 1 ? currentFolders[0] : 'Unsorted' }))?.trim()
    if (!folder) return
    const selected = new Set(selectedIds)
    commit(assets.map((asset) => selected.has(asset.id) ? { ...asset, virtualFolder: folder } : asset))
  }

  async function tagSelected() {
    const tag = (await onRequestText({ title: 'Tag selected assets', label: 'Shared alias or tag', initialValue: 'reference' }))?.trim()
    if (!tag) return
    const selected = new Set(selectedIds)
    commit(assets.map((asset) => selected.has(asset.id) ? { ...asset, aliases: [...new Set([...asset.aliases, tag])], tags: [...new Set([...(asset.tags || []), tag])], history: [...(asset.history || []), { at: new Date().toISOString(), action: 'Tagged', detail: tag }] } : asset))
  }

  async function createCollection() {
    const name = (await onRequestText({ title: 'New asset collection', label: 'Collection name', initialValue: 'Favorites' }))?.trim()
    if (name) onCollectionsChange([...collections, { id: `collection-${crypto.randomUUID()}`, name }])
  }

  async function addToCollection() {
    if (!selectedIds.length || !collections.length) return
    const menu = collections.map((collection, index) => `${index + 1}. ${collection.name}`).join('\n')
    const choice = await onRequestText({ title: 'Add to collection', label: 'Collection number or exact name', initialValue: '1', helpText: menu })
    const collection = collections[Number(choice) - 1] || collections.find((entry) => entry.name.toLocaleLowerCase() === choice?.trim().toLocaleLowerCase())
    if (!collection) return
    const selected = new Set(selectedIds)
    commit(assets.map((asset) => selected.has(asset.id) ? { ...asset, collectionIds: [...new Set([...(asset.collectionIds || []), collection.id])], history: [...(asset.history || []), { at: new Date().toISOString(), action: 'Added to collection', detail: collection.name }] } : asset))
  }

  function toggleFavorite(asset: ProjectAsset) {
    commit(assets.map((entry) => entry.id === asset.id ? { ...entry, favorite: !entry.favorite, history: [...(entry.history || []), { at: new Date().toISOString(), action: entry.favorite ? 'Unfavorited' : 'Favorited' }] } : entry))
  }

  function toggleFavoriteSelected() {
    if (!selectedIds.length) return
    const selected = new Set(selectedIds)
    const targets = assets.filter((asset) => selected.has(asset.id))
    const shouldFavorite = targets.some((asset) => !asset.favorite)
    commit(assets.map((asset) => selected.has(asset.id) ? { ...asset, favorite: shouldFavorite, history: [...(asset.history || []), { at: new Date().toISOString(), action: shouldFavorite ? 'Favorited in bulk' : 'Unfavorited in bulk' }] } : asset))
  }

  async function renameFolder(currentFolder: string) {
    const folder = (await onRequestText({ title: 'Rename virtual folder', label: 'Folder name', initialValue: currentFolder }))?.trim()
    if (!folder || folder === currentFolder) return
    commit(assets.map((asset) => asset.virtualFolder === currentFolder ? { ...asset, virtualFolder: folder } : asset))
  }

  function undoCatalogChange() {
    if (!undoSnapshot) return
    onChange(undoSnapshot)
    setUndoSnapshot(null)
  }

  async function syncDiskNames() {
    const selected = new Set(selectedIds)
    const targets = selected.size ? assets.filter((asset) => selected.has(asset.id)) : filtered
    setMaterializing(true)
    try { await onMaterialize(targets) } finally { setMaterializing(false) }
  }

  function thumbnailUrl(asset: ProjectAsset, fullSize = false) {
    if (!workspaceRoot || asset.status === 'missing') return undefined
    const sourcePath = asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath
    const browserRaster = asset.kind === 'image' && !asset.requiresTiledPreview && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(asset.extension.toLowerCase().replace(/^\./, ''))
    const relativePath = fullSize && browserRaster ? sourcePath : asset.thumbnailRelativePath || (asset.kind === 'image' ? sourcePath : undefined)
    if (!relativePath) return undefined
    try {
      if (/^[a-zA-Z]:[\\/]/.test(relativePath)) return convertFileSrc(relativePath)
      return convertFileSrc(`${workspaceRoot.replace(/[\\/]+$/, '')}\\${relativePath.replaceAll('/', '\\')}`)
    } catch { return undefined }
  }

  function leaveMenu(event: React.KeyboardEvent<HTMLDivElement>, origin: HTMLElement | null) {
    navigateMenu(event)
    if (event.key !== 'Tab') return
    event.preventDefault()
    setAssetMenu(null); setShowToolsMenu(false)
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex]') || [])].filter((item) => {
      if (item.tabIndex < 0 || item.closest('[role="menu"],[inert]') || !item.getClientRects().length) return false
      for (let parent = item.parentElement; parent && parent !== dialogRef.current; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false
      return true
    })
    const index = origin ? controls.indexOf(origin) : -1
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
  }

  function openAssetActions(asset: ProjectAsset, origin: HTMLElement, x: number, y: number) {
    origin.focus({ preventScroll: true })
    assetMenuOriginRef.current = origin
    setShowToolsMenu(false); setSelectedIds([asset.id])
    setAssetMenu({ id: asset.id, x: Math.max(8, Math.min(x, window.innerWidth - 230)), y: Math.max(8, Math.min(y, window.innerHeight - 260)) })
  }

  return (
    <section ref={dialogRef} className="asset-manager mini-bridge" role="dialog" aria-modal="true" aria-label="Project Mini Bridge" tabIndex={-1} onKeyDown={(event) => {
      event.stopPropagation()
      if (event.defaultPrevented || event.key !== 'Escape') return
      event.preventDefault()
      if (assetMenu) { setAssetMenu(null); assetMenuOriginRef.current?.focus() }
      else if (showToolsMenu) { setShowToolsMenu(false); toolsButtonRef.current?.focus() }
      else onClose()
    }}>
      <header className="mini-bridge-titlebar">
        <div className="mini-bridge-identity"><span className="bridge-mark">AE</span><div><span className="eyebrow">Board-scoped asset companion</span><h2>Mini Bridge · {projectName} · {board.title}</h2><p><strong>Project root</strong><span>{workspaceRoot || `projects/${projectId}`}</span></p></div></div>
        <div className="asset-manager-actions">
          <button type="button" onClick={() => onImport('image')}>＋ Import</button>
          <button type="button" title="Copy the complete project to a self-contained folder" onClick={onCollect}>Collect project</button>
          <div ref={toolsRef} className="bridge-tools-menu">
            <button ref={toolsButtonRef} type="button" aria-haspopup="menu" aria-controls={showToolsMenu ? 'mini-bridge-tools-menu' : undefined} aria-expanded={showToolsMenu} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setAssetMenu(null); setShowToolsMenu(true) } }} onClick={() => { setAssetMenu(null); setShowToolsMenu((visible) => !visible) }}>Tools <span>⌄</span></button>
            {showToolsMenu && <div id="mini-bridge-tools-menu" role="menu" aria-label="Mini Bridge tools" onKeyDown={(event) => leaveMenu(event, toolsButtonRef.current)}>
              <button type="button" role="menuitem" onClick={() => { setActiveTool('upscaler'); setShowToolsMenu(false); toolsButtonRef.current?.focus() }}>Local upscaler<small>Process board or project images here</small></button>
              <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); toolsButtonRef.current?.focus(); void prepareSemanticSources() }}>Scan integrity<small>Check project-local source records</small></button>
              <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); toolsButtonRef.current?.focus(); void reviewSemanticClusters() }} disabled={semanticStatus?.state !== 'ready'}>Semantic review<small>Clusters and near-duplicates</small></button>
            </div>}
          </div>
          {onPopOut && <button type="button" onClick={onPopOut} title="Open this Mini Bridge in its own window">Pop out</button>}
          <button className="primary-button" type="button" onClick={onClose}>Done</button>
        </div>
      </header>
      <div className="asset-health"><strong>Project health</strong><span>{assets.length - unusedCount}/{assets.length} in use</span><span className={unusedCount ? 'warning' : ''}>{unusedCount} unused</span><span className={missingCount ? 'warning' : ''}>{missingCount} missing</span><span className={movedCount ? 'warning' : ''}>{movedCount} moved</span><span>{duplicateCount} duplicate</span><span className={nearDuplicateCount ? 'warning' : ''}>{nearDuplicateCount} near-duplicate</span><span className={orphanCount ? 'warning' : ''}>{orphanCount} orphaned</span><span className="bridge-cache-state">● Thumbnails cached</span><span>● Watcher idle</span></div>
      {activeTool === 'upscaler' ? <UpscalerErrorBoundary onBack={() => setActiveTool('catalog')}><Suspense fallback={<div className="asset-manager-loading">Loading local upscaler…</div>}><ApisrUpscaler embedded assets={assets} board={board} projectId={projectId} projectName={projectName} workspaceRoot={workspaceRoot} readOnly={readOnly} initialSelectedIds={selectedIds} onGenerated={onGenerated} onClose={() => setActiveTool('catalog')} /></Suspense></UpscalerErrorBoundary> : <div className="mini-bridge-workspace">
        <aside className="mini-bridge-sidebar" aria-label="Mini Bridge navigation">
          <section><header><span>Active board</span><small>{board.title}</small></header><button className={scopeMode === 'board' ? 'active' : ''} type="button" onClick={() => { setScopeMode('board'); setFolderFilter('all') }}><span>▧</span><strong>On this board</strong><small>{boardAssetIds.size}</small></button><button className={scopeMode === 'unlinked' ? 'active' : ''} type="button" onClick={() => { setScopeMode('unlinked'); setFolderFilter('all') }}><span>⚠</span><strong>Unlinked placements</strong><small>{unlinkedPlacementCount}</small></button><button className={scopeMode === 'unplaced' ? 'active' : ''} type="button" onClick={() => { setScopeMode('unplaced'); setFolderFilter('all') }}><span>○</span><strong>Project, not placed</strong><small>{assets.length - boardAssetIds.size}</small></button></section>
          <section><header><span>Project folders</span><button type="button" title="Refresh project folders">↻</button></header><button className={scopeMode === 'project' && folderFilter === 'all' ? 'active' : ''} type="button" onClick={() => { setScopeMode('project'); setFolderFilter('all'); setCatalogView('all'); setCollectionFilter('all') }}><span>▾</span><strong>All project assets</strong><small>{assets.length}</small></button>{projectFolders.map((folder) => <button className={scopeMode === 'project' && folderFilter === folder ? 'active' : ''} type="button" key={folder} onClick={() => { setScopeMode('project'); setFolderFilter(folder); setQuery(''); setCatalogView('all'); setCollectionFilter('all'); setStatusFilter('all') }}><span>▱</span><strong>{folder}</strong><small>{assets.filter((asset) => asset.virtualFolder === folder).length}</small></button>)}</section>
          <section><header><span>Collections</span><button type="button" onClick={createCollection}>＋</button></header>{collections.map((collection) => <button className={collectionFilter === collection.id ? 'active' : ''} type="button" key={collection.id} onClick={() => setCollectionFilter(collection.id)}><span>◇</span><strong>{collection.name}</strong></button>)}{!collections.length && <p>No project collections yet.</p>}</section>
          <section><header><span>Canvas placements</span></header><button type="button" onClick={() => setSortMode('usage')}><span>▧</span><strong>Placed on boards</strong><small>{assets.filter((asset) => assetUsage[asset.id]).length}</small></button><button type="button" onClick={() => setCatalogView('unused')}><span>○</span><strong>Not placed</strong><small>{unusedCount}</small></button></section>
          <section><header><span>Smart states</span></header>{([['attention','Needs attention',missingCount + movedCount],['duplicates','Duplicates',duplicateCount],['near-duplicates','Near-duplicates',nearDuplicateCount],['orphaned','Orphaned',orphanCount],['history','Version history',assets.filter((asset) => asset.history?.length).length]] as const).map(([view,label,count]) => <button className={catalogView === view ? 'active' : ''} type="button" key={view} onClick={() => setCatalogView(view)}><span>•</span><strong>{label}</strong><small>{count}</small></button>)}</section>
        </aside>
        <main className="mini-bridge-center">
          <div className="asset-manager-tools bridge-searchbar">
            <select value={searchMode} onChange={(event) => { const mode = event.target.value as typeof searchMode; setSearchMode(mode); if (mode === 'metadata') { setSemanticMatches(null); setSemanticSearchStatus('') } }} aria-label="Asset search mode"><option value="metadata">Metadata</option><option value="semantic" disabled={semanticStatus?.state !== 'ready'}>Visual meaning</option></select>
            <input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); if (searchMode === 'semantic') setSemanticMatches(null) }} onKeyDown={(event) => { if (event.key === 'Enter' && searchMode === 'semantic') void runSemanticSearch() }} placeholder={searchMode === 'semantic' ? "Describe the image you're looking for…" : 'Search this project'} aria-label="Search assets" />
            {searchMode === 'semantic' && <><button type="button" className="semantic-search-button" onClick={() => void runSemanticSearch()} disabled={!query.trim() || semanticSearching || semanticStatus?.state !== 'ready'}>{semanticSearching ? 'Searching…' : 'Search visually'}</button>{semanticSearchStatus && <span className="bridge-search-status" role="status">{semanticSearchStatus}</span>}</>}
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} aria-label="Filter by asset type"><option value="all">All types</option><option value="image">Images</option><option value="video">Video</option><option value="model">3D models</option><option value="document">Documents</option><option value="font">Fonts</option><option value="other">Other</option></select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)} aria-label="Sort assets"><option value="name">Name</option><option value="newest">Newest</option><option value="largest">Largest</option><option value="type">File type</option><option value="status">Status</option><option value="usage">Board usage</option></select>
            {catalogLayout === 'grid' && <label className="bridge-thumbnail-size" title="Thumbnail size"><span>▦</span><input type="range" aria-label="Thumbnail size" min="130" max="280" step="10" value={thumbnailSize} onChange={(event) => setThumbnailSize(Number(event.target.value))} /></label>}<div className="asset-layout-toggle" role="group" aria-label="Asset catalog layout"><button type="button" aria-label="List" className={catalogLayout === 'list' ? 'active' : ''} aria-pressed={catalogLayout === 'list'} onClick={() => setCatalogLayout('list')}>☷</button><button type="button" aria-label="Grid" className={catalogLayout === 'grid' ? 'active' : ''} aria-pressed={catalogLayout === 'grid'} onClick={() => setCatalogLayout('grid')}>▦</button></div>
          </div>
          <div className="bridge-selectionbar"><span>{selectedIds.length ? `${selectedIds.length} selected` : `${filtered.length} of ${assets.length} assets`}</span><button type="button" onClick={() => setSelectedIds((current) => [...new Set([...current, ...filtered.map((asset) => asset.id)])])} disabled={!filtered.length}>Select shown</button><button type="button" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>Clear</button><button type="button" onClick={() => setShowBatchTray((visible) => !visible)}>Batch actions</button><button type="button" onClick={() => setShowConversionTray((visible) => !visible)}>Convert</button><button type="button" onClick={() => void syncDiskNames()} disabled={!filtered.length || materializing}>{materializing ? 'Syncing…' : 'Sync disk names'}</button></div>
          {(showBatchTray || showConversionTray) && <section className="bridge-operation-tray" aria-label="Mini Bridge operation preview">
            {showBatchTray && <div><header><span>Previewed batch operations</span><button type="button" onClick={() => setShowBatchTray(false)}>×</button></header><label>Rename pattern<input value="{project}_{type}_{n}_{name}" readOnly /></label><div className="bridge-token-row"><button type="button">{'{project}'}</button><button type="button">{'{type}'}</button><button type="button">{'{n}'}</button><button type="button">{'{name}'}</button></div><p><strong>Collision policy:</strong> append sequence · journal rollback enabled · originals protected</p><div className="bridge-batch-actions"><button type="button" onClick={renameSelected} disabled={!selectedIds.length}>Rename preview</button><button type="button" onClick={numberSelected} disabled={!selectedIds.length}>Number</button><button type="button" onClick={moveSelected} disabled={!selectedIds.length}>Move to folder</button><button type="button" onClick={tagSelected} disabled={!selectedIds.length}>Add tag</button><button type="button" onClick={addToCollection} disabled={!selectedIds.length || !collections.length}>Add to collection</button><button type="button" onClick={toggleFavoriteSelected} disabled={!selectedIds.length}>Favorite</button><button type="button" onClick={autoOrganize} disabled={!assets.length}>Auto-organize</button><button type="button" onClick={() => void onRelinkMany(assets.filter((asset) => selectedIds.includes(asset.id)))} disabled={!selectedIds.length}>Relink selected</button><button type="button" onClick={undoCatalogChange} disabled={!undoSnapshot}>Undo catalog edit</button></div></div>}
            {showConversionTray && <div><header><span>Conversion queue</span><button type="button" onClick={() => setShowConversionTray(false)}>×</button></header><label>Format<select value={conversionFormat} disabled={converting} onChange={(event) => setConversionFormat(event.target.value as typeof conversionFormat)}><option value="png">PNG · lossless</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label><label>Color profile<select defaultValue="srgb" disabled={converting}><option value="srgb">sRGB</option><option value="preserve">Preserve embedded where available</option></select></label><label>Quality<input type="range" min="1" max="100" value={conversionQuality} disabled={converting || conversionFormat === 'png'} onChange={(event) => setConversionQuality(Number(event.target.value))} /></label><p>Creates derived disk files. Originals remain unchanged.</p>{conversionStatus && <p role="status">{conversionStatus}</p>}<button type="button" onClick={() => void convertSelected()} disabled={converting || readOnly || !selectedIds.some((id) => assets.some((asset) => asset.id === id && asset.kind === 'image' && asset.status === 'available'))}>{converting ? 'Converting…' : `Convert selected (${selectedIds.filter((id) => assets.some((asset) => asset.id === id && asset.kind === 'image')).length})`}</button></div>}
          </section>}
          <div className={`asset-catalog layout-${catalogLayout}`} style={{ '--bridge-thumbnail-size': `${thumbnailSize}px` } as React.CSSProperties}>
        {!groups.length && <div className="asset-empty"><strong>{scopeMode === 'unlinked' ? `${unlinkedPlacementCount} unlinked placement${unlinkedPlacementCount === 1 ? '' : 's'}` : 'No matching files'}</strong><p>{scopeMode === 'unlinked' ? 'These canvas cards have no resolvable disk identity. Select them on the board and use Relink to attach a project source.' : 'Import media above, change scope, or clear the search.'}</p></div>}
        {groups.map(([folder, folderAssets]) => <section className="asset-folder" key={folder}>
          <header><span>⌄</span><strong>{folder}</strong><button type="button" onClick={() => renameFolder(folder)}>Rename folder</button><small>{folderAssets.length} items</small></header>
          <div className="asset-table-heading"><span /><span>Preview</span><span>Managed name</span><span>Virtual folder</span><span>Type & size</span><span>Tracking</span></div>
          {folderAssets.map((asset) => <div className="asset-row" role="group" key={asset.id} tabIndex={0} aria-label={`Asset ${asset.displayName}; press Shift+F10 for actions`} onKeyDown={(event) => { if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openAssetActions(asset, event.currentTarget, rect.left + 24, rect.top + 24) }} onContextMenu={(event) => { event.preventDefault(); openAssetActions(asset, event.currentTarget, event.clientX, event.clientY) }}>
            <input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} aria-label={`Select ${asset.displayName}`} />
            <span className={`asset-thumbnail kind-${asset.kind}`} role="img" draggable={asset.kind === 'image'} onDragStart={(event) => { if (asset.kind === 'image') event.dataTransfer.setData('application/x-art-equation-asset-id', asset.id) }} aria-label={`${asset.displayName} preview`} title={asset.kind === 'image' ? 'Drag onto the Project Inspector cover, or use its cover picker' : asset.thumbnailRelativePath ? 'Disk-backed thumbnail' : 'No thumbnail available'}>{thumbnailUrl(asset) && <img src={thumbnailUrl(asset)} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />}<strong>{asset.extension.toUpperCase().slice(0, 4)}</strong></span>
            <label><input aria-label={`Catalog name for ${asset.displayName}`} value={asset.displayName} onChange={(event) => updateAsset(asset.id, { displayName: event.target.value })} /><small title={asset.originalName}>Source: {asset.originalName}</small><input className="asset-aliases" value={asset.aliases.join(', ')} placeholder="Aliases, comma separated" aria-label={`Aliases for ${asset.displayName}`} onChange={(event) => updateAsset(asset.id, { aliases: event.target.value.split(',').map((alias) => alias.trim()).filter(Boolean) })} />{asset.semanticSuggestions?.length ? <div className="semantic-suggestions">{asset.semanticSuggestions.map((suggestion) => <span key={suggestion.tag} className={`semantic-suggestion is-${suggestion.decision}`} title={`Local visual match ${(suggestion.score * 100).toFixed(1)}%`}><em>{suggestion.tag}</em>{suggestion.decision === 'pending' && <><button type="button" onClick={() => decideSemanticSuggestion(asset, suggestion.tag, 'accepted')}>Accept</button><button type="button" onClick={() => decideSemanticSuggestion(asset, suggestion.tag, 'rejected')}>×</button></>}</span>)}{asset.semanticFilenameSuggestion && <button type="button" className="semantic-name-proposal" title={`Apply catalog name “${asset.semanticFilenameSuggestion}”. Disk files remain unchanged until you choose Sync disk names.`} onClick={() => applySemanticFilename(asset)}>Use name</button>}</div> : null}</label>
            <input value={asset.virtualFolder} onChange={(event) => updateAsset(asset.id, { virtualFolder: event.target.value || 'Unsorted' })} aria-label={`Folder for ${asset.displayName}`} />
            <span className={`asset-type asset-kind kind-${asset.kind} ${['ztl', 'zpr', 'pdf', 'psd'].includes(asset.extension.toLowerCase()) ? 'format-card' : ''}`} title={`${asset.kind} file · ${asset.originalName}`}><button type="button" className="favorite-button" aria-label={`${asset.favorite ? 'Remove' : 'Add'} favorite for ${asset.displayName}`} onClick={() => toggleFavorite(asset)}>{asset.favorite ? '★' : '☆'}</button><strong>{asset.extension === 'ztl' || asset.extension === 'zpr' ? 'ZB' : asset.extension.toUpperCase()}</strong><small>{asset.extension === 'ztl' || asset.extension === 'zpr' ? 'ZBrush project' : asset.extension === 'pdf' ? 'PDF document' : asset.extension === 'psd' ? 'Photoshop document' : `${formatBytes(asset.byteLength)} · ${asset.kind}`}</small></span>
            <span className={`asset-status status-${asset.status}`}><i />{asset.status.replace('-', ' ')}<b className="asset-usage" title={assetUsage[asset.id] ? `Used on ${assetUsage[asset.id]} board card${assetUsage[asset.id] === 1 ? '' : 's'}` : 'Not currently placed on a board'}>{assetUsage[asset.id] ? `used · ${assetUsage[asset.id]}` : asset.generated ? 'derived' : 'unused'}</b>{asset.status === 'moved' && <b className="asset-state state-moved" title="The original path is unavailable but a managed working copy was found">moved</b>}{duplicateIds.has(asset.id) && <b className="asset-state state-duplicate" title="Another catalog entry has the same source name or content">duplicate</b>}{nearDuplicateIdSet.has(asset.id) && <b className="asset-state state-near-duplicate" title="Flagged by the local visual near-duplicate review">near-duplicate</b>}{orphanedIds.has(asset.id) && <b className="asset-state state-orphaned" title="A tracked dependency or generated source is missing">orphaned</b>}{semanticScore(asset.id) !== undefined && <b title={`Raw cosine score ${semanticScore(asset.id)!.toFixed(4)}`}>{semanticScore(asset.id)! >= .28 ? 'Strong' : semanticScore(asset.id)! >= .2 ? 'Related' : 'Weak'}</b>}{asset.generated && <b title={`Derived from ${assets.find((entry) => entry.id === asset.generated?.sourceAssetId)?.displayName || asset.generated.sourceAssetId}\n${asset.generated.outputWidth} × ${asset.generated.outputHeight}${asset.generated.modelSha256 ? `\n${asset.generated.modelSha256}` : ''}`}>{asset.generated.engine === 'board-transform' ? 'Transform derived' : asset.generated.engine === 'Swin2SR-q4' ? 'Super-resolution derived' : 'APISR derived'}</b>}{asset.managedRelativePath && <b title={asset.managedRelativePath}>disk name</b>}{asset.dependencies?.some((dependency) => dependency.status === 'missing') && <button type="button" title={asset.dependencies.filter((dependency) => dependency.status === 'missing').map((dependency) => dependency.uri).join('\n')} onClick={() => onRepairDependencies(asset)}>Repair {asset.dependencies.filter((dependency) => dependency.status === 'missing').length}</button>}{asset.kind === 'image' && semanticStatus?.state === 'ready' && <button type="button" onClick={() => void findSimilar(asset)} disabled={semanticSearching}>Similar</button>}{asset.status === 'available' && <button type="button" onClick={() => onReveal(asset)}>Reveal</button>}{openWith[asset.extension.toLowerCase()] && <button type="button" title={`Open with ${openWith[asset.extension.toLowerCase()]}`} onClick={() => onOpenWith(asset, openWith[asset.extension.toLowerCase()])}>Launch</button>}{(asset.status === 'missing' || asset.status === 'modified' || asset.status === 'moved') && <button type="button" onClick={() => onRelink(asset)}>Relink</button>}</span>
          </div>)}
        </section>)}
          </div>
        </main>
        <aside className="mini-bridge-inspector" aria-label="Asset preview and metadata">
          <div className="bridge-inspector-tabs" role="tablist" aria-label="Asset details">{(['preview','metadata','lineage','dependencies','placements'] as const).map((tab) => <button id={`bridge-inspector-tab-${tab}`} className={inspectorTab === tab ? 'active' : ''} type="button" role="tab" aria-controls="bridge-inspector-panel" aria-selected={inspectorTab === tab} tabIndex={inspectorTab === tab ? 0 : -1} key={tab} onKeyDown={(event) => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const tabs = ['preview','metadata','lineage','dependencies','placements'] as const
            const index = tabs.indexOf(tab)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            setInspectorTab(tabs[next]); document.getElementById(`bridge-inspector-tab-${tabs[next]}`)?.focus()
          }} onClick={() => setInspectorTab(tab)}>{tab}</button>)}</div>
          <div id="bridge-inspector-panel" role="tabpanel" aria-labelledby={`bridge-inspector-tab-${inspectorTab}`}>
          {inspectedAsset ? <><div className="bridge-preview">{thumbnailUrl(inspectedAsset, true) ? <img src={thumbnailUrl(inspectedAsset, true)} alt={`${inspectedAsset.displayName} preview`} onError={(event) => { const fallback = thumbnailUrl(inspectedAsset); if (fallback && event.currentTarget.src !== fallback) event.currentTarget.src = fallback; else event.currentTarget.style.display = 'none' }} /> : <span>{inspectedAsset.extension.toUpperCase()}</span>}<strong>{inspectedAsset.displayName}</strong><small>{formatBytes(inspectedAsset.byteLength)} · {inspectedAsset.kind}</small></div>
            <div className="bridge-identity-panel"><span className="eyebrow">Disk ↔ canvas identity</span><dl><dt>Project path</dt><dd title={inspectedAsset.relativePath}>{inspectedAsset.relativePath}</dd><dt>Fingerprint</dt><dd><code>{inspectedAsset.id.slice(0,18)}</code><b>tracked</b></dd><dt>Role</dt><dd>{inspectedAsset.generated ? 'Derived asset' : 'Immutable original'}</dd><dt>Status</dt><dd><i className={`bridge-status status-${inspectedAsset.status}`} />{inspectedAsset.status.replace('-', ' ')}</dd></dl></div>
            {inspectorTab === 'lineage' && <section className="bridge-detail-panel"><h3>Derived lineage</h3><p>{inspectedAsset.generated ? `Created by ${inspectedAsset.generated.engine} from ${inspectedAsset.generated.sourceAssetId}` : 'This is an original project asset. Derivatives branch from this record without replacing it.'}</p></section>}
            {inspectorTab === 'dependencies' && <section className="bridge-detail-panel"><h3>Dependencies</h3>{inspectedAsset.dependencies?.length ? inspectedAsset.dependencies.map((dependency) => <p key={dependency.uri}><i className={`bridge-status status-${dependency.status}`} />{dependency.uri}</p>) : <p>No tracked companion dependencies.</p>}</section>}
            {inspectorTab === 'placements' && <section className="bridge-detail-panel"><h3>Canvas placements</h3><p>{assetUsage[inspectedAsset.id] ? `Used by ${assetUsage[inspectedAsset.id]} board card${assetUsage[inspectedAsset.id] === 1 ? '' : 's'}.` : 'Not currently placed on a canvas.'}</p></section>}
            <div className="bridge-asset-actions"><button type="button" onClick={() => onSetCover(inspectedAsset.id)} disabled={inspectedAsset.kind !== 'image'}>Set board cover</button><button type="button" onClick={() => onRelink(inspectedAsset)}>Relink / Replace</button><button type="button" onClick={() => onReveal(inspectedAsset)} disabled={inspectedAsset.status !== 'available'}>Reveal</button>{openWith[inspectedAsset.extension.toLowerCase()] && <button type="button" onClick={() => onOpenWith(inspectedAsset, openWith[inspectedAsset.extension.toLowerCase()])}>Open with…</button>}<button type="button" disabled title="Requires the journaled disk-operation pass">Copy / Move</button><button type="button" disabled title="Requires the conversion/export pass">Export</button><button className="danger" type="button" disabled={readOnly || inspectedAsset.locked} title={inspectedAsset.locked ? 'Locked assets cannot be moved to Trash' : 'Original file remains on disk'} onClick={() => onTrashAsset(inspectedAsset.id)}>Move to Trash…</button></div>
          </> : <div className="bridge-preview-empty"><span>◇</span><strong>No asset selected</strong><p>Choose an item to inspect disk identity, lineage, dependencies, and canvas placements.</p></div>}
          </div>
        </aside>
      </div>}
      <footer className="mini-bridge-statusbar"><span className={`bridge-status status-${semanticStatus?.state || 'loading'}`} /> <strong>{semanticBusy ? semanticProgress?.phase.replace('-', ' ') || 'Indexing' : 'Project scan idle'}</strong><span>Thumbnails: cached</span><span>Watcher: debounced</span><span>Recovery journal: ready</span><span className={missingCount ? 'warning' : ''}>{missingCount ? `${missingCount} unresolved files` : 'All source links resolved'}</span><button type="button" onClick={onRollbackManaged} disabled={!canRollbackManaged}>Rollback last disk operation</button></footer>
      <details className="bridge-advanced-settings"><summary>Application assignments and semantic index</summary><section className="open-with-panel" aria-label="Open with application assignments"><div><strong>Open with…</strong><small>Assign an executable per file type. Paths are stored in this portable workspace.</small></div><div className="open-with-grid">{assignmentExtensions.map((extension) => <label key={extension}><span>.{extension}</span><input value={openWith[extension] || ''} placeholder="Application.exe path" onChange={(event) => onOpenWithChange(extension, event.target.value)} /></label>)}</div></section><section className="semantic-index-panel" aria-label="Project semantic index"><div><span className="eyebrow">Local project intelligence</span><strong>Semantic reference index</strong><small>Stored inside this portable project.</small></div><div className={`semantic-index-state state-${semanticStatus?.state || 'loading'}`}><i /><span>{semanticStatus?.state || 'Checking index'}</span><small>{semanticStatus ? `${semanticStatus.indexedCount}/${semanticStatus.sourceCount} embedded` : ''}</small></div><div className="semantic-index-actions"><button type="button" onClick={() => void buildSemanticIndex()} disabled={semanticBusy}>Build / verify</button><button type="button" onClick={() => void repairSemanticAnn()} disabled={semanticBusy}>Repair accelerator</button><button type="button" onClick={() => void suggestSemanticTags()} disabled={semanticStatus?.state !== 'ready'}>Suggest tags</button></div>{(semanticError || semanticStatus?.annBuildError) && <p role="alert">{semanticError || semanticStatus?.annBuildError}</p>}</section></details>
      {semanticAnalysis && <SemanticClusterReview board={board} analysis={semanticAnalysis} assets={assets} onClose={() => setSemanticAnalysis(null)} onApply={(clusters, target) => { onApplySemanticClusters(clusters, target); setSemanticAnalysis(null); onClose() }} />}
      {assetMenu && (() => {
        const asset = assets.find((entry) => entry.id === assetMenu.id)
        if (!asset) return null
        const close = () => { setAssetMenu(null); assetMenuOriginRef.current?.focus() }
        const applicationPath = openWith[asset.extension.toLowerCase()]
        return <div ref={assetMenuRef} className="asset-item-menu" role="menu" aria-label={`Actions for ${asset.displayName}`} style={{ left: assetMenu.x, top: assetMenu.y }} onKeyDown={(event) => leaveMenu(event, assetMenuOriginRef.current)}>
          <strong>{asset.displayName}</strong>
          <button type="button" role="menuitem" onClick={() => { setSelectedIds([asset.id]); setInspectorTab('preview'); close() }}>Inspect asset</button>
          <button type="button" role="menuitem" onClick={async () => { close(); const name = (await onRequestText({ title: 'Rename catalog entry', label: 'File name', initialValue: asset.displayName }))?.trim(); if (name && name !== asset.displayName) updateAsset(asset.id, { displayName: name }) }}>Rename catalog entry…</button>
          {asset.kind === 'image' && <button type="button" role="menuitem" disabled={readOnly} onClick={() => { onSetCover(asset.id); close() }}>Set as board cover</button>}
          {asset.status === 'available' && <button type="button" role="menuitem" onClick={() => { onReveal(asset); close() }}>Reveal in Explorer</button>}
          {applicationPath && <button type="button" role="menuitem" onClick={() => { onOpenWith(asset, applicationPath); close() }}>Open with…</button>}
          {(asset.status === 'missing' || asset.status === 'modified' || asset.status === 'moved') && <button type="button" role="menuitem" onClick={() => { onRelink(asset); close() }}>Relink / Replace…</button>}
          <button type="button" className="danger" role="menuitem" disabled={readOnly || asset.locked} title={asset.locked ? 'Locked assets cannot be moved to Trash' : 'Original file remains on disk'} onClick={() => { close(); onTrashAsset(asset.id) }}>Move to Trash…</button>
        </div>
      })()}
    </section>
  )
}

function navigateMenu(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'))
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  options[next]?.focus()
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
}
