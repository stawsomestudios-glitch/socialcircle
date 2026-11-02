// The places and limits the map is built around. Edit this file to correct them.

// OpenStreetMap lists "Hauptgebäude", Geschwister-Scholl-Straße 8, inside this footprint.
export const MAIN_BUILDING = {
  label: 'Bauhaus main building, Geschwister-Scholl-Straße 8',
  buildingIds: ['14780'],
}

// The routes start from a general point on this street, on purpose not a specific address.
export const ROUTE_START = {
  label: 'merketalstraße',
  location: [11.336, 50.96458], // longitude, latitude
}

// The titles drawn on the map. `anchor` sets which side of the point the text sits on,
// so the three titles around the campus don't cover each other: [1, 0.5] puts the text
// to the left of the point, [0, 0.5] to the right, and a negative second number lifts it
// clear above.
export const TITLES = [
  { text: 'merketalstraße', location: ROUTE_START.location, anchor: [-0.06, 0.5] },
  { text: 'bauhaus main building', buildingId: '14780', anchor: [1.14, 0.5] },
  { text: 'm18', buildingId: '15065', anchor: [0.5, -0.65] }, // OpenStreetMap: M18, Marienstraße 18
  { text: 'mensa', buildingId: '15293', anchor: [0, 0.5] }, // OpenStreetMap: Mensa am Park
  // Café Lieblingsgarten is listed at Jakobstraße 10. OpenStreetMap names the cafe there
  // "Café du jardin", so this building is matched by address, not by name.
  { text: 'lieblingsgarten', buildingId: '23969', anchor: [0, 0.5] },
]

// The map runs from south of Merketalstraße to north of Café Lieblingsgarten,
// Jakobstraße 10. West, south, east, north. The width is a chosen margin that leaves
// the routes room to differ.
export const MAP_BOUNDARY = [11.3235, 50.9625, 11.3385, 50.983]

// How far the social area reaches from a social building's outline, in metres.
// Used to score the routes.
export const SOCIAL_REACH_M = 25

// The point the camera turns around: the middle of the map.
export const FOCUS = [11.331, 50.97275]
