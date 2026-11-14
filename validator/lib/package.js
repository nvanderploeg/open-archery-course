import { unsafeHref } from './rules.js';
import { distanceM } from './geo.js';

export const MIMETYPE = 'application/vnd.openarchery.course+zip';
export const SIZE_LIMIT = 25 * 1024 * 1024;

const VECTOR_KINDS = ['trail', 'road', 'water', 'building', 'boundary', 'contour', 'vegetation', 'hazard', 'label', 'other'];
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The first local file header, which must be the stored `mimetype` entry (SPEC §2). */
export function firstEntry(bytes) {
  if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method = view.getUint16(8, true);
  const nameLen = view.getUint16(26, true);
  return { name: new TextDecoder().decode(bytes.subarray(30, 30 + nameLen)), stored: method === 0 };
}

/** Unzips a package. Throws when the bytes are not a zip. */
export async function openPackage(bytes, JSZip) {
  const zip = await JSZip.loadAsync(bytes);
  const files = new Map();
  for (const entry of Object.values(zip.files)) if (!entry.dir) files.set(entry.name, await entry.async('uint8array'));
  return { size: bytes.length, first: firstEntry(bytes), files };
}

/** Package-level checks that do not depend on course.json. */
export function checkContainer(pkg) {
  const issues = [];
  const add = (level, code, message) => issues.push({ level, code, path: null, message });

  if (pkg.size > SIZE_LIMIT)
    add('warning', 'package-size', `The package is ${(pkg.size / 1048576).toFixed(1)} MB; it should be under 25 MB.`);

  const mime = pkg.files.get('mimetype');
  if (!pkg.first || pkg.first.name !== 'mimetype')
    add('warning', 'mimetype-first', `"mimetype" must be the first entry in the zip${pkg.first ? `; found "${pkg.first.name}"` : ''}.`);
  else if (!pkg.first.stored) add('warning', 'mimetype-stored', '"mimetype" must be stored uncompressed.');
  if (mime) {
    const text = decode(mime);
    if (text !== MIMETYPE)
      add('warning', 'mimetype-content', `"mimetype" must hold exactly ${MIMETYPE}${text?.trim() === MIMETYPE ? ' with no trailing whitespace' : ''}.`);
  }

  for (const name of pkg.files.keys()) {
    const why = unsafeHref(name);
    if (why) add('warning', 'entry-unsafe', `Zip entry "${name}" ${why}; readers must never extract it.`);
  }
  if (!pkg.files.has('course.json')) add('error', 'course-json-missing', 'No course.json at the zip root.');
  return issues;
}

/** Decodes course.json, or returns an issue. */
export function readCourseJson(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: decode(bytes.subarray(3)), issue: { level: 'warning', code: 'utf8-bom', path: null, message: 'course.json starts with a byte order mark; JSON must not.' } };
  const text = decode(bytes);
  if (text === null) return { text: null, issue: { level: 'error', code: 'utf8', path: null, message: 'course.json is not valid UTF-8.' } };
  return { text, issue: null };
}

