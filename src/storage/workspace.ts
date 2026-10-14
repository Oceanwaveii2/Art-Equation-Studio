import { ProjectAutosave, restoreProjectViews } from './projectAutosave'
import { projectSaveDelta } from './projectSaveDelta'
const projectAutosave=new ProjectAutosave()
export const hasPendingProjectContent=(project:ProjectModel)=>projectAutosave.hasPendingContent(project)
let nativeIncrementalStorage=false
const acceptedProjects=new Map<string,{project:ProjectModel;revision:number}>()
import type { SavePolicy } from './savePolicy'
export { defaultSavePolicy,validSavePolicy,type SavePolicy } from './savePolicy'
export type StorageStatus={projectRevision:number;stateSavedAt?:number;projectFileSavedAt?:number;recoverySavedAt?:number;recoveryRevision?:number;pendingBoards?:number;error?:string;commitMs?:number;payloadBytes?:number;changedRecords?:number;boardCheckpoints?:Record<string,{revision:number;savedAt:number;path:string;sha256:string}>}
export function getProjectStorageStatus(projectId:string){return invoke<StorageStatus>('project_storage_status',{projectId})}
export function configureProjectStorage(projectId:string,intervalMinutes:number){return invoke<StorageStatus>('project_storage_configure',{projectId,intervalMinutes})}
export function snapshotProject(projectId:string){return invoke<StorageStatus>('project_storage_snapshot',{projectId})}
import { invoke } from '@tauri-apps/api/core'
import { metricSpan } from '../diagnostics/performance'
import type { ImagePyramid } from '../canvas-engine/imagePyramid'

export type PyramidJob = { id: string; projectId: string; assetId: string; phase: string; elapsedMs: number; pyramid?: ImagePyramid; error?: string }
export function startImagePyramid(projectId: string, assetId: string, relativePath: string) { return invoke<PyramidJob>('start_image_pyramid', { projectId, assetId, relativePath }) }
export function imagePyramidStatus(jobId: string) { return invoke<PyramidJob>('image_pyramid_status', { jobId }) }
export function cancelImagePyramid(jobId: string) { return invoke<void>('cancel_image_pyramid', { jobId }) }
import type { AssetRecord, AssetStatus, ProjectAsset, ProjectModel, VisualRecipe } from '../model/project'
import { managedBoardFolderPath, withRequiredBoardFolderLinks } from '../model/project'

export type WorkspaceInfo = {
  root: string
  workspaceId: string
  readOnly: boolean
  lockOwned: boolean
  storageSchema?:number
}

export type ViewMode = 'document' | 'split' | 'canvas'

export type ProjectSummary = {
  id: string
  title: string
  updatedAt: string
  boardCount: number
  assetCount: number
  tags?: string
  date?: string
  status?: string
  coverRelativePath?: string
  coverFraming?: import('../model/project').CoverFraming
}

export type ProjectNavigation = {
  activeBoardId: string
  activeDocumentId: string
  activeNavigatorItem: string
  viewMode?: ViewMode
  splitRatio?: number
  documentScrollTop?: Record<string, number>
}

export type WorkspaceSettings = {
  schemaVersion: 1 | 2 | 3 | 4 | 5
  viewMode: ViewMode
  splitRatio: number
  activeProjectId?: string
  projectNavigation?: Record<string, ProjectNavigation>
  /** Executable paths keyed by file extension, without the leading dot. */
  openWith?: Record<string, string>
  theme?: 'navy' | 'dark' | 'light'
  glassStrength?: number
  minimalNavigation?: boolean
  archivedProjectIds?: string[]
  /** Shared across every project in this portable installation. */
  recipes?: VisualRecipe[]
  savePolicy?:SavePolicy
}

export async function openAssetWith(applicationPath: string, assetPath: string): Promise<void> {
  await invoke('open_asset_with', { applicationPath, assetPath })
}

export type RecoveryEntry = { relativePath: string; kind: 'backup' | 'journal'; byteLength: number; modifiedAtUnixMs: number }

export async function listRecoveryEntries(projectId: string): Promise<RecoveryEntry[]> {
  return invoke<RecoveryEntry[]>('list_recovery_entries', { projectId })
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  const info=await invoke<WorkspaceInfo>('workspace_info');nativeIncrementalStorage=info.storageSchema===2;return info
}

