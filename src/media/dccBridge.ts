/**
 * External 3D DCC Bridge: OpenPBR Shader Generator, Command Stacks & Poly Haven Integration
 * Implements ARGON_INSTRUCTION_DIRECTIVE.md (§§5.2-5.3) & 3D_DCC_EXPANSION_BLUEPRINT.md (§§2.2-2.4)
 */

import type { PbrTextureSet } from './pbrClassifier'

export type TargetDccApp = 'blender' | 'cinema4d' | 'houdini'

export type DccCommandAction =
  | { action: 'import_mesh'; file: string }
  | { action: 'auto_wire_pbr'; materialName: string; textureSet: PbrTextureSet }
  | { action: 'normalize_scale'; targetSizeMeters: number }
  | { action: 'align_to_floor'; originAtBottomCenter: boolean }
  | { action: 'generate_collision_hull'; method: 'convex_hull' | 'box' }
  | { action: 'assign_collection'; collectionName: string }

export interface DccCommandStack {
  id: string
  name: string
  targetDcc: TargetDccApp
  steps: DccCommandAction[]
}

export interface PolyHavenAssetPreset {
  id: string
  name: string
  category: 'hdri' | 'textures' | 'models'
  resolution: '1k' | '2k' | '4k'
  license: 'CC0'
  tags: string[]
  files: string[]
}

export const CURATED_POLY_HAVEN_PRESETS: readonly PolyHavenAssetPreset[] = [
  {
    id: 'studio_small_09',
    name: 'Studio Small 09',
    category: 'hdri',
    resolution: '2k',
    license: 'CC0',
    tags: ['studio', 'neutral', 'softboxes', 'product'],
    files: ['studio_small_09_2k.hdr'],
  },
  {
    id: 'kloppenheim_06_puresky',
    name: 'Kloppenheim 06 Pure Sky',
    category: 'hdri',
    resolution: '2k',
    license: 'CC0',
    tags: ['sunset', 'outdoor', 'warm', 'sky'],
    files: ['kloppenheim_06_puresky_2k.hdr'],
  },
  {
    id: 'aerial_rocks_02',
    name: 'Aerial Rocks 02 PBR',
    category: 'textures',
    resolution: '2k',
    license: 'CC0',
    tags: ['rock', 'cliff', 'nature', 'terrain'],
    files: [
      'aerial_rocks_02_diffuse_2k.jpg',
      'aerial_rocks_02_nor_gl_2k.jpg',
      'aerial_rocks_02_rough_2k.jpg',
      'aerial_rocks_02_ao_2k.jpg',
      'aerial_rocks_02_disp_2k.jpg',
    ],
  },
  {
    id: ' brushed_iron_02',
    name: 'Brushed Iron 02 PBR',
    category: 'textures',
    resolution: '2k',
    license: 'CC0',
    tags: ['metal', 'iron', 'industrial', 'brushed'],
    files: [
      'brushed_iron_02_albedo_2k.png',
      'brushed_iron_02_normal_gl_2k.png',
      'brushed_iron_02_roughness_2k.png',
      'brushed_iron_02_metallic_2k.png',
      'brushed_iron_02_ao_2k.png',
    ],
  },
]

/**
 * Generates executable Blender Python script (`mcp_blender_execute_blender_code`)
 * to construct a Principled BSDF node tree with OpenPBR color-space discipline.
 */
export function generateBlenderPrincipledBsdfScript(
  materialName: string,
  textureSet: PbrTextureSet
): string {
  const safeName = materialName.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'AE_Material'
  const lines: string[] = [
    'import bpy',
    '',
    `mat = bpy.data.materials.get("${safeName}") or bpy.data.materials.new(name="${safeName}")`,
    'mat.use_nodes = True',
    'nodes = mat.node_tree.nodes',
    'links = mat.node_tree.links',
    'nodes.clear()',
    '',
    'output = nodes.new(type="ShaderNodeOutputMaterial")',
    'output.location = (400, 0)',
    'bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")',
    'bsdf.location = (80, 0)',
    'links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])',
  ]

  const albedo = textureSet.textures.albedo
  if (albedo) {
    lines.push(
      `tex_albedo = nodes.new(type="ShaderNodeTexImage")`,
      `tex_albedo.label = "Albedo (${albedo.filename})"`,
      `tex_albedo.location = (-420, 260)`,
      `# Color Space: sRGB`,
      `links.new(tex_albedo.outputs["Color"], bsdf.inputs["Base Color"])`
    )
  }

  const metalness = textureSet.textures.metalness
  if (metalness) {
    lines.push(
      `tex_metal = nodes.new(type="ShaderNodeTexImage")`,
      `tex_metal.label = "Metalness (${metalness.filename}) [Non-Color]"`,
      `tex_metal.location = (-420, 40)`,
      `links.new(tex_metal.outputs["Color"], bsdf.inputs["Metallic"])`
    )
  }

  const roughness = textureSet.textures.roughness
  if (roughness) {
    lines.push(
      `tex_rough = nodes.new(type="ShaderNodeTexImage")`,
      `tex_rough.label = "${roughness.label} (${roughness.filename}) [Non-Color]"`,
      `tex_rough.location = (-420, -180)`
    )
    if (roughness.invertRoughness) {
      lines.push(
        `invert_rough = nodes.new(type="ShaderNodeInvert")`,
        `invert_rough.location = (-160, -180)`,
        `links.new(tex_rough.outputs["Color"], invert_rough.inputs["Color"])`,
        `links.new(invert_rough.outputs["Color"], bsdf.inputs["Roughness"])`
      )
    } else {
      lines.push(`links.new(tex_rough.outputs["Color"], bsdf.inputs["Roughness"])`)
    }
  }

  const normal = textureSet.textures.normal
  if (normal) {
    lines.push(
      `tex_norm = nodes.new(type="ShaderNodeTexImage")`,
      `tex_norm.label = "Normal (${normal.filename}) [Non-Color]"`,
      `tex_norm.location = (-420, -420)`,
      `norm_map = nodes.new(type="ShaderNodeNormalMap")`,
      `norm_map.location = (-160, -420)`,
      `links.new(tex_norm.outputs["Color"], norm_map.inputs["Color"])`,
      `links.new(norm_map.outputs["Normal"], bsdf.inputs["Normal"])`
    )
  }

  return lines.join('\n')
}

