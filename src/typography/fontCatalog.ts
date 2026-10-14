import { invoke } from '@tauri-apps/api/core'

const CURATED_FONT_FAMILIES = [
  'Inter', 'Source Serif 4', 'Iowan Old Style', 'Georgia', 'Garamond',
  'Palatino Linotype', 'Arial', 'Calibri', 'Cambria', 'Courier New',
]

export type FontCatalog = {
  families: readonly string[]
  source: 'system-catalog' | 'unverified'
}

export type FontFamilyOption = {
  value: string
  label: string
  description: string
  status: 'default' | 'listed' | 'unlisted' | 'unverified' | 'stack' | 'generic'
}

export const UNVERIFIED_FONT_CATALOG: FontCatalog = {
  families: CURATED_FONT_FAMILIES,
  source: 'unverified',
}

let cachedCatalog: FontCatalog | null = null
let pending: Promise<FontCatalog> | null = null

/** The native command currently enumerates catalog names, not resolved faces. */
export function normalizeFontCatalog(families: readonly string[]): FontCatalog {
  const unique = new Map<string, string>()
  for (const family of families) {
    const trimmed = family.trim()
    if (trimmed && !unique.has(trimmed.toLowerCase())) unique.set(trimmed.toLowerCase(), trimmed)
  }
  const normalized = [...unique.values()].sort((a, b) => a.localeCompare(b))
  // An empty response can also mean catalog discovery failed. Do not assert that
  // every font is unavailable, or promote the curated list to installed fonts.
  return normalized.length ? { families: normalized, source: 'system-catalog' } : UNVERIFIED_FONT_CATALOG
}

/** Preserve the exact authored value; menu labels never rewrite document marks. */
export function fontFamilyOptions(catalog: FontCatalog, authoredFamily = ''): FontFamilyOption[] {
  const listedFamilies = new Set(catalog.families.map(family => family.toLowerCase()))
  const defaults: FontFamilyOption = {
    value: '', label: 'Default (paragraph style)', status: 'default',
    description: 'Uses the paragraph font styling. No font family override is saved.',
  }
  const describe = (value: string): FontFamilyOption => {
    if (value.includes(',')) return {
      value, label: `${value} (Font stack)`, status: 'stack',
      description: 'Uses this ordered font stack. An available family or browser fallback is used.',
    }
    const canonical = value.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase()
    if (['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'].includes(canonical)) return {
      value, label: `${value} (Generic family)`, status: 'generic',
      description: 'Uses a font chosen by the browser for this generic family.',
    }
    const listed = catalog.source === 'system-catalog' && listedFamilies.has(canonical)
    if (listed) return {
      value, label: value, status: 'listed',
      description: 'Listed in this device’s font catalog. The rendered face can vary with weight, style and character coverage.',
    }
    if (catalog.source === 'system-catalog') return {
      value, label: `${value} (Not listed)`, status: 'unlisted',
      description: 'Not listed in this device’s font catalog. Another font may be used; the saved font choice is preserved.',
    }
    return {
      value, label: `${value} (Unverified)`, status: 'unverified',
      description: 'Font availability has not been checked on this device.',
    }
  }
  const options = [defaults]
  if (authoredFamily) options.push(describe(authoredFamily))
  const activeCanonical = authoredFamily.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase()
  for (const family of catalog.families) {
    if (family.toLowerCase() !== activeCanonical) options.push(describe(family))
  }
  return options
}

/** Discover catalog choices without asserting that a family or face was rendered. */
export async function discoverFontCatalog() {
  if (cachedCatalog) return cachedCatalog
  if (!pending) {
    pending = invoke<string[]>('list_system_fonts')
      .then((families) => {
        cachedCatalog = normalizeFontCatalog(families)
        return cachedCatalog
      })
      .catch(() => {
        cachedCatalog = UNVERIFIED_FONT_CATALOG
        return cachedCatalog
      })
      .finally(() => { pending = null })
  }
  return pending
}
