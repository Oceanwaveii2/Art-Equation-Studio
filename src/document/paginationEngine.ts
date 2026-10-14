/**
 * Advance Document Continuous Semantic Tree Pagination & Layout Solver
 * Implements ART_EQUATION_DOCUMENT_ADVANCE_SCOPE (§§2-5) & ARGON_INSTRUCTION_DIRECTIVE.md (§2.2-2.3)
 *
 * Core Architectural Law:
 * - Pages and Flow are dynamic projections of a single continuous authored ProseMirror/Tiptap tree.
 * - Never persist `document.pages[]` in document schemas.
 * - Overflow pagination is derived via constraint solving; explicit breaks (PageBreak, BlankPage,
 *   SectionBreakContinuous, SectionBreakNextPage) represent authored user intent.
 */

import type { JSONContent } from '@tiptap/react'
import type { DocumentLayout } from '../model/project'

export type AuthoredBreakKind =
  | 'pageBreak'
  | 'blankPage'
  | 'sectionBreakContinuous'
  | 'sectionBreakNextPage'

export type MediaPlacementMode = 'inline' | 'block' | 'anchored' | 'left' | 'right'

export interface DocPosition {
  blockIndex: number
  lineOffset: number
  utf8Offset: number
}

export interface FragmentRef {
  blockIndex: number
  nodeType: string
  nodeId: string
  startLine: number
  endLine: number
  heightPx: number
  isAuthoredBreak?: boolean
  breakKind?: AuthoredBreakKind
  intrinsicReserved?: boolean
}

export interface PageSlice {
  pageIndex: number
  pageNumber: number
  sectionId: string
  sectionIndex: number
  sourceStart: DocPosition
  sourceEnd: DocPosition
  fragments: FragmentRef[]
  contentHeightPx: number
  availableHeightPx: number
  utilization: number
  isBlankPage: boolean
  hasExplicitBreak: boolean
  explicitBreakKind?: AuthoredBreakKind
  columns: 1 | 2
}

export interface PaginationCheckpoint {
  pageIndex: number
  sectionIndex: number
  blockIndex: number
  accumulatedWords: number
  contentHash: string
}

export interface OverflowDiagnostic {
  pageIndex: number
  blockIndex: number
  nodeType: string
  severity: 'warning' | 'info'
  message: string
}

export interface DocumentBlockCounts {
  paragraphs: number
  headings: number
  lists: number
  images: number
  videos: number
  models3d: number
  pdfEmbeds: number
  tables: number
  footnotes: number
  pageBreaks: number
  blankPages: number
  sectionBreaks: number
}

export interface PaginationResult {
  revision: number
  pageWidthPx: number
  pageHeightPx: number
  marginPx: number
  contentWidthPx: number
  contentHeightPx: number
  columns: 1 | 2
  pages: PageSlice[]
  checkpoints: PaginationCheckpoint[]
  overflow: OverflowDiagnostic[]
  counts: DocumentBlockCounts
  wordCount: number
  characterCount: number
  estimatedReadMinutes: number
}

/**
 * Explicit Unicode & UTF-8/UTF-16/Grapheme Index Map per paragraph (Advance Document Scope §3).
 * Prevents caret/selection bugs across emoji sequences, CJK, RTL, and combining marks.
 */
export interface TextIndexMap {
  text: string
  utf8ByteLength: number
  utf16CodeUnitLength: number
  scalarCount: number
  graphemeBoundariesUtf16: number[]
  wordCount: number
  containsRtl: boolean
  containsCjk: boolean
}

const RTL_REGEX = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/
const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/

