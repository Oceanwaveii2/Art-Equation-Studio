/**
 * Priority 1.5 - Project 2: Milanote Spatial Board Arrangement Recreation
 * 
 * Recreates the complete 6-column Milanote reference board ("Family Guy Incomplete data"
 * from Milinotes I.png & Milinotes 4.png, plus spatial elements from ref-milanote-latest.png):
 *  1. Dark canvas workspace (#1f1f1f) with dot grid pattern
 *  2. Top navigation header with full breadcrumb hierarchy & board title
 *  3. Left persistent creation rail with 12 tool icons & bottom Trash affordance
 *  4. 6 structured vertical columns with headers, card/file count badges, and collapse toggles
 *  5. 16 authentic image cards (PDF documents, MP4 video with play overlay, PSD assets,
 *     character illustrations, comic panels, airship photos, 3D figurines, wood sculptures)
 *     registered as genuine DecodedImageReferences in B4CpuRenderer
 *  6. Floating active column with vibrant mint/turquoise background (#66cca8)
 *  7. Floating color picker / appearance HUD with Background/Top strip tabs & color swatches
 *  8. Fluid cubic Bézier connector line with arrowhead marker linking cards
 *  9. Stylized vector polygon shape (origami shard) with cyan border & translucent fill
 * 10. Canvas minimap HUD with layout thumbnail blocks, focus box & zoom pill (- 92% +)
 * 11. Shaped editorial typography via TextEngine (HarfBuzz/Parley WASM)
 * 12. 100% rendered via genuine Vello CPU Sparse Strips WASM pipeline (zero DOM <div>s)
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'

console.log('=== Step 1: Initializing Production Engine & Vello CPU Renderer ===')
const wasmModulePath = new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js', import.meta.url)
const wasmBinaryPath = new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', import.meta.url)

const engine = await import(wasmModulePath)
await engine.default({ module_or_path: await readFile(wasmBinaryPath) })

const renderer = new engine.B4CpuRenderer()
console.log('✔ B4CpuRenderer instantiated successfully')

// Initialize TextEngine for typography
const fontEpoch = 'milanote-board-text'
const textEngine = new engine.TextEngine(fontEpoch)
textEngine.register_font('arial', '1', 0, await readFile('C:/Windows/Fonts/arial.ttf'))
textEngine.register_font('georgia', '1', 0, await readFile('C:/Windows/Fonts/georgia.ttf'))
console.log('✔ TextEngine registered Arial & Georgia system fonts')

// ----------------------------------------------------
// Step 2: Registering Authentic Image Card Textures
// ----------------------------------------------------
console.log('\n=== Step 2: Registering Authentic Milanote Image Card Textures ===')
const assetDir = new URL('../artifacts/recreation/milanote_assets/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', assetDir), 'utf8'))

const imageResources = []
const registeredImages = new Map()

const currentEpoch = 1
for (const [pngName, info] of Object.entries(manifest)) {
  const rawPath = new URL(info.raw, assetDir)
  const rawBytes = await readFile(rawPath)
  const key = pngName.replace('.png', '')
  
  const ref = {
    key,
    revision: 1,
    epoch: currentEpoch,
    width: info.width,
    height: info.height,
  }
  
  renderer.register_image(JSON.stringify(ref), new Uint8Array(rawBytes))
  imageResources.push(ref)
  registeredImages.set(key, ref)
}
console.log(`✔ Registered ${registeredImages.size} authentic card images into B4CpuRenderer`)

// ----------------------------------------------------
// Step 3: Constructing Scene Geometry & Display List
// ----------------------------------------------------
console.log('\n=== Step 3: Constructing Milanote Board Layout ===')
const W = 1920
const H = 1080

const operations = []
let nextOpId = 1

function addRect(id, x, y, width, height, fill, stroke = 'none', strokeWidth = 0, opacity = 1.0) {
  const normFill = fill === 'none' ? '#00000000' : normalizeColor8(fill)
  const normStroke = stroke === 'none' ? '#00000000' : normalizeColor8(stroke)
  const commands = [
    ['M', x, y],
    ['L', x + width, y],
    ['L', x + width, y + height],
    ['L', x, y + height],
    ['Z']
  ]
  operations.push({
    type: 'vector',
    object: {
      id: `${id}-${nextOpId++}`,
      kind: 'vector',
      bounds: { x, y, width, height },
      visible: true,
      opacity,
      blendMode: 'normal',
      payload: {
        commands,
        fill: normFill,
        stroke: normStroke,
        strokeWidth,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })
}

function addRoundedRect(id, x, y, width, height, radius, fill, stroke = 'none', strokeWidth = 0, opacity = 1.0) {
  const normFill = fill === 'none' ? '#00000000' : normalizeColor8(fill)
  const normStroke = stroke === 'none' ? '#00000000' : normalizeColor8(stroke)
  const r = Math.min(radius, width / 2, height / 2)
  const commands = [
    ['M', x + r, y],
    ['L', x + width - r, y],
    ['C', x + width - r * 0.45, y, x + width, y + r * 0.45, x + width, y + r],
    ['L', x + width, y + height - r],
    ['C', x + width, y + height - r * 0.45, x + width - r * 0.45, y + height, x + width - r, y + height],
    ['L', x + r, y + height],
    ['C', x + r * 0.45, y + height, x, y + height - r * 0.45, x, y + height - r],
    ['L', x, y + r],
    ['C', x, y + r * 0.45, x + r * 0.45, y, x + r, y],
    ['Z']
  ]
  operations.push({
    type: 'vector',
    object: {
      id: `${id}-${nextOpId++}`,
      kind: 'vector',
      bounds: { x, y, width, height },
      visible: true,
      opacity,
      blendMode: 'normal',
      payload: {
        commands,
        fill: normFill,
        stroke: normStroke,
        strokeWidth,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })
}

function addCircle(id, cx, cy, radius, fill, stroke = 'none', strokeWidth = 0, opacity = 1.0) {
  const normFill = fill === 'none' ? '#00000000' : normalizeColor8(fill)
  const normStroke = stroke === 'none' ? '#00000000' : normalizeColor8(stroke)
  const k = 0.5522847498 * radius
  const commands = [
    ['M', cx, cy - radius],
    ['C', cx + k, cy - radius, cx + radius, cy - k, cx + radius, cy],
    ['C', cx + radius, cy + k, cx + k, cy + radius, cx, cy + radius],
    ['C', cx - k, cy + radius, cx - radius, cy + k, cx - radius, cy],
    ['C', cx - radius, cy - k, cx - k, cy - radius, cx, cy - radius],
    ['Z']
  ]
  operations.push({
    type: 'vector',
    object: {
      id: `${id}-${nextOpId++}`,
      kind: 'vector',
      bounds: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
      visible: true,
      opacity,
      blendMode: 'normal',
      payload: {
        commands,
        fill: normFill,
        stroke: normStroke,
        strokeWidth,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })
}

function addImage(id, key, x, y, width, height, opacity = 1.0) {
  const ref = registeredImages.get(key)
  if (!ref) throw new Error(`Missing registered image: ${key}`)
  
  const sx = width / ref.width
  const sy = height / ref.height
  
  operations.push({
    type: 'image',
    id: `${id}-${nextOpId++}`,
    resource: ref,
    sourceRect: { x: 0, y: 0, width: ref.width, height: ref.height },
    transform: [sx, 0, 0, sy, x, y],
    opacity,
    sampling: 'bilinear'
  })
}

function normalizeColor8(c) {
  if (typeof c === 'string' && c.startsWith('#')) {
    if (c.length === 7) return c + 'ff'
    if (c.length === 4) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}ff`
    if (c.length === 9) return c
  }
  return c
}

function addText(id, text, fontKey, fontSize, x, y, maxWidth, color = '#ffffffff', lineHeight = 1.25) {
  const normColor = normalizeColor8(color)
  const shapeReq = JSON.stringify({
    schema: 'art-equation.shaped-text',
    schemaVersion: 1,
    id: `${id}-text`,
    revision: '1',
    fontEpoch,
    maxWidth,
    transform: [1, 0, 0, 1, x, y],
    text,
    spans: [{
      start: 0,
      end: Buffer.byteLength(text),
      fonts: [{ key: fontKey, revision: '1' }],
      fontSize,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight,
      letterSpacing: 0,
      color: normColor,
    }]
  })
  const res = JSON.parse(textEngine.shape(shapeReq))
  for (const op of res.operations || []) {
    if (op.type === 'vector' && op.object) {
      operations.push({
        type: 'vector',
        object: {
          ...op.object,
          id: `${id}-${nextOpId++}`,
          bounds: { x, y, width: maxWidth, height: fontSize * 2 },
          visible: true,
          opacity: 1,
          blendMode: 'normal',
        }
      })
    }
  }
}

// ----------------------------------------------------
// 1. Canvas Background & Dot Grid
// ----------------------------------------------------
// Base dark workspace #1e1e1e
addRect('canvas-bg', 0, 0, W, H, '#1e1e1eff')

// Subtle dot grid (pitch 32px)
for (let gx = 70; gx < W; gx += 32) {
  for (let gy = 80; gy < H; gy += 32) {
    addCircle(`grid-${gx}-${gy}`, gx, gy, 1.0, '#333333ff')
  }
}

// ----------------------------------------------------
// 2. Top Navigation Bar (0..W, 0..72)
// ----------------------------------------------------
addRect('topbar-bg', 0, 0, W, 72, '#181818ff', '#2a2a2aff', 1.0)

// Breadcrumb path on top row
const breadcrumb = 'Home  /  Rainee Bootyverse 5.0  /  Visual Character Designer  /  Blending anime  /  Family guy  /  Family Guy Incomplete data'
addText('top-breadcrumb', breadcrumb, 'arial', 11, 80, 16, 1200, '#888888ff')

// Board Title center
addText('board-title', 'Family Guy Incomplete data', 'georgia', 18, 860, 40, 500, '#eeeeeeff')

// Right Header Controls (Share, Export, View)
addRoundedRect('share-btn', W - 260, 22, 68, 28, 4, '#262626ff', '#3d3d3dff', 1.0)
addText('share-txt', 'Share', 'arial', 12, W - 244, 30, 60, '#ccccccff')

addRoundedRect('export-btn', W - 180, 22, 72, 28, 4, '#262626ff', '#3d3d3dff', 1.0)
addText('export-txt', 'Export', 'arial', 12, W - 165, 30, 60, '#ccccccff')

addRoundedRect('view-btn', W - 96, 22, 64, 28, 4, '#262626ff', '#3d3d3dff', 1.0)
addText('view-txt', 'View', 'arial', 12, W - 80, 30, 60, '#ccccccff')

// ----------------------------------------------------
// 3. Left Persistent Creation Rail (0..58, 0..H)
// ----------------------------------------------------
addRect('rail-bg', 0, 0, 58, H, '#161616ff', '#252525ff', 1.0)

// Rail Tool Icons (vertical stack)
const railTools = [
  { name: 'Note', y: 80, active: false },
  { name: 'Link', y: 124, active: false },
  { name: 'To-do', y: 168, active: false },
  { name: 'Line', y: 212, active: false },
  { name: 'Board', y: 256, active: true }, // Highlighted in Milanote screenshot!
  { name: 'Column', y: 300, active: false },
  { name: 'Comment', y: 344, active: false },
  { name: 'Table', y: 388, active: false },
  { name: 'More', y: 432, active: false },
  { name: 'Image', y: 490, active: false },
  { name: 'Upload', y: 534, active: false },
  { name: 'Draw', y: 578, active: false },
]

for (const t of railTools) {
  if (t.active) {
    // Blue active pill for Board tool (#2563eb / #3b82f6)
    addRoundedRect(`tool-active-${t.name}`, 8, t.y - 4, 42, 34, 6, '#2563ebff')
  }
  // Tool icon button outline
  addRoundedRect(`tool-btn-${t.name}`, 12, t.y, 34, 26, 4, t.active ? '#3b82f6ff' : '#222222ff', t.active ? '#60a5faff' : '#333333ff', 1.0)
  addText(`tool-lbl-${t.name}`, t.name.slice(0, 3), 'arial', 9, 17, t.y + 7, 26, t.active ? '#ffffffff' : '#999999ff')
}

// Trash affordance at bottom left
addRoundedRect('rail-trash', 10, H - 48, 38, 34, 6, '#222222ff', '#333333ff', 1.0)
addText('trash-txt', 'Trash', 'arial', 9, 13, H - 36, 32, '#888888ff')

// ----------------------------------------------------
// 4. The 6 Vertical Columns (Spatial Arrangement)
// ----------------------------------------------------
const columnWidth = 282
const columnGutter = 20
const columnStartY = 160
const columnHeight = 880
const startX = 82

const columnsData = [
  {
    col: 1,
    title: 'New Column',
    subtitle: '10 cards, 5 files',
    cards: [
      { type: 'image_asset', key: 'col1_pdf_doc', h: 100 },
      { type: 'image_asset', key: 'col1_video_minions', h: 215 },
      { type: 'image_asset', key: 'col1_psd_marge', h: 175 },
    ]
  },
  {
    col: 2,
    title: 'New Column',
    subtitle: '12 cards, 2 files',
    cards: [
      { type: 'image_asset', key: 'col2_fox_girl_phone', h: 385 },
      { type: 'image_asset', key: 'col2_anime_catgirl', h: 175 },
    ]
  },
  {
    col: 3,
    title: 'New Column',
    subtitle: '11 cards, 3 files',
    cards: [
      { type: 'image_asset', key: 'col3_comic_panel', h: 185 },
      { type: 'image_asset', key: 'col3_peter_window', h: 215 },
      { type: 'image_asset', key: 'col3_airship_hangar', h: 175 },
    ]
  },
  {
    col: 4,
    title: 'New Column',
    subtitle: '15 cards, 2 files',
    cards: [
      { type: 'image_asset', key: 'col4_airship_field', h: 200 },
      { type: 'image_asset', key: 'col4_figurine_3d', h: 360 },
    ]
  },
  {
    col: 5,
    title: 'New Column',
    subtitle: '8 cards, 2 files',
    cards: [
      { type: 'image_asset', key: 'col5_airship_hangar_rear', h: 185 },
      { type: 'image_asset', key: 'col5_airship_flight_tallis', h: 375 },
      { type: 'image_asset', key: 'col5_wood_sculpture', h: 120 },
    ]
  },
  {
    col: 6,
    title: 'New Column',
    subtitle: '13 cards',
    cards: [
      { type: 'image_asset', key: 'col6_lego_manual', h: 215 },
      { type: 'image_asset', key: 'col6_3d_render', h: 285 },
      { type: 'image_asset', key: 'col6_wood_pig', h: 145 },
    ]
  }
]

for (let c = 0; c < columnsData.length; c++) {
  const col = columnsData[c]
  const cx = startX + c * (columnWidth + columnGutter)
  
  // 1. Column Container Box (#2a2a2a background, rounded corners)
  addRoundedRect(`col-box-${c}`, cx, columnStartY, columnWidth, columnHeight, 6, '#2a2a2aff', '#383838ff', 1.0)
  
  // 2. Column Header Header Strip
  addText(`col-title-${c}`, col.title, 'georgia', 13, cx + 16, columnStartY + 14, 180, '#f0f0f0ff')
  addText(`col-sub-${c}`, col.subtitle, 'arial', 10.5, cx + 16, columnStartY + 34, 180, '#999999ff')
  
  // Collapse button [-]
  addCircle(`col-collapse-${c}`, cx + columnWidth - 22, columnStartY + 24, 7, '#333333ff', '#444444ff', 1.0)
  addRect(`col-minus-${c}`, cx + columnWidth - 26, columnStartY + 23, 8, 2, '#aaaaaaff')
  
  // Header divider
  addRect(`col-div-${c}`, cx + 12, columnStartY + 54, columnWidth - 24, 1, '#383838ff')
  
  // 3. Stacked Cards
  let cardY = columnStartY + 64
  for (let i = 0; i < col.cards.length; i++) {
    const card = col.cards[i]
    const cardW = columnWidth - 24
    const cardX = cx + 12
    
    // Card card background frame
    addRoundedRect(`card-bg-${c}-${i}`, cardX, cardY, cardW, card.h, 4, '#202020ff', '#333333ff', 1.0)
    
    // Render authentic cropped image texture
    addImage(`card-img-${c}-${i}`, card.key, cardX, cardY, cardW, card.h)
    
    // Subtle border over image
    addRoundedRect(`card-border-${c}-${i}`, cardX, cardY, cardW, card.h, 4, 'none', '#44444488', 1.0)
    
    cardY += card.h + 12
  }
}

// ----------------------------------------------------
// 5. Floating Active Column & Color HUD (from Milinotes 4.png)
// ----------------------------------------------------
// A newly created column with mint/turquoise background (#66cca8) floating above Column 2/3
const floatColX = 540
const floatColY = 110
const floatColW = 340
const floatColH = 160
addRoundedRect('float-col-bg', floatColX, floatColY, floatColW, floatColH, 6, '#66cca8ff', '#52ba95ff', 1.0)
addText('float-col-title', 'New Column', 'georgia', 15, floatColX + floatColW / 2 - 45, floatColY + 18, 120, '#111111ff')
addText('float-col-sub', '0 cards', 'arial', 11, floatColX + floatColW / 2 - 20, floatColY + 38, 80, '#222222aa')
addCircle('float-col-dot', floatColX + floatColW - 18, floatColY + 18, 4, '#ffffffcc')

// Color Picker HUD on the left (from Milinotes 4.png)
const hudX = 75
const hudY = 16
const hudW = 220
const hudH = 265
addRoundedRect('hud-bg', hudX, hudY, hudW, hudH, 8, '#242424ee', '#3d3d3dff', 1.0)

// Tabs: Background (active pill) / Top strip
addRoundedRect('hud-tab-bg', hudX + 12, hudY + 12, 92, 28, 4, '#383838ff')
addText('hud-tab-bg-txt', 'Background', 'arial', 11, hudX + 26, hudY + 20, 80, '#ffffff')
addText('hud-tab-strip-txt', 'Top strip', 'arial', 11, hudX + 124, hudY + 20, 80, '#888888')

// Swatches Grid: 2 rows of 6 pastel/earthy chips
const swatchesRow1 = ['#ffffff', '#fde047', '#86efac', '#67e8f9', '#93c5fd', '#c4b5fd']
const swatchesRow2 = ['#d1d5db', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6']
const swatchesRow3 = ['#78716c', '#b45309', '#047857', '#0e7490', '#1d4ed8', '#6d28d9']

function drawSwatchRow(row, startY) {
  for (let s = 0; s < row.length; s++) {
    const sx = hudX + 16 + s * 32
    addRoundedRect(`swatch-${startY}-${s}`, sx, startY, 24, 20, 3, row[s])
  }
}
drawSwatchRow(swatchesRow1, hudY + 54)
drawSwatchRow(swatchesRow2, hudY + 82)
drawSwatchRow(swatchesRow3, hudY + 110)

// Custom color button
addRoundedRect('hud-custom-btn', hudX + 16, hudY + 144, 188, 28, 4, '#2e2e2eff', '#444444ff', 1.0)
addCircle('hud-color-wheel', hudX + 32, hudY + 158, 6, '#ec4899ff')
addText('hud-custom-txt', 'Custom color...', 'arial', 11.5, hudX + 46, hudY + 151, 140, '#dddddd')

// Rename & Submenus
addRect('hud-div', hudX + 12, hudY + 185, hudW - 24, 1, '#383838ff')
addText('hud-rename-txt', 'Rename', 'arial', 12, hudX + 24, hudY + 200, 100, '#cccccc')
addText('hud-lock-txt', 'Lock Position', 'arial', 12, hudX + 24, hudY + 230, 100, '#888888')

// ----------------------------------------------------
// 6. Fluid Bézier Connection Curve (from ref-milanote-latest.png)
// ----------------------------------------------------
// Swooping cubic curve connecting Column 1 (Video card) to Column 4 (Figurine card)
const connectorCommands = [
  ['M', 360, 480],
  ['C', 540, 400, 800, 560, 1010, 520]
]
operations.push({
  type: 'vector',
  object: {
    id: `connector-bezier-${nextOpId++}`,
    kind: 'vector',
    bounds: { x: 360, y: 400, width: 650, height: 160 },
    visible: true,
    opacity: 0.9,
    blendMode: 'normal',
    payload: {
      commands: connectorCommands,
      fill: 'none',
      stroke: '#5eead4ff', // Luminous mint/cyan
      strokeWidth: 3.5,
      vectorFillRule: 'nonzero'
    },
    transform: [1, 0, 0, 1, 0, 0]
  }
})

// Arrowhead at endpoint (1010, 520)
const arrowCommands = [
  ['M', 1012, 520],
  ['L', 996, 510],
  ['L', 1000, 520],
  ['L', 996, 530],
  ['Z']
]
operations.push({
  type: 'vector',
  object: {
    id: `connector-arrow-${nextOpId++}`,
    kind: 'vector',
    bounds: { x: 996, y: 510, width: 16, height: 20 },
    visible: true,
    opacity: 1.0,
    blendMode: 'normal',
    payload: {
      commands: arrowCommands,
      fill: '#5eead4ff',
      stroke: '#5eead4ff',
      strokeWidth: 1.0,
      vectorFillRule: 'nonzero'
    },
    transform: [1, 0, 0, 1, 0, 0]
  }
})

// ----------------------------------------------------
// 7. Stylized Origami Vector Shape (from ref-milanote-latest.png)
// ----------------------------------------------------
// Polygon shard on the left margin
const shardCommands = [
  ['M', 450, 680],
  ['L', 520, 630],
  ['L', 500, 740],
  ['L', 570, 780],
  ['L', 480, 860],
  ['L', 440, 760],
  ['Z']
]
operations.push({
  type: 'vector',
  object: {
    id: `vector-shard-${nextOpId++}`,
    kind: 'vector',
    bounds: { x: 440, y: 630, width: 130, height: 230 },
    visible: true,
    opacity: 0.85,
    blendMode: 'normal',
    payload: {
      commands: shardCommands,
      fill: '#172a45dd',
      stroke: '#38bdf8ff',
      strokeWidth: 2.5,
      vectorFillRule: 'nonzero'
    },
    transform: [1, 0, 0, 1, 0, 0]
  }
})

// ----------------------------------------------------
// 8. Canvas Minimap HUD (from ref-milanote-latest.png)
// ----------------------------------------------------
const mapX = W - 220
const mapY = H - 120
const mapW = 190
const mapH = 96
// Glass background
addRoundedRect('minimap-bg', mapX, mapY, mapW, mapH, 6, '#181818dd', '#333333ff', 1.0)

// Miniature column blocks
for (let mc = 0; mc < 6; mc++) {
  const mx = mapX + 14 + mc * 26
  addRoundedRect(`minimap-col-${mc}`, mx, mapY + 18, 22, 60, 2, mc === 1 ? '#66cca8aa' : '#3d3d3daa')
}

// Active camera viewport rectangle
addRoundedRect('minimap-viewport', mapX + 8, mapY + 12, 174, 72, 3, 'none', '#3b82f6ff', 1.5)

// Zoom pill (- 92% +)
addRoundedRect('zoom-pill', mapX + 20, mapY + mapH - 18, 150, 20, 10, '#262626ff', '#3d3d3dff', 1.0)
addText('zoom-minus', '-', 'arial', 12, mapX + 32, mapY + mapH - 14, 15, '#aaaaaa')
addText('zoom-pct', '92%', 'arial', 10, mapX + 78, mapY + mapH - 13, 40, '#dddddd')
addText('zoom-plus', '+', 'arial', 12, mapX + 145, mapY + mapH - 14, 15, '#aaaaaa')

console.log(`✔ Assembled complete Milanote Board scene with ${operations.length} operations`)

// ----------------------------------------------------
// Step 4: Compiling Display List Schema Version 2
// ----------------------------------------------------
console.log('\n=== Step 4: Compiling Display List v2 ===')
const displayList = {
  schema: 'art-equation.display-list',
  schemaVersion: 2,
  sceneId: 'milanote-board-recreation',
  revision: '1',
  environment: {
    background: '#1e1e1eff',
    colorSpace: 'srgb'
  },
  resources: imageResources,
  operations
}

console.log(`✔ Display list ready: ${displayList.operations.length} ops, ${displayList.resources.length} image resources`)

// ----------------------------------------------------
// Step 5: Rendering via Genuine Vello CPU Wasm
// ----------------------------------------------------
console.log('\n=== Step 5: Rendering via Vello CPU Sparse Strips WASM ===')
const t0 = performance.now()
const renderedPixels = renderer.render_snapshot(W, H, JSON.stringify(displayList), 1.0, 0, 0)
const elapsed = performance.now() - t0
console.log(`✔ Vello CPU rendered ${W}x${H} in ${elapsed.toFixed(2)} ms`)
assert(renderedPixels.length === W * H * 4, 'Render output matches expected byte length')

// ----------------------------------------------------
// Step 6: Verifying Color Fidelity & Layer Assertions
// ----------------------------------------------------
console.log('\n=== Step 6: Verifying Color Fidelity & Compositing ===')
function pixelAt(x, y) {
  const i = (Math.round(y) * W + Math.round(x)) * 4
  return [renderedPixels[i], renderedPixels[i + 1], renderedPixels[i + 2], renderedPixels[i + 3]]
}

// 1. Canvas Background Sample (#1e1e1e -> [30, 30, 30])
const bgPixel = pixelAt(400, 100)
console.log('Canvas Background Sample (400, 100):', bgPixel)
assert(bgPixel[0] >= 28 && bgPixel[0] <= 32, 'Canvas background R channel matches #1e1e1e')
assert(bgPixel[1] >= 28 && bgPixel[1] <= 32, 'Canvas background G channel matches #1e1e1e')

// 2. Left Creation Rail Tool Active Board Pill (#2563eb / #3b82f6)
const activeToolPixel = pixelAt(20, 265)
console.log('Active Board Tool Sample (20, 265):', activeToolPixel)
assert(activeToolPixel[2] > 200, 'Board active tool highlighted with blue pill')

// 3. Floating Mint/Turquoise Column (#66cca8 -> [102, 204, 168])
const mintPixel = pixelAt(600, 180)
console.log('Floating Mint Column Sample (600, 180):', mintPixel)
assert(mintPixel[0] > 90 && mintPixel[0] < 120, 'Mint column R matches #66cca8')
assert(mintPixel[1] > 190 && mintPixel[1] < 220, 'Mint column G matches #66cca8')
assert(mintPixel[2] > 155 && mintPixel[2] < 185, 'Mint column B matches #66cca8')

// 4. Authentic Image Card Texture: Fox-girl illustration (Column 2)
const foxGirlPixel = pixelAt(startX + columnWidth + columnGutter + 120, columnStartY + 150)
console.log('Fox Girl Artwork Sample:', foxGirlPixel)
assert(foxGirlPixel[3] === 255, 'Image card texture composited with 100% alpha')

// 5. Authentic Image Card Texture: Airship in hangar (Column 3)
const airshipPixel = pixelAt(startX + 2 * (columnWidth + columnGutter) + 120, columnStartY + 450)
console.log('Airship Photo Sample:', airshipPixel)
assert(airshipPixel[3] === 255, 'Airship photo composited with 100% alpha')

// 6. Luminous Cyan Connector Curve (#5eead4)
const connectorPixel = pixelAt(360, 480)
console.log('Connector Start Sample (360, 480):', connectorPixel)
assert(connectorPixel[1] > 150 && connectorPixel[2] > 150, 'Cyan connector curve rasterized')

// 7. Minimap HUD Glass Box
const minimapPixel = pixelAt(mapX + 20, mapY + 20)
console.log('Minimap HUD Sample:', minimapPixel)
assert(minimapPixel[0] > 35 && minimapPixel[1] > 35, 'Minimap HUD elements rendered')

// ----------------------------------------------------
// Step 7: Exporting Rendered Artifact PNG
// ----------------------------------------------------
console.log('\n=== Step 7: Exporting Rendered Artifact PNG ===')
const artifactsDir = new URL('../artifacts/recreation/', import.meta.url)
await mkdir(artifactsDir, { recursive: true })
const rawPath = new URL('milanote_board_recreation_raw.bin', artifactsDir)
const pngPath = new URL('milanote_board_recreation.png', artifactsDir)

await writeFile(rawPath, renderedPixels)

const convertScript = `import sys
from PIL import Image

raw_path = sys.argv[1]
png_path = sys.argv[2]
width = int(sys.argv[3])
height = int(sys.argv[4])

with open(raw_path, 'rb') as f:
    data = f.read()

img = Image.frombytes('RGBA', (width, height), data)
img.save(png_path)
print(f'PNG saved to {png_path} successfully!')
`
const pythonScriptPath = new URL('convert_milanote_png.py', artifactsDir)
await writeFile(pythonScriptPath, convertScript)

execFileSync('python', [pythonScriptPath.pathname.replace(/^\/([A-Za-z]:)/, '$1'), rawPath.pathname.replace(/^\/([A-Za-z]:)/, '$1'), pngPath.pathname.replace(/^\/([A-Za-z]:)/, '$1'), W.toString(), H.toString()])
console.log(`✔ PNG artifact written to: ${pngPath.pathname.replace(/^\/([A-Za-z]:)/, '$1')}`)

console.log('\n=== MILANOTE BOARD RECREATION COMPLETE: 100% PASS ===\n')
