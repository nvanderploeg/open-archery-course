import { distanceM, rasterPlacement } from './geo.js';

/** Known `formatVersion` minor within major 0. */
export const KNOWN_MINOR = 1;

const FAR_FROM_BASE_M = 25000;
const PHOTO_EXT = /\.(jpe?g|webp)$/i;

/** SPEC §10. Expects a document that already passed the schema. */
export function checkRules(doc) {
  const issues = [];
  const add = (level, code, path, message) => issues.push({ level, code, path, message });

  const minor = Number(doc.formatVersion.split('.')[1]);
  if (minor > KNOWN_MINOR)
    add('info', 'newer-minor', '/formatVersion', `Written for ${doc.formatVersion}; this validator knows 0.${KNOWN_MINOR}. Keys added since are reported as unknown.`);

  const keys = new Map();
  doc.courses.forEach((entry, ci) => {
    const at = `/courses/${ci}`;
    if (keys.has(entry.key))
      add('warning', 'course-key-duplicate', `${at}/key`, `Course key "${entry.key}" is already used by course ${keys.get(entry.key) + 1}.`);
    else keys.set(entry.key, ci);
    checkCourse(entry.course, `${at}/course`, add);
    checkCourseExtensions(entry.extensions, `${at}/extensions`, add);
  });

  checkRaster(doc.map?.raster, add);
  for (const [layer, spec] of Object.entries(doc.map ?? {})) checkHref(spec.href, `/map/${layer}/href`, add);
  checkTiles(doc.extensions?.['org.openarchery.tiles'], add);
  checkPhotos(doc, add);
  return issues;
}

function checkCourse(course, at, add) {
  const numbers = new Map();
  course.stations.forEach((s, si) => {
    if (numbers.has(s.number))
      add('warning', 'station-number-duplicate', `${at}/stations/${si}/number`, `Target ${s.number} appears more than once.`);
    else numbers.set(s.number, si);
  });
  const missing = [];
  for (let n = 1; n <= Math.max(...numbers.keys()); n++) if (!numbers.has(n)) missing.push(n);
  if (missing.length)
    add('warning', 'station-number-gap', `${at}/stations`, `Station numbers must run 1..n with no gaps; missing ${missing.join(', ')}.`);

  const ids = new Map();
  const claim = (id, path) => {
    if (ids.has(id)) add('warning', 'id-duplicate', path, `Id "${id}" is already used at ${ids.get(id)}.`);
    else ids.set(id, path);
  };

  const legend = new Map();
  for (const e of course.legend) {
    const marks = legend.get(e.colour) ?? new Set();
    marks.add(e.marked);
    legend.set(e.colour, marks);
  }
  const unmarkedRuleset = ['asa-3d', 'ibo-3d', 'wa-3d'].includes(course.ruleset);
  course.legend.forEach((e, li) => {
    if (unmarkedRuleset && e.marked)
      add('warning', 'ruleset-unmarked', `${at}/legend/${li}/marked`, `${course.ruleset} courses are unmarked; "${e.colour}" is marked.`);
  });

  const family = course.ruleset.split('-')[0];
  const buttStation = new Map();
  course.stations.forEach((s) => s.butts.forEach((b) => buttStation.set(b.id, s.number)));

  course.stations.forEach((s, si) => {
    const sp = `${at}/stations/${si}`;
    const butts = new Set(s.butts.map((b) => b.id));
    s.butts.forEach((b, bi) => claim(b.id, `${sp}/butts/${bi}`));

    if (family === 'asa' && s.butts.length !== 1)
      add('warning', 'lane-asa-butts', `${sp}/butts`, `ASA: Target ${s.number} must have exactly one butt, not ${s.butts.length}.`);

    const perColour = new Map();
    s.positions.forEach((p, pi) => {
      const pp = `${sp}/positions/${pi}`;
      claim(p.id, pp);
      for (const c of p.colours) perColour.set(c, [...(perColour.get(c) ?? []), pi]);

      for (const c of p.colours)
        if (!legend.has(c)) add('warning', 'colour-not-in-legend', `${pp}/colours`, `Colour "${c}" is not in the legend.`);

      const known = p.colours.filter((c) => legend.has(c));
      const marked = known.some((c) => legend.get(c).size === 1 && legend.get(c).has(true));
      const allUnmarked = known.length === p.colours.length && known.every((c) => legend.get(c).size === 1 && legend.get(c).has(false));
      if (marked && !p.distance)
        add('warning', 'distance-missing', pp, `Position "${p.id}" has a marked colour, so it needs the posted distance.`);
      if (allUnmarked && p.distance)
        add('warning', 'distance-on-unmarked', `${pp}/distance`, `Position "${p.id}" is unmarked, so it must carry no distance.`);

      for (const [k, id] of (p.shoots ?? []).entries()) {
        if (butts.has(id)) continue;
        const elsewhere = buttStation.get(id);
        add('warning', 'shoots-unknown-butt', `${pp}/shoots/${k}`,
          elsewhere ? `"${id}" is a butt on Target ${elsewhere}; shoots names butts in the same station.` : `No butt "${id}" in Target ${s.number}.`);
      }

      if (p.shoots && family === 'asa')
        add('warning', 'lane-asa-shoots', `${pp}/shoots`, 'ASA positions carry no shoots.');
      if (p.shoots && family === 'ifaa')
        add('warning', 'lane-ifaa-shoots', `${pp}/shoots`, 'IFAA derives shoots from marker order; do not store it.');
      checkFar(course.base, p.point, `${pp}/point`, add);
    });

    for (const [c, list] of perColour) {
      if (family === 'asa' && list.length > 1)
        add('warning', 'lane-asa-colour', `${sp}/positions/${list[1]}`, `ASA: Target ${s.number} has ${list.length} ${c} positions; at most one per colour.`);
      if (family === 'nfaa' && list.length === 4 && s.butts.length > 1)
        for (const pi of list)
          if (!s.positions[pi].shoots)
            add('warning', 'lane-nfaa-shoots', `${sp}/positions/${pi}`, `NFAA four-position shot on Target ${s.number}: "${s.positions[pi].id}" must say which butt it shoots.`);
    }
    s.butts.forEach((b, bi) => checkFar(course.base, b.point, `${sp}/butts/${bi}/point`, add));
  });

  (course.walkways ?? []).forEach((w, wi) => {
    for (const end of ['from', 'to'])
      if (w[end] !== 'base' && !numbers.has(w[end]))
        add('warning', 'walkway-end-unknown', `${at}/walkways/${wi}/${end}`, `Walkway ${end} names Target ${w[end]}, which does not exist.`);
  });
}

