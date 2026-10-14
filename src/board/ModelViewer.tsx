import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import './ModelViewer.css'

type ModelViewerProps = {
  source: string
  extension: string
  title: string
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      Object.values(material as THREE.Material & Record<string, unknown>).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose()
      })
      material.dispose()
    })
  })
}

function frameObject(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const largestSide = Math.max(size.x, size.y, size.z, 0.1)
  object.position.sub(center)
  const distance = largestSide * 1.75
  camera.position.set(distance, distance * 0.7, distance)
  camera.near = Math.max(largestSide / 100, 0.01)
  camera.far = Math.max(largestSide * 100, 100)
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
}

export function ModelViewer({ source, extension, title }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [turntable, setTurntable] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)

  const turntableRef = useRef(false)
  const wireframeRef = useRef(false)
  const showGridRef = useRef(true)

  const stateRefs = useRef<{
    loadedObject?: THREE.Object3D
    camera?: THREE.PerspectiveCamera
    controls?: OrbitControls
    grid?: THREE.GridHelper
    invalidate?: () => void
  }>({})

  const handleResetView = useCallback(() => {
    const { loadedObject, camera, controls, invalidate } = stateRefs.current
    if (loadedObject && camera && controls) {
      frameObject(loadedObject, camera, controls)
      invalidate?.()
    }
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

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let frameId = 0
    let loadedObject: THREE.Object3D | undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#10141a')
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10_000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
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
    scene.add(new THREE.HemisphereLight('#d8e8ff', '#1a202b', 2.2))
    const key = new THREE.DirectionalLight('#fff0df', 2.3)
    key.position.set(4, 6, 5)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.DirectionalLight('#75d8ff', 1.2)
    rim.position.set(-5, 2, -4)
    scene.add(rim)
    const grid = new THREE.GridHelper(20, 20, '#40515e', '#26313b')
    grid.position.y = -0.001
    grid.visible = showGridRef.current
    scene.add(grid)

    stateRefs.current = { camera, controls, grid }

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
        if (!mesh.material) mesh.material = new THREE.MeshStandardMaterial({ color: '#b7c9d8', roughness: 0.72, metalness: 0.05 })
        if (wireframeRef.current) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach(m => { if (m && 'wireframe' in m) (m as unknown as { wireframe: boolean }).wireframe = true })
        }
      })
      loadedObject = object
      stateRefs.current.loadedObject = object
      scene.add(object)
      frameObject(object, camera, controls)
      setStatus('ready')
      invalidate()
    }
    const fail = (reason: unknown) => {
      if (cancelled) return
      const isGltf = extension.toLowerCase() === 'gltf'
      setError(isGltf ? 'This GLTF needs sidecar data or textures. Import a self-contained GLB, or keep the GLTF and its companion files together for the next compatibility pass.' : `Could not open this 3D file: ${String(reason)}`)
      setStatus('error')
    }

    setStatus('loading')
    setError('')
    const type = extension.toLowerCase()
    if (type === 'obj') {
      const basePath = source.slice(0, source.lastIndexOf('/') + 1)
      void fetch(source).then((response) => response.text()).then((text) => {
        const material = text.match(/^\s*mtllib\s+(.+)$/m)?.[1]?.trim()
        if (!material) return new OBJLoader().load(source, finish, undefined, fail)
        const mtl = new MTLLoader()
        mtl.setResourcePath(basePath)
        mtl.load(`${basePath}${material.replaceAll('\\', '/')}`, (materials) => {
          materials.preload()
          const obj = new OBJLoader()
          obj.setMaterials(materials)
          obj.load(source, finish, undefined, (reason) => new OBJLoader().load(source, finish, undefined, () => fail(reason)))
        }, undefined, () => new OBJLoader().load(source, finish, undefined, fail))
      }).catch(() => new OBJLoader().load(source, finish, undefined, fail))
    }
    else if (type === 'glb' || type === 'gltf') new GLTFLoader().load(source, (result) => finish(result.scene), undefined, fail)
    else fail('Unsupported model type')

    invalidate()
    return () => {
      cancelled = true
      cancelAppFrame(frameId)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      if (loadedObject) disposeObject(loadedObject)
      renderer.dispose()
      renderer.domElement.remove()
      stateRefs.current = {}
    }
  }, [extension, source])

  return (
    <div className="model-viewer" onPointerDown={(event) => event.stopPropagation()} title="Drag to orbit · scroll to zoom · right-drag to pan">
      <div ref={hostRef} className="model-viewer-canvas" aria-label={`${title} 3D preview`} />
      {status === 'loading' && <div className="model-viewer-status">Loading 3D…</div>}
      {status === 'error' && <div className="model-viewer-status model-viewer-error">{error}</div>}
      {status === 'ready' && (
        <>
          <div className="model-viewer-toolbar" role="toolbar" aria-label="3D model controls">
            <button type="button" title="Reset camera view" onClick={handleResetView}>⟲ Reset</button>
            <button type="button" className={turntable ? 'active' : ''} title="Toggle turntable auto-rotation" onClick={handleToggleTurntable}>⟳ Turntable</button>
            <button type="button" className={wireframe ? 'active' : ''} title="Toggle wireframe display" onClick={handleToggleWireframe}>⬡ Wireframe</button>
            <button type="button" className={showGrid ? 'active' : ''} title="Toggle ground grid" onClick={handleToggleGrid}>▦ Grid</button>
          </div>
          <div className="model-viewer-hint">Orbit · zoom · pan</div>
        </>
      )}
    </div>
  )
}
