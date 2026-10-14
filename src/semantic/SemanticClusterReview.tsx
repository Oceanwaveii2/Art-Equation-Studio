import { useState } from 'react'
import { useMemo } from 'react'
import { LayoutPlanPreview } from '../board/LayoutResearchPanel'
import { organizeSemanticClusters, semanticClusterLabel } from '../board/layoutResearch'
import type { BoardModel, ProjectAsset } from '../model/project'
import type { SemanticAnalysis } from '../storage/workspace'
import './SemanticClusterReview.css'

type Props = {
  board?: BoardModel
  analysis: SemanticAnalysis
  assets: ProjectAsset[]
  onApply: (clusters: Array<{ title: string; assetIds: string[] }>, target: 'groups' | 'columns') => void
  onClose: () => void
}

const assetId = (recordId: string) => recordId.startsWith('asset:') ? recordId.slice(6) : undefined

export function SemanticClusterReview({ board, analysis, assets, onApply, onClose }: Props) {
  const [target, setTarget] = useState<'groups' | 'columns'>('groups')
  const [clusters, setClusters] = useState(() => analysis.clusters.map((cluster, index) => ({ ...cluster, title: semanticClusterLabel(cluster.recordIds.map(assetId).filter((id): id is string => Boolean(id)), assets, index), selected: true })))
  const assetName = (recordId: string) => assets.find((asset) => asset.id === assetId(recordId))?.displayName || recordId.replace(/^asset:/, '')
  const selected = clusters.filter((cluster) => cluster.selected)
  const chosen = selected.map((cluster) => ({ title: cluster.title.trim() || 'Visual references', assetIds: cluster.recordIds.map(assetId).filter((id): id is string => Boolean(id)) }))
  const proposal = useMemo(() => board ? organizeSemanticClusters(board, chosen, target, assets) : null, [board, clusters, target, assets])
  return <div className="semantic-review-backdrop">
    <section className="semantic-review" aria-label="Semantic cluster review">
      <header><div><span>REVIEW BEFORE ORGANIZING</span><h2>Visual clusters</h2><p>{analysis.analyzedCount} images analyzed · {analysis.clusters.length} clusters · {analysis.nearDuplicates.length} near-duplicate candidates</p></div><button type="button" onClick={onClose}>×</button></header>
      <div className="semantic-review-body">
        <main>
          {!clusters.length && <div className="semantic-review-empty"><strong>No stable clusters found</strong><p>The current images may be intentionally diverse. Nothing has been changed.</p></div>}
          {clusters.map((cluster) => <article className={cluster.selected ? 'selected' : ''} key={cluster.id}>
            <label><input type="checkbox" checked={cluster.selected} onChange={(event) => setClusters((current) => current.map((entry) => entry.id === cluster.id ? { ...entry, selected: event.target.checked } : entry))}/><input value={cluster.title} aria-label="Cluster title" onChange={(event) => setClusters((current) => current.map((entry) => entry.id === cluster.id ? { ...entry, title: event.target.value } : entry))}/></label>
            <div><strong>{assetName(cluster.representativeRecordId)}</strong><small>{cluster.recordIds.length} members · average similarity {cluster.averageScore.toFixed(3)}</small></div>
            <ul>{cluster.recordIds.map((recordId) => <li key={recordId}>{assetName(recordId)}</li>)}</ul>
          </article>)}
        </main>
        <aside>{proposal && board && <section><h3>Layout preview</h3><LayoutPlanPreview before={board} after={proposal.board} /><p>{proposal.moved} references eligible. Existing dimensions are retained.</p>{proposal.warnings.map((warning) => <p key={warning}>{warning}</p>)}{selected.some((cluster) => cluster.recordIds.length > 12) && <p>Large cluster: consider smaller themed subgroups or an existing subboard before applying.</p>}</section>}<h3>Near-duplicate candidates</h3><p>These require both close pixels and close embeddings. Review only—no files will be removed.</p>{analysis.nearDuplicates.map((pair) => <div key={`${pair.leftRecordId}:${pair.rightRecordId}`}><strong>{assetName(pair.leftRecordId)}</strong><span>↔</span><strong>{assetName(pair.rightRecordId)}</strong><small>pixel distance {pair.perceptualDistance} · semantic {pair.embeddingScore.toFixed(3)}</small></div>)}{!analysis.nearDuplicates.length && <em>No near duplicates detected.</em>}</aside>
      </div>
      <footer><label>Organize selected clusters as <select value={target} onChange={(event) => setTarget(event.target.value as typeof target)}><option value="groups">Freeform groups</option><option value="columns">Columns</option></select></label><span>{selected.length} clusters selected</span><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={!selected.length || Boolean(proposal && !proposal.moved)} onClick={() => onApply(selected.map((cluster) => ({ title: cluster.title.trim() || 'Visual cluster', assetIds: cluster.recordIds.map(assetId).filter((id): id is string => Boolean(id)) })), target)}>Apply to active board</button></footer>
    </section>
  </div>
}
