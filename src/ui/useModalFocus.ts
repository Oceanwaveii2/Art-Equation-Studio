import { useLayoutEffect, type RefObject } from 'react'

const focusableSelector = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[contenteditable="true"],[contenteditable="plaintext-only"],audio[controls],video[controls],[tabindex]'
const modalStack: HTMLElement[] = []
const inertOwners = new WeakMap<HTMLElement, { count: number; original: boolean }>()

function isTabbable(item: HTMLElement) {
  if (item.tabIndex < 0 || item.closest('[inert]') || !item.getClientRects().length || getComputedStyle(item).visibility === 'hidden') return false
  // Chromium may expose layout boxes for descendants of closed details.
  // Only the first summary (and its descendants) belongs in the Tab order.
  for (let ancestor = item.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = [...ancestor.children].find((child) => child.tagName === 'SUMMARY')
      if (!summary?.contains(item)) return false
    }
  }
  return true
}

/** Contain modal focus and suspend sibling panes without changing their saved state. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, initial?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const restored: HTMLElement[] = []
    modalStack.push(dialog)
    const topmost = () => modalStack.at(-1) === dialog
    let branch: HTMLElement = dialog
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue
        const owner = inertOwners.get(sibling) || { count: 0, original: sibling.inert }
        owner.count++; inertOwners.set(sibling, owner)
        restored.push(sibling); sibling.inert = true
      }
      branch = branch.parentElement
      if (branch === document.body) break
    }
    const items = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(isTabbable)
    const focusFirst = () => (initial?.current || items()[0] || dialog).focus({ preventScroll: true })
    const contain = (event: FocusEvent) => { if (topmost() && !dialog.contains(event.target as Node)) focusFirst() }
    const keys = (event: KeyboardEvent) => {
      if (!topmost() || event.key !== 'Tab') return
      const list = items(), index = list.indexOf(document.activeElement as HTMLElement)
      if (!list.length) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && index <= 0) { event.preventDefault(); list.at(-1)!.focus() }
      else if (!event.shiftKey && (index < 0 || index === list.length - 1)) { event.preventDefault(); list[0].focus() }
    }
    dialog.addEventListener('keydown', keys)
    document.addEventListener('focusin', contain, true)
    focusFirst()
    return () => {
      dialog.removeEventListener('keydown', keys)
      document.removeEventListener('focusin', contain, true)
      const wasTop = topmost()
      const stackIndex = modalStack.lastIndexOf(dialog)
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1)
      for (const element of restored) {
        const owner = inertOwners.get(element)
        if (!owner) continue
        if (--owner.count === 0) { element.inert = owner.original; inertOwners.delete(element) }
      }
      if (wasTop && origin?.isConnected && !origin.closest('[inert]')) origin.focus({ preventScroll: true })
    }
  }, [ref, initial])
}
