import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TiptapImage from '@tiptap/extension-image'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type JSONContent, type NodeViewProps } from '@tiptap/react'
import { Extension, Node } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import type { DocumentLayout } from '../model/project'
import { discoverFontCatalog, fontFamilyOptions, UNVERIFIED_FONT_CATALOG, type FontCatalog } from '../typography/fontCatalog'
import { solveDocumentPagination } from './paginationEngine'

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => element.style.fontSize || null,
          renderHTML: (attributes) => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
        },
        lineHeight: {
          default: null,
          parseHTML: (element) => element.style.lineHeight || null,
          renderHTML: (attributes) => attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
        },
        letterSpacing: {
          default: null,
          parseHTML: (element) => element.style.letterSpacing || null,
          renderHTML: (attributes) => attributes.letterSpacing ? { style: `letter-spacing: ${attributes.letterSpacing}` } : {},
        },
        fontWeight: {
          default: null,
          parseHTML: (element) => element.style.fontWeight || null,
          renderHTML: (attributes) => attributes.fontWeight ? { style: `font-weight: ${attributes.fontWeight}` } : {},
        },
      },
    }]
  },
})

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': 'true' }],
})

const BlankPage = Node.create({
  name: 'blankPage',
  group: 'block',
  atom: true,
  parseHTML: () => [{ tag: 'div[data-blank-page]' }],
  renderHTML: () => ['div', { 'data-blank-page': 'true', 'data-page-break': 'true' }],
})

const SectionBreakContinuous = Node.create({
  name: 'sectionBreakContinuous',
  group: 'block',
  atom: true,
  addAttributes: () => ({ title: { default: 'Section' } }),
  parseHTML: () => [{ tag: 'div[data-section-break="continuous"]' }],
  renderHTML: ({ node }) => ['div', { 'data-section-break': 'continuous', 'data-section-title': String(node.attrs.title || 'Section') }],
})

const SectionBreakNextPage = Node.create({
  name: 'sectionBreakNextPage',
  group: 'block',
  atom: true,
  addAttributes: () => ({ title: { default: 'New Section' } }),
  parseHTML: () => [{ tag: 'div[data-section-break="next-page"]' }],
  renderHTML: ({ node }) => ['div', { 'data-section-break': 'next-page', 'data-page-break': 'true', 'data-section-title': String(node.attrs.title || 'New Section') }],
})

const Footnote = Node.create({
  name: 'footnote', group: 'block', atom: true,
  addAttributes: () => ({ number: { default: 1 }, text: { default: '' } }),
  parseHTML: () => [{ tag: 'aside[data-footnote]' }],
  renderHTML: ({ node }) => ['aside', { 'data-footnote': String(node.attrs.number) }, ['sup', {}, String(node.attrs.number)], ['span', {}, String(node.attrs.text)]],
})

function LayoutImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const editable = useEditorState({ editor, selector: ({ editor: currentEditor }) => currentEditor.isEditable })
  const intrinsicWidth = Number(node.attrs.width) || 640
  const intrinsicHeight = Number(node.attrs.height) || 360
  return <NodeViewWrapper as="figure" className={`layout-image ${selected ? 'selected' : ''}`} data-placement={node.attrs.placement} data-intrinsic-reserved="true" contentEditable={false}>
    <img src={node.attrs.src} width={intrinsicWidth} height={intrinsicHeight} style={{ aspectRatio: `${intrinsicWidth} / ${intrinsicHeight}` }} alt={node.attrs.alt || node.attrs.caption || ''} title={node.attrs.title || node.attrs.caption || ''} onLoad={(event) => {
      const img = event.currentTarget
      if (img.naturalWidth > 0 && img.naturalHeight > 0 && (!node.attrs.width || !node.attrs.height) && editor.isEditable) {
        updateAttributes({ width: img.naturalWidth, height: img.naturalHeight })
      }
    }} />
    <input className="editable-image-caption" aria-label="Image caption" value={node.attrs.caption || ''} readOnly={!editable} placeholder="Add an image caption…" onChange={(event) => { if (editor.isEditable) updateAttributes({ caption: event.target.value, alt: event.target.value, title: event.target.value }) }} />
  </NodeViewWrapper>
}

const LayoutImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: 640, parseHTML: (el) => Number(el.getAttribute('width')) || 640, renderHTML: (attrs) => ({ width: attrs.width || 640 }) },
      height: { default: 360, parseHTML: (el) => Number(el.getAttribute('height')) || 360, renderHTML: (attrs) => ({ height: attrs.height || 360 }) },
      placement: { default: 'block', parseHTML: (element) => element.getAttribute('data-placement') || 'block', renderHTML: (attributes) => ({ 'data-placement': attributes.placement }) },
      caption: { default: '', parseHTML: (element) => element.getAttribute('data-caption') || '', renderHTML: (attributes) => ({ 'data-caption': attributes.caption, title: attributes.caption || undefined, 'aria-label': attributes.caption || undefined }) },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(LayoutImageView) },
})

const VideoBlock = Node.create({
  name: 'videoBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    src: { default: '' },
    poster: { default: '' },
    caption: { default: '' },
    fit: { default: 'contain' },
    muted: { default: true },
    width: { default: 640 },
    height: { default: 360 },
  }),
  parseHTML: () => [{ tag: 'figure[data-video-block]' }],
  renderHTML: ({ node }) => [
    'figure',
    {
      'data-video-block': 'true',
      'data-intrinsic-reserved': 'true',
      'data-fit': String(node.attrs.fit || 'contain'),
      style: `aspect-ratio:${Number(node.attrs.width) || 640}/${Number(node.attrs.height) || 360};min-height:180px`,
    },
    ['video', { src: String(node.attrs.src || ''), poster: node.attrs.poster ? String(node.attrs.poster) : undefined, controls: 'true', muted: node.attrs.muted !== false ? 'true' : undefined, preload: 'metadata', style: `width:100%;height:auto;object-fit:${String(node.attrs.fit || 'contain')}` }],
    ['figcaption', {}, String(node.attrs.caption || 'Embedded video block (intrinsic box reserved)')],
  ],
})

