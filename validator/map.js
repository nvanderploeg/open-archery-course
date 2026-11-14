/* global L */
import { distanceM, metresTo } from './lib/geo.js';

export const PEG = {
  white: '#f7f7f2',
  red: '#d7263d',
  yellow: '#f2c230',
  blue: '#2463c9',
  black: '#1d1d1f',
  green: '#2f9a48',
  orange: '#ef8a23',
  pink: '#ee6fae',
};

const POI_GLYPH = { parking: 'P', toilet: 'WC', water: 'W', shelter: 'S', first_aid: '+', practice: 'Pr', other: '•' };

const VECTOR_STYLE = {
  trail: { color: '#9c7440', weight: 3, dashArray: '6 4' },
  road: { color: '#77736b', weight: 5 },
  water: { color: '#3a7fc1', weight: 3, fillColor: '#9cc9ec', fillOpacity: 0.5 },
  building: { color: '#6e3b22', weight: 1.5, fillColor: '#b0603b', fillOpacity: 0.8 },
  boundary: { color: '#7a5c2e', weight: 2, dashArray: '10 5', fill: false },
  contour: { color: '#a8794a', weight: 1, opacity: 0.6, fill: false },
  vegetation: { color: '#4c8a3f', weight: 1, fillColor: '#4c8a3f', fillOpacity: 0.25 },
  hazard: { color: '#c0392b', weight: 3 },
  other: { color: '#555', weight: 2 },
};