export async function loadWorkspaceSettings(): Promise<WorkspaceSettings | null> {
  try {
    return await invoke<WorkspaceSettings>('load_json', { relativePath: 'settings.json' })
  } catch {
    return null
  }
}

export async function saveWorkspaceSettings(settings: WorkspaceSettings): Promise<void> {
  await invoke('save_json', { relativePath: 'settings.json', value: settings })
}

export type ReferenceFile = { path: string; name: string; extension: string }
export async function scanReferenceLibrary(path: string): Promise<ReferenceFile[]> { return invoke<ReferenceFile[]>('scan_reference_library', { path }) }

export async function listProjects(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>('list_projects')
}

export async function trashProject(projectId: string): Promise<string> { return invoke<string>('trash_project', { projectId }) }
export async function restoreTrashedProject(projectId: string): Promise<string> { return invoke<string>('restore_trashed_project', { projectId }) }
export async function listTrashedProjects(): Promise<ProjectSummary[]> { return invoke<ProjectSummary[]>('list_trashed_projects') }

export type ApisrModelInfo = {
  installed: boolean
  verified: boolean
  relativePath: string
  byteLength: number
}

export async function getApisrModelInfo(): Promise<ApisrModelInfo> {
  return invoke<ApisrModelInfo>('apisr_model_info')
}

export async function installApisrModel(sourcePath: string): Promise<ApisrModelInfo> {
  return invoke<ApisrModelInfo>('install_apisr_model', { sourcePath })
}

export async function saveGeneratedImage(bytes: Uint8Array, metadata: { projectId: string; projectName: string; boardName: string; fileName: string }): Promise<AssetRecord> {
  return invoke<AssetRecord>('save_generated_image', bytes, { headers: {
    'project-id': encodeURIComponent(metadata.projectId),
    'project-name': encodeURIComponent(metadata.projectName),
    'board-name': encodeURIComponent(metadata.boardName),
    'file-name': encodeURIComponent(metadata.fileName),
  } })
}

export async function exportBinary(destinationPath: string, bytes: Uint8Array): Promise<{ relativePath: string; bytesWritten: number; backupCreated: boolean }> {
  return invoke('export_binary', { destinationPath, bytes: Array.from(bytes) })
}

export async function ensureProjectWorkspace(projectId: string): Promise<void> {
  await invoke('ensure_project_workspace', { projectId })
}

export type SemanticIndexState = 'notIndexed' | 'prepared' | 'indexing' | 'ready' | 'partial' | 'stale' | 'paused' | 'failed' | 'rebuildRequired'
export type SemanticIndexStatus = {
  state: SemanticIndexState
  sourceCount: number
  indexedCount: number
  failedCount: number
  generation: number
  diskBytes: number
  modelId?: string
  modelRevision?: string
  updatedAtUnixMs?: number
  annState: 'notBuilt' | 'notNeeded' | 'ready' | 'rebuildRequired'
  annIndexedCount: number
  searchEngine: 'exact' | 'hnsw'
  annBuildError?: string
}

export async function getSemanticIndexStatus(projectId: string): Promise<SemanticIndexStatus> {
  return invoke<SemanticIndexStatus>('semantic_index_status', { projectId })
}

export async function prepareSemanticIndex(projectId: string): Promise<SemanticIndexStatus> {
  return invoke<SemanticIndexStatus>('prepare_semantic_index', { projectId })
}

export type SemanticSourceRecord = {
  recordId: string
  assetId?: string
  sourceKind: 'managedAsset' | 'derivedAsset' | 'savedCrop'
  relativePath: string
  contentSha256?: string
  byteLength?: number
  active: boolean
  embeddingState: 'pending' | 'ready' | 'failed' | 'unavailable'
  vectorOffset?: number
}

export async function listSemanticSources(projectId: string): Promise<SemanticSourceRecord[]> {
  return invoke<SemanticSourceRecord[]>('list_semantic_sources', { projectId })
}

export async function commitSemanticEmbeddings(projectId: string, modelId: string, modelRevision: string, dimension: number, embeddings: Array<{ recordId: string; vector: number[] }>): Promise<SemanticIndexStatus> {
  return invoke<SemanticIndexStatus>('commit_semantic_embeddings', { projectId, modelId, modelRevision, dimension, embeddings })
}

export async function rebuildSemanticAnn(projectId: string): Promise<SemanticIndexStatus> {
  return invoke<SemanticIndexStatus>('rebuild_semantic_ann', { projectId })
}