const Model3DBlock = Node.create({
  name: 'model3DBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    src: { default: '' },
    extension: { default: 'glb' },
    title: { default: '3D Model Asset' },
    caption: { default: '' },
    cameraPreset: { default: 'perspective' },
    width: { default: 640 },
    height: { default: 380 },
  }),
  parseHTML: () => [{ tag: 'figure[data-model3d-block]' }],
  renderHTML: ({ node }) => [
    'figure',
    {
      'data-model3d-block': 'true',
      'data-intrinsic-reserved': 'true',
      'data-model-src': String(node.attrs.src || ''),
      'data-camera-preset': String(node.attrs.cameraPreset || 'perspective'),
      style: `aspect-ratio:${Number(node.attrs.width) || 640}/${Number(node.attrs.height) || 380};min-height:220px`,
    },
    ['div', { class: 'document-model3d-poster' }, `⬡ 3D Viewport: ${String(node.attrs.title || '3D Model Asset')} (${String(node.attrs.extension || 'glb').toUpperCase()} · Camera: ${String(node.attrs.cameraPreset || 'perspective')})`],
    ['figcaption', {}, String(node.attrs.caption || '')],
  ],
})

const PdfEmbedBlock = Node.create({
  name: 'pdfEmbedBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    src: { default: '' },
    title: { default: 'Embedded PDF' },
    pageRange: { default: '1' },
    caption: { default: '' },
    width: { default: 612 },
    height: { default: 792 },
  }),
  parseHTML: () => [{ tag: 'figure[data-pdf-embed]' }],
  renderHTML: ({ node }) => [
    'figure',
    {
      'data-pdf-embed': 'true',
      'data-intrinsic-reserved': 'true',
      'data-page-range': String(node.attrs.pageRange || '1'),
    },
    ['div', { class: 'document-pdf-embed-card' }, `📄 PDF Embed: ${String(node.attrs.title || 'Embedded PDF')} (Pages: ${String(node.attrs.pageRange || '1')})`],
    ['figcaption', {}, String(node.attrs.caption || '')],
  ],
})

export type DocumentWorkspaceViewSnapshot = {
  showOutline: boolean
  showInspector: boolean
  focusMode: boolean
  selection: { from: number; to: number }
  /** Observed history eligibility; restoreView never restores these derived flags. */
  canUndo?: boolean
  canRedo?: boolean
  /** Entry visibility is retained even when a focus-writing snapshot hides both panels. */
  focusRestore?: { showOutline: boolean; showInspector: boolean }
}

export type DocumentWorkspaceControls = {
  togglePageInspector: () => void
  toggleOutline: () => void
  toggleFocusWriting: () => void
  undo: () => boolean
  redo: () => boolean
  focusEditor: () => void
  captureView: () => DocumentWorkspaceViewSnapshot
  restoreView: (snapshot: DocumentWorkspaceViewSnapshot) => void
}

type RichDocumentProps = {
  content: Record<string, unknown>
  layout: DocumentLayout
  readOnly?: boolean
  active?: boolean
  controlsRef?: Ref<DocumentWorkspaceControls>
  onFocusWritingChange?: (enabled: boolean) => void
  onChange: (content: Record<string, unknown>) => void
  onLayoutChange: (layout: DocumentLayout) => void
  onRequestText: (options: { title: string; label: string; initialValue?: string }) => Promise<string | null>
}

type OutlineEntry = { level: number; label: string }

function normalizedViewSelection(selection: { from: number; to: number }, maximum: number, fallback: { from: number; to: number }) {
  const clamp = (value: number, previous: number) => Math.max(0, Math.min(maximum, Math.trunc(Number.isFinite(value) ? value : previous)))
  const from = clamp(selection.from, fallback.from)
  const to = clamp(selection.to, fallback.to)
  return { from: Math.min(from, to), to: Math.max(from, to) }
}

function documentOutline(content: JSONContent): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const visit = (node: JSONContent) => {
    if (node.type === 'heading') {
      const label = (node.content || []).map((child) => child.text || '').join('').trim()
      if (label) entries.push({ level: Number(node.attrs?.level) || 2, label })
    }
    node.content?.forEach(visit)
  }
  visit(content)
  return entries
}

function documentSvg(html: string, width = 1200, height = 900) {
  const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f6f1e8"/><foreignObject x="48" y="42" width="${width - 96}" height="${height - 84}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;overflow:hidden;padding:0;color:#25221f;background:#f6f1e8;font:400 16px/1.62 Inter,Arial,sans-serif;">${safeHtml}</div></foreignObject></svg>`
}