function decode(bytes) {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

/** Every file course.json names, as [path, href, purpose]. */
export function referencedFiles(doc) {
  const refs = [];
  if (doc.map?.raster?.href) refs.push(['/map/raster/href', doc.map.raster.href, 'raster']);
  if (doc.map?.vector?.href) refs.push(['/map/vector/href', doc.map.vector.href, 'vector']);
  const tiles = doc.extensions?.['org.openarchery.tiles'];
  if (typeof tiles?.href === 'string') refs.push(['/extensions/org.openarchery.tiles/href', tiles.href, 'tiles']);
  const photos = doc.extensions?.['org.openarchery.photos']?.photos;
  if (Array.isArray(photos))
    photos.forEach((p, i) => typeof p?.href === 'string' && refs.push([`/extensions/org.openarchery.photos/photos/${i}/href`, p.href, 'photo']));
  return refs;
}

/**
 * Checks the files a schema-valid course.json names against the package.
 * Returns the issues and the parsed vector layer, if any.
 */
export async function checkAssets(pkg, doc) {
  const issues = [];
  const add = (level, code, path, message) => issues.push({ level, code, path, message });
  let vector = null;

  const refs = referencedFiles(doc);
  for (const [path, href, purpose] of refs) {
    if (unsafeHref(href)) continue;
    const bytes = pkg.files.get(href);
    if (!bytes) {
      add('warning', 'file-missing', path, `"${href}" is not in the package.`);
      continue;
    }
    if (purpose === 'raster') {
      const type = sniffImage(bytes);
      if (type !== 'png' && type !== 'jpeg') add('warning', 'raster-type', path, `"${href}" is not a PNG or JPEG image.`);
      else if (!new RegExp(type === 'png' ? '\\.png$' : '\\.jpe?g$', 'i').test(href))
        add('warning', 'raster-extension', path, `"${href}" holds a ${type.toUpperCase()} image under the wrong extension.`);
    }
    if (purpose === 'photo') {
      const type = sniffImage(bytes);
      if (type !== 'jpeg' && type !== 'webp') add('warning', 'photo-type', path, `"${href}" is not a JPEG or WebP image.`);
      if (type === 'jpeg' && hasExif(bytes)) add('warning', 'photo-exif', path, `"${href}" carries EXIF metadata; writers should strip it.`);
    }
    if (purpose === 'vector') ({ vector } = checkVector(bytes, path, doc, add));
  }

  for (const [path, layer] of [['/map/raster/sha256', doc.map?.raster], ['/map/vector/sha256', doc.map?.vector], ['/extensions/org.openarchery.tiles/sha256', doc.extensions?.['org.openarchery.tiles']]]) {
    const bytes = layer?.sha256 && typeof layer.href === 'string' && pkg.files.get(layer.href);
    if (!bytes) continue;
    const actual = await sha256(bytes);
    if (actual === null) add('info', 'sha256-unchecked', path, 'This browser cannot hash here (needs https), so sha256 was not checked.');
    else if (actual !== layer.sha256) add('warning', 'sha256-mismatch', path, `sha256 does not match "${layer.href}" (actual ${actual}).`);
  }

  const named = new Set(['mimetype', 'course.json', ...refs.map((r) => r[1])]);
  const declared = new Set(Object.keys(doc.extensions ?? {}));
  for (const name of pkg.files.keys()) {
    if (named.has(name)) continue;
    const ns = name.match(/^extensions\/([^/]+)\//)?.[1];
    if (ns && !declared.has(ns)) add('info', 'extension-undeclared', null, `"${name}" sits under extensions/${ns}/, but course.json declares no "${ns}" extension.`);
    else if (!ns) add('info', 'file-unreferenced', null, `"${name}" is not named by course.json; readers ignore it.`);
  }
  return { issues, vector };
}

function checkVector(bytes, path, doc, add) {
  const text = decode(bytes);
  let fc;
  try {
    fc = JSON.parse(text);
  } catch {
    add('warning', 'vector-json', path, 'The vector layer is not valid UTF-8 JSON.');
    return { vector: null };
  }
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    add('warning', 'vector-type', path, 'The vector layer must be one GeoJSON FeatureCollection.');
    return { vector: null };
  }
  fc.features.forEach((f, i) => {
    const kind = f?.properties?.kind;
    if (kind !== undefined && !VECTOR_KINDS.includes(kind))
      add('warning', 'vector-kind', path, `Feature ${i} has kind "${kind}"; expected one of ${VECTOR_KINDS.join(', ')}.`);
  });

  const first = firstCoordinate(fc);
  const base = doc.courses[0].course.base;
  if (first) {
    const asLonLat = distanceM(base, { lat: first[1], lon: first[0] });
    const asLatLon = distanceM(base, { lat: first[0], lon: first[1] });
    if (asLonLat > 25000 && asLatLon < 25000)
      add('warning', 'vector-axis-order', path, 'Vector coordinates look like [lat, lon]; GeoJSON is [lon, lat].');
  }
  return { vector: fc };
}

function firstCoordinate(fc) {
  for (const f of fc.features) {
    let c = f?.geometry?.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    if (Array.isArray(c) && typeof c[0] === 'number') return c;
  }
  return null;
}

export function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/** Whether a JPEG carries an APP1 Exif segment before its image data. */
function hasExif(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return true;
    if (marker === 0xda) return false;
    i += 2 + len;
  }
  return false;
}

async function sha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return [...digest].map((x) => x.toString(16).padStart(2, '0')).join('');
}
