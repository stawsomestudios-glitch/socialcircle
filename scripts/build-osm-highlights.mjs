// Finds the buildings where you may run into people you know, using OpenStreetMap tags
// and the main use from the city kit, and writes public/osm/highlights.json. The queries
// are in public/osm/SOURCES.md.
//
// Run with: node scripts/build-osm-highlights.mjs <raw Overpass JSON files>

import { readFileSync, writeFileSync } from 'node:fs'

const NEAREST_LIMIT_M = 15
const PRIORITY = ['museum', 'library', 'cafe', 'food', 'shop', 'bauhaus'] // when one building has several
const FOOD_AND_DRINK = new Set(['restaurant', 'fast_food', 'food_court', 'bar', 'pub', 'biergarten', 'nightclub'])
// Shops you visit by appointment or for a one-off errand, not places you bump into people.
const NOT_SOCIAL_SHOPS = new Set([
  'no', 'vacant', 'car', 'car_parts', 'car_repair', 'funeral_directors', 'hairdresser', 'beauty',
  'hearing_aids', 'locksmith', 'massage', 'tattoo', 'trade', 'travel_agency',
])

const elements = process.argv.slice(2).flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).elements)
const buildings = [
  ...JSON.parse(readFileSync('public/data/buildings.geojson', 'utf8')).features,
  ...JSON.parse(readFileSync('public/osm/context.geojson', 'utf8')).features.filter(
    (feature) => feature.properties.kind === 'building',
  ),
].map((feature) => {
  const ring = feature.geometry.coordinates[0]
  return { id: String(feature.properties.id), use: feature.properties.use, ring, middle: centroid(ring) }
})

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

function categoryOf(element) {
  const tags = element.tags ?? {}
  const name = tags.name ?? ''
  if (tags.amenity === 'cafe' || tags.amenity === 'ice_cream') return 'cafe'
  if (FOOD_AND_DRINK.has(tags.amenity) || /mensa/i.test(name)) return 'food'
  if (tags.shop && !NOT_SOCIAL_SHOPS.has(tags.shop)) return 'shop'
  if (tags.tourism === 'museum' || tags.building === 'museum') return 'museum'
  // Archives are tagged as libraries in OpenStreetMap but aren't libraries here.
  if (tags.amenity === 'library') return /archiv/i.test(name) ? null : 'library'

  const isBuilding = element.type === 'node' || tags.building
  const saysBauhaus = /Bauhaus/.test(tags.operator ?? '') || /Bauhaus[- ](Univ|Institut)/.test(name)
  if (isBuilding && saysBauhaus) return 'bauhaus'
  return null
}

function outlinesOf(element) {
  const toRing = (geometry) => geometry.map((point) => [point.lon, point.lat])
  if (element.type === 'way') return [toRing(element.geometry)]
  if (element.type === 'relation') {
    return element.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => toRing(m.geometry))
  }
  return []
}

function nearestBuilding(point) {
  const mPerLat = 111320
  const mPerLon = mPerLat * Math.cos((point[1] * Math.PI) / 180)
  let best = null
  let bestDistance = Infinity
  for (const building of buildings) {
    for (const corner of building.ring) {
      const distance = Math.hypot((corner[0] - point[0]) * mPerLon, (corner[1] - point[1]) * mPerLat)
      if (distance < bestDistance) {
        bestDistance = distance
        best = building
      }
    }
  }
  return bestDistance <= NEAREST_LIMIT_M ? best : null
}

function matchBuildings(element) {
  const outlines = outlinesOf(element)
  const points = outlines.length ? [...outlines.map(centroid), centroid(outlines.flat())] : [[element.lon, element.lat]]
  const matches = new Set()
  outlines.forEach((outline) => {
    buildings.filter((b) => inRing(b.middle, outline)).forEach((b) => matches.add(b))
  })
  points.forEach((point) => {
    const holder = buildings.find((b) => inRing(point, b.ring)) ?? nearestBuilding(point)
    if (holder) matches.add(holder)
  })
  return [...matches]
}

const highlights = {}
const unmatched = []
for (const element of elements) {
  const category = categoryOf(element)
  if (!category) continue
  const matches = matchBuildings(element)
  if (!matches.length) unmatched.push(`${category}: ${element.tags.name ?? element.id}`)
  for (const { id } of matches) {
    const entry = (highlights[id] ??= { categories: new Set(), names: new Set() })
    entry.categories.add(category)
    if (element.tags.name) entry.names.add(element.tags.name)
  }
}

// The kit knows the main use of its buildings even where OpenStreetMap lists nothing.
const KIT_USES = { retail: 'shop', food_and_drink: 'food' }
for (const { id, use } of buildings) {
  if (KIT_USES[use]) (highlights[id] ??= { categories: new Set(), names: new Set() }).categories.add(KIT_USES[use])
}

const output = Object.fromEntries(
  Object.entries(highlights).map(([id, entry]) => [
    id,
    { category: PRIORITY.find((c) => entry.categories.has(c)), names: [...entry.names] },
  ]),
)
writeFileSync('public/osm/highlights.json', JSON.stringify(output))

const counts = {}
Object.values(output).forEach(({ category }) => (counts[category] = (counts[category] ?? 0) + 1))
console.log('buildings per category', counts)
console.log('not matched to a building', unmatched)
