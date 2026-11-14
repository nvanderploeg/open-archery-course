const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** East-north metres of `p` in a plane tangent at `origin` (SPEC §5.1). */
export function toLocal(origin, p) {
  return {
    x: (p.lon - origin.lon) * RAD * EARTH_RADIUS_M * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * EARTH_RADIUS_M,
  };
}

export function fromLocal(origin, { x, y }) {
  return {
    lat: origin.lat + y / EARTH_RADIUS_M / RAD,
    lon: origin.lon + x / (EARTH_RADIUS_M * Math.cos(origin.lat * RAD)) / RAD,
  };
}

export function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The raster's affine placement from its three control corners.
 * `pixelToLatLon(u, v)` takes fractions of width and height, 0..1.
 */
export function rasterPlacement(corners) {
  const { topLeft: tl, topRight, bottomLeft } = corners;
  const tr = toLocal(tl, topRight);
  const bl = toLocal(tl, bottomLeft);
  const derivedBr = { x: tr.x + bl.x, y: tr.y + bl.y };
  return {
    widthM: Math.hypot(tr.x, tr.y),
    heightM: Math.hypot(bl.x, bl.y),
    diagonalM: Math.hypot(derivedBr.x, derivedBr.y),
    // Negative for an image laid out as drawn; positive means mirrored, zero means degenerate.
    cross: tr.x * bl.y - tr.y * bl.x,
    bottomRight: fromLocal(tl, derivedBr),
    pixelToLatLon: (u, v) => fromLocal(tl, { x: u * tr.x + v * bl.x, y: u * tr.y + v * bl.y }),
    offsetM: (p) => {
      const q = toLocal(tl, p);
      return Math.hypot(q.x - derivedBr.x, q.y - derivedBr.y);
    },
  };
}

const UNIT_M = { m: 1, yd: 0.9144, ft: 0.3048 };

export function metresTo(unit, m) {
  return m / UNIT_M[unit];
}