export function createTextIndexMap(text: string): TextIndexMap {
  const encoder = new TextEncoder()
  const utf8ByteLength = encoder.encode(text).byteLength
  const utf16CodeUnitLength = text.length
  let scalarCount = 0
  for (const _ of text) scalarCount += 1

  const graphemeBoundariesUtf16: number[] = [0]
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const seg of segmenter.segment(text)) {
      if (seg.index > 0) graphemeBoundariesUtf16.push(seg.index)
    }
  } else {
    let idx = 0
    for (const ch of text) {
      idx += ch.length
      if (idx < text.length) graphemeBoundariesUtf16.push(idx)
    }
  }
  if (graphemeBoundariesUtf16[graphemeBoundariesUtf16.length - 1] !== text.length && text.length > 0) {
    graphemeBoundariesUtf16.push(text.length)
  }

  const trimmed = text.trim()
  const cjkMatches = trimmed.match(new RegExp(CJK_REGEX.source, 'g'))
  const nonCjkText = trimmed.replace(new RegExp(CJK_REGEX.source, 'g'), ' ').trim()
  const latinWords = nonCjkText ? nonCjkText.split(/\s+/).length : 0
  const wordCount = latinWords + (cjkMatches ? cjkMatches.length : 0)

  return {
    text,
    utf8ByteLength,
    utf16CodeUnitLength,
    scalarCount,
    graphemeBoundariesUtf16,
    wordCount,
    containsRtl: RTL_REGEX.test(text),
    containsCjk: CJK_REGEX.test(text),
  }
}

export function resolvePageGeometry(layout: DocumentLayout) {
  const baseDimensions =
    layout.pageSize === 'a4'
      ? [794, 1123]
      : layout.pageSize === 'screen'
        ? [920, 1080]
        : [816, 1056] // US Letter default
  const [portraitWidth, portraitHeight] = baseDimensions
  const pageWidthPx = layout.orientation === 'landscape' ? portraitHeight : portraitWidth
  const pageHeightPx = layout.orientation === 'landscape' ? portraitWidth : portraitHeight
  const marginPx = layout.margins === 'compact' ? 42 : layout.margins === 'wide' ? 92 : 68
  // Running header (52px top band) and running footer (38px bottom band)
  const headerFooterReservePx = 166
  const contentHeightPx = Math.max(240, pageHeightPx - headerFooterReservePx)
  const contentWidthPx = Math.max(200, pageWidthPx - 2 * marginPx)
  const columns: 1 | 2 = layout.columns === 2 ? 2 : 1
  const columnGutterPx = columns === 2 ? 42 : 0
  const columnWidthPx = columns === 2 ? Math.max(120, (contentWidthPx - columnGutterPx) / 2) : contentWidthPx

  return {
    pageWidthPx,
    pageHeightPx,
    marginPx,
    contentWidthPx,
    contentHeightPx,
    columns,
    columnWidthPx,
    columnGutterPx,
  }
}

function extractNodeText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(extractNodeText).join('')
}

function hashBlock(node: JSONContent, index: number): string {
  const type = node.type || 'unknown'
  const text = extractNodeText(node)
  const attrs = node.attrs ? JSON.stringify(node.attrs) : ''
  return `${index}:${type}:${text.length}:${attrs}`
}

interface MeasuredBlock {
  blockIndex: number
  nodeType: string
  nodeId: string
  heightPx: number
  lineCount: number
  lineHeightPx: number
  keepWithNext: boolean
  keepTogether: boolean
  isAuthoredBreak: boolean
  breakKind?: AuthoredBreakKind
  intrinsicReserved: boolean
  wordCount: number
  charCount: number
  utf8Bytes: number
  hash: string
}

