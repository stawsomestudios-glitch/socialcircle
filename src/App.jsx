import { useEffect, useMemo, useState } from 'react'
import CityScene from './map/CityScene.jsx'
import { isInsideMap, placeOf } from './map/cityGeometry.js'
import { MAIN_BUILDING } from './map/places.js'
import { RAMP, buildHeat, buildSources, heatAt, hotspots } from './map/heat.js'

const FILES = {
  buildings: 'data/buildings.geojson',
  plots: 'data/plots.geojson',
  context: 'osm/context.geojson',
  highlights: 'osm/highlights.json',
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

// Quick jumps to typical moments of the day.
const MOMENTS = [
  ['Morning', 8],
  ['Lunch', 12.5],
  ['Afternoon', 16],
  ['Evening', 19],
  ['Night', 22],
  ['Late', 1],
]

// Below this share of the day's peak, the city is too quiet to name hotspots.
const QUIET = 0.12

async function loadData() {
  // The titles are drawn onto the map, so their font must be ready first.
  await document.fonts.load('40px Righteous', 'weimar')
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

const clock = (t) => {
  const h = Math.floor(t) % 24
  const m = Math.round((t - Math.floor(t)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// How busy the whole map is over the day. Click a bar to go to that hour.
function DayChart({ totals, t, onChange }) {
  const now = Math.floor(t) % 24
  return (
    <figure className="daychart">
      <div className="bars" role="group" aria-label="How busy Weimar is through the day">
        {totals.map((v, h) => (
          <button
            key={h}
            className={h === now ? 'bar on' : 'bar'}
            onClick={() => onChange(h)}
            aria-label={`${clock(h)}: ${Math.round(v * 100)}% of the busiest hour`}
          >
            <span style={{ height: `${Math.max(3, v * 100)}%` }} />
            <em className="tip">
              {clock(h)} · {Math.round(v * 100)}%
            </em>
          </button>
        ))}
      </div>
      <figcaption className="ticks">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </figcaption>
    </figure>
  )
}

function Timeline({ t, onChange, playing, onPlay }) {
  return (
    <section className="timeline">
      <button className="play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play the day'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <output htmlFor="hour" className="clock">{clock(t)}</output>
      <div className="track">
        <input
          id="hour"
          type="range"
          min="0"
          max="23.75"
          step="0.25"
          value={t}
          aria-label="Time of day"
          aria-valuetext={clock(t)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className="ticks" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>
      <p className="timeline-note">Estimated, typical weekday. Press ▶ to watch the day.</p>
    </section>
  )
}

function BuildingInfo({ feature, highlight, hour }) {
  const { id, height, source, address, name, height_estimated } = feature.properties
  const place = placeOf(feature)
  const names = highlight?.names.length ? highlight.names : name ? [name] : []
  return (
    <>
      {place === 'main' && <p>{MAIN_BUILDING.label}</p>}
      {highlight && (
        <p>
          {CATEGORY_LABELS[highlight.category]}: about {Math.round(highlight.activity[hour] * 100)}% busy at {clock(hour)}
        </p>
      )}
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

function Selection({ selected, data, hour }) {
  return (
    <section className="info">
      <h2>Selected building</h2>
      {selected.kind === 'building' ? (
        <BuildingInfo feature={selected.feature} highlight={data.highlights[selected.feature.properties.id]} hour={hour} />
      ) : (
        <p>Outside the black map area, so shown as an outline only.</p>
      )}
    </section>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [viewRequest, setViewRequest] = useState(null)
  const [t, setT] = useState(() => new Date().getHours())
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(e.message))
  }, [])

  // The heat for all 24 hours is worked out once, when the data arrives.
  const model = useMemo(() => {
    if (!data) return null
    const outside = data.context.features.filter((f) => f.properties.kind === 'building')
    const buildings = [...data.buildings.features, ...outside].filter(isInsideMap)
    const sources = buildSources(buildings, data.highlights, data.plots)
    return { sources, heat: buildHeat(sources) }
  }, [data])

  const grid = useMemo(() => (model ? heatAt(model.heat, t) : null), [model, t])
  const level = model ? model.heat.totals[Math.floor(t) % 24] : 0
  const spots = useMemo(() => (grid && level >= QUIET ? hotspots(grid, model.sources, t) : []), [grid, model, t, level])

  // Play runs through the day in quarter hours.
  useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(() => setT((v) => (v + 0.25) % 24), 140)
    return () => clearInterval(timer)
  }, [playing])

  if (error) return <p className="status">The map data didn't load ({error}).</p>
  if (!data || !model) return <p className="status">Loading Weimar…</p>

  const hour = Math.floor(t) % 24
  const goTo = (v) => {
    setPlaying(false)
    setT(v)
  }

  return (
    <div className="app">
      <CityScene
        data={data}
        grid={grid}
        max={model.heat.max}
        spots={spots}
        selected={selected}
        onSelect={setSelected}
        viewRequest={viewRequest}
      />

      <aside className="panel">
        <h1>socialcircle</h1>
        <p>Where people gather in Weimar through a typical weekday. The warmer the ground, the more people are likely to be there.</p>
        <div className="buttons">
          <button onClick={() => setViewRequest({ name: 'city' })}>Whole city</button>
          <button onClick={() => setViewRequest({ name: 'area' })}>City centre</button>
        </div>

        <h2>Through the day</h2>
        <DayChart totals={model.heat.totals} t={t} onChange={goTo} />
        <div className="moments">
          {MOMENTS.map(([label, v]) => (
            <button key={label} className={Math.floor(v) === hour ? 'on' : ''} onClick={() => goTo(v)}>
              {label} <small>{clock(v)}</small>
            </button>
          ))}
        </div>

        <h2>Busiest at {clock(t)}</h2>
        {spots.length ? (
          <ol className="spots">
            {spots.map((s, i) => (
              <li key={`${i}-${s.name}`}>
                <button
                  className="link"
                  onClick={() => setViewRequest({ box: [s.x - 120, s.z - 120, s.x + 120, s.z + 120], margin: 250, at: Date.now() })}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p>Quiet. Almost everything is closed, so no place stands out.</p>
        )}

        {selected && <Selection selected={selected} data={data} hour={hour} />}

        <h2>Key</h2>
        <div className="ramp" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${RAMP.join(', ')})` }} />
        <div className="ramp-labels">
          <span>a few people</span>
          <span>crowded</span>
        </div>
        <ul className="legend">
          <Key kind="main">Bauhaus main building</Key>
          <Key kind="black">Buildings in the map area</Key>
          <Key kind="outline">Buildings in the rest of Weimar</Key>
          <Key kind="border">Boundary of the city of Weimar</Key>
          <Key kind="water">Rivers, streams, ponds, springs, wells and fountains</Key>
        </ul>
        <p className="note">
          An estimate, not a count of real people. Each cafe, restaurant, bar, shop, museum, library and Bauhaus building
          warms the ground by its opening hours and size; squares and green spaces follow an assumed day rhythm. All hours
          share one scale, so you can compare them.
        </p>
      </aside>

      <Timeline t={t} onChange={goTo} playing={playing} onPlay={() => setPlaying((p) => !p)} />

      <footer className="attribution">
        {ATTRIBUTION} City boundary, surroundings and building types: ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL).
      </footer>
    </div>
  )
}
