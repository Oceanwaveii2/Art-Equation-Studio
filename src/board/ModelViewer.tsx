import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useRef, useState, useCallback, type DragEvent, type ChangeEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import {
  buildPbrTextureSet,
  classifyPbrFilename,
  CORE_PBR_CHANNELS,
  type PbrChannelKind,
  type PbrTextureSet,
} from '../media/pbrClassifier'
import {
  generateBlenderPrincipledBsdfScript,
  generateCinema4DShaderScript,
  generateHoudiniMaterialXScript,
  type TargetDccApp,
} from '../media/dccBridge'
import './ModelViewer.css'

type ModelViewerProps = {
  source: string
  extension: string
  title: string
}

export type ShadingMode = 'pbr' | 'clay' | 'normals' | 'uv-grid'
export type LightingPreset = 'studio' | 'sunset' | 'noir' | 'flat'
export type CameraPreset = 'perspective' | 'front' | 'top' | 'right'

export interface ModelGeometryStats {
  triangles: number
  vertices: number
  meshes: number
  materials: number
}

const LIGHTING_PRESETS: Record<
  LightingPreset,
  {
    label: string
    bg: string
    hemiSky: string
    hemiGround: string
    hemiIntensity: number
    keyColor: string
    keyIntensity: number
    keyPos: [number, number, number]
    rimColor: string
    rimIntensity: number
    rimPos: [number, number, number]
  }
> = {
  studio: {
    label: 'Studio',
    bg: '#10141a',
    hemiSky: '#d8e8ff',
    hemiGround: '#1a202b',
    hemiIntensity: 2.2,
    keyColor: '#fff0df',
    keyIntensity: 2.3,
    keyPos: [4, 6, 5],
    rimColor: '#75d8ff',
    rimIntensity: 1.2,
    rimPos: [-5, 2, -4],
  },
  sunset: {
    label: 'Sunset',
    bg: '#181118',
    hemiSky: '#ff9e6d',
    hemiGround: '#241528',
    hemiIntensity: 1.8,
    keyColor: '#ff7b3d',
    keyIntensity: 2.8,
    keyPos: [6, 3, 4],
    rimColor: '#7c5cff',
    rimIntensity: 1.5,
    rimPos: [-4, 4, -5],
  },
  noir: {
    label: 'Noir',
    bg: '#08090c',
    hemiSky: '#8fa4b8',
    hemiGround: '#050608',
    hemiIntensity: 0.65,
    keyColor: '#ffffff',
    keyIntensity: 3.1,
    keyPos: [2, 7, 2],
    rimColor: '#38bdf8',
    rimIntensity: 2.0,
    rimPos: [-6, 1, -3],
  },
  flat: {
    label: 'Flat',
    bg: '#161b22',
    hemiSky: '#ffffff',
    hemiGround: '#d0d7de',
    hemiIntensity: 3.2,
    keyColor: '#ffffff',
    keyIntensity: 0.4,
    keyPos: [0, 5, 5],
    rimColor: '#ffffff',
    rimIntensity: 0.2,
    rimPos: [0, -5, -5],
  },
}

function createProceduralUvCheckerTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cellX = Math.floor(x / 8)
      const cellY = Math.floor(y / 8)
      const isEven = (cellX + cellY) % 2 === 0
      const idx = (y * size + x) * 4
      if (isEven) {
        data[idx] = 228
        data[idx + 1] = 234
        data[idx + 2] = 242
        data[idx + 3] = 255
      } else {
        data[idx] = 42
        data[idx + 1] = 56
        data[idx + 2] = 74
        data[idx + 3] = 255
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 4)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function computeGeometryStats(object: THREE.Object3D): ModelGeometryStats {
  let triangles = 0
  let vertices = 0
  let meshes = 0
  const materialSet = new Set<THREE.Material>()

  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    meshes += 1
    const pos = mesh.geometry.attributes.position
    if (pos) vertices += pos.count
    if (mesh.geometry.index) {
      triangles += Math.floor(mesh.geometry.index.count / 3)
    } else if (pos) {
      triangles += Math.floor(pos.count / 3)
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mats.forEach((m) => {
      if (m) materialSet.add(m)
    })
  })

  return {
    triangles,
    vertices,
    meshes,
    materials: materialSet.size,
  }
}

