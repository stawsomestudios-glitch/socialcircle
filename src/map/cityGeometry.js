import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FOCUS, M18_AREA, MAIN_BUILDING } from './places.js'

export const CATEGORY_COLORS = {
  bauhaus: '#e3b505',
  museum: '#7a4fb0',
  library: '#2b6cb8',
  cafe: '#e0559a',
  food: '#ef8a17',
  shop: '#4c9a5b',
}

// Every other building gets one of these, picked from its id so it never changes.
export const NEUTRAL_TONES = ['#d8cfbe', '#cfc4b0', '#c6b9a3', '#d3c6b4']

export const LAND_COLORS = {
  recreation: '#cfe0bd',
  cemetery: '#c3d3b8',
  square: '#e8dfcf',
  'flowing water': '#a9cbe0',
  'standing water': '#a9cbe0',
}

export const GLOW_COLOR = '#e8743b'
export const GROUND_COLOR = '#efece3'
export const MAIN_COLOR = '#d1401f'
export const M18_COLOR = '#008f8a'
export const WATER_LINE_COLOR = '#7fb0cf'

// Longitude and latitude to metres from the focus point. x is east, z is south.
const M_PER_LAT = 111320
const M_PER_LON = 111320 * Math.cos((FOCUS[1] * Math.PI) / 180)

export function toLocal([lon, lat]) {
  return [(lon - FOCUS[0]) * M_PER_LON, -(lat - FOCUS[1]) * M_PER_LAT]
}

const toShapePoints = (ring) =>
  ring.map((coord) => {
    const [x, z] = toLocal(coord)
    return new THREE.Vector2(x, -z)
  })

function toShape(rings) {
  const shape = new THREE.Shape(toShapePoints(rings[0]))
  rings.slice(1).forEach((hole) => shape.holes.push(new THREE.Path(toShapePoints(hole))))
  return shape
}

const polygonsOf = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

function paint(geometry, colorValue) {
  const color = new THREE.Color(colorValue)
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.deleteAttribute('uv')
  return geometry
}

function centroid(feature) {
  const ring = polygonsOf(feature.geometry)[0][0]
  const sum = ring.reduce((total, [lon, lat]) => [total[0] + lon, total[1] + lat], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length]
}

export function placeOf(feature) {
  if (MAIN_BUILDING.buildingIds.includes(String(feature.properties.id))) return 'main'
  return M18_AREA.buildingIds.includes(String(feature.properties.id)) ? 'm18' : null
}

export function buildingColor(feature, highlights) {
  const place = placeOf(feature)
  if (place === 'main') return MAIN_COLOR
  if (place === 'm18') return M18_COLOR
  const id = String(feature.properties.id)
  const category = highlights[id]?.category
  if (category) return CATEGORY_COLORS[category]
  const hash = [...id].reduce((total, character) => total + character.charCodeAt(0), 0)
  return NEUTRAL_TONES[hash % NEUTRAL_TONES.length]
}

export function extrudeBuilding(feature) {
  const geometry = new THREE.ExtrudeGeometry(toShape(feature.geometry.coordinates), {
    depth: feature.properties.height,
    bevelEnabled: false,
  })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

// All buildings as one mesh, so orbiting stays smooth. `ranges` remembers which
// triangles belong to which building, so a click can find the building again.
export function buildCity(features, highlights) {
  const ranges = []
  let triangles = 0
  const parts = features.map((feature) => {
    const part = paint(extrudeBuilding(feature), buildingColor(feature, highlights))
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

// A soft patch on the ground around each social building. The patches add up,
// so the ground gets stronger where many places sit close together.
export function buildGlow(features, highlights, reach) {
  const parts = features
    .filter((feature) => placeOf(feature) || highlights[feature.properties.id])
    .map((feature) => {
      const ring = feature.geometry.coordinates[0].map(toLocal)
      const [x, z] = toLocal(centroid(feature))
      const size = Math.max(...ring.map(([px, pz]) => Math.hypot(px - x, pz - z)))
      const part = new THREE.CircleGeometry(size + reach, 32)
      part.rotateX(-Math.PI / 2)
      part.translate(x, 0, z)
      return part
    })
  return mergeGeometries(parts)
}

export function buildLand(features) {
  const parts = []
  features.forEach((feature) => {
    const color = LAND_COLORS[feature.properties.landuse]
    if (!color) return
    polygonsOf(feature.geometry).forEach((rings) => {
      const part = new THREE.ShapeGeometry(toShape(rings))
      part.rotateX(-Math.PI / 2)
      parts.push(paint(part, color))
    })
  })
  return mergeGeometries(parts)
}

export function buildStreets(features) {
  const positions = []
  features.forEach((feature) => {
    const line = feature.geometry.coordinates
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = toLocal(line[i])
      const [bx, bz] = toLocal(line[i + 1])
      positions.push(ax, 0, az, bx, 0, bz)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

// The label sits above the first listed footprint of the building.
export function labelPosition(features, id) {
  const feature = features.find((f) => String(f.properties.id) === id)
  const [x, z] = toLocal(centroid(feature))
  return [x, feature.properties.height + 8, z]
}
