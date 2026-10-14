/**
 * Smart PBR Texture Suffix Classifier (Kiosk Library 2.1 Synthesis)
 * Implements ARGON_INSTRUCTION_DIRECTIVE.md (§5.1, §5.3.1) & 3D_DCC_EXPANSION_BLUEPRINT.md (§2.1)
 *
 * Automatically classifies texture roles, color spaces, normal-map handedness
 * (OpenGL vs DirectX), and glossiness auto-inversion from asset filenames.
 */

export type PbrChannelKind =
  | 'albedo'
  | 'normal'
  | 'roughness'
  | 'metalness'
  | 'ao'
  | 'displacement'
  | 'emissive'
  | 'opacity'

export type PbrColorSpace = 'sRGB' | 'Non-Color'

export type NormalMapConvention = 'opengl' | 'directx'

export interface ClassifiedPbrTexture {
  filename: string
  stem: string
  channel: PbrChannelKind
  label: string
  colorSpace: PbrColorSpace
  invertRoughness?: boolean
  normalConvention?: NormalMapConvention
  sourceUrl?: string
}

export interface PbrChannelStatus {
  channel: PbrChannelKind
  label: string
  active: boolean
  textureName?: string
  colorSpace: PbrColorSpace
  notes?: string
}

export interface PbrTextureSet {
  materialName: string
  textures: Partial<Record<PbrChannelKind, ClassifiedPbrTexture>>
  channels: PbrChannelStatus[]
  activeCount: number
  missingCount: number
}

export const CORE_PBR_CHANNELS: ReadonlyArray<{
  channel: PbrChannelKind
  label: string
  colorSpace: PbrColorSpace
}> = [
  { channel: 'albedo', label: 'Albedo / Base Color', colorSpace: 'sRGB' },
  { channel: 'normal', label: 'Normal Map', colorSpace: 'Non-Color' },
  { channel: 'roughness', label: 'Roughness', colorSpace: 'Non-Color' },
  { channel: 'metalness', label: 'Metalness', colorSpace: 'Non-Color' },
  { channel: 'ao', label: 'Ambient Occlusion', colorSpace: 'Non-Color' },
]

const CHANNEL_RULES: Array<{
  channel: PbrChannelKind
  label: string
  colorSpace: PbrColorSpace
  pattern: RegExp
  invertRoughness?: boolean
}> = [
  {
    channel: 'albedo',
    label: 'Albedo / Base Color',
    colorSpace: 'sRGB',
    pattern: /(?:^|[_\-.])(diffuse|albedo|basecolor|base_color|col|color|diff|alb)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'normal',
    label: 'Normal Map',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(normal|nor|nrm|norm|normal_gl|nor_gl|normal_dx|nor_dx|nrml)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'roughness',
    label: 'Roughness',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(roughness|rough|rgh)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'roughness',
    label: 'Glossiness (Auto-Invert → Roughness)',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(gloss|glossiness|gls|smoothness)(?:[_\-.]\d+k)?$/i,
    invertRoughness: true,
  },
  {
    channel: 'metalness',
    label: 'Metalness',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(metallic|metalness|metal|met|mtl)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'ao',
    label: 'Ambient Occlusion',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(ambient_occlusion|ambientocclusion|ao|occ|occlusion)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'displacement',
    label: 'Height / Displacement',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(displacement|disp|height|hgt|bump)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'emissive',
    label: 'Emission',
    colorSpace: 'sRGB',
    pattern: /(?:^|[_\-.])(emissive|emission|emit|glow)(?:[_\-.]\d+k)?$/i,
  },
  {
    channel: 'opacity',
    label: 'Opacity / Alpha',
    colorSpace: 'Non-Color',
    pattern: /(?:^|[_\-.])(opacity|alpha|mask|trans)(?:[_\-.]\d+k)?$/i,
  },
]

export function classifyPbrFilename(filename: string, sourceUrl?: string): ClassifiedPbrTexture | null {
  const cleanName = filename.split(/[\\/]/).pop() || filename
  const withoutExt = cleanName.replace(/\.[^.]+$/, '')

  for (const rule of CHANNEL_RULES) {
    const match = withoutExt.match(rule.pattern)
    if (match) {
      const stem = withoutExt.slice(0, match.index || withoutExt.length).replace(/[_\-.]+$/, '') || 'Material'
      const isDirectX = /(?:[_\-.])(dx|directx)(?:[_\-.]|$)/i.test(withoutExt)
      return {
        filename: cleanName,
        stem,
        channel: rule.channel,
        label: rule.label,
        colorSpace: rule.colorSpace,
        ...(rule.invertRoughness ? { invertRoughness: true } : {}),
        ...(rule.channel === 'normal'
          ? { normalConvention: isDirectX ? 'directx' : 'opengl' }
          : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      }
    }
  }
  return null
}

export function buildPbrTextureSet(
  files: ReadonlyArray<{ name: string; url?: string }>,
  existingChannels?: Partial<Record<PbrChannelKind, string>>
): PbrTextureSet {
  const textures: Partial<Record<PbrChannelKind, ClassifiedPbrTexture>> = {}
  let detectedStem = ''

  for (const file of files) {
    const classified = classifyPbrFilename(file.name, file.url)
    if (classified) {
      textures[classified.channel] = classified
      if (!detectedStem && classified.stem) detectedStem = classified.stem
    }
  }

  const channels: PbrChannelStatus[] = CORE_PBR_CHANNELS.map(({ channel, label, colorSpace }) => {
    const classified = textures[channel]
    const fallbackName = existingChannels?.[channel]
    const active = Boolean(classified || fallbackName)
    return {
      channel,
      label,
      active,
      textureName: classified?.filename || fallbackName,
      colorSpace,
      notes: classified?.invertRoughness
        ? 'Auto-inverted from Glossiness'
        : classified?.normalConvention === 'directx'
          ? 'DirectX normal (G-channel flip)'
          : classified?.normalConvention === 'opengl'
            ? 'OpenGL normal (+Y)'
            : undefined,
    }
  })

  const activeCount = channels.filter((c) => c.active).length
  return {
    materialName: detectedStem || 'PBR_Material',
    textures,
    channels,
    activeCount,
    missingCount: channels.length - activeCount,
  }
}