function measureBlock(
  node: JSONContent,
  blockIndex: number,
  columnWidthPx: number
): MeasuredBlock {
  const type = node.type || 'paragraph'
  const nodeId = String(node.attrs?.id || `block-${blockIndex}`)
  const text = extractNodeText(node)
  const textMap = createTextIndexMap(text)
  const hash = hashBlock(node, blockIndex)

  // Authored Break Intent
  if (
    type === 'pageBreak' ||
    type === 'blankPage' ||
    type === 'sectionBreakContinuous' ||
    type === 'sectionBreakNextPage'
  ) {
    return {
      blockIndex,
      nodeType: type,
      nodeId,
      heightPx: 0,
      lineCount: 0,
      lineHeightPx: 0,
      keepWithNext: false,
      keepTogether: true,
      isAuthoredBreak: true,
      breakKind: type as AuthoredBreakKind,
      intrinsicReserved: false,
      wordCount: 0,
      charCount: 0,
      utf8Bytes: 0,
      hash,
    }
  }

  // Multimodal Media Blocks with Intrinsic Box Reservation (Advance Document Scope §4 "Media stability rule")
  if (type === 'image' || type === 'videoBlock' || type === 'model3DBlock' || type === 'pdfEmbedBlock') {
    const placement = String(node.attrs?.placement || 'block') as MediaPlacementMode
    const intrinsicW = Number(node.attrs?.width) || (type === 'model3DBlock' ? 640 : type === 'pdfEmbedBlock' ? 612 : 640)
    const intrinsicH = Number(node.attrs?.height) || (type === 'model3DBlock' ? 380 : type === 'pdfEmbedBlock' ? 792 : 360)
    const ratio = intrinsicH / Math.max(1, intrinsicW)
    const effectiveWidth =
      placement === 'inline'
        ? Math.min(180, columnWidthPx * 0.45)
        : placement === 'left' || placement === 'right'
          ? columnWidthPx * 0.48
          : Math.min(columnWidthPx, intrinsicW)
    const mediaBoxHeight = Math.round(
      Math.max(110, Math.min(520, effectiveWidth * ratio)) + (node.attrs?.caption ? 28 : 12)
    )
    return {
      blockIndex,
      nodeType: type,
      nodeId,
      heightPx: mediaBoxHeight,
      lineCount: 1,
      lineHeightPx: mediaBoxHeight,
      keepWithNext: false,
      keepTogether: true,
      isAuthoredBreak: false,
      intrinsicReserved: true,
      wordCount: textMap.wordCount,
      charCount: textMap.scalarCount,
      utf8Bytes: textMap.utf8ByteLength,
      hash,
    }
  }

  // Table block with row-level split policy (Advance Document Scope §22)
  if (type === 'table') {
    const rows = Array.isArray(node.content) ? node.content.length : 3
    const rowHeightPx = 38
    const totalHeight = rows * rowHeightPx + 20
    return {
      blockIndex,
      nodeType: type,
      nodeId,
      heightPx: totalHeight,
      lineCount: Math.max(1, rows),
      lineHeightPx: rowHeightPx,
      keepWithNext: false,
      keepTogether: rows <= 4,
      isAuthoredBreak: false,
      intrinsicReserved: false,
      wordCount: textMap.wordCount,
      charCount: textMap.scalarCount,
      utf8Bytes: textMap.utf8ByteLength,
      hash,
    }
  }

  // Footnote block
  if (type === 'footnote') {
    const footnoteText = String(node.attrs?.text || text)
    const fnMap = createTextIndexMap(footnoteText)
    const charsPerLine = Math.max(24, Math.floor(columnWidthPx / 7.2))
    const lines = Math.max(1, Math.ceil(Math.max(1, fnMap.scalarCount) / charsPerLine))
    const lineHeightPx = 19
    return {
      blockIndex,
      nodeType: type,
      nodeId,
      heightPx: lines * lineHeightPx + 10,
      lineCount: lines,
      lineHeightPx,
      keepWithNext: false,
      keepTogether: true,
      isAuthoredBreak: false,
      intrinsicReserved: false,
      wordCount: fnMap.wordCount,
      charCount: fnMap.scalarCount,
      utf8Bytes: fnMap.utf8ByteLength,
      hash,
    }
  }

  // Headings (keepWithNext = true, keepTogether = true)
  if (type === 'heading') {
    const level = Number(node.attrs?.level) || 2
    const fontSizePx = level === 1 ? 34 : level === 2 ? 24 : 18
    const lineHeightPx = Math.round(fontSizePx * 1.22)
    const avgCharWidth = fontSizePx * 0.54
    const charsPerLine = Math.max(12, Math.floor(columnWidthPx / avgCharWidth))
    const lines = Math.max(1, Math.ceil(Math.max(1, textMap.scalarCount) / charsPerLine))
    const marginVertical = level === 1 ? 28 : level === 2 ? 22 : 16
    return {
      blockIndex,
      nodeType: type,
      nodeId,
      heightPx: lines * lineHeightPx + marginVertical,
      lineCount: lines,
      lineHeightPx,
      keepWithNext: true,
      keepTogether: true,
      isAuthoredBreak: false,
      intrinsicReserved: false,
      wordCount: textMap.wordCount,
      charCount: textMap.scalarCount,
      utf8Bytes: textMap.utf8ByteLength,
      hash,
    }
  }

  // Lists & Blockquotes & Paragraphs
  const fontSizePx = 15
  const lineHeightPx = 25
  const avgCharWidth = textMap.containsCjk ? fontSizePx * 0.95 : fontSizePx * 0.52
  const effectiveColumnWidth = type === 'blockquote' || type === 'bulletList' || type === 'orderedList'
    ? Math.max(120, columnWidthPx - 32)
    : columnWidthPx
  const charsPerLine = Math.max(18, Math.floor(effectiveColumnWidth / avgCharWidth))

  let lines = 1
  if (type === 'bulletList' || type === 'orderedList') {
    const items = Array.isArray(node.content) ? node.content : []
    lines = items.reduce((acc, item) => {
      const itemLen = extractNodeText(item).length
      return acc + Math.max(1, Math.ceil(Math.max(1, itemLen) / charsPerLine))
    }, 0)
    lines = Math.max(1, lines)
  } else {
    lines = Math.max(1, Math.ceil(Math.max(1, textMap.scalarCount) / charsPerLine))
  }

  const blockMargin = type === 'blockquote' ? 24 : 12
  return {
    blockIndex,
    nodeType: type,
    nodeId,
    heightPx: lines * lineHeightPx + blockMargin,
    lineCount: lines,
    lineHeightPx,
    keepWithNext: false,
    keepTogether: type === 'blockquote' && lines <= 4,
    isAuthoredBreak: false,
    intrinsicReserved: false,
    wordCount: textMap.wordCount,
    charCount: textMap.scalarCount,
    utf8Bytes: textMap.utf8ByteLength,
    hash,
  }
}

