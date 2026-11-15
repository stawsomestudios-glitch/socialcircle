import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { TITLES } from './places.js'
import {
  AREA_BOX,
  COLORS,
  boxOf,
  buildCity,
  buildLines,
  buildOutlineIndex,
  buildPoints,
  buildWaterAreas,
  cameraFor,
  extrudeBuilding,
  findBuilding,
  flatFootprint,
  isInsideMap,
  linesToPairs,
  titlePosition,
  toLocal,
} from './cityGeometry.js'
import { PLANE, makeTexture, paintTexture } from './heat.js'

const FOV = 40
const CLICK_MARGIN_M = 1000 // how much area to show around whatever you click
const CITY_MARGIN_M = 1000
const AREA_MARGIN_M = 150
const RIVER_WIDTH_PX = 3
const STREAM_WIDTH_PX = 1.5
const WATER_POINT_PX = 6
const FLIGHT_MS = 1100

const allPoints = (rings) => rings.flat()
// Long names are cut short on the map so they don't cover other titles. The panel shows them in full.
const short = (text) => (text.length > 24 ? `${text.slice(0, 22).trim()}…` : text)

// A title on a small white plate that always faces the camera and keeps its size.
function Title({ position, anchor, children }) {
  const { texture, scale } = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const font = '40px Righteous, sans-serif'
    context.font = font
    canvas.width = Math.ceil(context.measureText(children).width) + 36
    canvas.height = 64
    context.font = font
    context.fillStyle = COLORS.white
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = COLORS.black
    context.lineWidth = 4
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
    context.fillStyle = COLORS.black
    context.textBaseline = 'middle'
    context.fillText(children, 18, 34)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const height = 0.021
    return { texture, scale: [(height * canvas.width) / canvas.height, height, 1] }
  }, [children])

  return (
    <sprite position={position} scale={scale} center={anchor} renderOrder={10}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  )
}

// Everything with water, drawn first so the buildings and outlines sit on top of it.
function Water({ water }) {
  const areas = useMemo(() => buildWaterAreas(water.areas), [water])
  const rivers = useMemo(() => linesToPairs(water.rivers, 0.1), [water])
  const streams = useMemo(() => linesToPairs(water.streams, 0.1), [water])
  const points = useMemo(() => buildPoints(water.points), [water])
  const dot = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    context.fillStyle = COLORS.white
    context.beginPath()
    context.arc(32, 32, 30, 0, Math.PI * 2)
    context.fill()
    return new THREE.CanvasTexture(canvas)
  }, [])

  return (
    <>
      <mesh geometry={areas} position={[0, 0.05, 0]} renderOrder={-1}>
        <meshBasicMaterial color={COLORS.water} depthWrite={false} />
      </mesh>
      <Line segments points={rivers} color={COLORS.water} lineWidth={RIVER_WIDTH_PX} depthWrite={false} renderOrder={-1} />
      <Line segments points={streams} color={COLORS.water} lineWidth={STREAM_WIDTH_PX} depthWrite={false} renderOrder={-1} />
      <points geometry={points} position={[0, 0.1, 0]} renderOrder={-1}>
        <pointsMaterial
          color={COLORS.water}
          map={dot}
          alphaTest={0.5}
          size={WATER_POINT_PX}
          sizeAttenuation={false}
          depthWrite={false}
        />
      </points>
    </>
  )
}

