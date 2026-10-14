/** Computed colour, not model colour. Unknown colour spaces remain refused. */
export function normalizeMeasuredColor(css: string): string | null {
  if (css === 'transparent') return '#00000000'
  const match = /^(rgba?|color)\((.*)\)$/.exec(css.trim())
  if (!match) return null
  let value = match[2].trim(), normalized = false
  if (match[1] === 'color') {
    if (!value.startsWith('srgb ')) return null
    value = value.slice(5); normalized = true
  }
  const tokens = value.replace(/,/g, ' ').replace(/\//g, ' ').trim().split(/\s+/)
  if (tokens.length !== 3 && tokens.length !== 4) return null
  const numbers = tokens.map((token, index) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(token)) return NaN
    const n = Number.parseFloat(token)
    return token.endsWith('%') ? n / 100 : index === 3 || normalized ? n : n / 255
  })
  if (!numbers.every(Number.isFinite)) return null
  if (numbers.length === 3) numbers.push(1)
  return '#' + numbers.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')
}

