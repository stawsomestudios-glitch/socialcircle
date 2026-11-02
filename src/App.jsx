import { useEffect, useState } from 'react'
import CityScene, { GLOW_REACH_M } from './map/CityScene.jsx'
import { CATEGORY_COLORS, GLOW_COLOR, GROUND_COLOR, LAND_COLORS, M18_COLOR, MAIN_COLOR, NEUTRAL_TONES, placeOf } from './map/cityGeometry.js'
import { M18_AREA, MAIN_BUILDING } from './map/places.js'

const FILES = {
  kit: 'data/kit.json',
  buildings: 'data/buildings.geojson',
  plots: 'data/plots.geojson',
  streets: 'data/streets.geojson',
  context: 'osm/context.geojson',
  highlights: 'osm/highlights.json',
}

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

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

const CATEGORY_LABELS = {
  bauhaus: 'Bauhaus school buildings',
  cafe: 'Cafes',
  food: 'Restaurants and bars',
  shop: 'Shops and supermarkets',
  museum: 'Museums',
  library: 'Libraries',
}

function BuildingInfo({ feature, highlight }) {
  const { id, height, source, address, name, height_estimated } = feature.properties
  const place = placeOf(feature)
  const names = highlight?.names.length ? highlight.names : name ? [name] : []
  return (
    <section className="info">
      <h2>Selected building</h2>
      {place === 'main' && <p>{MAIN_BUILDING.label}, Geschwister-Scholl-Straße 8</p>}
      {place === 'm18' && <p>{M18_AREA.label}, Marienstraße 18</p>}
      {!place && highlight && <p>{CATEGORY_LABELS[highlight.category]}</p>}
      {names.map((text) => (
        <p key={text}>{text}</p>
      ))}
      {address && <p>{address}</p>}
      <p>
        {source === 'osm' ? id : `ID ${id}`} · {height_estimated ? `about ${height} m (estimated)` : `${height} m`}
      </p>
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
        <h1>SocialCircle</h1>
        <p className="hint">
          Where in Weimar you may run into people you know. Drag to orbit, right-drag to pan, scroll to
          zoom. Click a building to read its details.
        </p>
        <button onClick={() => setResetSignal((n) => n + 1)}>Back to Bauhaus and M18</button>
        {selected && (
          <BuildingInfo feature={selected} highlight={data.highlights[selected.properties.id]} />
        )}
        <h2>Likely to run into people</h2>
        <ul className="legend">
          <Key color={MAIN_COLOR}>{MAIN_BUILDING.label}</Key>
          <Key color={M18_COLOR}>{M18_AREA.label}, with a {M18_AREA.radius} m circle</Key>
          {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
            <Key key={category} color={CATEGORY_COLORS[category]}>
              {label}
            </Key>
          ))}
          <Key color={GLOW_COLOR}>Ground glow, {GLOW_REACH_M} m around these; stronger where they cluster</Key>
        </ul>
        <h2>Unlikely to run into people</h2>
        <ul className="legend">
          <Key color={NEUTRAL_TONES[1]}>All other buildings</Key>
          <Key color={GROUND_COLOR}>Ground between buildings</Key>
          <Key color={LAND_COLORS.recreation}>Parks and green space</Key>
          <Key color={LAND_COLORS['flowing water']}>Water</Key>
        </ul>
        <p className="hint note">An estimate from what each place is, not a record of where people actually go.</p>
      </aside>

      <footer className="attribution">
        {ATTRIBUTION} Surroundings and building types: ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL).
      </footer>
    </div>
  )
}