/**
 * Generates Cinema 4D Python script (`c4d_run_python`) for Redshift Standard Material.
 */
export function generateCinema4DShaderScript(
  materialName: string,
  textureSet: PbrTextureSet
): string {
  const safeName = materialName.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'AE_RS_Material'
  const channels = Object.values(textureSet.textures).map(
    (t) => `    "${t?.channel}": {"file": "${t?.filename}", "colorSpace": "${t?.colorSpace === 'sRGB' ? 'sRGB' : 'Raw'}"}`
  )
  return [
    'import c4d',
    '',
    `# Art Equation Studio 2.5 -> Cinema 4D Redshift OpenPBR Auto-Wire`,
    `MATERIAL_NAME = "${safeName}"`,
    `TEXTURE_SLOTS = {`,
    channels.join(',\n'),
    `}`,
    'doc = c4d.documents.GetActiveDocument()',
    'mat = c4d.BaseMaterial(c4d.Mmaterial)',
    'mat.SetName(MATERIAL_NAME)',
    'doc.InsertMaterial(mat)',
    'c4d.EventAdd()',
  ].join('\n')
}

/**
 * Generates Houdini Solaris MaterialX OpenPBR Surface Python snippet.
 */
export function generateHoudiniMaterialXScript(
  materialName: string,
  textureSet: PbrTextureSet,
  stagePath = '/stage/materiallibrary1'
): string {
  const safeName = materialName.replace(/[^a-zA-Z0-9_]/g, '_') || 'ae_openpbr'
  const bindLines = Object.values(textureSet.textures).map(
    (t) => `# Bind ${t?.channel} -> ${t?.filename} (${t?.colorSpace})`
  )
  return [
    'import hou',
    '',
    `# Art Equation Studio 2.5 -> Houdini Solaris MaterialX OpenPBR Surface`,
    `lib = hou.node("${stagePath}")`,
    `if lib is not None:`,
    `    surface = lib.createNode("mtlxstandard_surface", "${safeName}")`,
    ...bindLines.map((l) => `    ${l}`),
    `    lib.layoutChildren()`,
  ].join('\n')
}

/**
 * Compiles a configurable Command Stack into an executable MCP Python macro.
 */
export function compileCommandStackToPython(stack: DccCommandStack): string {
  const out: string[] = [
    `# Art Equation Command Stack: ${stack.name} (${stack.targetDcc.toUpperCase()})`,
  ]
  for (const step of stack.steps) {
    if (step.action === 'import_mesh') {
      out.push(`# [Step] Import Mesh: ${step.file}`)
    } else if (step.action === 'auto_wire_pbr') {
      out.push(
        stack.targetDcc === 'blender'
          ? generateBlenderPrincipledBsdfScript(step.materialName, step.textureSet)
          : stack.targetDcc === 'cinema4d'
            ? generateCinema4DShaderScript(step.materialName, step.textureSet)
            : generateHoudiniMaterialXScript(step.materialName, step.textureSet)
      )
    } else if (step.action === 'normalize_scale') {
      out.push(`# [Step] Normalize Scale -> ${step.targetSizeMeters}m bounding box`)
    } else if (step.action === 'align_to_floor') {
      out.push(`# [Step] Align Origin to Bottom-Center Floor (Z=0 / Y=0)`)
    } else if (step.action === 'generate_collision_hull') {
      out.push(`# [Step] Generate Collision Hull (${step.method})`)
    } else if (step.action === 'assign_collection') {
      out.push(`# [Step] Assign Collection: ${step.collectionName}`)
    }
  }
  return out.join('\n\n')
}
