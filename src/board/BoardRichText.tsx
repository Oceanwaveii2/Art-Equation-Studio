import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Extension } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { discoverFontCatalog, fontFamilyOptions, UNVERIFIED_FONT_CATALOG, type FontCatalog } from '../typography/fontCatalog'
import './BoardRichText.css'

const CanvasTypography = Extension.create({
  name: 'canvasTypography',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: {
      fontSize: { default: null, parseHTML: (element) => element.style.fontSize || null, renderHTML: (attributes) => attributes.fontSize ? { style: `font-size:${attributes.fontSize}` } : {} },
      lineHeight: { default: null, parseHTML: (element) => element.style.lineHeight || null, renderHTML: (attributes) => attributes.lineHeight ? { style: `line-height:${attributes.lineHeight}` } : {} },
      letterSpacing: { default: null, parseHTML: (element) => element.style.letterSpacing || null, renderHTML: (attributes) => attributes.letterSpacing ? { style: `letter-spacing:${attributes.letterSpacing}` } : {} },
      textTransform: { default: null, parseHTML: (element) => element.style.textTransform || null, renderHTML: (attributes) => attributes.textTransform ? { style: `text-transform:${attributes.textTransform}` } : {} },
      fontWeight: { default: null, parseHTML: (element) => element.style.fontWeight || null, renderHTML: (attributes) => attributes.fontWeight ? { style: `font-weight:${attributes.fontWeight}` } : {} },
    } }, { types: ['paragraph', 'heading'], attributes: {
      spaceBefore: { default: null, parseHTML: element => element.style.marginTop || null, renderHTML: attributes => attributes.spaceBefore ? { style: `margin-top:${attributes.spaceBefore}` } : {} },
      spaceAfter: { default: null, parseHTML: element => element.style.marginBottom || null, renderHTML: attributes => attributes.spaceAfter ? { style: `margin-bottom:${attributes.spaceAfter}` } : {} },
    } }]
  },
})

type BoardRichTextProps = {
  html: string
  selected: boolean
  onChange: (html: string, editSession?: string) => void
  onRequestText: (options: { title: string; label: string; initialValue?: string }) => Promise<string | null>
  variant?: 'card' | 'composer'
  onLayout?: (size: { width: number; height: number }, editSession?: string) => void
  areaText?: boolean
  typeText?: boolean
}