function checkFar(base, point, path, add) {
  const d = distanceM(base, point);
  if (d > FAR_FROM_BASE_M)
    add('warning', 'far-from-base', path, `This point is ${(d / 1000).toFixed(0)} km from the course base. Swapped lat and lon?`);
}

function checkRaster(raster, add) {
  if (!raster) return;
  const placed = rasterPlacement(raster.corners);
  if (Math.abs(placed.cross) < 1e-6)
    add('warning', 'raster-degenerate', '/map/raster/corners', 'The three corners are in a line, so the image cannot be placed.');
  else if (placed.cross > 0)
    add('warning', 'raster-mirrored', '/map/raster/corners', 'These corners place the image mirrored. Is bottomLeft swapped with topRight?');
  const br = raster.corners.bottomRight;
  if (br) {
    const off = placed.offsetM(br);
    if (off > 0.02 * placed.diagonalM)
      add('warning', 'raster-bottom-right', '/map/raster/corners/bottomRight',
        `bottomRight is ${off.toFixed(1)} m from the corner the other three imply, more than 2% of the ${placed.diagonalM.toFixed(0)} m diagonal.`);
  }
}

/** Why `href` is unsafe to follow (SPEC §2), or null. */
export function unsafeHref(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return 'is a URL';
  if (href.startsWith('/')) return 'is absolute';
  if (href.includes('\\')) return 'uses a backslash';
  if (href.split('/').includes('..')) return 'has a ".." segment';
  return null;
}

function checkHref(href, path, add) {
  if (typeof href !== 'string') return;
  const why = unsafeHref(href);
  if (why) add('warning', 'href-unsafe', path, `"${href}" ${why}; readers must not follow it.`);
}

function checkTiles(tiles, add) {
  if (!tiles) return;
  const at = '/extensions/org.openarchery.tiles';
  if (typeof tiles.href !== 'string') add('warning', 'tiles-href', `${at}/href`, 'Tiles need an href.');
  else checkHref(tiles.href, `${at}/href`, add);
  if (!['pmtiles', 'mbtiles'].includes(tiles.format))
    add('warning', 'tiles-format', `${at}/format`, 'Tiles format must be "pmtiles" or "mbtiles".');
  if (Number.isInteger(tiles.minZoom) && Number.isInteger(tiles.maxZoom) && tiles.minZoom > tiles.maxZoom)
    add('warning', 'tiles-zoom', `${at}/minZoom`, 'minZoom is above maxZoom.');
}

function checkPhotos(doc, add) {
  const ext = doc.extensions?.['org.openarchery.photos'];
  if (!ext) return;
  const at = '/extensions/org.openarchery.photos';
  if (!Array.isArray(ext.photos)) return add('warning', 'photos-list', `${at}/photos`, 'Expected a photos array.');
  const courses = new Map(doc.courses.map((c) => [c.key, c.course]));
  ext.photos.forEach((ph, i) => {
    const pp = `${at}/photos/${i}`;
    if (typeof ph.href !== 'string') add('warning', 'photo-href', `${pp}/href`, 'A photo needs an href.');
    else {
      checkHref(ph.href, `${pp}/href`, add);
      if (!PHOTO_EXT.test(ph.href)) add('warning', 'photo-type', `${pp}/href`, 'Photos are JPEG or WebP.');
    }
    const course = courses.get(ph.course);
    if (!course) return add('warning', 'photo-course', `${pp}/course`, `No course with key "${ph.course}".`);
    const station = course.stations.find((s) => s.number === ph.station);
    if (!station) return add('warning', 'photo-station', `${pp}/station`, `Course "${ph.course}" has no Target ${ph.station}.`);
    if (ph.of !== undefined && ![...station.butts, ...station.positions].some((x) => x.id === ph.of))
      add('warning', 'photo-of', `${pp}/of`, `No butt or position "${ph.of}" on Target ${ph.station} of "${ph.course}".`);
    if (ph.bearingDeg !== undefined && !(ph.bearingDeg >= 0 && ph.bearingDeg < 360))
      add('warning', 'photo-bearing', `${pp}/bearingDeg`, 'bearingDeg is degrees clockwise from north, 0 to under 360.');
  });
}

function checkCourseExtensions(ext, at, add) {
  for (const name of Object.keys(ext ?? {}))
    if (name === 'org.openarchery.tiles' || name === 'org.openarchery.photos')
      add('warning', 'extension-level', `${at}/${name}`, `${name} is a package-level extension; readers will not look for it here.`);
}
