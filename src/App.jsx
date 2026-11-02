import { useEffect, useState } from 'react'
import CityScene from './map/CityScene.jsx'
import { CONTEXT_COLOR, LAND_COLORS, M18_COLOR, MAIN_COLOR, USE_COLORS, placeOf } from './map/cityGeometry.js'
import { M18_AREA, MAIN_BUILDING } from './map/places.js'

const FILES = {
  kit: 'data/kit.json',
  buildings: 'data/buildings.geojson',
  plots: 'data/plots.geojson',
  streets: 'data/streets.geojson',
  context: 'osm/context.geojson',
}

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const nice = (name) => name.replaceAll('_', ' ')

async function loadData() {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${file}`)
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      return [key, await response.json()]
    }),
  )
  return Object.fromEntries(entries)
}

function Key({ color, children }) {
  return (
    <li>
      <span className="swatch" style={{ background: color }} />
      {children}
    </li>
  )
}

function BuildingInfo({ feature }) {
  const { id, height, floors, use, source, name, address, height_estimated } = feature.properties
  const place = placeOf(feature)
  return (
    <section className="info">
      <h2>Selected building</h2>
      {place === 'main' && <p>Marked as the {MAIN_BUILDING.label}.</p>}
      {place === 'm18' && <p>Marked as {M18_AREA.label}, Marienstraße 18.</p>}
      {name && <p>{name}</p>}
      {address && <p>{address}</p>}
      {source === 'osm' ? (
        <p>
          {id} · {height_estimated ? `about ${height} m (estimated)` : `${height} m`} · from OpenStreetMap
        </p>
      ) : (
        <p>
          ID {id} · {height} m · {floors ?? 'unknown'} floors · {nice(use ?? 'undefined')}
        </p>
      )}
    </section>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [resetSignal, setResetSignal] = useState(0)

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="status error">The city kit didn't load ({error}).</p>
  if (!data) return <p className="status">Loading Weimar…</p>

  return (
    <div className="app">
      <CityScene data={data} selected={selected} onSelect={setSelected} resetSignal={resetSignal} />

      <aside className="panel">
        <h1>Weimar in 3D</h1>
        <p className="hint">
          Drag to orbit, right-drag to pan, scroll to zoom. Click a building to read its details.
        </p>
        <button onClick={() => setResetSignal((n) => n + 1)}>Back to Bauhaus and M18</button>
        {selected && <BuildingInfo feature={selected} />}
        <ul className="legend">
          <Key color={MAIN_COLOR}>{MAIN_BUILDING.label}</Key>
          <Key color={M18_COLOR}>{M18_AREA.label}, with a {M18_AREA.radius} m circle</Key>
          <Key color={CONTEXT_COLOR}>surroundings (OpenStreetMap, heights mostly estimated)</Key>
        </ul>
        <h2>Building use</h2>
        <ul className="legend columns">
          {Object.entries(USE_COLORS).map(([use, color]) => (
            <Key key={use} color={color}>
              {use === 'undefined' ? 'use unknown' : nice(use)}
            </Key>
          ))}
        </ul>
        <h2>Ground</h2>
        <ul className="legend columns">
          <Key color={LAND_COLORS.recreation}>recreation</Key>
          <Key color={LAND_COLORS.cemetery}>cemetery</Key>
          <Key color={LAND_COLORS.square}>square</Key>
          <Key color={LAND_COLORS['flowing water']}>water</Key>
        </ul>
      </aside>

      <footer className="attribution">
        {ATTRIBUTION} Surroundings: ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL).
      </footer>
    </div>
  )
}
