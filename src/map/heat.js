import * as THREE from 'three'
import { AREA_BOX, toLocal } from './cityGeometry.js'

// The heat map: where people are likely to gather at each hour of a typical weekday.
// Every place adds warmth around it: how busy it is at that hour × how many people it holds.
// These are estimates from opening hours and the usual rhythm of each kind of place.
// Nothing here counts real people. Change the numbers below to test other assumptions.

export const CELL_M = 6 // size of one heat cell, metres
const SPREAD_M = 24 // how far the warmth of a place spreads (the soft edge), metres
const SAMPLE_M = 14 // big buildings and squares are sampled every this many metres

// How many people a kind of place holds, relative to a cafe.
const CROWD = { bauhaus: 3, library: 1.6, museum: 1.4, food: 1.3, cafe: 1, shop: 0.7, square: 1.4, park: 0.9 }

// Assumed day rhythms for open spaces, 00:00 to 23:00, from 0 (empty) to 1 (busiest).
// Squares: a little at night, market and lunch in the day, a peak after work, evening life.
const SQUARE = [0.12, 0.08, 0.05, 0.03, 0.03, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.85, 0.7, 0.7, 0.8, 0.95, 0.9, 0.75, 0.6, 0.45, 0.3, 0.2]
// Parks and green spaces: quiet mornings, afternoon walks, empty after dark.
const PARK = [0.02, 0.01, 0, 0, 0, 0.02, 0.06, 0.12, 0.18, 0.25, 0.32, 0.4, 0.5, 0.55, 0.6, 0.65, 0.65, 0.55, 0.4, 0.25, 0.12, 0.06, 0.04, 0.03]

const [X0, Z0, X1, Z1] = AREA_BOX
export const NX = Math.ceil((X1 - X0) / CELL_M)
export const NZ = Math.ceil((Z1 - Z0) / CELL_M)

function inRing([x, z], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const crosses = ring[i][1] > z !== ring[j][1] > z
    if (crosses && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside
  }
  return inside
}
function area(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  return Math.abs(a / 2)
}
// Points spread evenly over a footprint, so a long building or a big square warms its whole length.
function samples(ring) {
  const xs = ring.map((p) => p[0])
  const zs = ring.map((p) => p[1])
  const out = []
  for (let x = Math.min(...xs) + SAMPLE_M / 2; x < Math.max(...xs); x += SAMPLE_M)
    for (let z = Math.min(...zs) + SAMPLE_M / 2; z < Math.max(...zs); z += SAMPLE_M) if (inRing([x, z], ring)) out.push([x, z])
  if (!out.length) out.push([xs.reduce((a, b) => a + b) / xs.length, zs.reduce((a, b) => a + b) / zs.length])
  return out
}

// Every source of warmth: the places in highlights.json, plus squares and green spaces from the city kit.
export function buildSources(buildings, highlights, plots) {
  const sources = []
  const add = (ring, category, activity, name) => {
    const size = Math.min(2.5, Math.max(0.6, Math.sqrt(area(ring)) / 18))
    sources.push({ points: samples(ring), weight: CROWD[category] * size, activity, category, name })
  }
  for (const f of buildings) {
    const h = highlights[String(f.properties.id)]
    if (h) add(f.geometry.coordinates[0].map(toLocal), h.category, h.activity, h.names[0] ?? null)
  }
  for (const f of plots.features) {
    const use = f.properties.landuse
    if (use !== 'square' && use !== 'recreation') continue
    const ring = f.geometry.coordinates[0].map(toLocal)
    add(ring, use === 'square' ? 'square' : 'park', use === 'square' ? SQUARE : PARK, null)
  }
  return sources
}

// Adds up the warmth of every source on a grid, once for each of the 24 hours.
export function buildHeat(sources) {
  const hours = Array.from({ length: 24 }, () => new Float32Array(NX * NZ))
  const reach = Math.ceil((SPREAD_M * 2.5) / CELL_M)
  const k2 = 1 / (2 * SPREAD_M * SPREAD_M)
  for (const s of sources) {
    const w = s.weight / s.points.length
    const act = s.activity
    for (const [px, pz] of s.points) {
      const ci = Math.floor((px - X0) / CELL_M)
      const cj = Math.floor((pz - Z0) / CELL_M)
      for (let j = Math.max(0, cj - reach); j <= Math.min(NZ - 1, cj + reach); j++)
        for (let i = Math.max(0, ci - reach); i <= Math.min(NX - 1, ci + reach); i++) {
          const dx = X0 + (i + 0.5) * CELL_M - px
          const dz = Z0 + (j + 0.5) * CELL_M - pz
          const k = w * Math.exp(-(dx * dx + dz * dz) * k2)
          if (k < 1e-4) continue
          const cell = j * NX + i
          for (let h = 0; h < 24; h++) if (act[h]) hours[h][cell] += act[h] * k
        }
    }
  }
  // One scale for the whole day, so hours can be compared with each other.
  let max = 0
  for (const g of hours) for (const v of g) if (v > max) max = v
  const totals = hours.map((g) => g.reduce((a, b) => a + b, 0))
  const peak = Math.max(...totals)
  return { hours, max, totals: totals.map((t) => t / peak) }
}

