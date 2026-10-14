export type StateUpdate<T> = T | ((previous: T) => T)

/** Instance-scoped, synchronous immutable state. Selectors notify only on a
 * changed slice; unchanged content retains identity for paint/history caches. */
export function createSelectorStore<T>(initial: T) {
  let state = initial, revision = 0
  const listeners = new Set<() => void>()
  const getSnapshot = () => state
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const set = (update: StateUpdate<T>) => {
    const next = typeof update === 'function' ? (update as (previous: T) => T)(state) : update
    if (Object.is(next, state)) return
    state = next; revision++
    for (const listener of [...listeners]) listener()
  }
  const field = <K extends keyof T>(key: K, update: StateUpdate<T[K]>) => set(previous => {
    const next = typeof update === 'function' ? (update as (value: T[K]) => T[K])(previous[key]) : update
    return Object.is(next, previous[key]) ? previous : { ...previous, [key]: next }
  })
  const select = <S>(selector: (value: T) => S, equal: (a: S, b: S) => boolean = Object.is) => {
    let selected = selector(state)
    return {
      getSnapshot: () => { const next = selector(state); if (!equal(next, selected)) selected = next; return selected },
      subscribe: (listener: () => void) => subscribe(() => {
        const next = selector(state)
        if (!equal(next, selected)) { selected = next; listener() }
      }),
    }
  }
  return { getSnapshot, subscribe, set, field, select, get revision() { return revision } }
}
export type SelectorStore<T> = ReturnType<typeof createSelectorStore<T>>
