// Finds the most and least social walking routes, for each hour of the day, from a general
// point on Merketalstraße to the Bauhaus
// main building, and writes public/osm/routes.json. Run the other two build scripts first.
//
// Run with: node scripts/build-routes.mjs <raw Overpass JSON files>

import { readFileSync, writeFileSync } from 'node:fs'
import { FOCUS, MAIN_BUILDING, MAP_BOUNDARY, ROUTE_START, SOCIAL_REACH_M } from '../src/map/places.js'

const WALK_M_PER_MIN = 80 // 4.8 km/h
const MAX_DETOUR = 1.6 // neither route may be longer than this times the shortest walk
const STRENGTHS = [0.5, 1, 2, 3, 5, 8, 12, 20, 40] // how hard to push toward or away from social areas
const NOT_WALKABLE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'escape'])

const M_PER_LAT = 111320
const M_PER_LON = M_PER_LAT * Math.cos((FOCUS[1] * Math.PI) / 180)
const toMetres = ([lon, lat]) => [(lon - FOCUS[0]) * M_PER_LON, (lat - FOCUS[1]) * M_PER_LAT]
const [west, south, east, north] = MAP_BOUNDARY
const inMap = ([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north
const centroid = (ring) => {
  const sum = ring.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length]
}

// ---- social areas: each social building's outline plus a band, the same as the map draws
const highlights = JSON.parse(readFileSync('public/osm/highlights.json', 'utf8'))
const allBuildings = [
  ...JSON.parse(readFileSync('public/data/buildings.geojson', 'utf8')).features,
  ...JSON.parse(readFileSync('public/osm/context.geojson', 'utf8')).features.filter((f) => f.properties.kind === 'building'),
]
const areas = []
for (const feature of allBuildings) {
  const id = String(feature.properties.id)
  const ring = feature.geometry.coordinates[0]
  if (!inMap(centroid(ring))) continue
  if (!highlights[id]) continue
  areas.push({ id, ring: ring.map(toMetres), activity: highlights[id].activity })
}

const CELL = 100
const grid = new Map()
areas.forEach((area, index) => {
  const xs = area.ring.map((p) => p[0])
  const ys = area.ring.map((p) => p[1])
  const from = [Math.floor((Math.min(...xs) - SOCIAL_REACH_M) / CELL), Math.floor((Math.min(...ys) - SOCIAL_REACH_M) / CELL)]
  const to = [Math.floor((Math.max(...xs) + SOCIAL_REACH_M) / CELL), Math.floor((Math.max(...ys) + SOCIAL_REACH_M) / CELL)]
  for (let i = from[0]; i <= to[0]; i++) {
    for (let j = from[1]; j <= to[1]; j++) {
      const key = `${i},${j}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(index)
    }
  }
})

function isInsideArea([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[j]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= SOCIAL_REACH_M) return true
    if (ay > y !== by > y && x < (dx * (y - ay)) / dy + ax) inside = !inside
  }
  return inside
}

const areasAt = (point) =>
  (grid.get(`${Math.floor(point[0] / CELL)},${Math.floor(point[1] / CELL)}`) ?? []).filter((index) =>
    isInsideArea(point, areas[index].ring),
  )

// ---- the walking network
const elements = new Map()
for (const file of process.argv.slice(2)) {
  for (const element of JSON.parse(readFileSync(file, 'utf8')).elements) elements.set(`${element.type}/${element.id}`, element)
}
const walkable = ({ type, tags = {} }) => {
  if (type !== 'way' || !tags.highway || NOT_WALKABLE.has(tags.highway)) return false
  if (tags.foot === 'no') return false
  const private_ = ['private', 'no'].includes(tags.access)
  return !private_ || ['yes', 'designated', 'permissive'].includes(tags.foot)
}

const keyOf = ([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`
const nodes = new Map()
const nodeOf = (point) => {
  const key = keyOf(point)
  if (!nodes.has(key)) nodes.set(key, { point, metres: toMetres(point), edges: [] })
  return nodes.get(key)
}
for (const element of elements.values()) {
  if (!walkable(element)) continue
  const line = element.geometry.map((p) => [p.lon, p.lat])
  for (let i = 0; i < line.length - 1; i++) {
    if (!inMap(line[i]) || !inMap(line[i + 1])) continue
    const a = nodeOf(line[i])
    const b = nodeOf(line[i + 1])
    const length = Math.hypot(a.metres[0] - b.metres[0], a.metres[1] - b.metres[1])
    if (!length) continue
    const samples = Math.max(1, Math.ceil(length / 10))
    // How busy this stretch is at each hour: at each point along it, the busiest social
    // building whose area covers that point, averaged over the stretch.
    const busy = new Array(24).fill(0)
    for (let s = 0; s < samples; s++) {
      const t = (s + 0.5) / samples
      const covering = areasAt([a.metres[0] + (b.metres[0] - a.metres[0]) * t, a.metres[1] + (b.metres[1] - a.metres[1]) * t])
      for (let hour = 0; hour < 24; hour++) {
        busy[hour] += Math.max(0, ...covering.map((index) => areas[index].activity[hour])) / samples
      }
    }
    const edge = { length, busy }
    a.edges.push({ ...edge, to: b })
    b.edges.push({ ...edge, to: a })
  }
}

function reachableFrom(start) {
  const seen = new Set([start])
  const stack = [start]
  while (stack.length) stack.pop().edges.forEach(({ to }) => seen.has(to) || (seen.add(to), stack.push(to)))
  return seen
}

function nearest(candidates, targets) {
  let best = null
  let bestDistance = Infinity
  for (const node of candidates) {
    for (const target of targets) {
      const distance = Math.hypot(node.metres[0] - target[0], node.metres[1] - target[1])
      if (distance < bestDistance) {
        bestDistance = distance
        best = node
      }
    }
  }
  return { node: best, distance: bestDistance }
}

// The biggest connected part of the network, so a stray path can't be picked as an end.
let network = new Set()
const visited = new Set()
for (const node of nodes.values()) {
  if (visited.has(node)) continue
  const part = reachableFrom(node)
  part.forEach((n) => visited.add(n))
  if (part.size > network.size) network = part
}

const mainFeature = allBuildings.find((f) => MAIN_BUILDING.buildingIds.includes(String(f.properties.id)))
const start = nearest(network, [toMetres(ROUTE_START.location)])
const end = nearest(network, mainFeature.geometry.coordinates[0].map(toMetres))

// ---- finding routes
function shortestPath(costOf, hour) {
  const best = new Map([[start.node, 0]])
  const previous = new Map()
  const done = new Set()
  const heap = [[0, start.node]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent][0] <= heap[i][0]) break
      ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
      i = parent
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let small = i
        if (l < heap.length && heap[l][0] < heap[small][0]) small = l
        if (r < heap.length && heap[r][0] < heap[small][0]) small = r
        if (small === i) break
        ;[heap[small], heap[i]] = [heap[i], heap[small]]
        i = small
      }
    }
    return top
  }
  while (heap.length) {
    const [, node] = pop()
    if (done.has(node)) continue
    done.add(node)
    if (node === end.node) break
    for (const edge of node.edges) {
      const cost = best.get(node) + costOf(edge)
      if (cost < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, cost)
        previous.set(edge.to, { node, edge })
        push([cost, edge.to])
      }
    }
  }
  const path = []
  for (let at = end.node; at !== start.node; at = previous.get(at).node) path.unshift(previous.get(at))
  return describe(path, hour)
}

