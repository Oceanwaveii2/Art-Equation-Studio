import fs from 'node:fs'
const files=['src/App.tsx','src/model/project.ts','src/media/AssetManager.tsx','src/semantic/SemanticClusterReview.tsx']
fs.mkdirSync('../baseline',{recursive:true})
for(const path of files) fs.writeFileSync('../baseline/'+path.replaceAll('/','__'),fs.readFileSync(path))
let p=fs.readFileSync('src/model/project.ts','utf8'); p=p.replace('  gridVisible?: boolean','  layoutGuides?: import(\'../board/layoutResearch\').PersistentLayoutGuide[]\n  gridVisible?: boolean');fs.writeFileSync('src/model/project.ts',p)
p=fs.readFileSync('src/App.tsx','utf8')
p=p.replace("import { alignBoardNodes, distributeBoardNodes, packBoardNodes }", "import { LayoutResearchPanel } from './board/LayoutResearchPanel'\nimport { reconcileLayoutGuides, organizeSemanticClusters } from './board/layoutResearch'\nimport { alignBoardNodes, distributeBoardNodes, packBoardNodes }")
p=p.replace('    const result = validateBoardMutation(currentBoard, nextBoard,', '    nextBoard = reconcileLayoutGuides(currentBoard, nextBoard)\n    const result = validateBoardMutation(currentBoard, nextBoard,')
const start=p.indexOf('    const sourceBoard = activeBoard',p.indexOf('  function applySemanticClusters('));const end=p.indexOf('\n  function acceptGeneratedAsset',start)
p=p.slice(0,start)+`    const proposal = organizeSemanticClusters(activeBoard, clusters, target, project.assets)
    if (!proposal.moved) { setStatus(proposal.warnings[0] || 'No movable references in the selected clusters.'); return }
    const result = layoutBoardColumnsForNodesResult(proposal.board, proposal.board.nodes.filter((node) => node.kind === 'column').map((node) => node.id))
    if (!result.ok) { setStatus(result.issues[0]?.detail || 'Organization was cancelled.'); return }
    if (applyBoardChange(result.value)) { changeMode('split'); setStatus('Visual references organized. Sizes and ownership preserved. ' + proposal.warnings.length + ' protected references retained.') }
  }
`+p.slice(end)
const canvas=p.indexOf('function CanvasPane(');const state=p.indexOf('\n',p.indexOf('const [showAppearance',canvas));p=p.slice(0,state)+ '\n  const [showLayoutResearch, setShowLayoutResearch] = useState(false)' +p.slice(state)
p=p.replace('      {showAppearance && <aside', '      {showLayoutResearch && <LayoutResearchPanel board={board} boards={boards} selectedIds={selectedIds} onChange={onBoardChange} onNavigate={onSwitchBoard} onClose={() => setShowLayoutResearch(false)} />}\n      {showAppearance && <aside')
p=p.replace('<section><h3>Arrange</h3><div className="appearance-control-grid">','<section><h3>Arrange</h3><div className="appearance-control-grid">\n          <button type="button" disabled={viewOnly} onClick={() => { setShowLayoutResearch(true); setShowAppearance(false) }}>Layout tools: guides and preview</button>')
fs.writeFileSync('src/App.tsx',p)
p=fs.readFileSync('src/media/AssetManager.tsx','utf8').replace('<SemanticClusterReview analysis={semanticAnalysis}', '<SemanticClusterReview board={board} analysis={semanticAnalysis}');fs.writeFileSync('src/media/AssetManager.tsx',p)
p=fs.readFileSync('src/semantic/SemanticClusterReview.tsx','utf8').replace("import type { ProjectAsset }", "import { useMemo } from 'react'\nimport { LayoutPlanPreview } from '../board/LayoutResearchPanel'\nimport { organizeSemanticClusters, semanticClusterLabel } from '../board/layoutResearch'\nimport type { BoardModel, ProjectAsset }")
p=p.replace('  analysis: SemanticAnalysis','  board?: BoardModel\n  analysis: SemanticAnalysis').replace('{ analysis, assets, onApply, onClose }','{ board, analysis, assets, onApply, onClose }')
p=p.replace('title: `Visual cluster ${index + 1}`','title: semanticClusterLabel(cluster.recordIds.map(assetId).filter((id): id is string => Boolean(id)), assets, index)')
p=p.replace('  return <div className="semantic-review-backdrop">',`  const chosen = selected.map((cluster) => ({ title: cluster.title.trim() || 'Visual references', assetIds: cluster.recordIds.map(assetId).filter((id): id is string => Boolean(id)) }))
  const proposal = useMemo(() => board ? organizeSemanticClusters(board, chosen, target, assets) : null, [board, clusters, target, assets])
  return <div className="semantic-review-backdrop">`)
p=p.replace('<aside><h3>Near-duplicate candidates</h3>',`<aside>{proposal && board && <section><h3>Layout preview</h3><LayoutPlanPreview before={board} after={proposal.board} /><p>{proposal.moved} references eligible. Existing dimensions are retained.</p>{proposal.warnings.map((warning) => <p key={warning}>{warning}</p>)}{selected.some((cluster) => cluster.recordIds.length > 12) && <p>Large cluster: consider smaller themed subgroups or an existing subboard before applying.</p>}</section>}<h3>Near-duplicate candidates</h3>`)
p=p.replace('disabled={!selected.length}', 'disabled={!selected.length || Boolean(proposal && !proposal.moved)}')
fs.writeFileSync('src/semantic/SemanticClusterReview.tsx',p)
