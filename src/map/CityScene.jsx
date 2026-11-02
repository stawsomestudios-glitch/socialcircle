import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { M18_AREA, MAIN_BUILDING } from './places.js'
import {
  M18_COLOR,
  GLOW_COLOR,
  WATER_LINE_COLOR,
  buildCity,
  buildGlow,
  buildLand,
  buildStreets,
  extrudeBuilding,
  findBuilding,
  labelPosition,
  toLocal,
} from './cityGeometry.js'

// Starts south of the campus, looking north, so north is at the top of the screen.
const START_CAMERA = [-170, 300, 520]
export const GLOW_REACH_M = 25

// A text label drawn on a small picture that always faces the camera and keeps its size.
function Label({ position, children }) {
  const { texture, scale } = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const font = '600 36px system-ui, sans-serif'
    context.font = font
    canvas.width = Math.ceil(context.measureText(children).width) + 40
    canvas.height = 60
    context.font = font
    context.fillStyle = 'rgba(28, 28, 28, 0.88)'
    context.beginPath()
    context.roundRect(0, 0, canvas.width, canvas.height, 10)
    context.fill()
    context.fillStyle = '#fff'
    context.textBaseline = 'middle'
    context.fillText(children, 20, 32)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const height = 0.021
    return { texture, scale: [(height * canvas.width) / canvas.height, height, 1] }
  }, [children])

  return (
    <sprite position={position} scale={scale} renderOrder={10}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  )
}

function City({ data, selected, onSelect }) {
  const context = useMemo(() => {
    const ofKind = (kind) => data.context.features.filter((f) => f.properties.kind === kind)
    return {
      buildings: ofKind('building'),
      land: buildLand(ofKind('land')),
      roads: buildStreets(ofKind('road')),
      waterways: buildStreets(ofKind('waterway')),
    }
  }, [data])
  const city = useMemo(
    () => buildCity([...data.buildings.features, ...context.buildings], data.highlights),
    [data, context],
  )
  const land = useMemo(() => buildLand(data.plots.features), [data])
  const glow = useMemo(
    () => buildGlow([...data.buildings.features, ...context.buildings], data.highlights, GLOW_REACH_M),
    [data, context],
  )
  const streets = useMemo(() => buildStreets(data.streets.features), [data])
  const selectedGeometry = useMemo(() => (selected ? extrudeBuilding(selected) : null), [selected])
  const mainLabel = useMemo(
    () => labelPosition(data.buildings.features, MAIN_BUILDING.buildingIds[0]),
    [data],
  )
  const sunTarget = useMemo(() => new THREE.Object3D(), [])

  const [west, south, east, north] = data.kit.bbox
  const [x0, z0] = toLocal([west, north])
  const [x1, z1] = toLocal([east, south])
  const center = [(x0 + x1) / 2, (z0 + z1) / 2]
  const size = [x1 - x0, z1 - z0]

  const [outerWest, outerSouth, outerEast, outerNorth] = data.context.bbox
  const [ox0, oz0] = toLocal([outerWest, outerNorth])
  const [ox1, oz1] = toLocal([outerEast, outerSouth])
  const outerCenter = [(ox0 + ox1) / 2, (oz0 + oz1) / 2]
  const outerSize = [ox1 - ox0, oz1 - oz0]
  const [m18x, m18z] = toLocal(M18_AREA.center)

  return (
    <>
      <ambientLight intensity={1.05} />
      <primitive object={sunTarget} position={[outerCenter[0], 0, outerCenter[1]]} />
      <directionalLight
        castShadow
        intensity={1.9}
        position={[outerCenter[0] - 700, 1300, outerCenter[1] + 650]}
        target={sunTarget}
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-2100}
        shadow-camera-right={2100}
        shadow-camera-top={2100}
        shadow-camera-bottom={-2100}
        shadow-camera-far={4500}
        shadow-normalBias={0.6}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[outerCenter[0], -0.9, outerCenter[1]]} receiveShadow>
        <planeGeometry args={outerSize} />
        <meshStandardMaterial color="#efece3" />
      </mesh>
      <mesh geometry={context.land} position={[0, -0.6, 0]} receiveShadow>
        <meshStandardMaterial vertexColors />
      </mesh>
      <lineSegments geometry={context.roads} position={[0, -0.3, 0]}>
        <lineBasicMaterial color="#b9b5ab" />
      </lineSegments>
      <lineSegments geometry={context.waterways} position={[0, -0.3, 0]}>
        <lineBasicMaterial color={WATER_LINE_COLOR} />
      </lineSegments>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], 0, center[1]]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color="#efece3" />
      </mesh>
      <mesh geometry={land} position={[0, 0.3, 0]} receiveShadow>
        <meshStandardMaterial vertexColors />
      </mesh>
      <lineSegments geometry={streets} position={[0, 0.6, 0]}>
        <lineBasicMaterial color="#9b978e" />
      </lineSegments>

      <mesh geometry={glow} position={[0, 0.8, 0]} renderOrder={1}>
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.13} depthWrite={false} />
      </mesh>

      <mesh
        geometry={city.geometry}
        castShadow
        receiveShadow
        onClick={(event) => {
          if (event.delta > 4) return
          event.stopPropagation()
          onSelect(findBuilding(city.ranges, event.faceIndex))
        }}
      >
        <meshStandardMaterial vertexColors />
      </mesh>

      {selectedGeometry && (
        <mesh geometry={selectedGeometry}>
          <meshStandardMaterial
            color="#2b2b2b"
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[m18x, 0.9, m18z]}>
        <ringGeometry args={[M18_AREA.radius - 1.5, M18_AREA.radius, 96]} />
        <meshBasicMaterial color={M18_COLOR} />
      </mesh>

      <Label position={mainLabel}>{MAIN_BUILDING.label}</Label>
      <Label position={[m18x, 28, m18z]}>{M18_AREA.label}</Label>
    </>
  )
}

export default function CityScene({ data, selected, onSelect, resetSignal }) {
  const controls = useRef()

  useEffect(() => {
    if (resetSignal) controls.current?.reset()
  }, [resetSignal])

  return (
    <Canvas
      shadows="percentage"
      frameloop="demand"
      camera={{ position: START_CAMERA, fov: 40, near: 5, far: 9000 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#dde6ea']} />
      <City data={data} selected={selected} onSelect={onSelect} />
      <OrbitControls
        ref={controls}
        makeDefault
        target={[0, 0, 0]}
        screenSpacePanning={false}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={40}
        maxDistance={4500}
      />
    </Canvas>
  )
}