export type SemanticSearchResult = { recordId: string; score: number }
export async function searchSemanticIndex(projectId: string, query: number[], limit = 40): Promise<SemanticSearchResult[]> {
  return invoke<SemanticSearchResult[]>('search_semantic_index', { projectId, query, limit })
}
export async function findSimilarSemantic(projectId: string, recordId: string, limit = 40): Promise<SemanticSearchResult[]> {
  return invoke<SemanticSearchResult[]>('find_similar_semantic', { projectId, recordId, limit })
}
export type SemanticNearDuplicate = { leftRecordId: string; rightRecordId: string; embeddingScore: number; perceptualDistance: number }
export type SemanticCluster = { id: string; recordIds: string[]; representativeRecordId: string; averageScore: number }
export type SemanticAnalysis = { nearDuplicates: SemanticNearDuplicate[]; clusters: SemanticCluster[]; analyzedCount: number }
export async function analyzeSemanticIndex(projectId: string): Promise<SemanticAnalysis> {
  return invoke<SemanticAnalysis>('analyze_semantic_index', { projectId })
}

export async function importProjectAsset(projectId: string, sourcePath: string): Promise<AssetRecord> {
  return invoke<AssetRecord>('import_asset', { projectId, sourcePath })
}

export async function importModelBundle(projectId: string, sourcePath: string): Promise<{ asset: AssetRecord; dependencies: string[]; missingDependencies: string[] }> {
  return invoke('import_model_bundle', { projectId, sourcePath })
}

export async function repairModelBundle(projectId: string, entryRelativePath: string, sourceFolder: string, missingUris: string[]): Promise<string[]> {
  return invoke('repair_model_bundle', { projectId, entryRelativePath, sourceFolder, missingUris })
}

export async function readTextAsset(projectId: string, relativePath: string): Promise<string> {
  return invoke<string>('read_text_asset', { projectId, relativePath })
}

export type AssetAuditResult = { id: string; status: AssetStatus; actualByteLength?: number }

export async function auditProjectAssets(assets: ProjectAsset[]): Promise<AssetAuditResult[]> {
  return invoke<AssetAuditResult[]>('audit_assets', {
    assets: assets.map((asset) => ({ id: asset.id, relativePath: asset.relativePath, byteLength: asset.byteLength, managedRelativePath: asset.managedRelativePath })),
  })
}

export type MaterializedAsset = { id: string; managedRelativePath: string }

export async function previewManagedAssets(projectId: string, assets: ProjectAsset[]): Promise<MaterializedAsset[]> {
  return invoke<MaterializedAsset[]>('preview_managed_assets', {
    projectId,
    requests: assets.map((asset) => ({
      assetId: asset.id,
      displayName: asset.displayName,
      virtualFolder: asset.virtualFolder,
      extension: asset.extension,
      existingRelativePath: asset.managedRelativePath,
    })),
  })
}

export async function materializeProjectAsset(projectId: string, asset: ProjectAsset): Promise<MaterializedAsset> {
  return invoke<MaterializedAsset>('materialize_asset', {
    projectId,
    assetId: asset.id,
    sourceRelativePath: asset.relativePath,
    displayName: asset.displayName,
    virtualFolder: asset.virtualFolder,
    extension: asset.extension,
    existingRelativePath: asset.managedRelativePath,
  })
}

export async function rollbackManagedAssets(projectId: string, entries: Array<{ currentRelativePath: string; previousRelativePath?: string }>): Promise<void> {
  await invoke('rollback_managed_assets', { projectId, entries })
}

export async function loadProject(projectId: string): Promise<ProjectModel | null> {
  try {
    const loaded = nativeIncrementalStorage
      ? await invoke<{ project: ProjectModel; revision: number }>('project_storage_load', { projectId }).catch((error) => {
          console.warn(`[storage] project_storage_load failed for ${projectId}, falling back to project.json:`, error)
          return null
        })
      : null
    const project = loaded?.project ?? await invoke<ProjectModel | null>('load_json', { relativePath: `projects/${projectId}/project.json` }).catch(() => null)
    if (!project) return null
    let views: unknown = null
    try { views = await invoke('load_json', { relativePath: `projects/${projectId}/view-state.json` }) } catch {}
    const restored = restoreProjectViews(project, views)
    if (loaded) acceptedProjects.set(projectId, { project: restored, revision: loaded.revision })
    projectAutosave.remember(restored, project.updatedAt)
    return restored
  } catch {
    return null
  }
}