// A building only counts as passed at an hour when it's fairly busy then.
const COUNTS_AS_BUSY = 0.25

function describe(path, hour) {
  const places = new Set()
  const addPlaces = (node) => {
    areasAt(node.metres).forEach((index) => {
      if (areas[index].activity[hour] >= COUNTS_AS_BUSY) places.add(areas[index].id)
    })
  }
  let length = 0
  let social = 0
  path.forEach(({ node, edge }) => {
    length += edge.length
    social += edge.length * edge.busy[hour]
    addPlaces(node)
  })
  addPlaces(end.node)
  return {
    coordinates: [...path.map(({ node }) => node.point), end.node.point],
    length_m: Math.round(length),
    minutes: Math.round(length / WALK_M_PER_MIN),
    social_m: Math.round(social),
    bustle_percent: Math.round((social / length) * 100),
    places_passed: places.size,
  }
}

function routesAt(hour) {
  const shortest = shortestPath((edge) => edge.length, hour)
  const limit = shortest.length_m * MAX_DETOUR
  const fits = (route) => route.length_m <= limit
  const leastOptions = STRENGTHS.map((s) => shortestPath((e) => e.length * (1 + s * e.busy[hour]), hour)).filter(fits)
  const mostOptions = STRENGTHS.map((s) => shortestPath((e) => e.length * (1 + s * (1 - e.busy[hour])), hour)).filter(fits)
  return {
    least: leastOptions.reduce((a, b) => (b.social_m < a.social_m ? b : a), shortest),
    most: mostOptions.reduce((a, b) => (b.social_m > a.social_m ? b : a), shortest),
  }
}

const hours = Array.from({ length: 24 }, (_, hour) => routesAt(hour))

writeFileSync('public/osm/routes.json', JSON.stringify({ hours }))

console.log('network nodes', network.size, '| social buildings', areas.length)
console.log('start snaps', Math.round(start.distance), 'm | end snaps', Math.round(end.distance), 'm')
hours.forEach(({ most, least }, hour) => {
  const same = JSON.stringify(most.coordinates) === JSON.stringify(least.coordinates)
  console.log(String(hour).padStart(2, '0') + ':00', 'most', most.length_m, 'm', most.bustle_percent + '%', most.places_passed, '| least', least.length_m, 'm', least.bustle_percent + '%', least.places_passed, same ? '| same route' : '')
})
