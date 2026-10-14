/**
 * Art Equation Canvas Engine - Color Utilities
 */

export function normalizeColor8(color: string): string {
  if (!color || color === 'none') return '#00000000'
  if (color.startsWith('#')) {
    if (color.length === 7) return `${color}ff`
    if (color.length === 9) return color
    if (color.length === 4) {
      const r = color[1], g = color[2], b = color[3]
      return `#${r}${r}${g}${g}${b}${b}ff`
    }
  }
  return color
}