export function RichDocument({ content, layout, readOnly = false, active = true, controlsRef, onFocusWritingChange, onChange, onLayoutChange, onRequestText }: RichDocumentProps) {
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const activeRef = useRef(active)
  activeRef.current = active
  const focusWritingChangeRef = useRef(onFocusWritingChange)
  focusWritingChangeRef.current = onFocusWritingChange
  const syncingContentRef = useRef(false)
  const lastEmittedContentRef = useRef<Record<string, unknown> | null>(null)
  const retainedSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const [showMore, setShowMore] = useState(false)
  const paneRef = useRef<HTMLElement>(null)
  const paginatedLayerRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const moreInitialEndRef = useRef(false)
  const moreMenuId = useId()
  const [morePosition, setMorePosition] = useState({ left: 8, top: 8, width: 286, maxHeight: 400 })
  const [exportStatus, setExportStatus] = useState('')
  const [displayMode, setDisplayMode] = useState<'pages' | 'flow'>('pages')
  const [showOutline, setShowOutline] = useState(false)
  const [navigatorTab, setNavigatorTab] = useState<'outline' | 'pages'>('outline')
  const [activePageIndex, setActivePageIndex] = useState(0)
  const [showInspector, setShowInspector] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [domMeasuredPages, setDomMeasuredPages] = useState(1)
  const viewRef = useRef({ showOutline, showInspector, focusMode })
  viewRef.current = { showOutline, showInspector, focusMode }
  const focusRestoreRef = useRef<{ showOutline: boolean; showInspector: boolean } | null>(null)
  const [fontCatalog, setFontCatalog] = useState<FontCatalog>(UNVERIFIED_FONT_CATALOG)
  const [, setEditorRevision] = useState(0)
  const [docContentRevision, setDocContentRevision] = useState(0)
  const outline = useMemo(() => documentOutline(content as JSONContent), [content])

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      Extension.create({
        name: 'documentMutationGuard',
        addProseMirrorPlugins: () => [new Plugin({
          // Editable controls are only presentation. Reject command, node-view,
          // history and pending async writes at the document transaction boundary.
          filterTransaction: (transaction) => !transaction.docChanged || !readOnlyRef.current || syncingContentRef.current,
        })],
      }),
      StarterKit,
      TextStyle,
      FontSize,
      Color,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Superscript,
      Subscript,
      TableKit.configure({ table: { resizable: true } }),
      LayoutImage.configure({ allowBase64: false, resize: { enabled: true } }),
      PageBreak,
      BlankPage,
      SectionBreakContinuous,
      SectionBreakNextPage,
      Footnote,
      VideoBlock,
      Model3DBlock,
      PdfEmbedBlock,
    ],
    content: content as JSONContent,
    onUpdate: ({ editor: currentEditor }) => {
      if (readOnlyRef.current) return
      const nextContent = currentEditor.getJSON() as Record<string, unknown>
      lastEmittedContentRef.current = nextContent
      setDocContentRevision((rev) => rev + 1)
      onChange(nextContent)
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (activeRef.current && currentEditor.isFocused) { const { from, to } = currentEditor.state.selection; retainedSelectionRef.current = { from, to } }
      setEditorRevision((revision) => revision + 1)
    },
    onFocus: ({ editor: currentEditor }) => {
      const retained = retainedSelectionRef.current
      if (retained && activeRef.current) queueMicrotask(() => {
        if (!currentEditor.isDestroyed && currentEditor.isFocused && activeRef.current) currentEditor.commands.setTextSelection(retained)
      })
    },
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged) setDocContentRevision((rev) => rev + 1)
      setEditorRevision((revision) => revision + 1)
    },
    editorProps: { attributes: { class: 'document-editor', spellcheck: 'true', role: 'textbox', 'aria-label': 'Project document text', 'aria-multiline': 'true', 'aria-readonly': String(readOnly), tabindex: '0' } },
  })

  function applyView(next: { showOutline: boolean; showInspector: boolean; focusMode: boolean }) {
    const modeChanged = viewRef.current.focusMode !== next.focusMode
    // Keep rapid same-event toggles coherent without side effects in replayable state updaters.
    viewRef.current = next
    setShowOutline(next.showOutline)
    setShowInspector(next.showInspector)
    setFocusMode(next.focusMode)
    if (modeChanged) focusWritingChangeRef.current?.(next.focusMode)
  }

  function toggleOutline() {
    applyView({ ...viewRef.current, showOutline: !viewRef.current.showOutline })
  }

  function togglePageInspector() {
    applyView({ ...viewRef.current, showInspector: !viewRef.current.showInspector })
  }

  function toggleFocusWriting() {
    const current = viewRef.current
    if (!current.focusMode) {
      focusRestoreRef.current = { showOutline: current.showOutline, showInspector: current.showInspector }
      applyView({ showOutline: false, showInspector: false, focusMode: true })
    } else {
      const panels = focusRestoreRef.current || { showOutline: false, showInspector: false }
      focusRestoreRef.current = null
      applyView({ ...panels, focusMode: false })
    }
  }

  function isActiveVisible() {
    const pane = paneRef.current
    return activeRef.current && !!pane?.isConnected && !pane.closest('[hidden],[inert]') && pane.getClientRects().length > 0 && getComputedStyle(pane).visibility !== 'hidden'
  }

  function applyHistory(command: 'undo' | 'redo') {
    if (readOnlyRef.current || !editor || editor.isDestroyed || !isActiveVisible()) return false
    return command === 'undo' ? editor.chain().focus().undo().run() : editor.chain().focus().redo().run()
  }

  function captureView(): DocumentWorkspaceViewSnapshot {
    const current = viewRef.current
    const selection = editor?.state.selection
    const canHistory = !readOnlyRef.current && !!editor && !editor.isDestroyed && isActiveVisible()
    return {
      ...current,
      selection: { from: selection?.from || 0, to: selection?.to || 0 },
      canUndo: canHistory && !!editor?.can().undo(),
      canRedo: canHistory && !!editor?.can().redo(),
      ...(current.focusMode && focusRestoreRef.current ? { focusRestore: { ...focusRestoreRef.current } } : {}),
    }
  }

  function restoreView(snapshot: DocumentWorkspaceViewSnapshot) {
    if (snapshot.focusMode) {
      focusRestoreRef.current = snapshot.focusRestore ? { ...snapshot.focusRestore }
        : focusRestoreRef.current || { showOutline: viewRef.current.showOutline, showInspector: viewRef.current.showInspector }
    } else focusRestoreRef.current = null
    applyView({ showOutline: snapshot.showOutline, showInspector: snapshot.showInspector, focusMode: snapshot.focusMode })
    if (!editor || editor.isDestroyed) return
    const selection = normalizedViewSelection(snapshot.selection, editor.state.doc.content.size, editor.state.selection)
    const nextSelection = TextSelection.between(editor.state.doc.resolve(selection.from), editor.state.doc.resolve(selection.to))
    retainedSelectionRef.current = selection
    // Selection is view state: never focus/scroll or add a document-history entry here.
    editor.view.dispatch(editor.state.tr.setSelection(nextSelection).setMeta('addToHistory', false))
  }

  useImperativeHandle(controlsRef, () => ({
    togglePageInspector, toggleOutline, toggleFocusWriting,
    undo: () => applyHistory('undo'), redo: () => applyHistory('redo'),
    focusEditor: () => { if (editor && !editor.isDestroyed && isActiveVisible()) editor.commands.focus(undefined, { scrollIntoView: false }) },
    captureView, restoreView,
  }))

  useEffect(() => {
    if (!active) setShowMore(false)
  }, [active])

  useLayoutEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly, false)
    editor.view.dom.setAttribute('aria-readonly', String(readOnly))
    editor.view.dispatch(editor.state.tr.setMeta('document-readonly', readOnly))
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || content === lastEmittedContentRef.current) return
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      // Parent content remains authoritative, including a different document
      // opened while this workspace is read-only. This never invokes onChange.
      syncingContentRef.current = true
      // Synchronizing authoritative props is hydration, not a user edit.
      try {
        editor.chain().setMeta('addToHistory', false).setContent(content as JSONContent, { emitUpdate: false }).run()
        setDocContentRevision((rev) => rev + 1)
      }
      finally { syncingContentRef.current = false }
    }
  }, [editor, content])

  useEffect(() => {
    let mounted = true
    void discoverFontCatalog().then(catalog => { if (mounted) setFontCatalog(catalog) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!editor) return
    const applyHistoryCommand = (event: Event) => {
      const command = (event as CustomEvent<'undo' | 'redo'>).detail
      if (command === 'undo' || command === 'redo') applyHistory(command)
    }
    window.addEventListener('art-equation:document-history', applyHistoryCommand)
    return () => window.removeEventListener('art-equation:document-history', applyHistoryCommand)
  }, [editor])

  useLayoutEffect(() => {
    if (!showMore || !active) return
    const menu = moreMenuRef.current, button = moreButtonRef.current
    if (!menu || !button) return
    const place = () => {
      const anchor = button.getBoundingClientRect()
      const width = Math.min(286, Math.max(1, window.innerWidth - 16))
      const maxHeight = Math.max(1, window.innerHeight - 16)
      const height = Math.min(menu.scrollHeight, maxHeight)
      const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
      const below = anchor.bottom + 5
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, Math.min(anchor.top - height - 5, window.innerHeight - height - 8))
      setMorePosition((previous) => previous.left === left && previous.top === top && previous.width === width && previous.maxHeight === maxHeight ? previous : { left, top, width, maxHeight })
    }
    place()
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    ;(moreInitialEndRef.current ? items.at(-1) : items[0])?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      const target = event.target as globalThis.Node
      if (!menu.contains(target) && !button.contains(target)) setShowMore(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      setShowMore(false); button.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [showMore, active])

  function navigateMore(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[next]?.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault(); setShowMore(false)
      const controls = [...document.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[contenteditable="true"],[tabindex]')].filter((item) => item.tabIndex >= 0 && !item.closest('[role="menu"],[inert]') && item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden')
      const origin = controls.indexOf(moreButtonRef.current!)
      controls[(origin + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
    }
  }

  const pagination = useMemo(() => {
    const currentJson = editor && !editor.isDestroyed ? editor.getJSON() : (content as JSONContent)
    return solveDocumentPagination(currentJson, layout, docContentRevision + 1)
  }, [editor, content, layout, docContentRevision])

  useLayoutEffect(() => {
    if (displayMode !== 'pages') return
    const layer = paginatedLayerRef.current
    const editorEl = layer?.querySelector<HTMLElement>('.document-editor')
    if (!editorEl) return
    const measureOverflow = () => {
      const stride = pagination.pageWidthPx + 26
      if (stride <= 0) return
      const scrollW = editorEl.scrollWidth
      const measured = Math.max(1, Math.ceil((scrollW + 12) / stride))
      setDomMeasuredPages((prev) => (prev === measured ? prev : measured))
    }
    measureOverflow()
    const observer = new ResizeObserver(measureOverflow)
    observer.observe(editorEl)
    return () => observer.disconnect()
  }, [displayMode, pagination.pageWidthPx, pagination.pageHeightPx, docContentRevision])

  if (!editor) return null

  const wordCount = pagination.wordCount
  const pageCount = Math.max(pagination.pages.length, displayMode === 'pages' ? domMeasuredPages : 1)
  const clampedActivePage = Math.min(activePageIndex, Math.max(0, pageCount - 1))
  const pageWidth = pagination.pageWidthPx
  const pageHeight = pagination.pageHeightPx
  const pagePadding = pagination.marginPx
  const pageStyle = {
    '--document-page-width': `${pageWidth}px`,
    '--document-page-height': `${pageHeight}px`,
    '--document-page-padding': `${pagePadding}px`,
    '--document-columns': layout.columns,
    '--document-page-count': pageCount,
  } as CSSProperties
  const activeFontFamily = String(editor.getAttributes('textStyle').fontFamily || '')
  const activeFontSize = String(editor.getAttributes('textStyle').fontSize || '11px').replace('px', '')
  const activeLineHeight = String(editor.getAttributes('textStyle').lineHeight || '1.62')
  const activeLetterSpacing = String(editor.getAttributes('textStyle').letterSpacing || '')
  const activeFontWeight = String(editor.getAttributes('textStyle').fontWeight || '400')
  const availableFontFamilies = fontFamilyOptions(fontCatalog, activeFontFamily)
  const activeFontDescription = availableFontFamilies.find(option => option.value === activeFontFamily)?.description
  const activeParagraphStyle = editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'body'

  function setParagraphStyle(value: string) {
    if (readOnlyRef.current) return
    if (value === 'body') editor!.chain().focus().setParagraph().run()
    else if (value === 'caption') editor!.chain().focus().setParagraph().setMark('textStyle', { fontSize: '9px' }).run()
    else editor!.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run()
  }

  function changeLayout(next: DocumentLayout) {
    if (!readOnlyRef.current) onLayoutChange(next)
  }

  async function setLink() {
    if (readOnlyRef.current) return
    const current = editor?.getAttributes('link').href as string | undefined
    const href = await onRequestText({ title: 'Edit text link', label: 'Link URL', initialValue: current || 'https://' })
    if (href === null || readOnlyRef.current || editor?.isDestroyed) return
    if (!href.trim()) editor?.chain().focus().unsetLink().run()
    else editor?.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }

  function navigateToHeading(index: number) {
    const heading = paneRef.current?.querySelectorAll('.document-editor h1,.document-editor h2,.document-editor h3').item(index)
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    heading?.classList.add('outline-flash')
    window.setTimeout(() => heading?.classList.remove('outline-flash'), 900)
  }

  function navigateToPageSheet(pageIndex: number) {
    const bounded = Math.max(0, Math.min(pageCount - 1, pageIndex))
    setActivePageIndex(bounded)
    const sheet = paneRef.current?.querySelectorAll('.page-sheet').item(bounded)
    sheet?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  function appendAuthoredPageBreak(kind: 'pageBreak' | 'blankPage' | 'sectionBreakNextPage') {
    if (readOnlyRef.current || !editor || editor.isDestroyed) return
    if (kind === 'blankPage') {
      editor.chain().focus('end').insertContent([{ type: 'blankPage' }, { type: 'paragraph' }]).run()
    } else if (kind === 'sectionBreakNextPage') {
      editor.chain().focus('end').insertContent([
        { type: 'sectionBreakNextPage', attrs: { title: `Section ${pagination.counts.sectionBreaks + 2}` } },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${pagination.counts.sectionBreaks + 2}` }] },
        { type: 'paragraph' },
      ]).run()
    } else {
      editor.chain().focus('end').insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run()
    }
  }

  async function insertFootnote() {
    if (readOnlyRef.current) return
    const footnoteText = (await onRequestText({ title: 'Insert footnote', label: 'Footnote text' }))?.trim()
    if (!footnoteText || readOnlyRef.current || editor?.isDestroyed) return
    const number = (editor!.getJSON().content || []).filter((node) => node.type === 'footnote').length + 1
    editor!.chain().focus().insertContent({ type: 'footnote', attrs: { number, text: footnoteText } }).run()
  }

  async function insertImage() {
    if (readOnlyRef.current) return
    const src = (await onRequestText({ title: 'Insert image', label: 'Image URL or local asset URL', initialValue: 'https://' }))?.trim()
    if (!src || readOnlyRef.current || editor?.isDestroyed) return
    const caption = await onRequestText({ title: 'Image caption', label: 'Caption (optional)' }) || ''
    if (readOnlyRef.current || editor?.isDestroyed) return
    editor!.chain().focus().setImage({ src }).updateAttributes('image', { caption, placement: 'block', width: 640, height: 360 }).run()
  }

  async function insertVideoBlock() {
    if (readOnlyRef.current) return
    const src = (await onRequestText({ title: 'Insert video block', label: 'Video URL or local asset path', initialValue: 'https://' }))?.trim()
    if (!src || readOnlyRef.current || editor?.isDestroyed) return
    const caption = (await onRequestText({ title: 'Video caption', label: 'Caption (optional)' })) || ''
    if (readOnlyRef.current || editor?.isDestroyed) return
    editor!.chain().focus().insertContent({ type: 'videoBlock', attrs: { src, caption, fit: 'contain', muted: true, width: 640, height: 360 } }).run()
  }

  async function insertModel3DBlock() {
    if (readOnlyRef.current) return
    const src = (await onRequestText({ title: 'Insert 3D model block', label: 'glTF / GLB / OBJ asset URL', initialValue: 'https://' }))?.trim()
    if (!src || readOnlyRef.current || editor?.isDestroyed) return
    const ext = src.split('.').pop()?.toLowerCase() || 'glb'
    const caption = (await onRequestText({ title: '3D viewport caption', label: 'Caption (optional)' })) || ''
    if (readOnlyRef.current || editor?.isDestroyed) return
    editor!.chain().focus().insertContent({ type: 'model3DBlock', attrs: { src, extension: ext, title: src.split('/').pop() || '3D Asset', caption, cameraPreset: 'perspective', width: 640, height: 380 } }).run()
  }

  async function insertPdfEmbedBlock() {
    if (readOnlyRef.current) return
    const src = (await onRequestText({ title: 'Embed PDF pages', label: 'PDF asset URL or path', initialValue: 'https://' }))?.trim()
    if (!src || readOnlyRef.current || editor?.isDestroyed) return
    const pageRange = (await onRequestText({ title: 'PDF page range', label: 'Page or range (e.g. 1, 1-3, all)', initialValue: '1' }))?.trim() || '1'
    if (readOnlyRef.current || editor?.isDestroyed) return
    editor!.chain().focus().insertContent({ type: 'pdfEmbedBlock', attrs: { src, title: src.split('/').pop() || 'Document.pdf', pageRange, width: 612, height: 792 } }).run()
  }

  async function exportHtml() {
    try {
      const destination = await save({ defaultPath: 'Art Equation Project Brief.html', filters: [{ name: 'HTML document', extensions: ['html'] }] })
      if (!destination) return
      const documentHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Art Equation Project Brief</title><style>body{margin:0;background:#e7e2d9;color:#25221f;font:16px/1.6 Inter,Arial,sans-serif}main{box-sizing:border-box;width:min(850px,100%);min-height:100vh;margin:auto;padding:72px;background:#f6f1e8}h1,h2,h3{font-family:Georgia,serif;line-height:1.05}h1{font-size:3.5rem;letter-spacing:-.035em}h2{margin-top:2em}blockquote{margin:2em 0;padding:1em 1.4em;border-left:4px solid #9e7448;background:#e9e2d7}table{width:100%;border-collapse:collapse}td,th{padding:.6em;border:1px solid #bbb}img{max-width:100%;height:auto}@media print{body{background:white}main{padding:0}}</style></head><body><main>${editor?.getHTML() || ''}</main></body></html>`
      await invoke('export_html', { destinationPath: destination, contents: documentHtml })
      setExportStatus('HTML exported')
      setShowMore(false)
    } catch (error) {
      setExportStatus(`Export failed: ${String(error)}`)
    }
  }

  async function exportTextSvg() {
    try {
      const destination = await save({ defaultPath: 'Art Equation Text.svg', filters: [{ name: 'SVG image', extensions: ['svg'] }] })
      if (!destination) return
      const svg = documentSvg(editor!.getHTML())
      const bytes = new TextEncoder().encode(svg)
      await invoke('export_binary', { destinationPath: destination, bytes: Array.from(bytes) })
      setExportStatus('SVG exported')
      setShowMore(false)
    } catch (error) {
      setExportStatus(`SVG export failed: ${String(error)}`)
    }
  }

  async function exportTextPng() {
    try {
      const destination = await save({ defaultPath: 'Art Equation Text.png', filters: [{ name: 'PNG image', extensions: ['png'] }] })
      if (!destination) return
      const svg = documentSvg(editor!.getHTML())
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      try {
        const image = new window.Image()
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render SVG')) ; image.src = url })
        const canvas = document.createElement('canvas')
        canvas.width = 1200
        canvas.height = 900
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas is unavailable')
        context.fillStyle = '#f6f1e8'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0)
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not encode PNG')), 'image/png'))
        await invoke('export_binary', { destinationPath: destination, bytes: Array.from(new Uint8Array(await png.arrayBuffer())) })
      } finally {
        URL.revokeObjectURL(url)
      }
      setExportStatus('PNG exported')
      setShowMore(false)
    } catch (error) {
      setExportStatus(`PNG export failed: ${String(error)}`)
    }
  }

  return (
    <section ref={paneRef} className="document-pane" aria-label="Project document" data-read-only={readOnly}>
      <div className="pane-toolbar document-toolbar" role="toolbar" aria-label="Text formatting">
        <div className="document-formatting-controls" onFocusCapture={(event) => {
          const controls = event.currentTarget
          const focused = event.target instanceof HTMLElement ? event.target : null
          const target = focused?.matches('input[type="color"]') ? focused.closest('label') ?? focused : focused
          if (!target || !controls.contains(target)) return
          const bounds = controls.getBoundingClientRect()
          const rect = target.getBoundingClientRect()
          const left = bounds.left + controls.clientLeft + 2
          const right = bounds.left + controls.clientLeft + controls.clientWidth - 2
          // Native focus scrolling can leave a partly visible control clipped.
          // Move only this toolbar; inspection must not move or edit the page.
          if (rect.left < left) controls.scrollLeft -= Math.ceil(left - rect.left)
          else if (rect.right > right) controls.scrollLeft += Math.ceil(rect.right - right)
        }}>
        <div className="segmented-control" aria-label="Document display"><button className={displayMode === 'pages' ? 'active' : ''} title="Compose using the selected paper size and margins" aria-pressed={displayMode === 'pages'} type="button" onClick={() => setDisplayMode('pages')}>Pages</button><button className={displayMode === 'flow' ? 'active' : ''} title="Use one continuous writing surface" aria-pressed={displayMode === 'flow'} type="button" onClick={() => setDisplayMode('flow')}>Flow</button></div>
        <button className={`format-button outline-button ${showOutline ? 'active' : ''}`} type="button" title="Navigate document headings and derived pages" aria-label="Toggle document outline" aria-expanded={showOutline} onClick={toggleOutline}>☷</button>
        <span className="toolbar-separator" />
        <select disabled={readOnly} aria-label="Paragraph style" value={activeParagraphStyle} onChange={(event) => setParagraphStyle(event.target.value)}>
          <option value="body">Body</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option><option value="caption">Caption</option>
        </select>
        <select disabled={readOnly} aria-label="Font family" title={activeFontDescription} value={activeFontFamily} onChange={(event) => event.target.value ? editor.chain().focus().setFontFamily(event.target.value).run() : editor.chain().focus().unsetFontFamily().run()}>
          {availableFontFamilies.map(option => <option key={option.value} value={option.value} title={option.description}>{option.label}</option>)}
        </select>
        <select disabled={readOnly} aria-label="Font size" value={activeFontSize} onChange={(event) => editor.chain().focus().setMark('textStyle', { fontSize: `${event.target.value}px` }).run()}>
          <option>9</option><option>10</option><option>11</option><option>12</option><option>16</option><option>24</option><option>36</option><option>56</option>
        </select>
        <select disabled={readOnly} aria-label="Font weight" value={activeFontWeight} onChange={(event) => editor.chain().focus().setMark('textStyle', { fontWeight: event.target.value }).run()}>
          <option value="300">Light</option><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Extra bold</option>
        </select>
        <select disabled={readOnly} aria-label="Letter spacing" value={activeLetterSpacing} onChange={(event) => editor.chain().focus().setMark('textStyle', { letterSpacing: event.target.value || null }).run()}>
          <option value="">Tracking</option><option value="-.04em">Tight</option><option value=".02em">Normal</option><option value=".08em">Wide</option><option value=".16em">Wider</option>
        </select>
        <button disabled={readOnly} className={`format-button ${editor.isActive('bold') ? 'active' : ''}`} type="button" title="Bold · Ctrl+B" aria-label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
        <button disabled={readOnly} className={`format-button italic ${editor.isActive('italic') ? 'active' : ''}`} type="button" title="Italic · Ctrl+I" aria-label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
        <button disabled={readOnly} className={`format-button ${editor.isActive('underline') ? 'active' : ''}`} type="button" title="Underline · Ctrl+U" aria-label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
        <button disabled={readOnly} className={`format-button ${editor.isActive('strike') ? 'active' : ''}`} type="button" title="Strikethrough" aria-label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
        <label className="format-button color-input" aria-label="Text color"><span className="text-color-a">A</span><input disabled={readOnly} type="color" defaultValue="#9e7448" onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} /></label>
        <button disabled={readOnly} className="format-button" type="button" title="Align text left" aria-label="Align left" onClick={() => editor.chain().focus().setTextAlign('left').run()}>≡</button>
        <button disabled={readOnly} className="format-button" type="button" title="Center text" aria-label="Align center" onClick={() => editor.chain().focus().setTextAlign('center').run()}>≣</button>
        <button disabled={readOnly} className="format-button" type="button" title="Justify paragraph edges" aria-label="Justify" onClick={() => editor.chain().focus().setTextAlign('justify').run()}>▤</button>
        <button disabled={!active || readOnly || !editor.can().undo()} className="format-button" type="button" title="Undo text change · Ctrl+Z" aria-label="Undo text change" onClick={() => applyHistory('undo')}>↶</button>
        <button disabled={!active || readOnly || !editor.can().redo()} className="format-button" type="button" title="Redo text change · Ctrl+Shift+Z" aria-label="Redo text change" onClick={() => applyHistory('redo')}>↷</button>
        <button className={`format-button focus-button ${focusMode ? 'active' : ''}`} type="button" title="Focus writing: hide navigation and page inspector" aria-label="Toggle focus writing" aria-pressed={focusMode} onClick={toggleFocusWriting}>⌑</button>
        <button className={`format-button ${showInspector ? 'active' : ''}`} type="button" title="Page size, margins, columns, theme, and document statistics" aria-label="Toggle page layout inspector" aria-expanded={showInspector} onClick={togglePageInspector}>Aa</button>
        </div>
        <button ref={moreButtonRef} className={`overflow-button ${showMore ? 'active' : ''}`} type="button" title="Lists, tables, links, page breaks, export, and more" aria-label="More formatting" aria-haspopup="menu" aria-controls={showMore ? moreMenuId : undefined} aria-expanded={showMore} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); moreInitialEndRef.current = event.key === 'ArrowUp'; setShowMore(true) } }} onClick={() => { moreInitialEndRef.current = false; setShowMore((visible) => !visible) }}>•••</button>
        {showMore && active && createPortal(<div className={`document-menu-portal-root ${paneRef.current?.closest('.workspace-light') ? 'workspace-light' : 'workspace-dark'}`} style={(() => { const shell = paneRef.current?.closest('.studio-shell'); const computed = shell ? getComputedStyle(shell) : null; const variables: CSSProperties & Record<string, string> = {}; for (const name of ['--surface-overlay', '--surface-hover', '--surface-active', '--surface-control', '--surface-input', '--surface-toolbar', '--text', '--text-strong', '--text-subtle', '--border-control', '--border-subtle', '--shadow-overlay', '--focus-ring', '--gold', '--line', '--muted', '--ui-control-size', '--ui-accent-text', '--ui-label-text', '--ui-disabled-text']) { const value = computed?.getPropertyValue(name); if (value) variables[name] = value } if (computed) variables.fontFamily = computed.fontFamily; return variables })()}><div ref={moreMenuRef} id={moreMenuId} className="document-more-menu document-more-menu-portaled" role="menu" aria-label="More document tools" style={{ position: 'fixed', right: 'auto', ...morePosition, overflowY: 'auto', boxSizing: 'border-box', zIndex: 110 }} onKeyDown={navigateMore} onClick={(event) => { if ((event.target as Element).closest('[role="menuitem"]')) setShowMore(false) }}>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().toggleBulletList().run()}>• Bulleted list</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Numbered list</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝ Quotation</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setShowMore(false) }}>▦ Insert table</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={insertImage}>▧ Insert image</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={insertVideoBlock}>▶ Insert video block</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={insertModel3DBlock}>⬡ Insert 3D model block</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={insertPdfEmbedBlock}>📄 Embed PDF page range</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().insertContent({ type: 'pageBreak' }).run()}>↵ Page break</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().insertContent({ type: 'blankPage' }).run()}>▢ Insert blank page</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().insertContent({ type: 'sectionBreakNextPage', attrs: { title: 'New Section' } }).run()}>§ Section break (next page)</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().insertContent({ type: 'sectionBreakContinuous', attrs: { title: 'Continuous Section' } }).run()}>§ Section break (continuous)</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={insertFootnote}>¹ Insert footnote</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={setLink}>↗ Link</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().toggleHighlight({ color: '#f2d68a' }).run()}>▰ Highlight</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().toggleSuperscript().run()}>x² Superscript</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().toggleSubscript().run()}>x₂ Subscript</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().setMark('textStyle', { lineHeight: activeLineHeight === '1.8' ? '1.45' : '1.8' }).run()}>↕ {activeLineHeight === '1.8' ? 'Compact leading' : 'Relaxed leading'}</button>
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().setMark('textStyle', { letterSpacing: '.04em' }).run()}>↔ Add tracking</button>
          {editor.isActive('image') && <><button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().updateAttributes('image', { placement: 'left' }).run()}>Image wrap left</button><button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().updateAttributes('image', { placement: 'right' }).run()}>Image wrap right</button><button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().updateAttributes('image', { placement: 'inline' }).run()}>Image inline</button><button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().updateAttributes('image', { placement: 'anchored' }).run()}>Image anchored</button><button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().updateAttributes('image', { placement: 'block' }).run()}>Image full width</button></>}
          <button disabled={readOnly} type="button" role="menuitem" tabIndex={-1} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>⌫ Clear selection formatting</button>
          <span role="separator" />
          <button disabled={!active || readOnly || !editor.can().undo()} type="button" role="menuitem" tabIndex={-1} onClick={() => applyHistory('undo')}>↶ Undo text</button>
          <button disabled={!active || readOnly || !editor.can().redo()} type="button" role="menuitem" tabIndex={-1} onClick={() => applyHistory('redo')}>↷ Redo text</button>
          <span role="separator" />
          <button type="button" role="menuitem" tabIndex={-1} disabled title="Native document export needs separate desktop verification" onClick={() => void exportHtml()}>⇩ Export HTML · desktop</button>
          <button type="button" role="menuitem" tabIndex={-1} disabled title="Native document export needs separate desktop verification" onClick={() => void exportTextSvg()}>⇩ Export SVG · desktop</button>
          <button type="button" role="menuitem" tabIndex={-1} disabled title="Native document export needs separate desktop verification" onClick={() => void exportTextPng()}>⇩ Export PNG · desktop</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => { setShowMore(false); window.print() }}>▣ Print / PDF</button>
          {exportStatus && <small>{exportStatus}</small>}
        </div></div>, document.body)}
      </div>
      <div className={`document-stage document-${displayMode} document-theme-${layout.theme} ${showInspector ? 'layout-inspector-open' : ''} ${focusMode ? 'document-focus-mode' : ''}`} style={pageStyle}>
        {displayMode === 'pages' && !focusMode && (
          <div className="document-page-bar" role="region" aria-label="Document pages navigation">
            <div className="document-page-bar-summary">
              <strong>Page {String(clampedActivePage + 1).padStart(2, '0')} of {String(pageCount).padStart(2, '0')}</strong>
              <span>{pagination.pages[clampedActivePage]?.sectionId.toUpperCase() || 'SEC-1'} · {layout.pageSize.toUpperCase()} {layout.orientation}</span>
            </div>
            <div className="document-page-pills" role="group" aria-label="Derived page sheets">
              <button
                type="button"
                disabled={clampedActivePage <= 0}
                onClick={() => navigateToPageSheet(clampedActivePage - 1)}
                title="Previous page sheet"
              >
                ‹ Prev
              </button>
              {Array.from({ length: pageCount }, (_, index) => {
                const slice = pagination.pages[index]
                const badge = slice?.isBlankPage ? 'Blank' : slice?.hasExplicitBreak ? 'Break' : 'Auto'
                return (
                  <button
                    key={index}
                    type="button"
                    className={`document-page-pill ${clampedActivePage === index ? 'active' : ''}`}
                    aria-current={clampedActivePage === index ? 'page' : undefined}
                    onClick={() => navigateToPageSheet(index)}
                    title={`Jump to Page ${index + 1} (${badge})`}
                  >
                    <span>P{index + 1}</span>
                    <small>{badge}</small>
                  </button>
                )
              })}
              <button
                type="button"
                disabled={clampedActivePage >= pageCount - 1}
                onClick={() => navigateToPageSheet(clampedActivePage + 1)}
                title="Next page sheet"
              >
                Next ›
              </button>
            </div>
            <div className="document-page-bar-actions">
              <button
                type="button"
                disabled={readOnly}
                onClick={() => appendAuthoredPageBreak('pageBreak')}
                title="Insert authored page break to start a new page sheet"
              >
                ＋ Add Page
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => appendAuthoredPageBreak('blankPage')}
                title="Insert an explicit blank page into the story"
              >
                ＋ Blank Page
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => appendAuthoredPageBreak('sectionBreakNextPage')}
                title="Insert a next-page section break"
              >
                ＋ Section
              </button>
            </div>
          </div>
        )}
        {showOutline && (
          <nav className="document-outline" aria-label="Document outline">
            <header>
              <strong>{navigatorTab === 'outline' ? 'Outline' : 'Derived Pages'}</strong>
              <span>{navigatorTab === 'outline' ? `${outline.length} sections` : `${pageCount} pages`}</span>
            </header>
            <div className="segmented-control" style={{ marginBottom: 8 }} aria-label="Document navigator view">
              <button type="button" className={navigatorTab === 'outline' ? 'active' : ''} aria-pressed={navigatorTab === 'outline'} onClick={() => setNavigatorTab('outline')}>Outline</button>
              <button type="button" className={navigatorTab === 'pages' ? 'active' : ''} aria-pressed={navigatorTab === 'pages'} onClick={() => setNavigatorTab('pages')}>Pages ({pageCount})</button>
            </div>
            {navigatorTab === 'outline' ? (
              outline.length ? outline.map((entry, index) => <button type="button" className={`outline-level-${entry.level}`} key={`${entry.label}-${index}`} onClick={() => navigateToHeading(index)}>{entry.label}</button>) : <p>Add headings to navigate this document.</p>
            ) : (
              <div className="document-derived-pages-list">
                {pagination.pages.map((slice) => (
                  <button
                    type="button"
                    key={slice.pageIndex}
                    className={`derived-page-card ${clampedActivePage === slice.pageIndex ? 'active' : ''}`}
                    onClick={() => navigateToPageSheet(slice.pageIndex)}
                    title={`Page ${slice.pageNumber} · Section ${slice.sectionIndex + 1} · ${Math.round(slice.utilization * 100)}% full`}
                  >
                    <strong>Page {String(slice.pageNumber).padStart(2, '0')}</strong>
                    <small>
                      {slice.sectionId.toUpperCase()}
                      {slice.isBlankPage ? ' · Blank' : slice.hasExplicitBreak ? ' · Manual Break' : ' · Derived'}
                    </small>
                  </button>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    className="derived-page-add-btn"
                    onClick={() => appendAuthoredPageBreak('pageBreak')}
                    title="Insert authored page break after current content"
                  >
                    + Add Page Break After
                  </button>
                )}
              </div>
            )}
          </nav>
        )}
        <article className={`paper ${displayMode === 'pages' ? 'paginated-paper' : ''}`} aria-label={`${readOnly ? 'Read-only' : 'Editable'} project brief, ${pageCount} page${pageCount === 1 ? '' : 's'}`}>
          {displayMode === 'pages' ? <>
            <div className="page-sheet-stack" aria-hidden="true">{Array.from({ length: pageCount }, (_, index) => <div className="page-sheet" style={{ left: `calc(${index} * (var(--document-page-width) + 26px))` }} key={index}><header className="paper-header"><span>{layout.headerText || 'ART EQUATION / PROJECT BRIEF'}</span><span>{layout.showPageNumber === false ? '' : String(index + 1).padStart(2, '0')}</span></header><footer className="paper-footer"><span>{layout.footerText || 'Art Equation Studio'}</span><span>{layout.showPageNumber === false ? '' : String(index + 1).padStart(2, '0')}</span></footer></div>)}</div>
            <div ref={paginatedLayerRef} className="paginated-editor-layer"><EditorContent editor={editor} /></div>
          </> : <><header className="paper-header"><span>{layout.headerText || 'ART EQUATION / PROJECT BRIEF'}</span><span>{layout.showPageNumber === false ? '' : '01'}</span></header><EditorContent editor={editor} /><footer className="paper-footer"><span>{layout.footerText || 'Art Equation Studio'}</span><span>{layout.showPageNumber === false ? '' : '01'}</span></footer></>}
        </article>
        {showInspector && <aside className="document-layout-inspector" aria-label="Page layout and document statistics">
          <header><span>DOCUMENT</span><strong>Page & typography</strong><button type="button" aria-label="Close page layout inspector" onClick={togglePageInspector}>×</button></header>
          <section><label><span>Page size</span><select disabled={readOnly} value={layout.pageSize} onChange={(event) => changeLayout({ ...layout, pageSize: event.target.value as DocumentLayout['pageSize'] })}><option value="letter">US Letter</option><option value="a4">A4</option><option value="screen">Digital page</option></select></label><label><span>Orientation</span><select disabled={readOnly} value={layout.orientation} onChange={(event) => changeLayout({ ...layout, orientation: event.target.value as DocumentLayout['orientation'] })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label></section>
          <section><label><span>Margins</span><select disabled={readOnly} value={layout.margins} onChange={(event) => changeLayout({ ...layout, margins: event.target.value as DocumentLayout['margins'] })}><option value="compact">Compact</option><option value="standard">Standard</option><option value="wide">Editorial wide</option></select></label><label><span>Text columns</span><select disabled={readOnly} value={layout.columns} onChange={(event) => changeLayout({ ...layout, columns: Number(event.target.value) as 1 | 2 })}><option value="1">One column</option><option value="2">Two columns</option></select></label></section>
          <section><label><span>Writing surface</span><select disabled={readOnly} value={layout.theme} onChange={(event) => changeLayout({ ...layout, theme: event.target.value as DocumentLayout['theme'] })}><option value="paper">Warm paper</option><option value="night">Night manuscript</option></select></label><label><span>Selected leading</span><select disabled={readOnly} value={activeLineHeight} onChange={(event) => editor.chain().focus().setMark('textStyle', { lineHeight: event.target.value }).run()}><option value="1.35">Compact</option><option value="1.45">Tight</option><option value="1.62">Standard</option><option value="1.8">Relaxed</option><option value="2">Open</option></select></label></section>
          <section className="document-running-copy"><label><span>Running header</span><input disabled={readOnly} value={layout.headerText || ''} placeholder="Project title" onChange={(event) => changeLayout({ ...layout, headerText: event.target.value })} /></label><label><span>Running footer</span><input disabled={readOnly} value={layout.footerText || ''} placeholder="Studio or chapter" onChange={(event) => changeLayout({ ...layout, footerText: event.target.value })} /></label><label className="layout-checkbox"><input disabled={readOnly} type="checkbox" checked={layout.showPageNumber !== false} onChange={(event) => changeLayout({ ...layout, showPageNumber: event.target.checked })} />Show page number</label></section>
          <div className="document-stats"><span><strong>{wordCount.toLocaleString()}</strong>words</span><span><strong>{pageCount}</strong>pages</span><span><strong>{pagination.estimatedReadMinutes}</strong>min read</span><span><strong>{outline.length}</strong>sections</span></div>
          {pagination.overflow.length > 0 && (
            <p className="document-overflow-notice" role="status">
              {pagination.overflow[0].message}
            </p>
          )}
          <p>Use headings for navigation. Page settings belong to this document and travel with the portable project.</p>
        </aside>}
      </div>
    </section>
  )
}