export function BoardRichText({ html, selected, onChange, onRequestText, variant = 'card', onLayout, areaText = false, typeText = false }: BoardRichTextProps) {
  const [fontCatalog, setFontCatalog] = useState<FontCatalog>(UNVERIFIED_FONT_CATALOG)
  const contentRef = useRef<HTMLDivElement>(null)
  const editSession = useRef<string | undefined>(undefined)
  const layoutCallback = useRef(onLayout)
  layoutCallback.current = onLayout
  // The authored first run supplies the paragraph strut for artwork frames.
  // Inline marks continue to override it; ordinary cards do not use these vars.
  const artworkTypography = useMemo(() => {
    if (typeof DOMParser === 'undefined') return undefined
    const run = new DOMParser().parseFromString(html, 'text/html').querySelector<HTMLElement>('p span[style], h1 span[style], h2 span[style], h3 span[style]')
    if (!run && !typeText) return undefined
    return {
      '--artwork-font-family': run?.style.fontFamily || (typeText ? 'Segoe UI' : 'Inter, sans-serif'),
      '--artwork-font-size': run?.style.fontSize || (typeText ? '32px' : '11px'),
      '--artwork-line-height': run?.style.lineHeight || (typeText ? '1.2' : '1.58'),
      '--artwork-font-weight': run?.style.fontWeight || '400',
    } as CSSProperties
  }, [html, typeText])
  const [artworkToolbar, setArtworkToolbar] = useState<{ host: HTMLElement; left: number; top: number; width: number } | null>(null)
  const [overset, setOverset] = useState(false)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, TextStyle, CanvasTypography, Color, FontFamily, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] })],
    content: html,
    onFocus: () => { editSession.current = crypto.randomUUID() },
    onBlur: () => { editSession.current = undefined },
    onUpdate: ({ editor: currentEditor }) => {
      editSession.current ||= crypto.randomUUID()
      onChange(currentEditor.getHTML(), editSession.current)
    },
    editorProps: { attributes: { class: `board-text-editor board-text-${variant}`, spellcheck: 'true' } },
  })

  useEffect(() => {
    if (editor && editor.getHTML() !== html) editor.commands.setContent(html, { emitUpdate: false })
  }, [editor, html])

  useEffect(() => {
    const element = contentRef.current?.querySelector<HTMLElement>('.ProseMirror')
    if (!element || !layoutCallback.current && !areaText) return
    const measure: ResizeObserverCallback = entries => {
      const observed = entries.find(entry => entry.target === element)?.borderBoxSize?.[0]
      if (observed) layoutCallback.current?.({ width: observed.inlineSize, height: observed.blockSize }, editSession.current)
      if (areaText) {
        const frame = contentRef.current?.closest<HTMLElement>('.board-node')
        setOverset(Boolean(frame && (element.scrollHeight > frame.clientHeight + 1 || element.scrollWidth > frame.clientWidth + 1)))
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const frame = contentRef.current?.closest<HTMLElement>('.board-node')
    if (areaText && frame) observer.observe(frame)
    return () => observer.disconnect()
  }, [editor, html, areaText])

  useEffect(() => {
    let mounted = true
    void discoverFontCatalog().then(catalog => { if (mounted) setFontCatalog(catalog) })
    return () => { mounted = false }
  }, [])

  // Transparent artwork text retains its authored frame. Formatting controls
  // belong to the canvas overlay, so selecting text never consumes its height.
  useLayoutEffect(() => {
    const article = contentRef.current?.closest<HTMLElement>('.board-node.node-artwork-text, .board-node.node-type')
    const host = article?.closest<HTMLElement>('.canvas-stage')
    if (!selected || variant !== 'card' || !article || !host) { setArtworkToolbar(null); return }
    const update = () => {
      const frame = article.getBoundingClientRect(), stage = host.getBoundingClientRect()
      const width = Math.min(700, Math.max(0, host.clientWidth - 24))
      const left = Math.max(12, Math.min(frame.left - stage.left, host.clientWidth - width - 12))
      const top = Math.max(12, Math.min(frame.bottom - stage.top + 8, host.clientHeight - 140))
      setArtworkToolbar(previous => previous?.host === host && previous.left === left && previous.top === top && previous.width === width ? previous : { host, left, top, width })
    }
    update()
    const resize = new ResizeObserver(update); resize.observe(article); resize.observe(host)
    host.addEventListener('canvas-camera-presented', update)
    window.addEventListener('resize', update)
    host.addEventListener('scroll', update, true)
    return () => { resize.disconnect(); host.removeEventListener('canvas-camera-presented', update); window.removeEventListener('resize', update); host.removeEventListener('scroll', update, true) }
  }, [editor, selected, variant])

  if (!editor) return null

  const activeTextStyle = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string; fontWeight?: string; lineHeight?: string; letterSpacing?: string }
  const activeFontSize = String(activeTextStyle.fontSize || (typeText ? '32px' : '12px')).replace('px', '')
  const activeLineHeight = String(activeTextStyle.lineHeight || '')
  const activeLetterSpacing = String(activeTextStyle.letterSpacing || '')
  const activeFontFamily = String(activeTextStyle.fontFamily || '')
  const activeFontWeight = String(activeTextStyle.fontWeight || '400')
  const availableFontFamilies = selected ? fontFamilyOptions(fontCatalog, activeFontFamily) : []
  const activeFontDescription = availableFontFamilies.find(option => option.value === activeFontFamily)?.description
  const availableFontSizes = Array.from(new Set([
    activeFontSize,
    '8', '9', '10', '11', '12', '14', '16', '18', '20', '22', '24', '28', '32', '36', '42', '48', '56', '64', '72', '84', '96', '112', '128', '144'
  ])).sort((a, b) => Number(a) - Number(b))

  async function setLink() {
    const current = editor?.getAttributes('link').href as string | undefined
    const href = await onRequestText({ title: 'Edit text link', label: 'Link URL', initialValue: current || 'https://' })
    if (href === null) return
    if (!href.trim()) editor?.chain().focus().unsetLink().run()
    else editor?.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }

  const toolbar = selected && <div className={`board-text-toolbar${artworkToolbar ? ' board-artwork-text-toolbar' : ''}`} role="toolbar" aria-label="Canvas text formatting" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} style={artworkToolbar ? { left: artworkToolbar.left, top: artworkToolbar.top, width: artworkToolbar.width } : undefined}>
      {/* 1. Paragraph Presets & Heading Levels */}
      <select aria-label="Canvas paragraph style" defaultValue="paragraph" onChange={(event) => {
        const val = event.target.value
        if (val === 'paragraph') editor.chain().focus().setParagraph().run()
        else if (val === 'display') {
          editor.chain().focus().setParagraph().setMark('textStyle', { fontSize: '72px', fontWeight: '700', lineHeight: '1.05' }).run()
        } else if (val === 'huge') {
          editor.chain().focus().setParagraph().setMark('textStyle', { fontSize: '48px', fontWeight: '700', lineHeight: '1.1' }).run()
        } else {
          editor.chain().focus().toggleHeading({ level: Number(val) as 1 | 2 | 3 }).run()
        }
      }}>
        <option value="paragraph">Body (Normal)</option>
        <option value="display">Display Banner (72px)</option>
        <option value="huge">Headline (48px)</option>
        <option value="1">Title (H1)</option>
        <option value="2">Heading (H2)</option>
        <option value="3">Subhead (H3)</option>
      </select>

      {/* 2. Font Family */}
      <select aria-label="Canvas text font" title={activeFontDescription} value={activeFontFamily} onChange={(event) => event.target.value ? editor.chain().focus().setFontFamily(event.target.value).run() : editor.chain().focus().unsetFontFamily().run()}>
        {availableFontFamilies.map(option => <option key={option.value} value={option.value} title={option.description}>{option.label}</option>)}
      </select>

      {/* 3. Font Size Preset & Custom Input */}
      <select className="board-font-size" aria-label="Canvas text size" value={activeFontSize} onChange={(event) => editor.chain().focus().setMark('textStyle', { fontSize: `${event.target.value}px` }).run()}>
        {availableFontSizes.map(size => <option key={size} value={size}>{size} px</option>)}
      </select>
      <input
        type="number"
        aria-label="Custom font size in pixels"
        title="Custom font size (px)"
        min="6"
        max="300"
        value={Number(activeFontSize) || 16}
        style={{ width: '46px' }}
        onChange={(event) => {
          const val = Number(event.target.value)
          if (val > 0) editor.chain().focus().setMark('textStyle', { fontSize: `${val}px` }).run()
        }}
      />

      {/* 4. Font Weight */}
      <select aria-label="Canvas text weight" value={activeFontWeight} onChange={(event) => editor.chain().focus().setMark('textStyle', { fontWeight: event.target.value }).run()}>
        <option value="100">Thin (100)</option>
        <option value="200">Extra light (200)</option>
        <option value="300">Light (300)</option>
        <option value="400">Regular (400)</option>
        <option value="500">Medium (500)</option>
        <option value="600">Semibold (600)</option>
        <option value="700">Bold (700)</option>
        <option value="800">Extra bold (800)</option>
        <option value="900">Black (900)</option>
      </select>

      <span className="toolbar-divider" />

      {/* 5. Leading (Line Height) & Tracking (Letter Spacing) */}
      <select aria-label="Canvas text leading" title="Line height (leading)" value={activeLineHeight} onChange={(event) => editor.chain().focus().setMark('textStyle', { lineHeight: event.target.value || null }).run()}>
        <option value="">Leading</option>
        <option value="0.9">0.9 (Tight)</option>
        <option value="1">1.0 (Solid)</option>
        <option value="1.1">1.1 (Compact)</option>
        <option value="1.2">1.2 (Editorial)</option>
        <option value="1.3">1.3 (Standard)</option>
        <option value="1.4">1.4 (Clean)</option>
        <option value="1.5">1.5 (Relaxed)</option>
        <option value="1.6">1.6 (Open)</option>
        <option value="1.8">1.8 (Double)</option>
        <option value="2">2.0 (Spacious)</option>
      </select>
      <select aria-label="Canvas text tracking" title="Letter spacing (tracking)" value={activeLetterSpacing} onChange={(event) => editor.chain().focus().setMark('textStyle', { letterSpacing: event.target.value || null }).run()}>
        <option value="">Tracking</option>
        <option value="-.08em">Ultra tight (-.08em)</option>
        <option value="-.04em">Tight (-.04em)</option>
        <option value="0">Normal (0)</option>
        <option value=".02em">Slight (.02em)</option>
        <option value=".06em">Wide (.06em)</option>
        <option value=".12em">Wider (.12em)</option>
        <option value=".2em">Headline wide (.2em)</option>
      </select>

      <span className="toolbar-divider" />

      {/* 6. Basic Formatting Toggles */}
      <button type="button" className={editor.isActive('bold') ? 'active' : ''} aria-label="Canvas text bold" title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
      <button type="button" className={editor.isActive('italic') ? 'active' : ''} aria-label="Canvas text italic" title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button type="button" className={editor.isActive('underline') ? 'active' : ''} aria-label="Canvas text underline" title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <button type="button" className={editor.isActive('strike') ? 'active' : ''} aria-label="Canvas text strikethrough" title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><del>S</del></button>

      {/* 7. Text Transform */}
      <select aria-label="Canvas text transform" title="Text transform" onChange={(event) => {
        const val = event.target.value
        editor.chain().focus().setMark('textStyle', { textTransform: val || null }).run()
      }}>
        <option value="">Case</option>
        <option value="uppercase">UPPERCASE</option>
        <option value="lowercase">lowercase</option>
        <option value="capitalize">Capitalize</option>
        <option value="none">Normal</option>
      </select>

      <span className="toolbar-divider" />

      {/* 8. Text Alignment (Left, Center, Right, Justify) */}
      <button type="button" className={editor.isActive({ textAlign: 'left' }) ? 'active' : ''} aria-label="Canvas text align left" title="Align left" onClick={() => editor.chain().focus().setTextAlign('left').run()}>≡</button>
      <button type="button" className={editor.isActive({ textAlign: 'center' }) ? 'active' : ''} aria-label="Canvas text align center" title="Align center" onClick={() => editor.chain().focus().setTextAlign('center').run()}>≣</button>
      <button type="button" className={editor.isActive({ textAlign: 'right' }) ? 'active' : ''} aria-label="Canvas text align right" title="Align right" onClick={() => editor.chain().focus().setTextAlign('right').run()}>⫸</button>
      <button type="button" className={editor.isActive({ textAlign: 'justify' }) ? 'active' : ''} aria-label="Canvas text justify" title="Justify" onClick={() => editor.chain().focus().setTextAlign('justify').run()}>☷</button>

      <span className="toolbar-divider" />

      {/* 9. Paragraph Spacing & Lists */}
      <button type="button" className={editor.isActive('bulletList') ? 'active' : ''} aria-label="Canvas bulleted list" title="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</button>
      <button type="button" className={editor.isActive('orderedList') ? 'active' : ''} aria-label="Canvas numbered list" title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</button>
      <button type="button" className={editor.isActive('blockquote') ? 'active' : ''} aria-label="Canvas quotation" title="Quote block" onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</button>

      <select aria-label="Canvas paragraph space before" title="Space before paragraph" value={editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').spaceBefore || ''} onChange={event => editor.chain().focus().updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', { spaceBefore: event.target.value || null }).run()}>
        <option value="">Space before</option>
        <option value="0px">0</option>
        <option value="4px">4 px</option>
        <option value="8px">8 px</option>
        <option value="12px">12 px</option>
        <option value="16px">16 px</option>
        <option value="24px">24 px</option>
        <option value="36px">36 px</option>
      </select>
      <select aria-label="Canvas paragraph space after" title="Space after paragraph" value={editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').spaceAfter || ''} onChange={event => editor.chain().focus().updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', { spaceAfter: event.target.value || null }).run()}>
        <option value="">Space after</option>
        <option value="0px">0</option>
        <option value="4px">4 px</option>
        <option value="8px">8 px</option>
        <option value="12px">12 px</option>
        <option value="16px">16 px</option>
        <option value="24px">24 px</option>
        <option value="36px">36 px</option>
      </select>

      <span className="toolbar-divider" />

      {/* 10. Links, Highlights & Text Color */}
      <button type="button" aria-label="Canvas text link" title="Add / edit link" onClick={setLink}>↗</button>
      <button type="button" aria-label="Canvas text highlight" title="Highlight" onClick={() => editor.chain().focus().toggleHighlight({ color: '#ecd28a' }).run()}>▰</button>
      <label aria-label="Canvas text color" title="Text color">
        <span>A</span>
        <input type="color" defaultValue="#e8e4dc" onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} />
      </label>
    </div>
  return <div ref={contentRef} style={artworkTypography} className={`board-rich-text board-rich-${variant}${typeText ? ' board-rich-type' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
    {artworkToolbar && toolbar ? createPortal(toolbar, artworkToolbar.host) : toolbar}
    <EditorContent editor={editor} />
    {areaText && overset && <span className="type-overset-indicator" role="status" title="Text exceeds this frame. Enlarge the frame; all text is retained.">+ Overflow</span>}
  </div>
}
