// Writes public/osm/city.json: the boundary of the city of Weimar and the outlines of every
// building in the city outside the black map area. The query is in
// public/osm/SOURCES.md.
//
// Run with: node scripts/build-city.mjs <raw Overpass JSON>

import { readFileSync, writeFileSync } from 'node:fs'
import { MAP_BOUNDARY } from '../src/map/places.js'

const elements = JSON.parse(readFileSync(process.argv[2], 'utf8')).elements
const round = (value) => Number(value.toFixed(5)) // about 1 m, plenty for an outline
const toLine = (geometry) => geometry.map((p) => [round(p.lon), round(p.lat)])
const same = (a, b) => a[0] === b[0] && a[1] === b[1]

function joinIntoRings(lines) {
  const rest = lines.map((line) => [...line])
  const rings = []
  while (rest.length) {
    let ring = rest.shift()
    let grew = true
    while (!same(ring[0], ring.at(-1)) && grew) {
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
    if (same(ring[0], ring.at(-1))) rings.push(ring)
    else throw new Error('The city boundary has a gap')
  }
  return rings
}

function inRing([lon, lat], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const crosses = ring[i][1] > lat !== ring[j][1] > lat
    if (crosses && lon < ((ring[j][0] - ring[i][0]) * (lat - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside
  }
  return inside
}

const centroid = (ring) => {
  const sum = ring.reduce((total, p) => [total[0] + p[0], total[1] + p[1]], [0, 0])
  return [sum[0] / ring.length, sum[1] / ring.length]
}

const relation = elements.find((e) => e.type === 'relation' && e.tags?.name === 'Weimar' && e.tags?.admin_level === '6')
const boundary = joinIntoRings(relation.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => toLine(m.geometry)))
const inCity = (point) => boundary.some((ring) => inRing(point, ring))

const [west, south, east, north] = MAP_BOUNDARY
const inMap = ([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north

const buildings = []
for (const element of elements) {
  const tags = element.tags ?? {}
  if (element.type !== 'way') continue
  if (tags.building && tags.building !== 'no') {
    if (tags.location === 'underground' || Number(tags.layer) < 0) continue
    const ring = toLine(element.geometry)
    if (ring.length < 4 || !same(ring[0], ring.at(-1))) continue
    const middle = centroid(ring)
    if (!inMap(middle) && inCity(middle)) buildings.push(ring)
  }
}

writeFileSync('public/osm/city.json', JSON.stringify({ boundary, buildings }))
console.log({ boundary_rings: boundary.length, boundary_points: boundary.flat().length, outlined_buildings: buildings.length })
