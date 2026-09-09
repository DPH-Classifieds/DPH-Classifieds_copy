// CARTO's basemaps now need an API key: unauthenticated requests still return
// HTTP 200, but the PNG has "API KEY REQUIRED" burned into it, so every map on
// the site rendered watermarked. OpenStreetMap's standard tiles are keyless.
//
// ponytail: env override so a paid provider (CARTO/MapTiler/Stadia) can be
// dropped in without another code change — set both vars and redeploy.
export const MAP_TILE_URL =
  process.env.REACT_APP_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_TILE_ATTRIBUTION =
  process.env.REACT_APP_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
