# Surroundings from OpenStreetMap

`context.geojson` holds the parts of the map outside the city kit: buildings, roads and water, inside the boundary in `src/map/places.js`. It leaves out what the kit already covers. Don't edit it by hand; `scripts/build-osm-context.mjs` makes it from a raw download.

Downloaded 2026-11-02 from the Overpass API. Licence: Open Database License (ODbL), © OpenStreetMap contributors, https://www.openstreetmap.org/copyright.

Downloaded area, west, south, east, north: 11.305, 50.958, 11.346, 50.9925. The map uses a smaller area inside it.

## Fields

- `kind`: `building`, `road` or `waterway`.
- Buildings: `id`, optional `name`, `address` and `floors`, `height` in metres and `height_estimated`.

## How to read it

Heights here are less reliable than the kit's measured heights. If a building has no `height` tag, its height is floors × 3 m + 1 m. With no floors either, it's 8 m, or 3 m for a small building such as a garage or shed. These are estimates for showing the surroundings, not for measuring.

## Query

```
[out:json][timeout:180][bbox:50.9650,11.3050,50.9925,11.3460];
(way["building"];relation["building"];way["highway"];
 way["landuse"~"^(grass|meadow|forest|recreation_ground|cemetery|village_green|allotments)$"];
 way["leisure"~"^(park|garden|pitch)$"];relation["leisure"="park"];
 way["natural"~"^(water|wood)$"];way["waterway"="river"];way["waterway"="stream"];
 relation["natural"="water"];);
out geom;
```

## `highlights.json`

The buildings where people gather, keyed by building id, with `category` (`museum`, `library`, `cafe`, `food`, `shop` or `bauhaus`) and the OpenStreetMap `names` found there. `scripts/build-osm-highlights.mjs` makes it. Downloaded 2026-11-02, same licence.

`activity` is an estimated 24-hour rhythm, from 0 to 1. Nothing here measures where people actually go. It combines two things: a typical rhythm for each kind of place, assumed in `scripts/build-osm-highlights.mjs`, and the place's real opening hours from OpenStreetMap, where listed, read for a weekday in November. A building with several places is as busy as its busiest one.

How it decides:

- A whole building counts even if the place takes up only part of it, such as a cafe on the ground floor.
- If a building has several, the order is museum, library, cafe, food, shop, Bauhaus.
- A place is only matched to a building that contains it or lies within 15 m of it.
- The kit's main use also counts: `retail` as shop, `food_and_drink` as food.
- Archives tagged as libraries are left out, and so are shops people rarely linger in, listed in the script.
- Bauhaus means the entry names Bauhaus-Universität or a Bauhaus institute, or gives it as operator. Other schools and buildings with no such evidence aren't included.

```
[out:json][timeout:120][bbox:50.9650,11.3050,50.9925,11.3460];
(nwr["amenity"~"^(cafe|library|university|college)$"];nwr["tourism"="museum"];
 nwr["building"="museum"];nwr["building"~"^(university|college)$"];);
out geom;
```

```
[out:json][timeout:120][bbox:50.9650,11.3050,50.9925,11.3460];
(nwr["amenity"~"^(restaurant|fast_food|bar|pub|biergarten|nightclub|food_court|ice_cream)$"];nwr["shop"];);
out geom;
```

The strip south of 50.965 came from one more query, 2026-11-02:

```
[out:json][timeout:150][bbox:50.9580,11.3180,50.9655,11.3460];
(way["building"];relation["building"];way["highway"];
 nwr["amenity"~"^(cafe|library|university|college|restaurant|fast_food|bar|pub|biergarten|nightclub|food_court|ice_cream)$"];
 nwr["tourism"="museum"];nwr["shop"];way["waterway"];);
out geom;
```

## The heat map

Not a file: the page works it out when it loads, in `src/map/heat.js`. It shows where people are likely to gather at each hour of a typical weekday.

- Every place in `highlights.json` warms the ground around it by its `activity` at that hour, times how many people it holds: an assumed crowd factor per kind of place (Bauhaus 3, library 1.6, museum 1.4, restaurant or bar 1.3, cafe 1, shop 0.7) and the size of its footprint.
- Squares and green spaces from the city kit's `plots.geojson` (`square` and `recreation`) follow an assumed day rhythm, written in `heat.js`.
- The warmth spreads about 24 m with a soft edge, on a 6 m grid. All 24 hours share one scale, so hours can be compared. Between whole hours the page blends the two.
- The three busiest spots are the warmest cells at least 180 m apart, named after the place that warms them most. Squares have no names in the data, so they take the nearest named place.

The crowd factors and the square and park rhythms are assumptions, not data. Nothing here counts real people.

## `city.json`

The rest of the city, made by `scripts/build-city.mjs`:

- `boundary`: the administrative boundary of the city of Weimar, as rings of longitude and latitude.
- `buildings`: the outline of every building inside the city but outside the black map area. These have no heights or names.

Downloaded 2026-11-02 from the Overpass API, same licence:

```
[out:json][timeout:220];
area["boundary"="administrative"]["name"="Weimar"]["admin_level"="6"]->.w;
(rel(pivot.w);way["building"](area.w););
out geom;
```

## `water.json`

All the water in the city that OpenStreetMap lists above ground, made by `scripts/build-water.mjs`:

- `areas`: ponds, lakes, reservoirs, basins and fountains with an outline, as an outline and any islands.
- `rivers`: the Ilm.
- `streams`: streams, ditches, drains, canals, weirs and fish passes.
- `points`: springs, wells, drinking water and fountains marked as a single point.

Water running underground is left out. Downloaded 2026-11-02 from the Overpass API, same licence:

```
[out:json][timeout:180];
area["boundary"="administrative"]["name"="Weimar"]["admin_level"="6"]->.w;
(way["natural"="water"](area.w);relation["natural"="water"](area.w);
 way["landuse"~"^(reservoir|basin)$"](area.w);way["waterway"](area.w);
 node["natural"="spring"](area.w);nwr["amenity"~"^(fountain|drinking_water)$"](area.w);
 nwr["man_made"="water_well"](area.w););
out geom;
```
