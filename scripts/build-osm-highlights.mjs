// Finds the buildings where you may run into people you know, using OpenStreetMap tags
// and the main use from the city kit, and writes public/osm/highlights.json. The queries
// are in public/osm/SOURCES.md.
//
// Run with: node scripts/build-osm-highlights.mjs <raw Overpass JSON files>

import { readFileSync, writeFileSync } from 'node:fs'
import opening_hours from 'opening_hours'
import { MAP_BOUNDARY } from '../src/map/places.js'

const NEAREST_LIMIT_M = 15
const PRIORITY = ['museum', 'library', 'cafe', 'food', 'shop', 'bauhaus'] // when one building has several
const FOOD_AND_DRINK = new Set(['restaurant', 'fast_food', 'food_court', 'bar', 'pub', 'biergarten', 'nightclub'])
// Shops you visit by appointment or for a one-off errand, not places you bump into people.
const NOT_SOCIAL_SHOPS = new Set([
  'no', 'vacant', 'car', 'car_parts', 'car_repair', 'funeral_directors', 'hairdresser', 'beauty',
  'hearing_aids', 'locksmith', 'massage', 'tattoo', 'trade', 'travel_agency',
])

// How busy each kind of place typically is, by hour, from 0 to 1. These are assumptions
// about a normal day, not measurements: nothing in the data counts people.
const RHYTHMS = {
  cafe: { 8: 0.3, 9: 0.6, 10: 0.8, 11: 0.8, 12: 0.7, 13: 0.7, 14: 0.8, 15: 0.9, 16: 0.9, 17: 0.7, 18: 0.4, 19: 0.2 },
  food: { 11: 0.4, 12: 0.9, 13: 0.9, 14: 0.5, 15: 0.2, 16: 0.2, 17: 0.4, 18: 0.8, 19: 1, 20: 1, 21: 0.8, 22: 0.5, 23: 0.2 },
  bar: { 0: 0.8, 1: 0.5, 2: 0.2, 17: 0.2, 18: 0.4, 19: 0.6, 20: 0.8, 21: 1, 22: 1, 23: 1 },
  mensa: { 8: 0.1, 9: 0.1, 10: 0.2, 11: 0.7, 12: 1, 13: 1, 14: 0.5, 15: 0.2 },
  shop: { 9: 0.2, 10: 0.5, 11: 0.6, 12: 0.6, 13: 0.6, 14: 0.6, 15: 0.7, 16: 0.8, 17: 0.8, 18: 0.6, 19: 0.3 },
  supermarket: { 7: 0.2, 8: 0.3, 9: 0.3, 10: 0.4, 11: 0.4, 12: 0.5, 13: 0.5, 14: 0.4, 15: 0.6, 16: 0.8, 17: 1, 18: 1, 19: 0.7, 20: 0.4, 21: 0.15 },
  museum: { 10: 0.4, 11: 0.6, 12: 0.6, 13: 0.6, 14: 0.7, 15: 0.7, 16: 0.5, 17: 0.2 },
  library: { 9: 0.4, 10: 0.7, 11: 0.8, 12: 0.8, 13: 0.8, 14: 0.9, 15: 0.9, 16: 0.9, 17: 0.8, 18: 0.6, 19: 0.4, 20: 0.2 },
  bauhaus: { 8: 0.4, 9: 0.8, 10: 1, 11: 1, 12: 0.9, 13: 0.9, 14: 1, 15: 1, 16: 0.9, 17: 0.7, 18: 0.4, 19: 0.2, 20: 0.1 },
}
const OPEN_BUT_QUIET = 0.15 // for a place that's open at an hour its rhythm calls empty
const TYPICAL_DAY = [2026, 10, 4] // a Wednesday in November that isn't a holiday: year, month from 0, day
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

const rhythmOf = (element, category) => {
  const tags = element.tags ?? {}
  if (/mensa/i.test(tags.name ?? '')) return RHYTHMS.mensa
  if (['bar', 'pub', 'biergarten', 'nightclub'].includes(tags.amenity)) return RHYTHMS.bar
  if (['supermarket', 'convenience'].includes(tags.shop)) return RHYTHMS.supermarket
  return RHYTHMS[category]
}

// The place's rhythm, limited to the hours it's open where OpenStreetMap lists them.
function activityOf(element, category) {
  const rhythm = rhythmOf(element, category)
  const fromRhythm = HOURS.map((hour) => rhythm[hour] ?? 0)
  const listed = element.tags?.opening_hours
  if (!listed) return fromRhythm
  try {
    const hours = new opening_hours(listed, { lat: 50.98, lon: 11.33, address: { country_code: 'de', state: 'Thüringen' } })
    return HOURS.map((hour) => {
      const moment = new Date(TYPICAL_DAY[0], TYPICAL_DAY[1], TYPICAL_DAY[2], hour, 30)
      if (hours.getUnknown(moment)) return fromRhythm[hour]
      return hours.getState(moment) ? Math.max(fromRhythm[hour], OPEN_BUT_QUIET) : 0
    })
  } catch {
    unreadableHours++
    return fromRhythm
  }
}
let unreadableHours = 0

const elementsById = new Map()
for (const file of process.argv.slice(2)) {
  for (const element of JSON.parse(readFileSync(file, 'utf8')).elements) {
    elementsById.set(`${element.type}/${element.id}`, element)
  }
}
const elements = [...elementsById.values()]
const buildings = [
  ...JSON.parse(readFileSync('public/data/buildings.geojson', 'utf8')).features,
  ...JSON.parse(readFileSync('public/osm/context.geojson', 'utf8')).features.filter(
    (feature) => feature.properties.kind === 'building',
  ),
].map((feature) => {
  const ring = feature.geometry.coordinates[0]
  return { id: String(feature.properties.id), use: feature.properties.use, ring, middle: centroid(ring) }
}).filter(({ middle: [lon, lat] }) =>
  lon >= MAP_BOUNDARY[0] && lon <= MAP_BOUNDARY[2] && lat >= MAP_BOUNDARY[1] && lat <= MAP_BOUNDARY[3],
)

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
for (const element of elements) {
  const category = categoryOf(element)
  if (!category) continue
  const matches = matchBuildings(element)
  for (const { id } of matches) {
    const entry = (highlights[id] ??= { categories: new Set(), names: new Set(), curves: [] })
    entry.categories.add(category)
    entry.curves.push(activityOf(element, category))
    if (element.tags.name) entry.names.add(element.tags.name)
  }
}

// The kit knows the main use of its buildings even where OpenStreetMap lists nothing.
const KIT_USES = { retail: 'shop', food_and_drink: 'food' }
for (const { id, use } of buildings) {
  if (!KIT_USES[use]) continue
  const entry = (highlights[id] ??= { categories: new Set(), names: new Set(), curves: [] })
  entry.categories.add(KIT_USES[use])
  if (!entry.curves.length) entry.curves.push(HOURS.map((hour) => RHYTHMS[KIT_USES[use]][hour] ?? 0))
}

const output = Object.fromEntries(
  Object.entries(highlights).map(([id, entry]) => [
    id,
    {
      category: PRIORITY.find((c) => entry.categories.has(c)),
      names: [...entry.names],
      // A building with several places is as busy as its busiest one.
      activity: HOURS.map((hour) => Math.max(...entry.curves.map((curve) => curve[hour]))),
    },
  ]),
)
writeFileSync('public/osm/highlights.json', JSON.stringify(output))

const counts = {}
Object.values(output).forEach(({ category }) => (counts[category] = (counts[category] ?? 0) + 1))
console.log('buildings per category', counts)
console.log('opening hours that could not be read', unreadableHours)