/** Words for positions and butts by ruleset family (SPEC §8.3). */
function terms(ruleset) {
  const family = ruleset.split('-')[0];
  return {
    position: { wa: 'peg', ifaa: 'marker' }[family] ?? 'stake',
    butt: family === 'asa' || family === 'ibo' ? 'target' : 'butt',
    unit: family === 'wa' || family === 'ifaa' ? 'm' : 'yd',
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const latlng = (p) => [p.lat, p.lon];

/** An image placed by three corners, as an affine CSS transform (SPEC §5.1). */
const AffineImage = L.Layer.extend({
  initialize(url, corners, opacity) {
    this._url = url;
    this._corners = corners;
    this._opacity = opacity;
  },
  onAdd(map) {
    const img = (this._img = L.DomUtil.create('img', 'oac-raster leaflet-zoom-animated'));
    img.alt = '';
    img.style.opacity = this._opacity;
    img.onload = () => this._reset();
    img.src = this._url;
    map.getPane('raster').appendChild(img);
    map.on('zoom viewreset', this._reset, this);
    map.on('zoomanim', this._animate, this);
    this._reset();
  },
  onRemove(map) {
    this._img.remove();
    map.off('zoom viewreset', this._reset, this);
    map.off('zoomanim', this._animate, this);
  },
  getBounds() {
    const { topLeft, topRight, bottomLeft } = this._corners;
    const br = { lat: topRight.lat + bottomLeft.lat - topLeft.lat, lon: topRight.lon + bottomLeft.lon - topLeft.lon };
    return L.latLngBounds([topLeft, topRight, bottomLeft, br].map(latlng));
  },
  _place(project) {
    const img = this._img;
    if (!img?.naturalWidth) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const tl = project(latlng(this._corners.topLeft));
    const tr = project(latlng(this._corners.topRight));
    const bl = project(latlng(this._corners.bottomLeft));
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform = `matrix(${(tr.x - tl.x) / w},${(tr.y - tl.y) / w},${(bl.x - tl.x) / h},${(bl.y - tl.y) / h},${tl.x},${tl.y})`;
  },
  _reset() {
    this._place((ll) => this._map.latLngToLayerPoint(ll));
  },
  _animate(e) {
    this._place((ll) => this._map._latLngToNewLayerPoint(ll, e.zoom, e.center));
  },
});

export function createMapView(el, { onPick }) {
  const map = L.map(el, { maxZoom: 22, zoomSnap: 0.5, worldCopyJump: true }).setView([30, 0], 2);
  map.createPane('raster').style.zIndex = 250;
  map.createPane('vectors').style.zIndex = 300;
  map.createPane('faded').style.zIndex = 350;
  map.getPane('faded').classList.add('oac-faded');

  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const control = L.control.layers({ OpenStreetMap: osm, 'No base map': L.layerGroup() }, {}, { collapsed: true }).addTo(map);
  L.control.scale({ imperial: true }).addTo(map);

  let overlays = [];
  let pulse = null;

  function clear() {
    for (const { layer } of overlays) {
      control.removeLayer(layer);
      layer.remove();
    }
    overlays = [];
  }

  function addOverlay(name, layer, inControl = true) {
    layer.addTo(map);
    if (inControl) control.addOverlay(layer, name);
    overlays.push({ name, layer });
  }

  /**
   * Draws a schema-valid document. `assets` holds object URLs for the package's
   * raster and photos, and its parsed vector layer.
   */
  function render(doc, assets, { courseIndex, showOthers }) {
    clear();
    const raster = doc.map?.raster;
    if (raster && assets.rasterUrl) {
      const layer = new AffineImage(assets.rasterUrl, raster.corners, raster.opacity ?? 1);
      if (raster.attribution) layer.getAttribution = () => esc(raster.attribution);
      addOverlay('Raster', layer);
    }
    if (assets.vector) {
      const layer = vectorLayer(assets.vector);
      if (doc.map.vector.attribution) layer.getAttribution = () => esc(doc.map.vector.attribution);
      addOverlay('Vectors', layer);
    }
    if (showOthers)
      doc.courses.forEach((entry, ci) => {
        if (ci !== courseIndex) addOverlay(entry.key, courseLayer(entry.course, `/courses/${ci}/course`, 'faded'), false);
      });
    const entry = doc.courses[courseIndex];
    addOverlay(`Course: ${entry.key}`, courseLayer(entry.course, `/courses/${courseIndex}/course`, null));
    const photos = photoLayer(doc, entry.key, assets.photoUrls ?? {});
    if (photos) addOverlay('Photos', photos);
  }

  function courseLayer(course, at, pane) {
    const t = terms(course.ruleset);
    const opts = pane ? { pane, interactive: false } : {};
    const markerOpts = pane ? { pane, interactive: false, keyboard: false } : {};
    const group = L.layerGroup();
    const pick = (layer, pointer) => (pane ? layer : layer.on('click', () => onPick(pointer)));

    (course.walkways ?? []).forEach((w, wi) => {
      const name = (end) => (end === 'base' ? 'Base' : `Target ${end}`);
      pick(L.polyline(w.path.map(latlng), { ...opts, color: '#5b3d1e', weight: 3.5, dashArray: '1 7', lineCap: 'round' }), `${at}/walkways/${wi}`)
        .bindTooltip(`${name(w.from)} → ${name(w.to)}`, { sticky: true })
        .addTo(group);
      (w.waypoints ?? []).forEach((wp, k) =>
        pick(L.circleMarker(latlng(wp.point), { ...opts, radius: 5, color: '#5b3d1e', weight: 2, fillColor: '#fff', fillOpacity: 1 }), `${at}/walkways/${wi}/waypoints/${k}`)
          .bindTooltip(esc(wp.note))
          .addTo(group),
      );
    });

    (course.pois ?? []).forEach((poi, pi) =>
      pick(L.marker(latlng(poi.point), { ...markerOpts, icon: icon(`<span class="poi">${POI_GLYPH[poi.kind]}</span>`, 22) }), `${at}/pois/${pi}`)
        .bindTooltip(esc(poi.label ?? poi.kind.replace('_', ' ')))
        .addTo(group),
    );

    pick(L.marker(latlng(course.base), { ...markerOpts, icon: icon('<span class="base">Base</span>', [40, 20]) }), `${at}/base`)
      .bindTooltip(`${esc(course.name)} — assembly point`)
      .addTo(group);

    course.stations.forEach((s, si) => {
      const sp = `${at}/stations/${si}`;
      const butts = new Map(s.butts.map((b) => [b.id, b]));
      s.positions.forEach((p, pi) => {
        const targets = (p.shoots ?? s.butts.map((b) => b.id)).map((id) => butts.get(id)).filter(Boolean);
        for (const b of targets)
          L.polyline([latlng(p.point), latlng(b.point)], { ...opts, interactive: false, color: PEG[p.colours[0]], weight: 2, opacity: 0.75 }).addTo(group);
        const [c1, c2 = c1] = p.colours.map((c) => PEG[c]);
        pick(L.marker(latlng(p.point), { ...markerOpts, icon: icon(`<span class="peg" style="--c1:${c1};--c2:${c2}"></span>`, 16), zIndexOffset: 100 }), `${sp}/positions/${pi}`)
          .bindTooltip(positionTip(s, p, targets, t, course))
          .addTo(group);
      });
      s.butts.forEach((b, bi) =>
        pick(L.marker(latlng(b.point), { ...markerOpts, icon: icon(`<span class="butt">${s.number}</span>`, 24), zIndexOffset: 200 }), `${sp}/butts/${bi}`)
          .bindTooltip(buttTip(s, b, t))
          .addTo(group),
      );
    });
    return group;
  }

  function photoLayer(doc, key, urls) {
    const photos = doc.extensions?.['oac.photos']?.photos;
    if (!Array.isArray(photos)) return null;
    const entry = doc.courses.find((c) => c.key === key);
    const group = L.layerGroup();
    photos.forEach((ph, i) => {
      if (ph?.course !== key) return;
      const station = entry.course.stations.find((s) => s.number === ph.station);
      const at = ph.point ?? station?.butts[0]?.point;
      if (!at) return;
      const img = urls[ph.href] ? `<img src="${urls[ph.href]}" alt="${esc(ph.caption ?? '')}">` : '<em>Not in the package</em>';
      const caption = `Target ${ph.station}${ph.caption ? ` — ${esc(ph.caption)}` : ''}`;
      const rotate = typeof ph.bearingDeg === 'number' ? `style="--bearing:${ph.bearingDeg}deg"` : '';
      L.marker(latlng(at), { icon: icon(`<span class="photo" ${rotate}></span>`, 22), zIndexOffset: 300 })
        .bindPopup(`<figure class="photo-pop">${img}<figcaption>${caption}</figcaption></figure>`, { maxWidth: 280 })
        .on('click', () => onPick(`/extensions/oac.photos/photos/${i}`))
        .addTo(group);
    });
    return group;
  }

  /** Flies to a point and rings it briefly. */
  function focus(point) {
    map.flyTo(latlng(point), Math.max(map.getZoom(), 18), { duration: 0.6 });
    pulse?.remove();
    pulse = L.circleMarker(latlng(point), { radius: 18, color: '#ff3d00', weight: 3, fill: false, interactive: false, className: 'oac-pulse' }).addTo(map);
    setTimeout(() => pulse?.remove(), 2400);
  }

  function fit(doc, assets, courseIndex) {
    const pts = [];
    const c = doc.courses[courseIndex]?.course;
    if (c) {
      pts.push(latlng(c.base));
      c.stations.forEach((s) => [...s.butts, ...s.positions].forEach((x) => pts.push(latlng(x.point))));
      (c.walkways ?? []).forEach((w) => w.path.forEach((p) => pts.push(latlng(p))));
    }
    if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 19 });
  }

  return { render, fit, focus, clear, invalidate: () => map.invalidateSize() };
}

