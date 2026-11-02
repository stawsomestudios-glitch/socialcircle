import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FOCUS, M18_AREA, MAIN_BUILDING } from './places.js'

export const USE_COLORS = {
  residential: '#d9cfc0',
  service: '#b9c4c9',
  education: '#8fa8c4',
  civic: '#a99fc2',
  culture: '#b890a9',
  entertainment: '#cfa5b5',
  retail: '#d8b27a',
  food_and_drink: '#d39b7f',
  office: '#9db7a8',
  health: '#a8cdb8',
  accommodation: '#c7b796',
  sport: '#9fc08a',
  transport: '#8f9499',
  light_industrial: '#a39882',
  undefined: '#d4d4d0',
}

export const LAND_COLORS = {
  recreation: '#cfe0bd',
  cemetery: '#c3d3b8',
  square: '#e8dfcf',
  'flowing water': '#a9cbe0',
  'standing water': '#a9cbe0',
}

export const MAIN_COLOR = '#d1401f'
export const M18_COLOR = '#008f8a'
export const CONTEXT_COLOR = '#ecebe8'
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

export function buildingColor(feature) {
  const place = placeOf(feature)
  if (place === 'main') return MAIN_COLOR
  if (place === 'm18') return M18_COLOR
  if (feature.properties.source === 'osm') return CONTEXT_COLOR
  return USE_COLORS[feature.properties.use] ?? USE_COLORS.undefined
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
export function buildCity(features) {
  const ranges = []
  let triangles = 0
  const parts = features.map((feature) => {
    const part = paint(extrudeBuilding(feature), buildingColor(feature))
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