export async function ensureManagedBoardFolders(project: ProjectModel): Promise<void> {
  const linked = withRequiredBoardFolderLinks(project)
  // A root board is never virtual. Create its managed directory before making
  // the project JSON point at it. External links were selected by the owner.
  const boardIds = linked.boards.filter((board) => !board.parentBoardId && board.linkedFolderPath === managedBoardFolderPath(linked.id, board.id)).map((board) => board.id)
  if (boardIds.length) await invoke('ensure_managed_board_folders', { projectId: linked.id, boardIds })
}

async function writeProject(project: ProjectModel,checkpoint=false): Promise<void> {
  const finish = metricSpan('project.save', { boards: project.boards.length, objects: project.boards.reduce((total,board) => total + board.nodes.length,0) })
  try {
  const linked = withRequiredBoardFolderLinks(project)
  await ensureManagedBoardFolders(linked)
  if(nativeIncrementalStorage){
    const prior=acceptedProjects.get(linked.id)
    const reason=checkpoint?'explicit-save-or-close':'automatic-edit'
    const delta=prior?.revision?projectSaveDelta(prior.project,linked,prior.revision,reason):{projectId:linked.id,baseRevision:0,fullProject:linked,puts:[],deletes:[],reason}
    const ack=await invoke<StorageStatus>('project_storage_commit',{delta:{...delta,checkpoint}})
    acceptedProjects.set(linked.id,{project:linked,revision:ack.projectRevision})
    if(ack.error)throw Error(`Project state committed, but board checkpoint failed: ${ack.error}`)
    if(checkpoint)await snapshotProject(linked.id)
    return
  }
  await invoke('save_json', {
    relativePath: `projects/${linked.id}/project.json`,
    value: linked,
  })
  } finally { finish() }
}

export function saveProject(project:ProjectModel):Promise<void> {
  return projectAutosave.enqueue(project,p=>writeProject(p,true),state=>invoke('save_json',{relativePath:`projects/${project.id}/view-state.json`,value:state}),true)
}
export function saveProjectAutosave(project:ProjectModel):Promise<void> {
  return projectAutosave.enqueue(project,p=>writeProject(p),state=>{
    const finish=metricSpan('project.view-save',{boards:project.boards.length})
    return invoke<void>('save_json',{relativePath:`projects/${project.id}/view-state.json`,value:state}).finally(finish)
  })
}

export async function saveProjectJournal(projectId: string, name: string, value: unknown): Promise<void> {
  await invoke('save_json', {
    relativePath: `projects/${projectId}/journal/${name.replace(/[^a-z0-9_.-]/gi, '_')}.json`,
    value,
  })
}

export async function collectProject(projectId: string, destinationPath: string): Promise<{ relativePath: string; bytesWritten: number }> {
  return invoke('collect_project', { projectId, destinationPath })
}

// --- Project trash (Adutt scope v2, Phase 1) -------------------------------

export type StoredTrashEntry = Record<string, unknown>

/** List the per-project trash index. Entries are opaque JSON records owned by
 * the frontend trash model; the backend only stores and replaces them by id. */
export async function listProjectTrash(projectId: string): Promise<StoredTrashEntry[]> {
  try {
    return await invoke<StoredTrashEntry[]>('list_project_trash', { projectId })
  } catch {
    return []
  }
}

export async function recordTrashEntry(projectId: string, entry: unknown): Promise<void> {
  await invoke('record_trash_entry', { projectId, entry })
}

export async function removeTrashEntry(projectId: string, entryId: string): Promise<void> {
  await invoke('remove_trash_entry', { projectId, entryId })
}

/** Move a file inside the project into the on-disk trash folder. Returns the
 * trash-relative path of the moved file (record it in the trash entry). */
export async function movePathToTrash(projectId: string, relativePath: string): Promise<string> {
  return invoke<string>('move_path_to_trash', { projectId, relativePath })
}

/** Move a trashed file back to its original project-relative location. */
export async function restoreTrashFile(projectId: string, trashRelativePath: string, originalRelativePath: string): Promise<void> {
  await invoke('restore_trash_file', { projectId, trashRelativePath, originalRelativePath })
}