function icon(html, size) {
  const [w, h] = Array.isArray(size) ? size : [size, size];
  return L.divIcon({ html, className: 'oac-icon', iconSize: [w, h], iconAnchor: [w / 2, h / 2] });
}

function vectorLayer(fc) {
  return L.geoJSON(fc, {
    pane: 'vectors',
    style: (f) => vectorStyle(f.properties ?? {}),
    pointToLayer: (f, at) => {
      const props = f.properties ?? {};
      if (props.kind === 'label' && props.title)
        return L.marker(at, { pane: 'vectors', icon: L.divIcon({ className: 'oac-label', html: esc(props.title), iconSize: null }) });
      return L.circleMarker(at, { pane: 'vectors', radius: 4, ...vectorStyle(props) });
    },
    onEachFeature: (f, layer) => {
      const p = f.properties ?? {};
      const tip = [p.title, p.kind === 'contour' && p.eleM !== undefined ? `${p.eleM} m` : null].filter(Boolean).join(' · ');
      if (tip && p.kind !== 'label') layer.bindTooltip(esc(tip), { sticky: true });
    },
  });
}

function vectorStyle(p) {
  const base = { ...(VECTOR_STYLE[p.kind] ?? VECTOR_STYLE.other) };
  if (p.stroke) base.color = p.stroke;
  if (p['stroke-width'] !== undefined) base.weight = p['stroke-width'];
  if (p['stroke-opacity'] !== undefined) base.opacity = p['stroke-opacity'];
  if (p.fill) {
    base.fillColor = p.fill;
    base.fill = true;
  }
  if (p['fill-opacity'] !== undefined) base.fillOpacity = p['fill-opacity'];
  return base;
}

function positionTip(station, p, targets, t, course) {
  const colours = p.colours.join(' / ');
  const lines = [`<strong>Target ${station.number}</strong> · ${esc(colours)} ${t.position}`];
  if (p.distance) lines.push(`Posted ${p.distance.value} ${p.distance.unit}`);
  else lines.push('Unmarked');
  const unit = p.distance?.unit ?? t.unit;
  for (const b of targets) {
    const m = distanceM(p.point, b.point);
    let line = `GPS ${metresTo(unit, m).toFixed(0)} ${unit} to ${esc(b.label ?? b.id)}`;
    if (typeof p.point.eleM === 'number' && typeof b.point.eleM === 'number') {
      const deg = (Math.atan2(b.point.eleM - p.point.eleM, m) * 180) / Math.PI;
      line += ` · ${deg >= 0 ? 'up' : 'down'} ${Math.abs(deg).toFixed(0)}°`;
    }
    lines.push(line);
  }
  const legend = course.legend.filter((e) => p.colours.includes(e.colour)).map((e) => esc(e.label));
  if (legend.length) lines.push(`<span class="muted">${legend.join(' · ')}</span>`);
  if (p.note) lines.push(`<em>${esc(p.note)}</em>`);
  return lines.join('<br>');
}

function buttTip(station, b, t) {
  const face = b.face?.sizeCm ? `${b.face.sizeCm} cm face` : b.face?.group ? `group ${b.face.group}` : null;
  const lines = [`<strong>Target ${station.number}</strong> · ${t.butt} ${esc(b.id)}`];
  if (b.label || face) lines.push([b.label && esc(b.label), face].filter(Boolean).join(' · '));
  if (station.note) lines.push(`<em>${esc(station.note)}</em>`);
  return lines.join('<br>');
}
