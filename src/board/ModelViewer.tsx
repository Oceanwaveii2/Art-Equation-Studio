import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import './ModelViewer.css'

export type ModelViewerProps = {
  source: string
  extension: string
  title: string
}

export type ShadingMode = 'pbr' | 'clay' | 'normals' | 'uv'
export type LightingPreset = 'studio' | 'sunset' | 'noir' | 'flat'
export type CameraPreset = 'perspective' | 'front' | 'top' | 'right'

export type TrackedMaterialSlot = {
  materialName: string
  hasAlbedo: boolean
  hasNormal: boolean
  hasRoughness: boolean
  hasMetalness: boolean
  hasAo: boolean
}

export type ModelMeshStats = {
  triangles: number
  vertices: number
  meshes: number
  materials: number
}

function createUvGridTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#1e242d'
    ctx.fillRect(0, 0, size, size)
    const cells = 16
    const step = size / cells
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        if ((i + j) % 2 === 0) {
          ctx.fillStyle = '#323c4a'
          ctx.fillRect(i * step, j * step, step, step)
        }
      }
    }
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 4)
  return texture
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
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

function frameObject(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls, preset: CameraPreset = 'perspective') {
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const largestSide = Math.max(size.x, size.y, size.z, 0.1)
  object.position.sub(center)

  const distance = largestSide * 1.85
  camera.near = Math.max(largestSide / 200, 0.005)
  camera.far = Math.max(largestSide * 200, 200)

  switch (preset) {
    case 'front':
      camera.position.set(0, 0, distance * 1.4)
      break
    case 'top':
      camera.position.set(0, distance * 1.5, 0.0001)
      break
    case 'right':
      camera.position.set(distance * 1.4, 0, 0)
      break
    case 'perspective':
    default:
      camera.position.set(distance, distance * 0.72, distance)
      break
  }

  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
}

