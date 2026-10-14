const articleSelector = 'article.board-node[data-node-id]'
const ownershipAttributes = new Set(['data-vello-paint', 'data-vello-card-paint', 'data-vello-canonical-read', 'data-vello-card-canonical-read'])
const connectorPaintAttributes = new Set(['d','fill','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','marker-start','marker-end','opacity','transform','viewBox','visibility','clip-path','filter','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','width','height'])

function externalConnectorPaint(record: MutationRecord, target: Element, stage: HTMLElement) {
  if (record.type !== 'attributes' || !connectorPaintAttributes.has(record.attributeName ?? '') || target.namespaceURI !== 'http://www.w3.org/2000/svg' || target.closest('article.board-node')) return false
  const layer = target.closest('svg.connector-layer')
  // This production sibling is DOM-owned and never enters the engine display
  // list. SVG presentation attributes cannot inherit into sibling articles.
  // Class/style, unknown wrappers and a connector SVG inside a card retain
  // their conservative invalidation paths below.
  return !!layer && layer.parentElement?.matches('.board-world') && layer.parentElement.parentElement === stage
}

/** Include nested card ancestors: inherited hover/focus/style on a containing
 * article can change both its measured contribution and a child card. */
export function cardPaintIds(node: Node): Set<string> {
  const ids = new Set<string>()
  const element = node instanceof Element ? node : node.parentElement
  for (let article = element?.closest<HTMLElement>(articleSelector); article; article = article.parentElement?.closest<HTMLElement>(articleSelector) ?? null) {
    if (article.dataset.nodeId) ids.add(article.dataset.nodeId)
    // A containing :hover/:focus-within or inherited style can affect nested
    // siblings as well as the event target. Keep that complete DOM family dirty.
    for (const child of article.querySelectorAll<HTMLElement>(articleSelector)) if (child.dataset.nodeId) ids.add(child.dataset.nodeId)
  }
  return ids
}

function withoutCameraTransform(element: Element, cssText: string | null) {
  const style = element.ownerDocument.createElement('div').style
  style.cssText = cssText ?? ''
  style.removeProperty('transform')
  return style.cssText
}

/** A world camera transform is supplied separately to the renderer. Every
 * other inherited style/class change remains a conservative global change. */
export function paintMutationScope(records: readonly MutationRecord[], stage: HTMLElement, surface: HTMLElement) {
  const ids = new Set<string>()
  let global = false
  for (const record of records) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement
    if (!target || surface.contains(target) || record.type === 'attributes' && ownershipAttributes.has(record.attributeName ?? '')) continue
    // This explicitly owned sibling contains only transient transform handles.
    // Internal geometry/focus changes cannot inherit into sibling card paint.
    // Keep root style/class and any inserted semantic article conservative.
    const chrome = target.closest('[data-canvas-paint-chrome="interaction"]')
    if (chrome && target !== chrome && chrome.matches('.canvas-interaction-overlay') &&
        chrome.parentElement?.matches('.board-world') && chrome.parentElement.parentElement === stage &&
        !chrome.querySelector('article.board-node') && !target.closest('article.board-node') &&
        !(record.type === 'childList' && [...record.addedNodes,...record.removedNodes].some(node => node instanceof Element && (node.matches('article.board-node') || node.querySelector('article.board-node'))))) continue
    if (externalConnectorPaint(record,target,stage)) continue
    if (record.type === 'attributes' && record.attributeName === 'style' && target.matches('.board-world') && target.parentElement === stage &&
      withoutCameraTransform(target, record.oldValue) === withoutCameraTransform(target, target.getAttribute('style'))) continue
    const ownIds = cardPaintIds(record.target)
    for (const id of ownIds) ids.add(id)
    if (record.type === 'attributes' && record.attributeName === 'data-node-id' && record.oldValue) ids.add(record.oldValue)
    if (record.type === 'childList') {
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        for (const id of cardPaintIds(node)) ids.add(id)
        if (node instanceof Element) for (const child of node.querySelectorAll<HTMLElement>(articleSelector)) if (child.dataset.nodeId) ids.add(child.dataset.nodeId)
      }
    }
    if (ownIds.size) continue
    const world = target.matches('.board-world') ? target : target.closest('.board-world')
    if (target === stage || world) {
      // Direct membership changes have explicit card ownership. A wrapper's
      // own style/unknown subtree can affect inherited paint across all cards.
      const membership = record.type === 'childList' && target.matches('.board-world,.board-object-layer') &&
        [...record.addedNodes, ...record.removedNodes].every(node => node instanceof Element && node.matches(articleSelector))
      if (!membership) global = true
    }
  }
  return { global, ids, changed: global || ids.size > 0 }
}
