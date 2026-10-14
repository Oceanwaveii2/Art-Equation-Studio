/** Re-arm after every monitor/DPI transition; resize alone is insufficient. */
export function watchPixelRatio(changed: () => void) {
  let query: MediaQueryList | undefined
  const update = () => { query?.removeEventListener('change', update); query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); query.addEventListener('change', update); changed() }
  update()
  return () => query?.removeEventListener('change', update)
}