function inspectObjectPbrChannels(object: THREE.Object3D): Partial<Record<PbrChannelKind, string>> {
  const detected: Partial<Record<PbrChannelKind, string>> = {}
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial
      if (!std) continue
      if (std.map && !detected.albedo) detected.albedo = std.map.name || 'Embedded Albedo'
      if (std.normalMap && !detected.normal) detected.normal = std.normalMap.name || 'Embedded Normal'
      if (std.roughnessMap && !detected.roughness) detected.roughness = std.roughnessMap.name || 'Embedded Roughness'
      if (std.metalnessMap && !detected.metalness) detected.metalness = std.metalnessMap.name || 'Embedded Metalness'
      if (std.aoMap && !detected.ao) detected.ao = std.aoMap.name || 'Embedded AO'
    }
  })
  return detected
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) return
      Object.values(material as THREE.Material & Record<string, unknown>).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose()
      })
      material.dispose()
    })
  })
}

function frameObject(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  preset: CameraPreset = 'perspective'
) {
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const largestSide = Math.max(size.x, size.y, size.z, 0.1)
  object.position.sub(center)
  const distance = largestSide * 1.75
  if (preset === 'front') {
    camera.position.set(0, 0, distance * 1.25)
  } else if (preset === 'top') {
    camera.position.set(0, distance * 1.35, 0.001)
  } else if (preset === 'right') {
    camera.position.set(distance * 1.25, 0, 0)
  } else {
    camera.position.set(distance, distance * 0.7, distance)
  }
  camera.near = Math.max(largestSide / 100, 0.01)
  camera.far = Math.max(largestSide * 100, 100)
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
}

