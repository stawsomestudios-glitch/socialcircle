// Turns a raw OpenStreetMap download into public/osm/context.geojson: the surroundings
// of the city kit. Everything the kit already covers is left out, so the kit stays the
// source inside its own area, and only what falls inside the map is kept. The queries are
// in public/osm/SOURCES.md.
//
// Run with: node scripts/build-osm-context.mjs <raw Overpass JSON files>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { MAP_BOUNDARY } from '../src/map/places.js'

const EDGE_MARGIN_M = 40 // the kit misses buildings this close to its edge, so OSM may fill them
const SMALL_BUILDINGS = new Set(['garage', 'garages', 'shed', 'hut', 'carport', 'garden_house', 'greenhouse', 'roof'])

const elementsById = new Map()
for (const file of process.argv.slice(2)) {
  for (const element of JSON.parse(readFileSync(file, 'utf8')).elements) {
    const key = `${element.type}/${element.id}`
    // A relation may arrive without its outline from one download and with it from another.
    if (!elementsById.get(key)?.members?.length) elementsById.set(key, element)
  }
}
const elements = [...elementsById.values()]
const kit = JSON.parse(readFileSync('public/data/kit.json', 'utf8'))
const kitBuildings = JSON.parse(readFileSync('public/data/buildings.geojson', 'utf8')).features.map(
  (feature) => feature.geometry.coordinates[0],
)
const [west, south, east, north] = kit.bbox

const M_PER_LAT = 111320
const M_PER_LON = M_PER_LAT * Math.cos((((south + north) / 2) * Math.PI) / 180)

const round = ([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]
const toLine = (geometry) => geometry.map((point) => round([point.lon, point.lat]))
const same = (a, b) => a[0] === b[0] && a[1] === b[1]
const isClosed = (line) => line.length >= 4 && same(line[0], line.at(-1))
const inKit = ([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north
const inMap = ([lon, lat]) =>
  lon >= MAP_BOUNDARY[0] && lon <= MAP_BOUNDARY[2] && lat >= MAP_BOUNDARY[1] && lat <= MAP_BOUNDARY[3]

function centroid(ring) {
  const sum = ring.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length]
}

function inRing([lon, lat], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const crosses = ring[i][1] > lat !== ring[j][1] > lat
    if (crosses && lon < ((ring[j][0] - ring[i][0]) * (lat - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) {
      inside = !inside
    }
  }
  return inside
}

function metresInsideKit([lon, lat]) {
  return Math.min((lon - west) * M_PER_LON, (east - lon) * M_PER_LON, (lat - south) * M_PER_LAT, (north - lat) * M_PER_LAT)
}

const overlapsKitBuilding = (ring) =>
  kitBuildings.some((other) => {
    const [lon, lat] = other[0]
    if (Math.abs(lon - ring[0][0]) > 0.003 || Math.abs(lat - ring[0][1]) > 0.002) return false
    return ring.some((point) => inRing(point, other)) || other.some((point) => inRing(point, ring)) || inRing(centroid(ring), other)
  })

// A relation's outline can arrive in several pieces; join them where their ends meet.
function joinLines(lines) {
  const rest = lines.map((line) => [...line])
  const rings = []
  while (rest.length) {
    let ring = rest.shift()
    let grew = true
    while (!isClosed(ring) && grew) {
      grew = false
      for (let i = 0; i < rest.length; i++) {
        const piece = rest[i]
        if (same(ring.at(-1), piece[0])) ring = [...ring, ...piece.slice(1)]
        else if (same(ring.at(-1), piece.at(-1))) ring = [...ring, ...[...piece].reverse().slice(1)]
        else continue
        rest.splice(i, 1)
        grew = true
        break
      }
    }
    if (isClosed(ring)) rings.push(ring)
  }
  return rings
}

// Every area as a list of polygons, each with its outline first and its holes after it.
function polygonsOf(element) {
  if (element.type === 'way') {
    const line = toLine(element.geometry ?? [])
    return isClosed(line) ? [[line]] : []
  }
  const linesWithRole = (role) =>
    (element.members ?? []).filter((m) => m.role === role && m.geometry).map((m) => toLine(m.geometry))
  const polygons = joinLines(linesWithRole('outer')).map((ring) => [ring])
  joinLines(linesWithRole('inner')).forEach((hole) => {
    polygons.find((polygon) => inRing(hole[0], polygon[0]))?.push(hole)
  })
  return polygons
}

function heightOf(tags) {
  const measured = Number.parseFloat(tags.height)
  if (measured > 0) return { height: measured, height_estimated: false }
  const levels = Number.parseFloat(tags['building:levels'])
  if (levels > 0) return { height: levels * 3 + 1, height_estimated: true }
  return { height: SMALL_BUILDINGS.has(tags.building) ? 3 : 8, height_estimated: true }
}

const features = []
const counts = { building: 0, road: 0, waterway: 0 }

function addLines(element, kind) {
  let run = []
  const flush = () => {
    if (run.length >= 2 && run.some(inMap)) {
      features.push({ type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: run } })
      counts[kind]++
    }
    run = []
  }
  const line = toLine(element.geometry ?? [])
  line.forEach((point, index) => {
    const next = line[index + 1]
    if (next && (kind === 'waterway' || !(inKit(point) && inKit(next)))) {
      if (!run.length) run.push(point)
      run.push(next)
    } else if (run.length) {
      flush()
    }
  })
  flush()
}

for (const element of elements) {
  const tags = element.tags ?? {}

  if (tags.building && tags.building !== 'no') {
    if (tags.location === 'underground' || Number(tags.layer) < 0) continue
    const polygons = polygonsOf(element)
    polygons.forEach((rings) => {
      const middle = centroid(rings[0])
      if (!inMap(middle)) return
      if (inKit(middle) && metresInsideKit(middle) > EDGE_MARGIN_M) return
      if (overlapsKitBuilding(rings[0])) return
      const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ')
      features.push({
        type: 'Feature',
        properties: {
          kind: 'building',
          source: 'osm',
          id: `${element.type}/${element.id}`,
          ...(tags.name && { name: tags.name }),
          ...(street && { address: street }),
          ...heightOf(tags),
          ...(tags['building:levels'] && { floors: Number.parseFloat(tags['building:levels']) }),
        },
        geometry: { type: 'Polygon', coordinates: rings },
      })
      counts.building++
    })
  } else if (tags.highway) {
    if (tags.tunnel === 'yes' || tags.highway === 'proposed' || tags.highway === 'construction') continue
    addLines(element, 'road')
  } else if (tags.waterway) {
    if (tags.tunnel) continue // underground, so not part of the plan
    addLines(element, 'waterway')
  }
}

mkdirSync('public/osm', { recursive: true })
writeFileSync(
  'public/osm/context.geojson',
  JSON.stringify({ type: 'FeatureCollection', features }),
)
console.log(counts)
