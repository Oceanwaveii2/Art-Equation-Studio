import fs from 'node:fs'
let source=fs.readFileSync('src/App.tsx','utf8')
source=source.replace("import { Prototype25Shell }", "import { PrototypeAssetShelf } from './ui/PrototypeAssetShelf'\nimport { Prototype25Shell }")
source=source.replace("navigation={<>\n{mode !== 'document' && !viewBoardId", "navigation={<>\n{!viewBoardId")
source=source.replace(/\{!viewBoardId && mode !== 'canvas' && \(showProjectBoardStrip && \(mode !== 'split' \|\| !showCanvasFilmstrip\) \? (<ProjectBoardStrip[^]*?\/>) : mode === 'document' \? <button className="project-board-strip-restore"[^]*?<\/button> : null\)\}/,"{!viewBoardId && mode === 'split' && showProjectBoardStrip && !showCanvasFilmstrip && $1}")
source=source.replace('slots={{','slots={{\nworkspaceHeading: <>\n<button type="button" aria-label="Toggle project navigation" onClick={() => { if(showNavigatorPanel)setShowNavigatorPanel(false);else restorePanel(\'navigator\') }}>☷</button>\n<nav className="p25-workspace-crumb" aria-label="Workspace breadcrumb"><span>Project</span><span aria-hidden="true">›</span><strong>{mode === \'canvas\' ? activeBoard.title : documentRegionVisible ? activeDocument.title : \'Documents\'}</strong></nav>\n<button type="button" onClick={() => {setShowNavigatorPanel(true);setNavigatorWidth(228);setShowInspectorDrawer(false);setSplit(54);window.dispatchEvent(new Event(\'art-equation:reset-studio-layout\'))}}>Reset workspace</button>\n<button type="button" disabled={mode === \'document\'} onClick={() => window.dispatchEvent(new Event(\'art-equation:show-studio\'))}>Color &amp; Layers</button>\n</>,')
const begin=source.indexOf('<span className="tree-section-label">Documents</span>')
const boards=source.indexOf('<span className="tree-section-label">Boards</span>',begin)
const end=source.indexOf('<span className="tree-section-label">Project system</span>',boards)
if(begin<0||boards<0||end<0)throw new Error('Navigator sections missing')
const docs=source.slice(begin,boards).replace('<span className="tree-section-label">Documents</span>','<div className="p25-tree-section"><span className="tree-section-label">Documents &amp; notes</span><small>{project.documents.length} documents</small></div>')
const boardSection=source.slice(boards,end).replace('<span className="tree-section-label">Boards</span>','<div className="p25-tree-section"><span className="tree-section-label">Boards &amp; sub-boards</span><small>{project.boards.length} boards</small></div>')
const shelf='<PrototypeAssetShelf assets={project.assets} board={activeBoard} readOnly={inspectorPermission.readOnly} preview={asset => workspaceAssetUrl(workspace?.root, assetPreviewPath(asset))} onCover={setBoardCover} onIcon={() => window.dispatchEvent(new Event(\'art-equation:board-tile-appearance\'))} onPlace={placeShelfAsset} onManage={() => openProjectModule(\'assets\')} />\n'
source=source.slice(0,begin)+boardSection+docs+shelf+source.slice(end)
const place=`  async function placeShelfAsset(asset: ProjectAsset) {
    if (viewBoardId || !canMutateInspectorProject() || !boardMutationContextIsCurrent()) return
    const context = inspectorMutationContext
    let bounds = asset.kind === 'image' ? fitNaturalImageBounds(assetIntrinsicSize(asset), {width:320,height:240}) : {width:320,height:asset.kind==='video'?180:240}
    if (asset.kind === 'image' && !bounds) {
      const url = workspaceAssetUrl(workspace?.root, asset.relativePath)
      if (!url) return setStatus('The original image is unavailable for placement.')
      try { bounds = fitNaturalImageBounds(await readImageDimensions(url), {width:320,height:240}) }
      catch(error) { return setStatus('Could not read image dimensions: '+String(error)) }
    }
    if (!bounds || !canMutateInspectorProject(context) || !boardMutationContextIsCurrent()) return
    const target=projectRef.current.boards.find(entry=>entry.id===activeBoardId)
    if(!target)return
    const node:BoardNode={id:'shelf-'+crypto.randomUUID(),kind:asset.kind,assetId:asset.id,title:asset.displayName,
      x:(180-target.viewport.x)/target.viewport.scale,y:(180-target.viewport.y)/target.viewport.scale,...bounds,
      ...(asset.kind==='image'?{imagePresentation:'artwork' as const}:{})}
    if(addGeneratedAssetToBoard(asset,node)){changeMode('split');setStatus(asset.displayName+' added to the canvas. Ctrl+Z removes the placement.')}
  }

`
source=source.replace('  function acceptGeneratedAsset(',place+'  function acceptGeneratedAsset(')
fs.writeFileSync('src/App.tsx',source);console.log('Exact prototype heading, board/document organization and canonical asset shelf connected.')