// The heat map on the ground, under the buildings. It repaints whenever the time changes.
function Heat({ grid, max }) {
  const invalidate = useThree((state) => state.invalidate)
  const texture = useMemo(makeTexture, [])

  useEffect(() => {
    paintTexture(texture, grid, max)
    invalidate()
  }, [texture, grid, max, invalidate])

  return (
    <mesh position={[PLANE.x, 0.15, PLANE.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[PLANE.width, PLANE.depth]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}

// Glides the camera to a new view. Grabbing the map stops the glide.
function CameraFlight({ flight }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)
  const size = useThree((state) => state.size)

  useEffect(() => {
    if (!flight || !controls) return undefined
    const goal = cameraFor(flight.box, flight.margin, size.width / size.height, FOV)
    const fromPosition = camera.position.clone()
    const fromTarget = controls.target.clone()
    const toPosition = new THREE.Vector3(...goal.position)
    const toTarget = new THREE.Vector3(...goal.target)
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    let frame = null

    const step = (now) => {
      const progress = instant ? 1 : Math.min(1, (now - started) / FLIGHT_MS)
      const eased = progress * progress * (3 - 2 * progress)
      camera.position.lerpVectors(fromPosition, toPosition, eased)
      controls.target.lerpVectors(fromTarget, toTarget, eased)
      controls.update()
      invalidate()
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    const stop = () => cancelAnimationFrame(frame)
    frame = requestAnimationFrame(step)
    controls.addEventListener('start', stop)
    return () => {
      stop()
      controls.removeEventListener('start', stop)
    }
  }, [flight, controls, camera, invalidate, size])

  return null
}

function City({ data, grid, max, spots, selected, onSelect, flyTo }) {
  const buildings = useMemo(() => {
    const outside = data.context.features.filter((f) => f.properties.kind === 'building')
    return [...data.buildings.features, ...outside].filter(isInsideMap)
  }, [data])
  const city = useMemo(() => buildCity(buildings), [buildings])
  const outlines = useMemo(() => buildLines(data.city.buildings), [data])
  const findOutline = useMemo(() => buildOutlineIndex(data.city.buildings), [data])
  const boundary = useMemo(
    () => data.city.boundary.map((ring) => ring.map((point) => {
      const [x, z] = toLocal(point)
      return [x, 0.5, z]
    })),
    [data],
  )
  const selectedShape = useMemo(() => {
    if (selected?.kind === 'building') return extrudeBuilding(selected.feature)
    if (selected?.kind === 'outline') return flatFootprint(selected.ring)
    return null
  }, [selected])

  function pick(event, feature) {
    if (event.delta > 4) return
    event.stopPropagation()
    const point = [event.point.x, event.point.z]
    if (feature) {
      onSelect({ kind: 'building', feature })
      flyTo(boxOf(feature.geometry.coordinates[0]), CLICK_MARGIN_M)
    } else {
      const ring = findOutline(point)
      if (ring) {
        onSelect({ kind: 'outline', ring })
        flyTo(boxOf(ring), CLICK_MARGIN_M)
      } else {
        onSelect(null)
      }
    }
  }

  return (
    <>
      {/* An invisible sheet that catches clicks on the outlined buildings. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={(event) => pick(event, null)}>
        <planeGeometry args={[200000, 200000]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      <Water water={data.water} />
      <Heat grid={grid} max={max} />

      {boundary.map((points, index) => (
        <Line key={index} points={points} color={COLORS.black} lineWidth={2.5} />
      ))}
      <lineSegments geometry={outlines} position={[0, 0.2, 0]}>
        <lineBasicMaterial color={COLORS.black} />
      </lineSegments>

      <mesh
        geometry={city.geometry}
        onClick={(event) => pick(event, findBuilding(city.ranges, event.faceIndex))}
      >
        <meshBasicMaterial vertexColors />
      </mesh>

      {selectedShape && (
        <mesh geometry={selectedShape} position={[0, selected.kind === 'outline' ? 0.4 : 0, 0]}>
          <meshBasicMaterial
            color={COLORS.selected}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}

      {spots.map((spot, index) => (
        <Title key={`${index}-${spot.name}`} position={[spot.x, 3, spot.z]} anchor={[0.5, 0.5]}>
          {`${index + 1} · ${short(spot.name.toLowerCase())}`}
        </Title>
      ))}

      {TITLES.map((title) => (
        <Title key={title.text} position={titlePosition(buildings, title)} anchor={title.anchor}>
          {title.text}
        </Title>
      ))}
    </>
  )
}

export default function CityScene({ data, grid, max, spots, selected, onSelect, viewRequest }) {
  const [flight, setFlight] = useState(null)
  const cityBox = useMemo(() => boxOf(allPoints(data.city.boundary)), [data])
  const start = useRef(cameraFor(cityBox, CITY_MARGIN_M, window.innerWidth / window.innerHeight, FOV))

  useEffect(() => {
    if (!viewRequest) return
    setFlight(
      viewRequest.box
        ? { box: viewRequest.box, margin: viewRequest.margin }
        : viewRequest.name === 'area'
          ? { box: AREA_BOX, margin: AREA_MARGIN_M }
          : { box: cityBox, margin: CITY_MARGIN_M },
    )
  }, [viewRequest, cityBox])

  return (
    <Canvas
      flat
      frameloop="demand"
      camera={{ position: start.current.position, fov: FOV, near: 20, far: 80000 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[COLORS.white]} />
      <City
        data={data}
        grid={grid}
        max={max}
        spots={spots}
        selected={selected}
        onSelect={onSelect}
        flyTo={(box, margin) => setFlight({ box, margin })}
      />
      <OrbitControls
        makeDefault
        target={start.current.target}
        screenSpacePanning={false}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={40}
        maxDistance={40000}
      />
      <CameraFlight flight={flight} />
    </Canvas>
  )
}
