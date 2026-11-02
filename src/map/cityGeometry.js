import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FOCUS, MAIN_BUILDING, MAP_BOUNDARY } from './places.js'

export const COLORS = {
  black: '#000000',
  white: '#ffffff',
  cobalt: '#0047ab',
  routeRed: '#d0021b',
  water: '#a9d8f2', // light baby blue
  selected: '#8a8a8a',
}

// Longitude and latitude to metres from the focus point. x is east, z is south.
const M_PER_LAT = 111320
const M_PER_LON = 111320 * Math.cos((FOCUS[1] * Math.PI) / 180)

export function toLocal([lon, lat]) {
  return [(lon - FOCUS[0]) * M_PER_LON, -(lat - FOCUS[1]) * M_PER_LAT]
}

const [WEST, SOUTH, EAST, NORTH] = MAP_BOUNDARY
const [BOUND_X0, BOUND_Z0] = toLocal([WEST, NORTH])
const [BOUND_X1, BOUND_Z1] = toLocal([EAST, SOUTH])

// The black map area, as [x0, z0, x1, z1].
export const AREA_BOX = [BOUND_X0, BOUND_Z0, BOUND_X1, BOUND_Z1]

// The smallest box around a list of longitude and latitude points, as [x0, z0, x1, z1].
export function boxOf(coordinates) {
  const points = coordinates.map(toLocal)
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
}

// Where the camera must sit to show a box with a margin around it, looking straight down
// with north at the top.
export function cameraFor(box, margin, aspect, fov) {
  const width = box[2] - box[0] + margin * 2
  const height = box[3] - box[1] + margin * 2
  const halfTan = Math.tan((fov * Math.PI) / 360)
  const distance = Math.max(height / (2 * halfTan), width / (2 * halfTan * aspect))
  const center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
  return { target: [center[0], 0, center[1]], position: [center[0], distance, center[1] + distance * 0.001] }
}

function centroid(feature) {
  const ring = feature.geometry.coordinates[0]
  const sum = ring.reduce((total, [lon, lat]) => [total[0] + lon, total[1] + lat], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length]
}

export function isInsideMap(feature) {
  const [lon, lat] = centroid(feature)
  return lon >= WEST && lon <= EAST && lat >= SOUTH && lat <= NORTH
}

export function placeOf(feature) {
  return MAIN_BUILDING.buildingIds.includes(String(feature.properties.id)) ? 'main' : null
}

const toShapePoints = (ring) =>
  ring.map((coord) => {
    const [x, z] = toLocal(coord)
    return new THREE.Vector2(x, -z)
  })

export function extrudeBuilding(feature) {
  const [outline, ...holes] = feature.geometry.coordinates
  const shape = new THREE.Shape(toShapePoints(outline))
  holes.forEach((hole) => shape.holes.push(new THREE.Path(toShapePoints(hole))))
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: feature.properties.height,
    bevelEnabled: false,
  })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

// A flat filled footprint, used to show which outlined building is selected.
export function flatFootprint(ring) {
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(toShapePoints(ring)))
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function paint(geometry, colorValue) {
  const color = new THREE.Color(colorValue)
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.deleteAttribute('uv')
  return geometry
}

// All buildings as one mesh, so orbiting stays smooth. `ranges` remembers which
// triangles belong to which building, so a click can find the building again.
export function buildCity(features) {
  const ranges = []
  let triangles = 0
  const parts = features.map((feature) => {
    const part = paint(extrudeBuilding(feature), placeOf(feature) ? COLORS.cobalt : COLORS.black)
    triangles += part.attributes.position.count / 3
    ranges.push({ end: triangles, feature })
    return part
  })
  return { geometry: mergeGeometries(parts), ranges }
}

export function findBuilding(ranges, triangle) {
  let low = 0
  let high = ranges.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (triangle < ranges[middle].end) high = middle
    else low = middle + 1
  }
  return ranges[low].feature
}

const lineGeometry = (positions) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

// Any number of lines, given as lists of longitude and latitude points, as one drawing.
export function buildLines(lines) {
  const positions = []
  lines.forEach((line) => {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = toLocal(line[i])
      const [bx, bz] = toLocal(line[i + 1])
      positions.push(ax, 0, az, bx, 0, bz)
    }
  })
  return lineGeometry(positions)
}

// Ponds and other water areas as one drawing. Each area is an outline, then any islands.
export function buildWaterAreas(areas) {
  return mergeGeometries(
    areas.map(([outline, ...islands]) => {
      const shape = new THREE.Shape(toShapePoints(outline))
      islands.forEach((island) => shape.holes.push(new THREE.Path(toShapePoints(island))))
      const geometry = new THREE.ShapeGeometry(shape)
      geometry.rotateX(-Math.PI / 2)
      return geometry
    }),
  )
}

// Lines as pairs of points, for drawing many of them at a set width on screen.
export function linesToPairs(lines, height) {
  const pairs = []
  lines.forEach((line) => {
    const points = line.map(toLocal)
    points.slice(1).forEach(([x, z], index) => {
      pairs.push([points[index][0], height, points[index][1]], [x, height, z])
    })
  })
  return pairs
}

// Springs, wells and fountains that are single points.
export function buildPoints(coordinates) {
  return lineGeometry(
    coordinates.flatMap((point) => {
      const [x, z] = toLocal(point)
      return [x, 0, z]
    }),
  )
}

export function distanceToLine([x, z], points) {
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
  }
  return best
}

function inRing([x, z], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const crosses = ring[i][1] > z !== ring[j][1] > z
    if (crosses && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside
  }
  return inside
}

// A quick way to find which outlined building a click landed in, among thousands.
export function buildOutlineIndex(rings) {
  const CELL = 200
  const grid = new Map()
  rings.forEach((ring) => {
    const local = ring.map(toLocal)
    const xs = local.map((p) => p[0])
    const zs = local.map((p) => p[1])
    const entry = { ring, local }
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) {
      for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) {
        const key = `${i},${j}`
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(entry)
      }
    }
  })
  return (point) =>
    (grid.get(`${Math.floor(point[0] / CELL)},${Math.floor(point[1] / CELL)}`) ?? []).find((entry) =>
      inRing(point, entry.local),
    )?.ring ?? null
}

// The point halfway along a route, where its label sits.
export function routeMiddle(coordinates) {
  const points = coordinates.map(toLocal)
  const lengths = points.slice(1).map(([x, z], i) => Math.hypot(x - points[i][0], z - points[i][1]))
  let left = lengths.reduce((total, length) => total + length, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] ? left / lengths[i] : 0
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, 3, points[i][1] + (points[i + 1][1] - points[i][1]) * t]
    }
    left -= lengths[i]
  }
  return [...points.at(-1), 3]
}

// A title sits above its building, or on the ground at a location.
export function titlePosition(features, { buildingId, location }) {
  if (location) {
    const [x, z] = toLocal(location)
    return [x, 3, z]
  }
  const feature = features.find((f) => String(f.properties.id) === buildingId)
  const [x, z] = toLocal(centroid(feature))
  return [x, feature.properties.height + 2, z]
}