export function ModelViewer({ source, extension, title }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const textureInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [turntable, setTurntable] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [shadingMode, setShadingMode] = useState<ShadingMode>('pbr')
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('studio')
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('perspective')
  const [showPbrDrawer, setShowPbrDrawer] = useState(false)
  const [stats, setStats] = useState<ModelGeometryStats>({
    triangles: 0,
    vertices: 0,
    meshes: 0,
    materials: 0,
  })
  const [pbrSet, setPbrSet] = useState<PbrTextureSet>(() => buildPbrTextureSet([]))
  const [bridgeMessage, setBridgeMessage] = useState('')

  const turntableRef = useRef(false)
  const wireframeRef = useRef(false)
  const showGridRef = useRef(true)

  const stateRefs = useRef<{
    loadedObject?: THREE.Object3D
    scene?: THREE.Scene
    camera?: THREE.PerspectiveCamera
    renderer?: THREE.WebGLRenderer
    controls?: OrbitControls
    grid?: THREE.GridHelper
    hemiLight?: THREE.HemisphereLight
    keyLight?: THREE.DirectionalLight
    rimLight?: THREE.DirectionalLight
    originalMaterials?: Map<THREE.Mesh, THREE.Material | THREE.Material[]>
    clayMaterial?: THREE.MeshStandardMaterial
    normalMaterial?: THREE.MeshNormalMaterial
    uvGridMaterial?: THREE.MeshBasicMaterial
    uvTexture?: THREE.DataTexture
    existingChannels?: Partial<Record<PbrChannelKind, string>>
    customFiles?: Array<{ name: string; url?: string }>
    invalidate?: () => void
  }>({})

  const applyShadingToLoadedObject = useCallback((mode: ShadingMode, wire: boolean) => {
    const {
      loadedObject,
      originalMaterials,
      clayMaterial,
      normalMaterial,
      uvGridMaterial,
      invalidate,
    } = stateRefs.current
    if (!loadedObject || !originalMaterials) return

    loadedObject.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      if (mode === 'clay' && clayMaterial) {
        clayMaterial.wireframe = wire
        mesh.material = clayMaterial
      } else if (mode === 'normals' && normalMaterial) {
        normalMaterial.wireframe = wire
        mesh.material = normalMaterial
      } else if (mode === 'uv-grid' && uvGridMaterial) {
        uvGridMaterial.wireframe = wire
        mesh.material = uvGridMaterial
      } else {
        const orig = originalMaterials.get(mesh)
        if (orig) {
          mesh.material = orig
          const mats = Array.isArray(orig) ? orig : [orig]
          mats.forEach((m) => {
            if (m && 'wireframe' in m) (m as unknown as { wireframe: boolean }).wireframe = wire
          })
        }
      }
    })
    invalidate?.()
  }, [])

  const handleResetView = useCallback(() => {
    const { loadedObject, camera, controls, invalidate } = stateRefs.current
    if (loadedObject && camera && controls) {
      setCameraPreset('perspective')
      frameObject(loadedObject, camera, controls, 'perspective')
      invalidate?.()
    }
  }, [])

  const handleSelectCameraPreset = useCallback((preset: CameraPreset) => {
    const { loadedObject, camera, controls, invalidate } = stateRefs.current
    setCameraPreset(preset)
    if (loadedObject && camera && controls) {
      frameObject(loadedObject, camera, controls, preset)
      invalidate?.()
    }
  }, [])

  const handleSelectShadingMode = useCallback(
    (mode: ShadingMode) => {
      setShadingMode(mode)
      applyShadingToLoadedObject(mode, wireframeRef.current)
    },
    [applyShadingToLoadedObject]
  )

  const handleSelectLighting = useCallback((preset: LightingPreset) => {
    setLightingPreset(preset)
    const cfg = LIGHTING_PRESETS[preset]
    const { scene, hemiLight, keyLight, rimLight, invalidate } = stateRefs.current
    if (scene) scene.background = new THREE.Color(cfg.bg)
    if (hemiLight) {
      hemiLight.color.set(cfg.hemiSky)
      hemiLight.groundColor.set(cfg.hemiGround)
      hemiLight.intensity = cfg.hemiIntensity
    }
    if (keyLight) {
      keyLight.color.set(cfg.keyColor)
      keyLight.intensity = cfg.keyIntensity
      keyLight.position.set(...cfg.keyPos)
    }
    if (rimLight) {
      rimLight.color.set(cfg.rimColor)
      rimLight.intensity = cfg.rimIntensity
      rimLight.position.set(...cfg.rimPos)
    }
    invalidate?.()
  }, [])

  const handleToggleTurntable = useCallback(() => {
    const next = !turntableRef.current
    turntableRef.current = next
    setTurntable(next)
    if (next) stateRefs.current.invalidate?.()
  }, [])

  const handleToggleWireframe = useCallback(() => {
    const next = !wireframeRef.current
    wireframeRef.current = next
    setWireframe(next)
    applyShadingToLoadedObject(shadingMode, next)
  }, [applyShadingToLoadedObject, shadingMode])

  const handleToggleGrid = useCallback(() => {
    const next = !showGridRef.current
    showGridRef.current = next
    setShowGrid(next)
    if (stateRefs.current.grid) {
      stateRefs.current.grid.visible = next
      stateRefs.current.invalidate?.()
    }
  }, [])

  const handleExportSnapshot = useCallback(() => {
    const { renderer, scene, camera } = stateRefs.current
    if (!renderer || !scene || !camera) return
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `${(title || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-viewport.png`
    link.click()
    setBridgeMessage('Viewport PNG snapshot exported')
  }, [title])

  const wireTextureFiles = useCallback(
    (fileList: FileList | File[]) => {
      const { loadedObject, originalMaterials, invalidate } = stateRefs.current
      if (!loadedObject || !originalMaterials) return

      const loader = new THREE.TextureLoader()
      const incoming: Array<{ name: string; url: string }> = []

      Array.from(fileList).forEach((file) => {
        const classified = classifyPbrFilename(file.name)
        if (!classified) return
        const objectUrl = URL.createObjectURL(file)
        incoming.push({ name: file.name, url: objectUrl })

        loader.load(objectUrl, (texture) => {
          texture.name = file.name
          texture.colorSpace =
            classified.colorSpace === 'sRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace
          if (classified.channel === 'normal' && classified.normalConvention === 'directx') {
            texture.repeat.y = -1
          }
          texture.needsUpdate = true

          for (const orig of originalMaterials.values()) {
            const mats = Array.isArray(orig) ? orig : [orig]
            for (const m of mats) {
              const std = m as THREE.MeshStandardMaterial
              if (!std || !('roughness' in std)) continue
              if (classified.channel === 'albedo') {
                std.map = texture
                std.color.set('#ffffff')
              } else if (classified.channel === 'normal') {
                std.normalMap = texture
              } else if (classified.channel === 'roughness') {
                std.roughnessMap = texture
                std.roughness = 1.0
              } else if (classified.channel === 'metalness') {
                std.metalnessMap = texture
                std.metalness = 1.0
              } else if (classified.channel === 'ao') {
                std.aoMap = texture
              } else if (classified.channel === 'emissive') {
                std.emissiveMap = texture
                std.emissive.set('#ffffff')
              } else if (classified.channel === 'displacement') {
                std.displacementMap = texture
              }
              std.needsUpdate = true
            }
          }
          invalidate?.()
        })
      })

      if (incoming.length > 0) {
        const merged = [...(stateRefs.current.customFiles || []), ...incoming]
        stateRefs.current.customFiles = merged
        const nextSet = buildPbrTextureSet(merged, stateRefs.current.existingChannels)
        setPbrSet(nextSet)
        setShadingMode('pbr')
        applyShadingToLoadedObject('pbr', wireframeRef.current)
        setBridgeMessage(`Auto-wired ${incoming.length} PBR texture map${incoming.length === 1 ? '' : 's'}`)
      }
    },
    [applyShadingToLoadedObject]
  )

  const handleDropTextures = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.files?.length) return
      event.preventDefault()
      event.stopPropagation()
      wireTextureFiles(event.dataTransfer.files)
    },
    [wireTextureFiles]
  )

  const handleTextureInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) {
        wireTextureFiles(event.target.files)
        event.target.value = ''
      }
    },
    [wireTextureFiles]
  )

  const handleCopyDccScript = useCallback(
    (dcc: TargetDccApp) => {
      const matName = title || pbrSet.materialName || 'AE_Asset'
      const script =
        dcc === 'blender'
          ? generateBlenderPrincipledBsdfScript(matName, pbrSet)
          : dcc === 'cinema4d'
            ? generateCinema4DShaderScript(matName, pbrSet)
            : generateHoudiniMaterialXScript(matName, pbrSet)
      void navigator.clipboard?.writeText(script)
      setBridgeMessage(`Copied ${dcc.toUpperCase()} OpenPBR shader script to clipboard`)
    },
    [pbrSet, title]
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let frameId = 0
    let loadedObject: THREE.Object3D | undefined
    const scene = new THREE.Scene()
    const presetCfg = LIGHTING_PRESETS.studio
    scene.background = new THREE.Color(presetCfg.bg)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10_000)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minDistance = 0.05
    controls.maxDistance = 100_000

    const hemiLight = new THREE.HemisphereLight(
      presetCfg.hemiSky,
      presetCfg.hemiGround,
      presetCfg.hemiIntensity
    )
    scene.add(hemiLight)
    const key = new THREE.DirectionalLight(presetCfg.keyColor, presetCfg.keyIntensity)
    key.position.set(...presetCfg.keyPos)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.DirectionalLight(presetCfg.rimColor, presetCfg.rimIntensity)
    rim.position.set(...presetCfg.rimPos)
    scene.add(rim)
    const grid = new THREE.GridHelper(20, 20, '#40515e', '#26313b')
    grid.position.y = -0.001
    grid.visible = showGridRef.current
    scene.add(grid)

    const uvTexture = createProceduralUvCheckerTexture()
    const clayMaterial = new THREE.MeshStandardMaterial({
      color: '#c87d65',
      roughness: 0.42,
      metalness: 0.04,
    })
    const normalMaterial = new THREE.MeshNormalMaterial()
    const uvGridMaterial = new THREE.MeshBasicMaterial({ map: uvTexture })
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()

    stateRefs.current = {
      scene,
      camera,
      renderer,
      controls,
      grid,
      hemiLight,
      keyLight: key,
      rimLight: rim,
      originalMaterials,
      clayMaterial,
      normalMaterial,
      uvGridMaterial,
      uvTexture,
      customFiles: [],
    }

    // One queued frame at a time. OrbitControls emits change while damping;
    // once it settles there is no idle animation loop or GPU redraw.
    const render = () => {
      frameId = 0
      if (cancelled) return
      let needsNextFrame = false
      if (turntableRef.current && loadedObject) {
        loadedObject.rotation.y += 0.015
        needsNextFrame = true
      }
      const changed = controls.update()
      renderer.render(scene, camera)
      if (changed || needsNextFrame) invalidate()
    }
    const invalidate = () => {
      if (!cancelled && !frameId) frameId = requestAppFrame(render)
    }
    stateRefs.current.invalidate = invalidate

    controls.addEventListener('change', invalidate)
    const resize = () => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const finish = (object: THREE.Object3D) => {
      if (cancelled) {
        disposeObject(object)
        return
      }
      object.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (!mesh.material) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: '#b7c9d8',
            roughness: 0.72,
            metalness: 0.05,
          })
        }
        originalMaterials.set(mesh, mesh.material)
        if (wireframeRef.current) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach((m) => {
            if (m && 'wireframe' in m) (m as unknown as { wireframe: boolean }).wireframe = true
          })
        }
      })
      loadedObject = object
      stateRefs.current.loadedObject = object
      const existingChannels = inspectObjectPbrChannels(object)
      stateRefs.current.existingChannels = existingChannels
      setStats(computeGeometryStats(object))
      setPbrSet(buildPbrTextureSet([], existingChannels))
      scene.add(object)
      frameObject(object, camera, controls, 'perspective')
      setStatus('ready')
      invalidate()
    }
    const fail = (reason: unknown) => {
      if (cancelled) return
      const isGltf = extension.toLowerCase() === 'gltf'
      setError(
        isGltf
          ? 'This GLTF needs sidecar data or textures. Import a self-contained GLB, or keep the GLTF and its companion files together for the next compatibility pass.'
          : `Could not open this 3D file: ${String(reason)}`
      )
      setStatus('error')
    }

    setStatus('loading')
    setError('')
    const type = extension.toLowerCase()
    if (type === 'obj') {
      const basePath = source.slice(0, source.lastIndexOf('/') + 1)
      void fetch(source)
        .then((response) => response.text())
        .then((text) => {
          const material = text.match(/^\s*mtllib\s+(.+)$/m)?.[1]?.trim()
          if (!material) return new OBJLoader().load(source, finish, undefined, fail)
          const mtl = new MTLLoader()
          mtl.setResourcePath(basePath)
          mtl.load(
            `${basePath}${material.replaceAll('\\', '/')}`,
            (materials) => {
              materials.preload()
              const obj = new OBJLoader()
              obj.setMaterials(materials)
              obj.load(source, finish, undefined, (reason) =>
                new OBJLoader().load(source, finish, undefined, () => fail(reason))
              )
            },
            undefined,
            () => new OBJLoader().load(source, finish, undefined, fail)
          )
        })
        .catch(() => new OBJLoader().load(source, finish, undefined, fail))
    } else if (type === 'glb' || type === 'gltf') {
      new GLTFLoader().load(source, (result) => finish(result.scene), undefined, fail)
    } else {
      fail('Unsupported model type')
    }

    invalidate()
    return () => {
      cancelled = true
      cancelAppFrame(frameId)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      if (loadedObject) disposeObject(loadedObject)
      clayMaterial.dispose()
      normalMaterial.dispose()
      uvGridMaterial.dispose()
      uvTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      stateRefs.current = {}
    }
  }, [extension, source])

  return (
    <div
      className="model-viewer"
      onPointerDown={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDrop={handleDropTextures}
      title="Drag to orbit · scroll to zoom · right-drag to pan · drop PBR texture maps to auto-wire"
    >
      <div ref={hostRef} className="model-viewer-canvas" aria-label={`${title} 3D preview`} />
      {status === 'loading' && <div className="model-viewer-status">Loading 3D…</div>}
      {status === 'error' && <div className="model-viewer-status model-viewer-error">{error}</div>}
      {status === 'ready' && (
        <>
          <div className="model-viewer-hud" aria-label="3D geometry statistics">
            <span>
              <strong>{stats.triangles.toLocaleString()}</strong> tris
            </span>
            <span>
              <strong>{stats.vertices.toLocaleString()}</strong> verts
            </span>
            <span>
              <strong>{stats.meshes}</strong> mesh{stats.meshes === 1 ? '' : 'es'}
            </span>
            <span>
              <strong>{stats.materials}</strong> mat{stats.materials === 1 ? '' : 's'}
            </span>
          </div>

          <div className="model-viewer-toolbar" role="toolbar" aria-label="3D model controls">
            <select
              aria-label="Diagnostic shading mode"
              title="Diagnostic shading mode (PBR, Clay Matcap, Normals, UV Checker)"
              value={shadingMode}
              onChange={(e) => handleSelectShadingMode(e.target.value as ShadingMode)}
            >
              <option value="pbr">PBR Lit</option>
              <option value="clay">Clay Matcap</option>
              <option value="normals">Normals RGB</option>
              <option value="uv-grid">UV Checker</option>
            </select>
            <select
              aria-label="Viewport lighting preset"
              title="Lighting environment preset"
              value={lightingPreset}
              onChange={(e) => handleSelectLighting(e.target.value as LightingPreset)}
            >
              <option value="studio">Studio</option>
              <option value="sunset">Sunset</option>
              <option value="noir">Noir</option>
              <option value="flat">Flat</option>
            </select>
            <select
              aria-label="Camera angle preset"
              title="Camera angle preset"
              value={cameraPreset}
              onChange={(e) => handleSelectCameraPreset(e.target.value as CameraPreset)}
            >
              <option value="perspective">3/4 View</option>
              <option value="front">Front</option>
              <option value="top">Top</option>
              <option value="right">Right</option>
            </select>
            <button type="button" title="Reset camera view" onClick={handleResetView}>
              ⟲ Reset
            </button>
            <button
              type="button"
              className={turntable ? 'active' : ''}
              title="Toggle turntable auto-rotation"
              onClick={handleToggleTurntable}
            >
              ⟳ Turntable
            </button>
            <button
              type="button"
              className={wireframe ? 'active' : ''}
              title="Toggle wireframe display"
              onClick={handleToggleWireframe}
            >
              ⬡ Wireframe
            </button>
            <button
              type="button"
              className={showGrid ? 'active' : ''}
              title="Toggle ground grid"
              onClick={handleToggleGrid}
            >
              ▦ Grid
            </button>
            <button
              type="button"
              className={showPbrDrawer ? 'active' : ''}
              title="Toggle PBR Texture Channel Tracker & Kiosk Auto-Wiring"
              aria-expanded={showPbrDrawer}
              onClick={() => setShowPbrDrawer((open) => !open)}
            >
              ◈ PBR ({pbrSet.activeCount}/{CORE_PBR_CHANNELS.length})
            </button>
            <button
              type="button"
              title="Export 1-click PNG viewport snapshot"
              onClick={handleExportSnapshot}
            >
              📷 Snapshot
            </button>
          </div>

          {showPbrDrawer && (
            <aside className="model-viewer-pbr-drawer" aria-label="PBR Texture Channel Tracker">
              <header className="model-viewer-pbr-header">
                <strong>PBR Channels ({pbrSet.materialName})</strong>
                <button
                  type="button"
                  onClick={() => textureInputRef.current?.click()}
                  title="Auto-wire texture maps by suffix (_diffuse, _nor, _rough, _metal, _ao)"
                >
                  + Auto-Wire Maps
                </button>
                <input
                  ref={textureInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleTextureInputChange}
                />
              </header>
              <ul className="model-viewer-pbr-list">
                {pbrSet.channels.map((ch) => (
                  <li key={ch.channel} className="model-viewer-pbr-slot">
                    <span className="pbr-slot-name">
                      {ch.label} <small>({ch.colorSpace})</small>
                    </span>
                    <span
                      className={`pbr-status-badge ${ch.active ? 'active' : 'missing'}`}
                      title={ch.textureName || 'Drop texture map to wire'}
                    >
                      {ch.active ? `[Active] ${ch.textureName}` : '[Missing]'}
                    </span>
                  </li>
                ))}
              </ul>
              <footer className="model-viewer-pbr-bridge">
                <span>DCC Bridge:</span>
                <button type="button" onClick={() => handleCopyDccScript('blender')}>
                  Blender BSDF
                </button>
                <button type="button" onClick={() => handleCopyDccScript('cinema4d')}>
                  C4D Redshift
                </button>
                <button type="button" onClick={() => handleCopyDccScript('houdini')}>
                  Houdini MtlX
                </button>
              </footer>
              {bridgeMessage && <div className="model-viewer-bridge-msg">{bridgeMessage}</div>}
            </aside>
          )}

          <div className="model-viewer-hint">Orbit · zoom · pan</div>
        </>
      )}
    </div>
  )
}
