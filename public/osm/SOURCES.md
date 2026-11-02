# Surroundings from OpenStreetMap

`context.geojson` holds the area around the city kit: buildings, roads, water and green space. It leaves out what the kit already covers. Don't edit it by hand; `scripts/build-osm-context.mjs` makes it from a raw download.

Downloaded 2026-11-02 from the Overpass API. Licence: Open Database License (ODbL), © OpenStreetMap contributors, https://www.openstreetmap.org/copyright.

Bounding box, west, south, east, north: 11.305, 50.965, 11.346, 50.9925.

## Fields

- `kind`: `building`, `land`, `road` or `waterway`.
- Buildings: `id`, optional `name`, `address` and `floors`, `height` in metres and `height_estimated`.
- Land: `landuse`, one of `recreation`, `cemetery`, `flowing water`.

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
