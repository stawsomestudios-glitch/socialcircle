// The two places the map is centred on. Edit this file to correct them.
// The city kit has no building names, so these were matched against OpenStreetMap.

// OpenStreetMap leaves this building unnamed. It is chosen because the buildings
// around it are named as other buildings (Van-De-Velde-Bau, Kubus, Werkstattkubus).
export const MAIN_BUILDING = {
  label: 'Bauhaus main building',
  buildingIds: ['14780'],
}

// OpenStreetMap names this building "M18", at Marienstraße 18.
// The circle around it is a chosen size, not a boundary from the data.
export const M18_AREA = {
  label: 'M18',
  buildingIds: ['15065'],
  center: [11.32947, 50.97499], // longitude, latitude
  radius: 70, // metres
}

// The point the camera turns around: halfway between the two places.
export const FOCUS = [11.32929, 50.97475]
