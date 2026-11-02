// Writes public/osm/water.json: all the water in the city of Weimar that OpenStreetMap
// lists above ground. Run scripts/build-city.mjs first. The query is in public/osm/SOURCES.md.
//
// Run with: node scripts/build-water.mjs <raw Overpass JSON>

import { readFileSync, writeFileSync } from 'node:fs'

const elements = JSON.parse(readFileSync(process.argv[2], 'utf8')).elements
const { boundary } = JSON.parse(readFileSync('public/osm/city.json', 'utf8'))

const round = (value) => Number(value.toFixed(6))
const toLine = (geometry) => geometry.map((p) => [round(p.lon), round(p.lat)])
const same = (a, b) => a[0] === b[0] && a[1] === b[1]
const isClosed = (line) => line.length >= 4 && same(line[0], line.at(-1))

function inRing([lon, lat], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const crosses = ring[i][1] > lat !== ring[j][1] > lat
    if (crosses && lon < ((ring[j][0] - ring[i][0]) * (lat - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside
  }
  return inside
}
const inCity = (point) => boundary.some((ring) => inRing(point, ring))

const centroid = (ring) => {
  const sum = ring.reduce((total, p) => [total[0] + p[0], total[1] + p[1]], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length]
}

// A relation's outline can arrive in several pieces; join them where their ends meet.
function joinIntoRings(lines) {
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

// Only the parts of a line inside the city.
function runsInCity(line) {
  const runs = []
  let run = []
  for (const point of line) {
    if (inCity(point)) run.push(point)
    else {
      if (run.length >= 2) runs.push(run)
      run = []
    }
  }
  if (run.length >= 2) runs.push(run)
  return runs
}

const areas = [] // each is an outline followed by any islands
const rivers = []
const streams = []
const points = []

for (const element of elements) {
  const tags = element.tags ?? {}
  if (element.type === 'node') {
    const point = [round(element.lon), round(element.lat)]
    if (inCity(point)) points.push(point)
  } else if (element.type === 'relation') {
    const members = (role) => (element.members ?? []).filter((m) => m.role === role && m.geometry).map((m) => toLine(m.geometry))
    const polygons = joinIntoRings(members('outer')).map((ring) => [ring])
    joinIntoRings(members('inner')).forEach((hole) => {
      polygons.find((polygon) => inRing(hole[0], polygon[0]))?.push(hole)
    })
    polygons.filter((polygon) => inCity(centroid(polygon[0]))).forEach((polygon) => areas.push(polygon))
  } else if (tags.waterway) {
    if (tags.tunnel) continue // underground, so not part of the plan
    ;(tags.waterway === 'river' ? rivers : streams).push(...runsInCity(toLine(element.geometry)))
  } else {
    const line = toLine(element.geometry)
    if (isClosed(line) && inCity(centroid(line))) areas.push([line])
  }
}

writeFileSync('public/osm/water.json', JSON.stringify({ areas, rivers, streams, points }))
console.log({ areas: areas.length, rivers: rivers.length, streams: streams.length, points: points.length })