// The heat at any moment, blending between whole hours, e.g. 17.25 is a quarter past five.
export function heatAt(heat, t) {
  const a = Math.floor(t) % 24
  const b = (a + 1) % 24
  const f = t - Math.floor(t)
  const ga = heat.hours[a]
  const gb = heat.hours[b]
  const out = new Float32Array(ga.length)
  for (let i = 0; i < ga.length; i++) out[i] = ga[i] + (gb[i] - ga[i]) * f
  return out
}

// One hue, light to dark: pale pink when a few people are about, deep red where it is most crowded.
export const RAMP = ['#fde3df', '#f8b4ab', '#ee7b70', '#d9443b', '#a4201e', '#6e1212']
const rampColors = RAMP.map((c) => new THREE.Color(c))

function colourOf(v, out) {
  const p = Math.min(1, v) * (rampColors.length - 1)
  const i = Math.min(rampColors.length - 2, Math.floor(p))
  out.lerpColors(rampColors[i], rampColors[i + 1], p - i)
}

export function makeTexture() {
  const data = new Uint8Array(NX * NZ * 4)
  const texture = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Paints the heat into the texture. Rows run south to north, the way the ground plane expects.
export function paintTexture(texture, grid, max) {
  const data = texture.image.data
  const c = new THREE.Color()
  for (let j = 0; j < NZ; j++) {
    const row = NZ - 1 - j
    for (let i = 0; i < NX; i++) {
      const v = Math.sqrt(grid[j * NX + i] / max) // square root, so quieter places still show
      const o = (row * NX + i) * 4
      if (v < 0.04) {
        data[o + 3] = 0
        continue
      }
      colourOf(v, c)
      data[o] = c.r * 255
      data[o + 1] = c.g * 255
      data[o + 2] = c.b * 255
      // fade out softly over the last 8 cells at the edge of the data area, instead of a hard line
      const edge = Math.min(i, NX - 1 - i, j, NZ - 1 - j)
      data[o + 3] = Math.min(1, (v - 0.04) / 0.18) * Math.min(1, edge / 8) * 235
    }
  }
  texture.needsUpdate = true
}

// The busiest spots at a moment: the warmest cells, at least 180 m apart, named after the place that warms them most.
export function hotspots(grid, sources, t, count = 3) {
  const h = Math.floor(t) % 24
  const taken = []
  let top = 0
  for (const v of grid) if (v > top) top = v
  const order = []
  for (let i = 0; i < grid.length; i++) if (grid[i] > top * 0.2) order.push(i)
  order.sort((a, b) => grid[b] - grid[a])
  for (const cell of order) {
    if (taken.length >= count || grid[cell] <= 0) break
    const x = X0 + ((cell % NX) + 0.5) * CELL_M
    const z = Z0 + (Math.floor(cell / NX) + 0.5) * CELL_M
    if (taken.some((s) => Math.hypot(s.x - x, s.z - z) < 180)) continue
    let best = null
    let bestK = 0
    for (const s of sources) {
      for (const [px, pz] of s.points) {
        const d2 = (px - x) ** 2 + (pz - z) ** 2
        if (d2 > 90 * 90) continue
        const k = s.activity[h] * s.weight * Math.exp(-d2 / (2 * SPREAD_M * SPREAD_M))
        if (k > bestK) [bestK, best] = [k, s]
      }
    }
    let name = best?.name
    if (!name) {
      // squares and green spaces have no names in the data: use the nearest named place
      let near = null
      let nd = 160 * 160
      for (const s of sources)
        if (s.name)
          for (const [px, pz] of s.points) {
            const d2 = (px - x) ** 2 + (pz - z) ** 2
            if (d2 < nd) [nd, near] = [d2, s.name]
          }
      const kind = best?.category === 'park' ? 'green space' : 'square'
      name = near ? `${kind} near ${near}` : kind
    }
    taken.push({ x, z, name })
  }
  return taken
}

export const PLANE = { width: NX * CELL_M, depth: NZ * CELL_M, x: X0 + (NX * CELL_M) / 2, z: Z0 + (NZ * CELL_M) / 2 }
