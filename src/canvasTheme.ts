/** Shared workspace canvas defaults for the React, retained/GPU and native adapters. */
export const CANVAS_THEME_COLORS = {
  navy: { background: '#102031', grid: '#2d465d', minorGrid: '#1b3045' },
  dark: {
    background: '#181a1f',
    grid: '#3a3f49',
    minorGrid: '#292d35',
  },
  light: {
    background: '#ded8ce',
    grid: '#aaa49a',
    minorGrid: '#d9d1c5',
  },
} as const

export const DEFAULT_CANVAS_GRID_OPACITY = 0.42

/** Shared resolved foreground for committed JSX and imperative shape previews. */
export function readableForeground(background: string, light = '#f4f0e8', dark = '#211d18') {
  const luminance = (color: string) => {
    const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)
    if (!match) return undefined
    const hex = match[1].length === 3 ? [...match[1]].map(digit => digit + digit).join('') : match[1]
    const linear = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
  }
  const base = luminance(background)
  if (base === undefined) return light
  const contrast = (color: string) => {
    const foreground = luminance(color) ?? 1
    return (Math.max(base, foreground) + .05) / (Math.min(base, foreground) + .05)
  }
  const preferred = contrast(light) >= contrast(dark) ? light : dark
  return contrast(preferred) >= 4.5 ? preferred : contrast('#fff') >= contrast('#000') ? '#fff' : '#000'
}
