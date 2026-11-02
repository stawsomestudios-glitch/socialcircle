import { useEffect, useState } from 'react'
import CityScene from './map/CityScene.jsx'
import { placeOf } from './map/cityGeometry.js'
import { MAIN_BUILDING } from './map/places.js'

const FILES = {
  buildings: 'data/buildings.geojson',
  context: 'osm/context.geojson',
  highlights: 'osm/highlights.json',
  routes: 'osm/routes.json',
  city: 'osm/city.json',
  water: 'osm/water.json',
}

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const CATEGORY_LABELS = {
  bauhaus: 'Bauhaus school building',
  cafe: 'Cafe',
  food: 'Restaurant or bar',
  shop: 'Shop or supermarket',
  museum: 'Museum',
  library: 'Library',
}

const ROUTE_NAMES = { most: 'SOCIAL route', least: 'ANTISOCIAL route' }

async function loadData() {
  // The titles are drawn onto the map, so their font must be ready first.
  await document.fonts.load('40px Righteous', 'merketalstraße')
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${file}`)
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      return [key, await response.json()]
    }),
  )
  return Object.fromEntries(entries)
}

function Key({ kind, children }) {
  return (
    <li>
      <span className={`symbol ${kind}`} />
      <span>{children}</span>
    </li>
  )
}

function RouteLine({ route }) {
  return (
    <>
      {route.length_m.toLocaleString('en')} m, about {route.minutes} min · {route.social_percent}% in social
      areas · passes {route.places_passed} social buildings
    </>
  )
}

function BuildingInfo({ feature, highlight }) {
  const { id, height, source, address, name, height_estimated } = feature.properties
  const place = placeOf(feature)
  const names = highlight?.names.length ? highlight.names : name ? [name] : []
  return (
    <>
      {place === 'main' && <p>{MAIN_BUILDING.label}</p>}
      {highlight && <p>{CATEGORY_LABELS[highlight.category]}: social</p>}
      {names.map((text) => (
        <p key={text}>{text}</p>
      ))}
      {address && <p>{address}</p>}
      <p>
        {source === 'osm' ? id : `ID ${id}`} · {height_estimated ? `about ${height} m (estimated)` : `${height} m`}
      </p>
    </>
  )
}

function Selection({ selected, data }) {
  return (
    <section className="info">
      {selected.kind === 'route' ? (
        <>
          <h2>{ROUTE_NAMES[selected.key]}</h2>
          <p>
            <RouteLine route={data.routes[selected.key]} />
          </p>
        </>
      ) : (
        <>
          <h2>Selected building</h2>
          {selected.kind === 'building' ? (
            <BuildingInfo feature={selected.feature} highlight={data.highlights[selected.feature.properties.id]} />
          ) : (
            <p>Outside the black map area, so shown as an outline only.</p>
          )}
        </>
      )}
    </section>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [viewRequest, setViewRequest] = useState(null)

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="status">The map data didn't load ({error}).</p>
  if (!data) return <p className="status">Loading Weimar…</p>

  return (
    <div className="app">
      <CityScene data={data} selected={selected} onSelect={setSelected} viewRequest={viewRequest} />

      <aside className="panel">
        <h1>socialcircle</h1>
        <p>Drag to orbit, right-drag to pan, scroll to zoom. Click a building or route to go to it.</p>
        <div className="buttons">
          <button onClick={() => setViewRequest({ name: 'city' })}>Whole city</button>
          <button onClick={() => setViewRequest({ name: 'area' })}>Route area</button>
        </div>
        {selected && <Selection selected={selected} data={data} />}
        <ul className="legend">
          <Key kind="main">Bauhaus main building</Key>
          <Key kind="black">Buildings in the map area</Key>
          <Key kind="outline">Buildings in the rest of Weimar</Key>
          <Key kind="border">Boundary of the city of Weimar</Key>
          <Key kind="water">Rivers, streams, ponds, springs, wells and fountains</Key>
        </ul>
        <h2>merketalstraße to bauhaus</h2>
        <ul className="legend">
          <Key kind="route-most">
            <strong>SOCIAL.</strong> <RouteLine route={data.routes.most} />
          </Key>
          <Key kind="route-least">
            <strong>ANTISOCIAL.</strong> <RouteLine route={data.routes.least} />
          </Key>
        </ul>
        <p className="note">
          An estimate from what each place is, not a record of where people actually go. Routes are at most
          1.6 × the shortest walk.
        </p>
      </aside>

      <footer className="attribution">
        {ATTRIBUTION} City boundary, surroundings, building types and routes: ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL).
      </footer>
    </div>
  )
}
