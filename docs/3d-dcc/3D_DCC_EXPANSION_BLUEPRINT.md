# 3D DCC Expansion Blueprint: Art Equation & Kiosk Library 2.1 Integration

**Target Architecture:** Art Equation Studio 2.5 / 2.6  
**Reference Specification:** [Kiosk Library 2.1](https://cgpress.org/archives/kiosk-library-2-1-released.html) (by Kiosk Software)  
**Scope:** Multi-DCC Visual Asset Bridge, Automated Shader Wiring, Command Stacks, and Live Studio Pipeline  

---

## 1. Executive Summary & Opportunity

Kiosk Library 2.1 introduces a lightweight, 100% offline-first digital asset management (DAM) and automated asset ingestion pipeline for 3D VFX artists across Blender, Cinema 4D, Autodesk Maya, Houdini, Unreal Engine 5, and 3ds Max. 

Art Equation Studio already features:
- A high-performance Vello GPU/CPU dual-engine canvas with spatial indexing.
- Retained card layout systems with reference boards, video scrubbers, and rich documents.
- Native Model-bundle / glTF 3D scene preview support.
- Fully wired Model Context Protocol (MCP) servers for **Blender**, **Cinema 4D**, **After Effects**, **DaVinci Resolve**, **Photoshop**, **Illustrator**, **Nuke**, and **Marvelous Designer**.

By integrating Kiosk Library 2.1's core design patterns—specifically its **OpenPBR / Standard Surface Auto-Wiring engine** and **Command Stacks (macro Python sequences)**—Art Equation expands from a 2D reference & document board into a **Unified 2D/3D Production Bridge Studio**.

```mermaid
flowchart LR
    AE[Art Equation Studio Canvas] -->|Drag Asset / Texture Pack| Bridge[Art Equation DCC Bridge]
    Bridge --> AutoWire[OpenPBR / Shader Auto-Wiring]
    Bridge --> CmdStack[Command Stack Execution]
    AutoWire --> Blender[Blender N-Panel / Eevee / Cycles]
    AutoWire --> C4D[Cinema 4D / Redshift / Octane]
    AutoWire --> Houdini[Houdini / Solaris / Karma USD]
    AutoWire --> UE[Unreal Engine 5 / Nanite]
    CmdStack -->|MCP Tools| AE_MCP[Automated Scene Assembly]
```

---

## 2. Key Architecture Pillars Inspired by Kiosk Library 2.1

### 2.1 100% Local-First Asset Hub & Smart Material Detection
- **Offline Indexing:** Assets reside in `projects/<project-id>/assets/originals/` with persistent UUIDs and local SQLite/JSON caches. Zero cloud lock-in.
- **Smart Suffix Matching:** Texture packs are automatically detected by filename semantics:
  - Base Color / Diffuse: `*_diffuse`, `*_albedo`, `*_col`, `*_basecolor`
  - Roughness / Glossiness: `*_roughness`, `*_rough`, `*_gloss` (with auto-inversion)
  - Normal: `*_normal`, `*_nor`, `*_nrm` (with OpenGL vs DirectX green channel detection)
  - Height / Displacement: `*_displacement`, `*_disp`, `*_height`
  - Metallic / Metalness: `*_metallic`, `*_metal`, `*_met`
  - Ambient Occlusion: `*_ao`, `*_ambient_occlusion`, `*_occ`
  - Emission: `*_emissive`, `*_emit`
  - Opacity / Alpha: `*_opacity`, `*_alpha`, `*_mask`

### 2.2 OpenPBR & Standard Surface Unified Shader Generator
Rather than requiring manual shader graph assembly in every DCC:
1. **Blender:** Generates Principled BSDF node network with non-color data set on utility maps and normal map nodes inserted automatically.
2. **Cinema 4D:** Constructs Redshift Standard Material or Octane Universal Material nodes with proper color spaces (ACEScg / sRGB).
3. **Houdini / Solaris:** Builds MaterialX OpenPBR Surface shaders compatible with Karma CPU/XPU and USD stages.
4. **Unreal Engine 5:** Generates Material Instance Dynamic (MID) linking texture parameters to master PBR shaders.

### 2.3 Command Stacks (Automated Python Macro Pipelines)
Kiosk Library 2.1's defining capability is **Command Stacks**—allowing technical directors and artists to chain Python commands that trigger immediately upon asset import.

Art Equation implements this via its native MCP integration:
```python
# Example Art Equation Command Stack for Blender Asset Drop
stack = [
    {"action": "import_mesh", "file": asset.source_path},
    {"action": "auto_wire_pbr", "material_name": asset.name, "textures": asset.texture_set},
    {"action": "apply_transform", "scale": [1.0, 1.0, 1.0], "align_to_floor": True},
    {"action": "assign_collection", "collection": "Props_Imported"}
]
```

### 2.4 Poly Haven & Public Repository Browser
- Embedded non-destructive client to search and stream CC0 HDRIs, PBR textures, and models directly onto canvas moodboards.
- Dragging an HDRI onto a canvas card creates an environment lighting preset that can be dispatched to Blender World nodes with one click.

---

## 3. Implementation Roadmap

| Milestone | Target | Capabilities |
| :--- | :--- | :--- |
| **Phase 1: Asset Classification** | v2.5.1 | Filename parser for PBR texture sets; 3D model inspector (OBJ, FBX, GLTF) with triangle count and texture references. |
| **Phase 2: Blender MCP Bridge** | v2.6.0 | Direct drag-and-drop from Art Equation board into Blender viewport via `mcp_blender_execute_blender_code`. Automated Principled BSDF graph setup. |
| **Phase 3: Command Stacks** | v2.6.2 | JSON-configurable action chains for asset post-processing (scale normalization, origin centering, UV checks). |
| **Phase 4: Cinema 4D & Houdini** | v2.7.0 | MaterialX export and Redshift shader network generation via C4D/Nuke MCP connections. |
