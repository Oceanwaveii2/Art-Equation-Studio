/** Independent proof format. Never normalize this into production project/documents. */
export const NOTEBOOK_STORAGE_KEY = 'art-equation.notebook-proof.v1'
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024
export const moduleKinds = ['heading', 'text', 'note', 'task', 'image', 'video'] as const
export type ModuleKind = typeof moduleKinds[number]
export type MediaReference = { id: string; name: string; mime: string; mode: 'embedded' | 'local'; dataUrl?: string }
export type NotebookModule = { id: string; kind: ModuleKind; text: string; checked: boolean; media?: MediaReference }
export type NotebookPage = { id: string; title: string; modules: NotebookModule[] }
export type Notebook = { schemaVersion: 1; kind: 'art-equation-notebook-proof'; id: string; title: string; updatedAt: string; pages: NotebookPage[] }
export type NotebookHistory = { current: Notebook; past: Notebook[]; future: Notebook[]; mergeKey?: string }
export type NotebookHistoryAction = { type: 'apply'; next: Notebook; mergeKey?: string } | { type: 'undo' } | { type: 'redo' } | { type: 'break' }

const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const touch = (book: Notebook): Notebook => ({ ...book, updatedAt: now() })
export function createModule(kind: ModuleKind, text = ''): NotebookModule { return { id: id(), kind, text, checked: false } }
export function createNotebook(): Notebook {
  return { schemaVersion: 1, kind: 'art-equation-notebook-proof', id: id(), title: 'Production notebook', updatedAt: now(), pages: [{ id: id(), title: 'Production process', modules: [
    createModule('heading', 'Source → Reconstruction → Reconceptualize → Production'),
    createModule('text', 'Collect the original reference, reconstruct its spatial logic, then make deliberate design changes before producing the final image.'),
    createModule('note', 'Working notes stay beside the production steps. Reference storage, reconstruction and reconceptualization are separate stages.'),
    createModule('task', 'Collect reference images and record why each one matters.'),
    createModule('task', 'Reconstruct a simple spatial study before committing to the final design.'),
    createModule('image', 'Reference image — add a local image and its caption.'),
    createModule('video', 'Process recording — choose a local video; relink it after reopening.'),
  ] }, { id: id(), title: 'Review and next steps', modules: [createModule('heading', 'Review the production result'), createModule('text', 'Keep the original reference intact. Record what changed, what worked and what to try next.'), createModule('task', 'Review layout, source links and export before handoff.')] }] }
}
export function insertModule(book: Notebook, pageId: string, kind: ModuleKind, afterId?: string): Notebook {
  if (!moduleKinds.includes(kind) || !book.pages.some((page) => page.id === pageId) || book.pages.reduce((sum, page) => sum + page.modules.length, 0) >= 1000) return book
  return touch({ ...book, pages: book.pages.map((page) => { if (page.id !== pageId) return page; const at = afterId ? page.modules.findIndex((item) => item.id === afterId) + 1 : page.modules.length; if (afterId && at === 0) return page; const modules = [...page.modules]; modules.splice(at, 0, createModule(kind)); return { ...page, modules } }) })
}
export function updateModule(book: Notebook, moduleId: string, patch: Partial<Pick<NotebookModule, 'text' | 'checked' | 'media'>>): Notebook {
  return touch({ ...book, pages: book.pages.map((page) => ({ ...page, modules: page.modules.map((item) => item.id === moduleId ? { ...item, ...patch } : item) })) })
}
export function removeModule(book: Notebook, moduleId: string): Notebook {
  return touch({ ...book, pages: book.pages.map((page) => ({ ...page, modules: page.modules.filter((item) => item.id !== moduleId) })) })
}
/** Offset within a page, or transfer to the target page while retaining identity. */
export function moveModule(book: Notebook, moduleId: string, offset: number, targetPageId?: string): Notebook {
  const source = book.pages.find((page) => page.modules.some((item) => item.id === moduleId))
  const target = book.pages.find((page) => page.id === (targetPageId || source?.id))
  if (!source || !target || !Number.isInteger(offset)) return book
  const position = source.modules.findIndex((item) => item.id === moduleId), item = source.modules[position]
  if (source === target) {
    const nextPosition = Math.max(0, Math.min(source.modules.length - 1, position + offset))
    if (nextPosition === position) return book
    const modules = [...source.modules]; modules.splice(position, 1); modules.splice(nextPosition, 0, item)
    return touch({ ...book, pages: book.pages.map((page) => page === source ? { ...page, modules } : page) })
  }
  return touch({ ...book, pages: book.pages.map((page) => page === source ? { ...page, modules: page.modules.filter((module) => module.id !== moduleId) } : page === target ? { ...page, modules: [...page.modules, item] } : page) })
}
export function addPage(book: Notebook): Notebook { return book.pages.length >= 50 ? book : touch({ ...book, pages: [...book.pages, { id: id(), title: `Page ${book.pages.length + 1}`, modules: [] }] }) }
export function renamePage(book: Notebook, pageId: string, title: string): Notebook { return touch({ ...book, pages: book.pages.map((page) => page.id === pageId ? { ...page, title } : page) }) }
export function notebookHistory(state: NotebookHistory, action: NotebookHistoryAction): NotebookHistory {
  if (action.type === 'break') return { ...state, mergeKey: undefined }
  if (action.type === 'undo') { const previous = state.past.at(-1); return previous ? { current: previous, past: state.past.slice(0, -1), future: [state.current, ...state.future] } : state }
  if (action.type === 'redo') { const next = state.future[0]; return next ? { current: next, past: [...state.past, state.current].slice(-50), future: state.future.slice(1) } : state }
  if (action.next === state.current) return state
  const merge = action.mergeKey && action.mergeKey === state.mergeKey
  return { current: action.next, past: merge ? state.past : [...state.past, state.current].slice(-50), future: [], mergeKey: action.mergeKey }
}

const imageMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const videoMimes = ['video/mp4', 'video/webm', 'video/ogg']
export function isEmbeddedImage(data: string, mime: string) { return imageMimes.includes(mime) && data.startsWith(`data:${mime};base64,`) && /^[A-Za-z0-9+/=]+$/.test(data.slice(data.indexOf(',') + 1)) && data.length <= Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100 }
export function validateNotebook(value: unknown): Notebook {
  if (!value || typeof value !== 'object') throw new Error('This is not a notebook document.')
  const book = value as Record<string, unknown>
  if (book.schemaVersion !== 1 || book.kind !== 'art-equation-notebook-proof') throw new Error('Unsupported notebook format. Production Art Equation documents are not imported here.')
  const seen = new Set<string>(); let count = 0
  const identity = (value: unknown) => { if (typeof value !== 'string' || !value || value.length > 120 || seen.has(value)) throw new Error('Notebook identities must be unique.'); seen.add(value); return value }
  const text = (value: unknown, max = 100_000) => { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid or oversized notebook text.'); return value }
  const bookId = identity(book.id), title = text(book.title, 500)
  if (!Array.isArray(book.pages) || !book.pages.length || book.pages.length > 50) throw new Error('Use 1 to 50 notebook pages.')
  const pages = book.pages.map((value): NotebookPage => {
    if (!value || typeof value !== 'object') throw new Error('Invalid page.')
    const page = value as Record<string, unknown>, pageId = identity(page.id), title = text(page.title, 500)
    if (!Array.isArray(page.modules) || (count += page.modules.length) > 1000) throw new Error('The proof supports up to 1000 modules.')
    const modules = page.modules.map((value): NotebookModule => {
      if (!value || typeof value !== 'object') throw new Error('Invalid module.')
      const item = value as Record<string, unknown>, moduleId = identity(item.id)
      if (!moduleKinds.includes(item.kind as ModuleKind) || typeof item.checked !== 'boolean') throw new Error('Invalid module type or task state.')
      const module: NotebookModule = { id: moduleId, kind: item.kind as ModuleKind, text: text(item.text), checked: item.checked }
      if (item.media !== undefined) {
        if (!['image', 'video'].includes(module.kind) || !item.media || typeof item.media !== 'object') throw new Error('Media belongs to an image or video module.')
        const media = item.media as Record<string, unknown>, mediaId = identity(media.id), name = text(media.name, 500), mime = text(media.mime, 100)
        if (!(module.kind === 'image' ? imageMimes : videoMimes).includes(mime)) throw new Error('Unsupported media format; SVG and active HTML are not accepted.')
        if (media.mode === 'embedded' && module.kind === 'image' && typeof media.dataUrl === 'string' && isEmbeddedImage(media.dataUrl, mime)) module.media = { id: mediaId, name, mime, mode: 'embedded', dataUrl: media.dataUrl }
        else if (media.mode === 'local' && media.dataUrl === undefined) module.media = { id: mediaId, name, mime, mode: 'local' }
        else throw new Error('Unsafe media source. Only embedded raster images or relinkable local references are allowed.')
      }
      return module
    })
    return { id: pageId, title, modules }
  })
  return { schemaVersion: 1, kind: 'art-equation-notebook-proof', id: bookId, title, updatedAt: typeof book.updatedAt === 'string' && Number.isFinite(Date.parse(book.updatedAt)) ? book.updatedAt : now(), pages }
}
export function parseNotebook(json: string) { if (new TextEncoder().encode(json).length > MAX_IMPORT_BYTES) throw new Error('Notebook import exceeds 16 MiB.'); return validateNotebook(JSON.parse(json)) }
export function exportNotebookJson(book: Notebook) { const json = JSON.stringify(validateNotebook(book), null, 2); if (new TextEncoder().encode(json).length > MAX_IMPORT_BYTES) throw new Error('Notebook exceeds the 16 MiB portable-copy limit. Keep fewer embedded image copies.'); return json }
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
export function exportNotebookHtml(input: Notebook) {
  const book = validateNotebook(input), escaped = escapeHtml
  const modules = (page: NotebookPage) => page.modules.map((item) => {
    const content = escaped(item.text).replace(/\n/g, '<br>')
    if (item.kind === 'heading') return `<h2>${content}</h2>`
    if (item.kind === 'task') return `<p class="task">${item.checked ? '☑' : '☐'} ${content}</p>`
    if (item.kind === 'image' && item.media?.mode === 'embedded') return `<figure><img src="${escaped(item.media.dataUrl!)}" alt="${escaped(item.text || item.media.name)}"><figcaption>${content}</figcaption></figure>`
    if (item.kind === 'image' || item.kind === 'video') return `<figure><p>${item.kind === 'video' ? 'Video' : 'Image'} source: ${escaped(item.media?.name || 'not linked')}. Relink the original local file in the notebook proof.</p><figcaption>${content}</figcaption></figure>`
    return `<p${item.kind === 'note' ? ' class="note"' : ''}>${content}</p>`
  }).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escaped(book.title)}</title><style>body{margin:2rem auto;max-width:760px;padding:0 1rem;color:#292725;background:#fff;font:17px/1.6 system-ui,sans-serif}h1,h2{line-height:1.2}section{margin:3rem 0;break-before:page}section:first-of-type{break-before:auto}img{display:block;max-width:100%;height:auto;max-height:700px;object-fit:contain}figure{margin:2rem 0}.note{padding:1rem;border-left:3px solid #976b38;background:#f6f1e8}.task{white-space:normal}p,figcaption{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}h2{break-after:avoid}figure{break-inside:avoid}}</style></head><body><h1>${escaped(book.title)}</h1><p>Art Equation Production Notebook — separate document proof of concept. Local video files are references, not packaged media.</p>${book.pages.map((page) => `<section aria-label="${escaped(page.title)}"><h1>${escaped(page.title)}</h1>${modules(page)}</section>`).join('\n')}</body></html>`
}