export function ModelViewer({ source, extension, title }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [turntable, setTurntable] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [shadingMode, setShadingMode] = useState<ShadingMode>('pbr')
  const [lighting, setLighting] = useState<LightingPreset>('studio')
  const [showTexturesDrawer, setShowTexturesDrawer] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState<ModelMeshStats>({ triangles: 0, vertices: 0, meshes: 0, materials: 0 })
  const [trackedMaterials, setTrackedMaterials] = useState<TrackedMaterialSlot[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const turntableRef = useRef(false)
  const wireframeRef = useRef(false)
  const showGridRef = useRef(true)
  const shadingModeRef = useRef<ShadingMode>('pbr')
  const originalMaterialsMap = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map())

  const stateRefs = useRef<{
    renderer?: THREE.WebGLRenderer
    scene?: THREE.Scene
    loadedObject?: THREE.Object3D
    camera?: THREE.PerspectiveCamera
    controls?: OrbitControls
    grid?: THREE.GridHelper
    keyLight?: THREE.DirectionalLight
    rimLight?: THREE.DirectionalLight
    hemiLight?: THREE.HemisphereLight
    uvTexture?: THREE.CanvasTexture
    invalidate?: () => void
  }>({})

  const showToast = useCallback((msg: string) => {
    setStatusMessage(msg)
    setTimeout(() => setStatusMessage(null), 3200)
  }, [])

  const handleResetView = useCallback(() => {
    const { loadedObject, camera, controls, invalidate } = stateRefs.current
    if (loadedObject && camera && controls) {
      frameObject(loadedObject, camera, controls, 'perspective')
      invalidate?.()
    }
  }, [])

  const handleSetCameraPreset = useCallback((preset: CameraPreset) => {
    const { loadedObject, camera, controls, invalidate } = stateRefs.current
    if (loadedObject && camera && controls) {
      frameObject(loadedObject, camera, controls, preset)
      invalidate?.()
      showToast(`Camera: ${preset.toUpperCase()}`)
    }
  }, [showToast])

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
    stateRefs.current.loadedObject?.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((m) => {
        if (m && 'wireframe' in m) (m as unknown as { wireframe: boolean }).wireframe = next
      })
    })
    stateRefs.current.invalidate?.()
  }, [])

  const handleToggleGrid = useCallback(() => {
    const next = !showGridRef.current
    showGridRef.current = next
    setShowGrid(next)
    if (stateRefs.current.grid) {
      stateRefs.current.grid.visible = next
      stateRefs.current.invalidate?.()
    }
  }, [])

  const applyShadingMode = useCallback((mode: ShadingMode) => {
    shadingModeRef.current = mode
    setShadingMode(mode)
    const { loadedObject, uvTexture, invalidate } = stateRefs.current
    if (!loadedObject) return

    loadedObject.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return

      if (mode === 'pbr') {
        const orig = originalMaterialsMap.current.get(mesh)
        if (orig) mesh.material = orig
      } else if (mode === 'clay') {
        mesh.material = new THREE.MeshStandardMaterial({
          color: '#c99b82',
          roughness: 0.88,
          metalness: 0.02,
          wireframe: wireframeRef.current
        })
      } else if (mode === 'normals') {
        mesh.material = new THREE.MeshNormalMaterial({
          wireframe: wireframeRef.current
        })
      } else if (mode === 'uv') {
        mesh.material = new THREE.MeshBasicMaterial({
          map: uvTexture,
          wireframe: wireframeRef.current
        })
      }
    })
    invalidate?.()
  }, [])

  const applyLightingPreset = useCallback((preset: LightingPreset) => {
    setLighting(preset)
    const { hemiLight, keyLight, rimLight, invalidate } = stateRefs.current
    if (!hemiLight || !keyLight || !rimLight) return

    switch (preset) {
      case 'sunset':
        hemiLight.color.set('#ffe5c4')
        hemiLight.groundColor.set('#24334a')
        hemiLight.intensity = 1.6
        keyLight.color.set('#ff9f43')
        keyLight.intensity = 3.0
        keyLight.position.set(6, 4, 3)
        rimLight.color.set('#74b9ff')
        rimLight.intensity = 1.5
        break
      case 'noir':
        hemiLight.color.set('#3a4750')
        hemiLight.groundColor.set('#0b0e14')
        hemiLight.intensity = 0.5
        keyLight.color.set('#ffffff')
        keyLight.intensity = 3.8
        keyLight.position.set(5, 7, 3)
        rimLight.color.set('#00d2d3')
        rimLight.intensity = 2.4
        break
      case 'flat':
        hemiLight.color.set('#ffffff')
        hemiLight.groundColor.set('#888888')
        hemiLight.intensity = 3.2
        keyLight.color.set('#ffffff')
        keyLight.intensity = 0.6
        rimLight.color.set('#ffffff')
        rimLight.intensity = 0.4
        break
      case 'studio':
      default:
        hemiLight.color.set('#d8e8ff')
        hemiLight.groundColor.set('#1a202b')
        hemiLight.intensity = 2.2
        keyLight.color.set('#fff0df')
        keyLight.intensity = 2.3
        keyLight.position.set(4, 6, 5)
        rimLight.color.set('#75d8ff')
        rimLight.intensity = 1.2
        break
    }
    invalidate?.()
    showToast(`Lighting: ${preset.toUpperCase()}`)
  }, [showToast])

  const handleTakeSnapshot = useCallback(() => {
    const { renderer, scene, camera } = stateRefs.current
    if (!renderer || !scene || !camera) return
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')
    const link = document.createElement('a')
    link.download = `3D_Snapshot_${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`
    link.href = dataUrl
    link.click()
    showToast('Snapshot exported as high-res PNG!')
  }, [title, showToast])

  const handleTextureUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    const { loadedObject, invalidate } = stateRefs.current
    if (!loadedObject) return

    let assignedCount = 0
    const loader = new THREE.TextureLoader()

    Array.from(files).forEach((file) => {
      const name = file.name.toLowerCase()
      const url = URL.createObjectURL(file)
      const texture = loader.load(url, () => {
        invalidate?.()
      })

      let targetChannel: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' = 'map'
      if (name.includes('normal') || name.includes('_nor') || name.includes('_nrm')) {
        targetChannel = 'normalMap'
        texture.colorSpace = THREE.NoColorSpace
      } else if (name.includes('rough') || name.includes('_rgh') || name.includes('gloss')) {
        targetChannel = 'roughnessMap'
        texture.colorSpace = THREE.NoColorSpace
      } else if (name.includes('metal') || name.includes('_met')) {
        targetChannel = 'metalnessMap'
        texture.colorSpace = THREE.NoColorSpace
      } else if (name.includes('ao') || name.includes('ambient') || name.includes('occ')) {
        targetChannel = 'aoMap'
        texture.colorSpace = THREE.NoColorSpace
      } else {
        targetChannel = 'map'
        texture.colorSpace = THREE.SRGBColorSpace
      }

      loadedObject.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat[targetChannel] = texture
            if (targetChannel === 'normalMap') mat.normalScale = new THREE.Vector2(1, 1)
            if (targetChannel === 'roughnessMap') mat.roughness = 1.0
            if (targetChannel === 'metalnessMap') mat.metalness = 1.0
            mat.needsUpdate = true
            assignedCount++
          }
        })
      })
    })

    invalidate?.()
    showToast(`Smart Texture Wiring: ${files.length} texture(s) linked to materials!`)
    event.target.value = ''
  }, [showToast])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let frameId = 0
    let loadedObject: THREE.Object3D | undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#10141a')
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10_000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    host.appendChild(renderer.domElement)

    const uvTexture = createUvGridTexture()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minDistance = 0.05
    controls.maxDistance = 100_000

    const hemiLight = new THREE.HemisphereLight('#d8e8ff', '#1a202b', 2.2)
    scene.add(hemiLight)
    const keyLight = new THREE.DirectionalLight('#fff0df', 2.3)
    keyLight.position.set(4, 6, 5)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 1024
    keyLight.shadow.mapSize.height = 1024
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight('#75d8ff', 1.2)
    rimLight.position.set(-5, 2, -4)
    scene.add(rimLight)

    const grid = new THREE.GridHelper(24, 24, '#40515e', '#26313b')
    grid.position.y = -0.001
    grid.visible = showGridRef.current
    scene.add(grid)

    stateRefs.current = { renderer, scene, camera, controls, grid, keyLight, rimLight, hemiLight, uvTexture }

    const render = () => {
      frameId = 0
      if (cancelled) return
      let needsNextFrame = false
      if (turntableRef.current && loadedObject) {
        loadedObject.rotation.y += 0.012
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

      let triCount = 0
      let vertCount = 0
      let meshCount = 0
      const matMap = new Map<string, TrackedMaterialSlot>()

      object.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        meshCount++
        mesh.castShadow = true
        mesh.receiveShadow = true

        if (mesh.geometry) {
          triCount += mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3
          vertCount += mesh.geometry.attributes.position.count
        }

        if (!mesh.material) {
          mesh.material = new THREE.MeshStandardMaterial({ color: '#b7c9d8', roughness: 0.72, metalness: 0.05 })
        }

        originalMaterialsMap.current.set(mesh, mesh.material)

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((mat) => {
          if (!mat) return
          const stdMat = mat as THREE.MeshStandardMaterial
          const matName = mat.name || `Material_${matMap.size + 1}`
          if (!matMap.has(matName)) {
            matMap.set(matName, {
              materialName: matName,
              hasAlbedo: !!stdMat.map,
              hasNormal: !!stdMat.normalMap,
              hasRoughness: !!stdMat.roughnessMap,
              hasMetalness: !!stdMat.metalnessMap,
              hasAo: !!stdMat.aoMap
            })
          }
          if (wireframeRef.current && 'wireframe' in mat) {
            (mat as unknown as { wireframe: boolean }).wireframe = true
          }
        })
      })

      setStats({
        triangles: Math.round(triCount),
        vertices: Math.round(vertCount),
        meshes: meshCount,
        materials: matMap.size
      })
      setTrackedMaterials(Array.from(matMap.values()))

      loadedObject = object
      stateRefs.current.loadedObject = object
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
          ? 'This GLTF references external companion textures. Use the Smart Texture drop to link missing maps, or import a self-contained GLB.'
          : `Could not open 3D model: ${String(reason)}`
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
              obj.load(source, finish, undefined, (reason) => new OBJLoader().load(source, finish, undefined, () => fail(reason)))
            },
            undefined,
            () => new OBJLoader().load(source, finish, undefined, fail)
          )
        })
        .catch(() => new OBJLoader().load(source, finish, undefined, fail))
    } else if (type === 'glb' || type === 'gltf') {
      new GLTFLoader().load(source, (result) => finish(result.scene), undefined, fail)
    } else {
      fail(`Format '.${type}' requires background DCC conversion or companion pack`)
    }

    invalidate()
    return () => {
      cancelled = true
      cancelAppFrame(frameId)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      if (loadedObject) disposeObject(loadedObject)
      uvTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      originalMaterialsMap.current.clear()
      stateRefs.current = {}
    }
  }, [extension, source])

  return (
    <div className="model-viewer" onPointerDown={(event) => event.stopPropagation()} title="Drag to orbit · scroll to zoom · right-drag to pan">
      <div ref={hostRef} className="model-viewer-canvas" aria-label={`${title} 3D DCC Viewport`} />

      {statusMessage && <div className="model-viewer-toast">{statusMessage}</div>}

      {status === 'loading' && <div className="model-viewer-status">Loading 3D Object & Shaders…</div>}
      {status === 'error' && (
        <div className="model-viewer-status model-viewer-error">
          <p>{error}</p>
          <label className="dcc-button-file-label">
            📁 Relink Texture Pack
            <input type="file" multiple accept="image/*" onChange={handleTextureUpload} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* Main DCC Viewport Toolbar */}
          <div className="model-viewer-toolbar" role="toolbar" aria-label="3D DCC Viewport Tools">
            {/* Shading Mode Selector */}
            <div className="dcc-tool-group">
              <button
                type="button"
                className={shadingMode === 'pbr' ? 'active' : ''}
                title="PBR Shading (Full Lit Physical Materials)"
                onClick={() => applyShadingMode('pbr')}
              >
                PBR
              </button>
              <button
                type="button"
                className={shadingMode === 'clay' ? 'active' : ''}
                title="Clay Matcap Mode (Sculpting Form Inspection)"
                onClick={() => applyShadingMode('clay')}
              >
                Clay
              </button>
              <button
                type="button"
                className={shadingMode === 'normals' ? 'active' : ''}
                title="Surface Normal Vectors (RGB Diagnostic)"
                onClick={() => applyShadingMode('normals')}
              >
                Normals
              </button>
              <button
                type="button"
                className={shadingMode === 'uv' ? 'active' : ''}
                title="UV Grid Checkerboard (Distortion Analysis)"
                onClick={() => applyShadingMode('uv')}
              >
                UV
              </button>
            </div>

            <div className="dcc-separator" />

            {/* View & Lighting Toggles */}
            <div className="dcc-tool-group">
              <button
                type="button"
                className={lighting !== 'studio' ? 'active' : ''}
                title={`Lighting: ${lighting} (Click to cycle Studio / Sunset / Noir / Flat)`}
                onClick={() => {
                  const cycle: LightingPreset[] = ['studio', 'sunset', 'noir', 'flat']
                  const next = cycle[(cycle.indexOf(lighting) + 1) % cycle.length]
                  applyLightingPreset(next)
                }}
              >
                ☀ {lighting === 'studio' ? 'Light' : lighting}
              </button>
              <button type="button" className={wireframe ? 'active' : ''} title="Toggle Wireframe Overlay" onClick={handleToggleWireframe}>
                ⬡ Wire
              </button>
              <button type="button" className={showGrid ? 'active' : ''} title="Toggle Ground Grid" onClick={handleToggleGrid}>
                ▦ Grid
              </button>
              <button type="button" className={turntable ? 'active' : ''} title="Toggle Turntable Rotation" onClick={handleToggleTurntable}>
                ⟳ Spin
              </button>
            </div>

            <div className="dcc-separator" />

            {/* Camera Presets */}
            <div className="dcc-tool-group">
              <button type="button" title="Perspective 3/4 Camera Angle" onClick={() => handleSetCameraPreset('perspective')}>
                3/4
              </button>
              <button type="button" title="Front Camera Angle" onClick={() => handleSetCameraPreset('front')}>
                Front
              </button>
              <button type="button" title="Top Camera Angle" onClick={() => handleSetCameraPreset('top')}>
                Top
              </button>
            </div>

            <div className="dcc-separator" />

            {/* DCC Panels: Textures, Stats, Snapshot */}
            <div className="dcc-tool-group">
              <button
                type="button"
                className={showTexturesDrawer ? 'active' : ''}
                title="Track Materials & Auto-Wire PBR Textures"
                onClick={() => setShowTexturesDrawer((prev) => !prev)}
              >
                🎨 Textures ({trackedMaterials.length})
              </button>
              <button
                type="button"
                className={showStats ? 'active' : ''}
                title="View Polycount & Mesh Geometry Statistics"
                onClick={() => setShowStats((prev) => !prev)}
              >
                📊 Stats
              </button>
              <button type="button" title="Capture High-Res Viewport Snapshot to Disk" onClick={handleTakeSnapshot}>
                📷 Snapshot
              </button>
              <button type="button" title="Reset Viewport Camera" onClick={handleResetView}>
                ⟲
              </button>
            </div>
          </div>

          {/* Collapsible Materials & Texture Tracking Drawer (Kiosk Library 2.1 Pattern) */}
          {showTexturesDrawer && (
            <div className="dcc-drawer dcc-materials-drawer" role="region" aria-label="Texture & Material Tracking">
              <header className="dcc-drawer-header">
                <strong>Material & PBR Texture Tracker</strong>
                <button type="button" className="dcc-close-btn" onClick={() => setShowTexturesDrawer(false)}>
                  ✕
                </button>
              </header>
              <div className="dcc-materials-list">
                {trackedMaterials.map((mat) => (
                  <div key={mat.materialName} className="dcc-material-item">
                    <span className="dcc-mat-title">{mat.materialName}</span>
                    <div className="dcc-channel-badges">
                      <span className={`channel-badge ${mat.hasAlbedo ? 'active' : 'missing'}`}>Albedo</span>
                      <span className={`channel-badge ${mat.hasNormal ? 'active' : 'missing'}`}>Normal</span>
                      <span className={`channel-badge ${mat.hasRoughness ? 'active' : 'missing'}`}>Rough</span>
                      <span className={`channel-badge ${mat.hasMetalness ? 'active' : 'missing'}`}>Metal</span>
                      <span className={`channel-badge ${mat.hasAo ? 'active' : 'missing'}`}>AO</span>
                    </div>
                  </div>
                ))}
              </div>
              <footer className="dcc-drawer-footer">
                <label className="dcc-upload-label">
                  📁 Smart Auto-Wire PBR Maps (Drop Suffixes: _nor, _col, _rough)
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleTextureUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </footer>
            </div>
          )}

          {/* Polycount & Geometry Stats HUD */}
          {showStats && (
            <div className="dcc-stats-hud" role="region" aria-label="Mesh Statistics">
              <div className="dcc-stat-row">
                <span>Triangles:</span> <strong>{stats.triangles.toLocaleString()}</strong>
              </div>
              <div className="dcc-stat-row">
                <span>Vertices:</span> <strong>{stats.vertices.toLocaleString()}</strong>
              </div>
              <div className="dcc-stat-row">
                <span>Meshes:</span> <strong>{stats.meshes}</strong>
              </div>
              <div className="dcc-stat-row">
                <span>Materials:</span> <strong>{stats.materials}</strong>
              </div>
            </div>
          )}

          <div className="model-viewer-hint">Orbit · zoom · pan</div>
        </>
      )}
    </div>
  )
}