/**
 * Constraint-solving pagination pass with widow/orphan control, keep-with-next,
 * intrinsic media reservation, and explicit break intent.
 */
export function solveDocumentPagination(
  content: JSONContent,
  layout: DocumentLayout,
  revision = 1
): PaginationResult {
  const geom = resolvePageGeometry(layout)
  const blocks = Array.isArray(content?.content) ? content.content : []

  const counts: DocumentBlockCounts = {
    paragraphs: 0,
    headings: 0,
    lists: 0,
    images: 0,
    videos: 0,
    models3d: 0,
    pdfEmbeds: 0,
    tables: 0,
    footnotes: 0,
    pageBreaks: 0,
    blankPages: 0,
    sectionBreaks: 0,
  }

  const measured: MeasuredBlock[] = blocks.map((node, index) => {
    const t = node.type || 'paragraph'
    if (t === 'paragraph') counts.paragraphs += 1
    else if (t === 'heading') counts.headings += 1
    else if (t === 'bulletList' || t === 'orderedList') counts.lists += 1
    else if (t === 'image') counts.images += 1
    else if (t === 'videoBlock') counts.videos += 1
    else if (t === 'model3DBlock') counts.models3d += 1
    else if (t === 'pdfEmbedBlock') counts.pdfEmbeds += 1
    else if (t === 'table') counts.tables += 1
    else if (t === 'footnote') counts.footnotes += 1
    else if (t === 'pageBreak') counts.pageBreaks += 1
    else if (t === 'blankPage') counts.blankPages += 1
    else if (t === 'sectionBreakContinuous' || t === 'sectionBreakNextPage') counts.sectionBreaks += 1

    return measureBlock(node, index, geom.columnWidthPx)
  })

  // Total available vertical column height per page sheet
  const pageCapacityPx = geom.contentHeightPx * geom.columns
  const pages: PageSlice[] = []
  const checkpoints: PaginationCheckpoint[] = []
  const overflow: OverflowDiagnostic[] = []

  let sectionIndex = 0
  let currentFragments: FragmentRef[] = []
  let currentHeightPx = 0
  let currentStart: DocPosition = { blockIndex: 0, lineOffset: 0, utf8Offset: 0 }
  let runningUtf8 = 0
  let totalWords = 0
  let totalChars = 0

  const flushPage = (
    endPos: DocPosition,
    opts?: { isBlankPage?: boolean; hasExplicitBreak?: boolean; explicitBreakKind?: AuthoredBreakKind }
  ) => {
    const pageIndex = pages.length
    const slice: PageSlice = {
      pageIndex,
      pageNumber: pageIndex + 1,
      sectionId: `sec-${sectionIndex + 1}`,
      sectionIndex,
      sourceStart: { ...currentStart },
      sourceEnd: { ...endPos },
      fragments: currentFragments,
      contentHeightPx: Math.round(currentHeightPx),
      availableHeightPx: pageCapacityPx,
      utilization: Math.min(1, Number((currentHeightPx / Math.max(1, pageCapacityPx)).toFixed(3))),
      isBlankPage: Boolean(opts?.isBlankPage),
      hasExplicitBreak: Boolean(opts?.hasExplicitBreak),
      explicitBreakKind: opts?.explicitBreakKind,
      columns: geom.columns,
    }
    pages.push(slice)
    checkpoints.push({
      pageIndex,
      sectionIndex,
      blockIndex: currentStart.blockIndex,
      accumulatedWords: totalWords,
      contentHash: currentFragments.map((f) => `${f.blockIndex}:${f.startLine}-${f.endLine}`).join('|'),
    })
    currentFragments = []
    currentHeightPx = 0
    currentStart = { ...endPos }
  }

  for (let i = 0; i < measured.length; i += 1) {
    const blk = measured[i]
    totalWords += blk.wordCount
    totalChars += blk.charCount

    // Handle explicit authored breaks
    if (blk.isAuthoredBreak && blk.breakKind) {
      currentFragments.push({
        blockIndex: blk.blockIndex,
        nodeType: blk.nodeType,
        nodeId: blk.nodeId,
        startLine: 0,
        endLine: 0,
        heightPx: 0,
        isAuthoredBreak: true,
        breakKind: blk.breakKind,
      })
      const nextPos: DocPosition = {
        blockIndex: i + 1,
        lineOffset: 0,
        utf8Offset: runningUtf8,
      }
      if (blk.breakKind === 'sectionBreakContinuous') {
        sectionIndex += 1
        continue
      }
      if (blk.breakKind === 'sectionBreakNextPage') {
        flushPage(nextPos, { hasExplicitBreak: true, explicitBreakKind: 'sectionBreakNextPage' })
        sectionIndex += 1
        continue
      }
      if (blk.breakKind === 'pageBreak') {
        flushPage(nextPos, { hasExplicitBreak: true, explicitBreakKind: 'pageBreak' })
        continue
      }
      if (blk.breakKind === 'blankPage') {
        if (currentFragments.length > 1 || currentHeightPx > 0) {
          flushPage(nextPos, { hasExplicitBreak: true, explicitBreakKind: 'pageBreak' })
        }
        flushPage(nextPos, {
          isBlankPage: true,
          hasExplicitBreak: true,
          explicitBreakKind: 'blankPage',
        })
        continue
      }
    }

    // Check oversized indivisible block diagnostic (Advance Document Scope §22)
    if (blk.keepTogether && blk.heightPx > pageCapacityPx) {
      overflow.push({
        pageIndex: pages.length,
        blockIndex: blk.blockIndex,
        nodeType: blk.nodeType,
        severity: 'warning',
        message: `Block #${blk.blockIndex + 1} (${blk.nodeType}, ${blk.heightPx}px) exceeds single-page capacity (${pageCapacityPx}px).`,
      })
    }

    // Keep-with-next constraint: if this is a heading and the next block's first 2 lines won't fit
    const nextBlk = measured[i + 1]
    const keepWithNextReserve =
      blk.keepWithNext && nextBlk && !nextBlk.isAuthoredBreak
        ? Math.min(nextBlk.heightPx, Math.max(nextBlk.lineHeightPx * 2, 44))
        : 0

    if (
      currentHeightPx > 0 &&
      currentHeightPx + blk.heightPx + keepWithNextReserve > pageCapacityPx
    ) {
      // Can we split lines across pages (with widow/orphan >= 2 lines)?
      const remainingPx = pageCapacityPx - currentHeightPx
      const fitLines =
        !blk.keepTogether && blk.lineHeightPx > 0
          ? Math.floor(remainingPx / blk.lineHeightPx)
          : 0

      if (!blk.keepTogether && blk.lineCount >= 4 && fitLines >= 2 && blk.lineCount - fitLines >= 2) {
        const firstPartPx = fitLines * blk.lineHeightPx
        currentFragments.push({
          blockIndex: blk.blockIndex,
          nodeType: blk.nodeType,
          nodeId: blk.nodeId,
          startLine: 0,
          endLine: fitLines,
          heightPx: firstPartPx,
          intrinsicReserved: blk.intrinsicReserved,
        })
        currentHeightPx += firstPartPx
        const midPos: DocPosition = {
          blockIndex: blk.blockIndex,
          lineOffset: fitLines,
          utf8Offset: runningUtf8 + Math.round((blk.utf8Bytes * fitLines) / blk.lineCount),
        }
        flushPage(midPos)
        const restPx = blk.heightPx - firstPartPx
        currentFragments.push({
          blockIndex: blk.blockIndex,
          nodeType: blk.nodeType,
          nodeId: blk.nodeId,
          startLine: fitLines,
          endLine: blk.lineCount,
          heightPx: restPx,
          intrinsicReserved: blk.intrinsicReserved,
        })
        currentHeightPx += restPx
      } else {
        // Move entire block to the next page
        flushPage({ blockIndex: blk.blockIndex, lineOffset: 0, utf8Offset: runningUtf8 })
        currentFragments.push({
          blockIndex: blk.blockIndex,
          nodeType: blk.nodeType,
          nodeId: blk.nodeId,
          startLine: 0,
          endLine: blk.lineCount,
          heightPx: blk.heightPx,
          intrinsicReserved: blk.intrinsicReserved,
        })
        currentHeightPx += blk.heightPx
      }
    } else {
      currentFragments.push({
        blockIndex: blk.blockIndex,
        nodeType: blk.nodeType,
        nodeId: blk.nodeId,
        startLine: 0,
        endLine: blk.lineCount,
        heightPx: blk.heightPx,
        intrinsicReserved: blk.intrinsicReserved,
      })
      currentHeightPx += blk.heightPx
    }

    runningUtf8 += blk.utf8Bytes
  }

  if (currentFragments.length > 0 || pages.length === 0) {
    flushPage({
      blockIndex: measured.length,
      lineOffset: 0,
      utf8Offset: runningUtf8,
    })
  }

  return {
    revision,
    pageWidthPx: geom.pageWidthPx,
    pageHeightPx: geom.pageHeightPx,
    marginPx: geom.marginPx,
    contentWidthPx: geom.contentWidthPx,
    contentHeightPx: geom.contentHeightPx,
    columns: geom.columns,
    pages,
    checkpoints,
    overflow,
    counts,
    wordCount: totalWords,
    characterCount: totalChars,
    estimatedReadMinutes: Math.max(1, Math.ceil(totalWords / 220)),
  }
}
