import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const root=process.cwd(), files=[]
const scan=async dir=>{for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true})){
  const relative=path.posix.join(dir,entry.name)
  if(entry.isDirectory()){if(!['generated','target','node_modules','.git','dist','output'].includes(entry.name))await scan(relative)}
  else if(/\.(tsx?|rs|mjs|css|ptx)$/.test(entry.name)){
    const source=await fs.readFile(path.join(root,relative),'utf8')
    files.push({path:relative,sha256:crypto.createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source),
      imports:[...source.matchAll(/(?:from\s+|import\s*|mod\s+)(?:['"]([^'"]+)['"]|([a-zA-Z_][\w]*);)/g)].map(match=>match[1]||match[2]),source})
  }
}}
for(const dir of ['src','src-tauri/src','src-tauri/vendor/gpu-allocator/src','scripts','engine/vello-surface/rust/src','engine/vello-surface/rust/vendor','engine/native-canvas-probe/src'])await scan(dir)
for(const relative of ['index.html','package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','engine/vello-surface/rust/Cargo.toml','engine/vello-surface/rust/Cargo.lock','engine/vello-surface/build-receipt.json','AGENTS.md','UI_REFERENCE_2026-10-08.md','PRODUCTION_SETTINGS_PRESERVATION_2026-10-08.md','scripts/quality-policy.json','scripts/UI_CONSISTENCY_POLICY.txt','scripts/QUALITY_GATE_GUIDE.txt']){
  const source=await fs.readFile(path.join(root,relative),'utf8');files.push({path:relative,sha256:crypto.createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source),imports:[],source})
}
files.sort((a,b)=>a.path.localeCompare(b.path))
for (const relative of ['scripts/install-nvidia-runtime.ps1','tools/nvidia/package-receipt.json','src-tauri/build.rs','src-tauri/windows-app-manifest.xml','src-tauri/vendor/gpu-allocator/Cargo.toml','src-tauri/vendor/gpu-allocator/ART-EQUATION-PATCH.md','docs/engine-2.6/source-receipt.json','engine/native-canvas-probe/Cargo.toml','engine/native-canvas-probe/Cargo.lock']) {
  const fullPath = path.join(root, relative)
  if (!fsSync.existsSync(fullPath)) continue
  const source=await fs.readFile(fullPath,'utf8')
  files.push({path:relative,sha256:crypto.createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source),imports:[],source})
}
files.sort((a,b)=>a.path.localeCompare(b.path))
const topology={
  scope:'Source snapshot embedded in this diagnostic build. Read-only inspection is not release qualification.',
  application:'React UI in Tauri/WebView2; portable project model; Rust native workspace services',
  renderer:'wgpu with Vello GPU preferred and Vello CPU fallback; project-b/p0-surface presenter owns generation and backend lifecycle',
  modules:[
    {name:'Workspace shell',paths:['src/ui/Prototype25Shell.tsx','src/ui/Prototype25Shell.css','src/ui/PrototypeCanvasLayout.css','src/ui/PrototypeDocumentTabs.tsx','src/ui/PrototypeAssetShelf.tsx','src/ui/ProductionStudio.tsx','src/ui/CanvasToolbar.tsx','src/board/BoardMinimap.tsx','src/App.tsx'],role:'Prototype 2.5 presentation boundary; production App controller supplies canonical command-bound slots. Document-only retained editor tabs, separate board navigation and canvas filmstrip, movable/resizable/hideable floating Color & Layers with a dedicated Layers tab. Task-grouped toolbar separates ordinary Columns from Graph Column and keeps Minimap in View; overview thumbnails and bounded retained rasters use canonical scene geometry. Docking is not implemented. Production SettingsDialog, Saving and Codex remain native-service backed.'},
    {name:'Canonical project',paths:['src/model/project.ts','src/model/trash.ts','src/board'],role:'Stable IDs, board/node/connector/document/assets, drawing geometry, groups, columns and undo'},
    {name:'Drawing input and CPU fallback',paths:['src/board/StrokePreview.ts','src/board/scheduledPointerGesture.ts','src/canvas-engine/appFrameClock.ts','src/model/vectorDrawing.ts','engine/vello-surface/rust/src/cpu.rs','engine/vello-surface/rust/examples/cpu_thread_probe.rs'],role:'Ordered CPU geometry samples with disposable once-per-frame SVG editing preview on the shared present phase; no per-sample React draft updates or document edits. Completed gestures retain one canonical history transaction. CPU fallback pairs persistent rendering context, pixel buffer and Resources, validates retained-capacity receipts and retains its memory lease until worker retirement. Native CPU parallelism is an explicit 0/2/4-thread diagnostic feature; browser fallback stays single-threaded in its worker and GPU remains preferred. Native raster and browser/model checks are separate from native app/stylus/4K acceptance.'},
    {name:'Renderer bridge',paths:['src/board/RetainedBoardContent.ts','src/project-b/p0-surface','src/canvas-engine'],role:'Capture eligibility, retained paint, image residency, text shaping, generation admission and GPU/CPU presentation'},
    {name:'Native canvas host',paths:['engine/native-canvas-probe/src/main.rs','engine/native-canvas-probe/src/bin/live_host.rs','engine/native-canvas-probe/Cargo.toml'],role:'Existing Vello renderer in an independent native winit/wgpu surface. The live host accepts bounded JSON-line frame and camera commands, rejects stale generations, emits native pointer/keyboard/IME/DPI input, reuses the GPU session and atlas, and presents without browser or pixel readback. It is not connected to the production workspace editors/storage or a full native UI. The original three-frame correctness probe remains separate. No 4K performance qualification.'},
    {name:'Native IO',paths:['src/storage/workspace.ts','src/storage/projectAutosave.ts','src/storage/projectSaveDelta.ts','engine/workspace-core/src/lib.rs','engine/workspace-core/src/session.rs','engine/workspace-core/Cargo.toml','src-tauri/src/project_storage.rs','src-tauri/src/lib.rs'],role:'One host-independent native SQLite WAL/FULL writer shared by the native window and existing UI adapter; canonical writer path identity, exclusive native workspace ownership, board checkpoints/project manifest, recovery and save configuration. Native host storage works directly; full native editors/workspace remain unfinished'},
    {name:'Fonts/media',paths:['src-tauri/src/font_resolver.rs','src-tauri/src/image_pyramid.rs','src/media'],role:'Native font identity, project assets, derived images, managed folders and semantic indexing'},
    {name:'Engine 2.6 preparation',paths:['src/canvas-engine/retainedPaintCompiler.ts','src/canvas-engine/preparationPolicy.ts','src/board/preparationWorkers.ts','src/board/tiffDecode.worker.ts','src/board/modelImageDecode.worker.ts','src/project-b/p0-surface/modelImageDemand.ts','src/project-b/p0-surface/modelTileStream.ts','src/project-b/p0-surface/retainedTextShape.ts','src/project-b/p0-surface/modelImageDecode.ts','src/project-b/p0-surface/engineScenePaint.ts','src/board/derivedDiskCache.ts','src/board/BoardPreview.tsx','src-tauri/src/experimental_compute.rs','src-tauri/src/experimental_compute/cl.rs','src-tauri/src/experimental_compute/session.rs','src-tauri/src/window_chrome.rs','src-tauri/windows-app-manifest.xml'],role:'Bounded immutable vector derivatives, full-render correctness fallback, reserved CPU capacity, cancellable TIFF workers, content-hash/version-keyed disposable disk previews, demand-gated board previews, visible-residency/detail reporting and native theme/DPI policy. Device/shader preparation warms in one background helper during launch and is retained; explicit CPU/wgpu/OpenCL comparisons report startup and warm job costs separately; opt-in CUDA/DX12 shared preparation and bounded nvJPEG comparison are separate from the browser viewport. Canvas performance remains unqualified.'},
    {name:'Telemetry and quality',paths:['src/diagnostics','scripts/quality-policy.json','scripts/QUALITY_GATE_GUIDE.txt'],role:'Bounded history and durable native JSONL, input-to-commit correlation, provenance and Retina/native acceptance gates'},
    {name:'Codex access',paths:['src/codex','src-tauri/src/codex_bridge.rs','src-tauri/src/live_inspection.rs','scripts/live-app-mcp-server.mjs'],role:'Startup local MCP inspection and automatically connected embedded official Codex app-server; current model/UI and paginated telemetry/log/source reads; Settings opt-out, bounded startup retries; no board mutations'}
  ],
  flows:{render:'Canonical board -> engine-owned graph and qualified rich Type, Notes, plain containers and static/tiled image paint (saved-source layout, native font identity, decoded source pixels); canonical spatial membership -> model-only production compiler; unsupported families retain explicit live overlays without DOM capture -> camera/model tile ROI with offscreen decoding; accepted image viewers unmounted; Vello grid/background; bounded retained scene/images across board switches -> presenter generation -> wgpu/Vello GPU or CPU -> accepted canvas. Active Type editing keeps its DOM IME overlay. Native wgpu window is an isolated evaluation using the same validated display list, not the production host.',
    save:'UI edits -> continuous or interval autosave coordinator -> changed stable records -> native WAL/FULL revision acknowledgement -> coalesced board files and project manifest -> consistent recovery backup; camera sidecar separate; Save/close drains current state and required physical/recovery files',
    inspect:'Codex MCP or embedded dynamic tool -> authenticated native request -> live UI adapter / native logs / embedded architecture -> bounded read response'},
  nativeCommands:[]
}
const native=files.find(row=>row.path==='src-tauri/src/lib.rs').source
topology.nativeCommands=(native.match(/generate_handler!\[([\s\S]*?)\]/)?.[1]||'').split(',').map(value=>value.trim()).filter(Boolean)
const identity=crypto.createHash('sha256').update(JSON.stringify(files.map(({path,sha256})=>({path,sha256})))).digest('hex')
await fs.writeFile(path.join(root,'src-tauri/bridge-architecture.json'),JSON.stringify({schema:1,identity,topology,files}))
console.log(JSON.stringify({architecture:'PASS',files:files.length,identity,scope:'Source snapshot; no product acceptance'}))
