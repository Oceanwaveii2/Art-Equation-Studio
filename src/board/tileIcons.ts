/** Searchable subboard tile icon library for the appearance picker.
 * Glyphs are single characters that Inter (or the OS fallback fonts) can
 * render, so an icon key stays a plain string on BoardModel.tileIcon and
 * existing projects keep working. */

export type TileIconCategory = 'Recommended' | 'Letters & numbers' | 'Shapes' | 'Arrows & pointers' | 'Work & objects' | 'Media' | 'Nature' | 'Status & symbols'

export type TileIcon = { glyph: string; name: string; category: TileIconCategory }

export const TILE_ICON_CATEGORIES: TileIconCategory[] = ['Recommended', 'Letters & numbers', 'Shapes', 'Arrows & pointers', 'Work & objects', 'Media', 'Nature', 'Status & symbols']

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({ glyph: letter, name: `Letter ${letter}`, category: 'Letters & numbers' as const }))
const digits = '0123456789'.split('').map((digit) => ({ glyph: digit, name: `Number ${digit}`, category: 'Letters & numbers' as const }))

export const TILE_ICONS: TileIcon[] = [
  // Recommended — the previous dropdown set plus the most useful board marks.
  { glyph: '▦', name: 'Board', category: 'Recommended' },
  { glyph: '▣', name: 'Reference', category: 'Recommended' },
  { glyph: '✦', name: 'Star', category: 'Recommended' },
  { glyph: '✎', name: 'Draw', category: 'Recommended' },
  { glyph: '●', name: 'Circle', category: 'Recommended' },
  { glyph: 'A', name: 'Letter A', category: 'Recommended' },
  { glyph: '▧', name: 'Subboard', category: 'Recommended' },
  { glyph: '☰', name: 'List', category: 'Recommended' },
  { glyph: '◈', name: 'Brief', category: 'Recommended' },
  { glyph: '✱', name: 'Spark', category: 'Recommended' },
  { glyph: '❖', name: 'Collection', category: 'Recommended' },
  { glyph: '⌂', name: 'Home', category: 'Recommended' },
  // Shapes
  { glyph: '■', name: 'Square', category: 'Shapes' },
  { glyph: '▲', name: 'Triangle', category: 'Shapes' },
  { glyph: '▼', name: 'Triangle down', category: 'Shapes' },
  { glyph: '◆', name: 'Diamond', category: 'Shapes' },
  { glyph: '○', name: 'Circle outline', category: 'Shapes' },
  { glyph: '◇', name: 'Diamond outline', category: 'Shapes' },
  { glyph: '▭', name: 'Rectangle', category: 'Shapes' },
  { glyph: '⬟', name: 'Pentagon', category: 'Shapes' },
  { glyph: '⬢', name: 'Hexagon', category: 'Shapes' },
  { glyph: '⯃', name: 'Cross', category: 'Shapes' },
  // Arrows & pointers
  { glyph: '→', name: 'Right arrow', category: 'Arrows & pointers' },
  { glyph: '←', name: 'Left arrow', category: 'Arrows & pointers' },
  { glyph: '↑', name: 'Up arrow', category: 'Arrows & pointers' },
  { glyph: '↓', name: 'Down arrow', category: 'Arrows & pointers' },
  { glyph: '↗', name: 'Diagonal up', category: 'Arrows & pointers' },
  { glyph: '↘', name: 'Diagonal down', category: 'Arrows & pointers' },
  { glyph: '⇄', name: 'Swap', category: 'Arrows & pointers' },
  { glyph: '⇅', name: 'Vertical swap', category: 'Arrows & pointers' },
  { glyph: '➤', name: 'Pointer', category: 'Arrows & pointers' },
  { glyph: '➔', name: 'Arrowhead', category: 'Arrows & pointers' },
  { glyph: '⤴', name: 'Turn up', category: 'Arrows & pointers' },
  { glyph: '⟳', name: 'Refresh', category: 'Arrows & pointers' },
  // Work & objects
  { glyph: '✓', name: 'Check', category: 'Work & objects' },
  { glyph: '✔', name: 'Done', category: 'Work & objects' },
  { glyph: '✗', name: 'Cross out', category: 'Work & objects' },
  { glyph: '⚙', name: 'Settings', category: 'Work & objects' },
  { glyph: '🔧', name: 'Wrench', category: 'Work & objects' },
  { glyph: '🔨', name: 'Hammer', category: 'Work & objects' },
  { glyph: '📌', name: 'Pin', category: 'Work & objects' },
  { glyph: '📎', name: 'Paperclip', category: 'Work & objects' },
  { glyph: '✂', name: 'Scissors', category: 'Work & objects' },
  { glyph: '🔑', name: 'Key', category: 'Work & objects' },
  { glyph: '🔒', name: 'Locked', category: 'Work & objects' },
  { glyph: '🔓', name: 'Unlocked', category: 'Work & objects' },
  { glyph: '🗂', name: 'Files', category: 'Work & objects' },
  { glyph: '📚', name: 'Books', category: 'Work & objects' },
  { glyph: '💼', name: 'Briefcase', category: 'Work & objects' },
  { glyph: '🧰', name: 'Toolbox', category: 'Work & objects' },
  { glyph: '💡', name: 'Idea', category: 'Work & objects' },
  { glyph: '🎯', name: 'Target', category: 'Work & objects' },
  { glyph: '📅', name: 'Calendar', category: 'Work & objects' },
  { glyph: '⏰', name: 'Alarm', category: 'Work & objects' },
  { glyph: '💰', name: 'Budget', category: 'Work & objects' },
  { glyph: '🛒', name: 'Shopping', category: 'Work & objects' },
  // Media
  { glyph: '📷', name: 'Photo', category: 'Media' },
  { glyph: '🎨', name: 'Art', category: 'Media' },
  { glyph: '🖼', name: 'Picture', category: 'Media' },
  { glyph: '🎬', name: 'Film', category: 'Media' },
  { glyph: '🎥', name: 'Camera', category: 'Media' },
  { glyph: '🎵', name: 'Music', category: 'Media' },
  { glyph: '🎧', name: 'Audio', category: 'Media' },
  { glyph: '🎤', name: 'Voice', category: 'Media' },
  { glyph: '📺', name: 'Screen', category: 'Media' },
  { glyph: '🎮', name: 'Games', category: 'Media' },
  { glyph: '🖌', name: 'Paint brush', category: 'Media' },
  { glyph: '✍', name: 'Writing', category: 'Media' },
  { glyph: '📄', name: 'Document', category: 'Media' },
  { glyph: '📝', name: 'Note', category: 'Media' },
  // Nature
  { glyph: '🌱', name: 'Seedling', category: 'Nature' },
  { glyph: '🌿', name: 'Herb', category: 'Nature' },
  { glyph: '🌲', name: 'Tree', category: 'Nature' },
  { glyph: '🌸', name: 'Blossom', category: 'Nature' },
  { glyph: '🌞', name: 'Sun', category: 'Nature' },
  { glyph: '🌙', name: 'Moon', category: 'Nature' },
  { glyph: '⭐', name: 'Star filled', category: 'Nature' },
  { glyph: '☁', name: 'Cloud', category: 'Nature' },
  { glyph: '💧', name: 'Drop', category: 'Nature' },
  { glyph: '🔥', name: 'Fire', category: 'Nature' },
  { glyph: '🌊', name: 'Wave', category: 'Nature' },
  { glyph: '🐾', name: 'Paw', category: 'Nature' },
  { glyph: '🦊', name: 'Fox', category: 'Nature' },
  { glyph: '🐧', name: 'Penguin', category: 'Nature' },
  // Status & symbols
  { glyph: '★', name: 'Favorite', category: 'Status & symbols' },
  { glyph: '☆', name: 'Unrated', category: 'Status & symbols' },
  { glyph: '♡', name: 'Heart', category: 'Status & symbols' },
  { glyph: '⚑', name: 'Flag', category: 'Status & symbols' },
  { glyph: '⚠', name: 'Warning', category: 'Status & symbols' },
  { glyph: 'ℹ', name: 'Info', category: 'Status & symbols' },
  { glyph: '⏳', name: 'Waiting', category: 'Status & symbols' },
  { glyph: '⛔', name: 'Blocked', category: 'Status & symbols' },
  { glyph: '♻', name: 'Recycle', category: 'Status & symbols' },
  { glyph: '⚖', name: 'Balance', category: 'Status & symbols' },
  { glyph: '⚑', name: 'Mark', category: 'Status & symbols' },
  { glyph: '❤', name: 'Heart filled', category: 'Status & symbols' },
  { glyph: '☕', name: 'Coffee', category: 'Status & symbols' },
  { glyph: '🕌', name: 'Landmark', category: 'Status & symbols' },
  ...letters,
  ...digits,
]

const RECENT_KEY = 'art-equation.recent-tile-icons'
const RECENT_LIMIT = 12

export function recentTileIcons(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

export function rememberTileIcon(glyph: string) {
  try {
    const next = [glyph, ...recentTileIcons().filter((entry) => entry !== glyph)].slice(0, RECENT_LIMIT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* storage is best-effort */ }
}

export function searchTileIcons(query: string, category: TileIconCategory | 'All'): TileIcon[] {
  const text = query.trim().toLowerCase()
  return TILE_ICONS.filter((icon) => {
    if (category !== 'All' && category !== 'Recommended' && icon.category !== category) return false
    if (category === 'Recommended' && !RECOMMENDED_SET.has(icon.glyph)) return false
    if (!text) return true
    return icon.name.toLowerCase().includes(text) || icon.category.toLowerCase().includes(text) || icon.glyph.toLowerCase() === text
  })
}

const RECOMMENDED_SET = new Set(TILE_ICONS.filter((icon) => icon.category === 'Recommended').map((icon) => icon.glyph))
