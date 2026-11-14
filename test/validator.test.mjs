import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import JSZip from 'jszip';
import { createValidator } from '../validator/lib/validate.js';
import { rasterPlacement } from '../validator/lib/geo.js';
import { locate } from '../validator/lib/locate.js';
import { MIMETYPE } from '../validator/lib/package.js';
import { packDir } from '../tools/pack.mjs';

const schema = JSON.parse(await readFile('schema/course/0.1/course.schema.json', 'utf8'));
const { validateText, openBytes } = createValidator({ Ajv2020, JSZip, schema });
const exampleText = await readFile('examples/pine-ridge/course.json', 'utf8');

const codes = (report, level) => report.issues.filter((i) => !level || i.level === level).map((i) => i.code);
const clone = (x) => structuredClone(x);
const validateDoc = (doc) => validateText(JSON.stringify(doc));

/** One small valid course, mutated by each test. */
const minimal = () => ({
  format: 'open-archery-course',
  formatVersion: '0.1',
  courses: [
    {
      key: 'field',
      course: {
        name: 'Test',
        venue: 'Test range',
        ruleset: 'nfaa-field',
        base: { lat: 44.1, lon: -79.5 },
        legend: [
          { colour: 'white', label: 'Adult', marked: true },
          { colour: 'blue', label: 'Unmarked', marked: false },
        ],
        stations: [1, 2].map((n) => ({
          number: n,
          butts: [{ id: `b${n}`, point: { lat: 44.1 + n * 0.001, lon: -79.5 } }],
          positions: [{ id: `p${n}`, point: { lat: 44.1 + n * 0.001 - 0.0003, lon: -79.5 }, colours: ['white'], distance: { value: 30, unit: 'yd' } }],
        })),
        walkways: [{ from: 'base', to: 1, path: [{ lat: 44.1, lon: -79.5 }, { lat: 44.1007, lon: -79.5 }] }],
      },
    },
  ],
});

async function zipOf(entries, { mimetypeFirst = true, mimetypeStored = true } = {}) {
  const zip = new JSZip();
  if (mimetypeFirst) zip.file('mimetype', MIMETYPE, { compression: mimetypeStored ? 'STORE' : 'DEFLATE' });
  for (const [name, data] of Object.entries(entries)) zip.file(name, data, { createFolders: false });
  if (!mimetypeFirst) zip.file('mimetype', MIMETYPE, { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function validateBytes(bytes) {
  const { pkg, text, failure } = await openBytes(bytes);
  if (failure) return { accepted: false, issues: [failure] };
  if (text === null) return { accepted: false, issues: pkg.containerIssues };
  return validateText(text, pkg);
}

test('the example package passes with no warnings', async () => {
  const report = await validateBytes(await packDir('examples/pine-ridge'));
  assert.equal(report.accepted, true);
  assert.deepEqual(codes(report, 'error'), []);
  assert.deepEqual(codes(report, 'warning'), []);
  assert.ok(report.vector.features.length > 0);
});

test('the example in SPEC.md passes the schema and the rules', async () => {
  const spec = await readFile('SPEC.md', 'utf8');
  const block = spec.split('## 16. Example `course.json`')[1].match(/```json\n([\s\S]*?)```/)[1];
  const report = await validateText(block);
  assert.equal(report.accepted, true);
  assert.deepEqual(codes(report, 'warning'), []);
});

test('the minimal fixture is clean', async () => {
  const report = await validateDoc(minimal());
  assert.deepEqual(codes(report).filter((c) => c !== 'files-unchecked'), []);
});

test('invalid JSON is rejected with an offset', async () => {
  const report = await validateText('{"format": "open-archery-course",, }');
  assert.equal(report.accepted, false);
  assert.equal(report.issues[0].code, 'json');
  assert.equal(typeof report.issues[0].offset, 'number');
});

test('schema failures reject and skip the rules', async () => {
  const doc = minimal();
  delete doc.courses[0].course.base;
  doc.courses[0].course.ruleset = 'olympic';
  const report = await validateDoc(doc);
  assert.equal(report.accepted, false);
  assert.ok(codes(report).includes('schema-required'));
  assert.ok(codes(report).includes('schema-enum'));
  assert.ok(codes(report).includes('rules-skipped'));
  assert.equal(report.issues.find((i) => i.code === 'schema-required').path, '/courses/0/course/base');
});

test('a oneOf failure reports one readable error, not each branch', async () => {
  const doc = minimal();
  doc.courses[0].course.stations[0].butts[0].face = { sizeCm: 45 };
  doc.courses[0].course.walkways[0].to = 'one';
  const report = await validateDoc(doc);
  const errors = report.issues.filter((i) => i.level === 'error');
  assert.deepEqual(errors.map((e) => e.path).sort(), ['/courses/0/course/stations/0/butts/0/face', '/courses/0/course/walkways/0/to']);
  assert.match(errors.find((e) => e.path.endsWith('/to')).message, /"base" or an integer/);
  assert.match(errors.find((e) => e.path.endsWith('/face')).message, /{sizeCm} or {group}/);
});

test('an unknown major version is rejected', async () => {
  const doc = minimal();
  doc.formatVersion = '1.0';
  const report = await validateDoc(doc);
  assert.equal(report.accepted, false);
  assert.deepEqual(codes(report, 'error'), ['unknown-major']);
});

test('a newer minor version is accepted with a note', async () => {
  const doc = minimal();
  doc.formatVersion = '0.4';
  const report = await validateDoc(doc);
  assert.equal(report.accepted, true);
  assert.ok(codes(report, 'info').includes('newer-minor'));
});

test('unknown keys are noted but accepted', async () => {
  const doc = minimal();
  doc.courses[0].course.walkway = [];
  const report = await validateDoc(doc);
  assert.equal(report.accepted, true);
  assert.equal(report.issues.find((i) => i.code === 'unknown-key').path, '/courses/0/course/walkway');
});

const ruleCases = {
  'course-key-duplicate': (d) => d.courses.push(clone(d.courses[0])),
  'station-number-gap': (d) => (d.courses[0].course.stations[1].number = 3),
  'station-number-duplicate': (d) => (d.courses[0].course.stations[1].number = 1),
  'id-duplicate': (d) => (d.courses[0].course.stations[1].positions[0].id = 'b1'),
  'shoots-unknown-butt': (d) => (d.courses[0].course.stations[1].positions[0].shoots = ['b1']),
  'walkway-end-unknown': (d) => (d.courses[0].course.walkways[0].to = 9),
  'colour-not-in-legend': (d) => d.courses[0].course.stations[0].positions[0].colours.push('pink'),
  'distance-missing': (d) => delete d.courses[0].course.stations[0].positions[0].distance,
  'distance-on-unmarked': (d) => (d.courses[0].course.stations[0].positions[0].colours = ['blue']),
  'lane-asa-butts': (d) => {
    const c = d.courses[0].course;
    c.ruleset = 'asa-3d';
    c.legend = [{ colour: 'white', label: 'Known', marked: false }];
    c.stations.forEach((s) => s.positions.forEach((p) => delete p.distance));
    c.stations[0].butts.push({ id: 'b1x', point: c.stations[0].butts[0].point });
  },
  'lane-ifaa-shoots': (d) => {
    d.courses[0].course.ruleset = 'ifaa-field';
    d.courses[0].course.stations[0].positions[0].shoots = ['b1'];
  },
  'lane-nfaa-shoots': (d) => {
    const s = d.courses[0].course.stations[0];
    s.butts.push({ id: 'b1b', point: s.butts[0].point });
    s.positions = [1, 2, 3, 4].map((k) => ({ ...clone(s.positions[0]), id: `p1-${k}` }));
  },
  'ruleset-unmarked': (d) => (d.courses[0].course.ruleset = 'ibo-3d'),
  'far-from-base': (d) => (d.courses[0].course.stations[0].butts[0].point = { lat: -79.5, lon: 44.1 }),
  'raster-bottom-right': (d) =>
    (d.map = { raster: { href: 'r.png', corners: { topLeft: { lat: 44.102, lon: -79.503 }, topRight: { lat: 44.102, lon: -79.498 }, bottomLeft: { lat: 44.099, lon: -79.503 }, bottomRight: { lat: 44.0995, lon: -79.4985 } } } }),
  'raster-mirrored': (d) =>
    (d.map = { raster: { href: 'r.png', corners: { topLeft: { lat: 44.102, lon: -79.503 }, topRight: { lat: 44.099, lon: -79.503 }, bottomLeft: { lat: 44.102, lon: -79.498 } } } }),
  'href-unsafe': (d) => (d.map = { vector: { href: '../outside.geojson' } }),
  'photo-of': (d) => (d.extensions = { 'org.openarchery.photos': { photos: [{ href: 'extensions/org.openarchery.photos/a.jpg', course: 'field', station: 1, of: 'nope' }] } }),
  'photo-station': (d) => (d.extensions = { 'org.openarchery.photos': { photos: [{ href: 'extensions/org.openarchery.photos/a.jpg', course: 'field', station: 7 }] } }),
  'tiles-format': (d) => (d.extensions = { 'org.openarchery.tiles': { href: 'extensions/org.openarchery.tiles/map.pmtiles', format: 'xyz' } }),
  'extension-level': (d) => (d.courses[0].extensions = { 'org.openarchery.tiles': { href: 'x.pmtiles', format: 'pmtiles' } }),
};

for (const [code, mutate] of Object.entries(ruleCases)) {
  test(`rule ${code} warns without rejecting`, async () => {
    const doc = minimal();
    mutate(doc);
    const report = await validateDoc(doc);
    assert.deepEqual(codes(report, 'error'), [], 'rules never reject');
    assert.ok(codes(report, 'warning').includes(code), `expected ${code}, got ${codes(report)}`);
  });
}

test('the first raster corner derivation matches the spec formula', () => {
  const placed = rasterPlacement({ topLeft: { lat: 44.102, lon: -79.503 }, topRight: { lat: 44.102, lon: -79.498 }, bottomLeft: { lat: 44.099, lon: -79.503 } });
  assert.ok(Math.abs(placed.bottomRight.lat - 44.099) < 1e-6);
  assert.ok(Math.abs(placed.bottomRight.lon + 79.498) < 1e-6);
  assert.ok(placed.cross < 0);
  const centre = placed.pixelToLatLon(0.5, 0.5);
  assert.ok(Math.abs(centre.lat - 44.1005) < 1e-6 && Math.abs(centre.lon + 79.5005) < 1e-6);
});

test('a non-zip is rejected', async () => {
  const report = await validateBytes(new TextEncoder().encode('{"not": "a zip"}'));
  assert.equal(report.accepted, false);
  assert.deepEqual(codes(report), ['not-zip']);
});

test('a package without course.json is rejected', async () => {
  const report = await validateBytes(await zipOf({ 'other.json': '{}' }));
  assert.equal(report.accepted, false);
  assert.ok(codes(report, 'error').includes('course-json-missing'));
});

test('mimetype must be first and stored', async () => {
  const json = JSON.stringify(minimal());
  assert.ok(codes(await validateBytes(await zipOf({ 'course.json': json }, { mimetypeFirst: false })), 'warning').includes('mimetype-first'));
  assert.ok(codes(await validateBytes(await zipOf({ 'course.json': json }, { mimetypeStored: false })), 'warning').includes('mimetype-stored'));
  assert.deepEqual(codes(await validateBytes(await zipOf({ 'course.json': json })), 'warning'), []);
});

test('named files must exist and match their sha256', async () => {
  const doc = minimal();
  doc.map = {
    raster: { href: 'raster.png', sha256: '0'.repeat(64), corners: { topLeft: { lat: 44.102, lon: -79.503 }, topRight: { lat: 44.102, lon: -79.498 }, bottomLeft: { lat: 44.099, lon: -79.503 } } },
    vector: { href: 'vector.geojson' },
  };
  const png = await readFile('examples/pine-ridge/raster.png');
  const report = await validateBytes(await zipOf({ 'course.json': JSON.stringify(doc), 'raster.png': png, 'stray.txt': 'x' }));
  assert.equal(report.accepted, true);
  assert.ok(codes(report, 'warning').includes('sha256-mismatch'));
  assert.ok(codes(report, 'warning').includes('file-missing'));
  assert.ok(codes(report, 'info').includes('file-unreferenced'));
});

test('a vector layer in [lat, lon] order is caught', async () => {
  const doc = minimal();
  doc.map = { vector: { href: 'vector.geojson' } };
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: [[44.1, -79.5], [44.101, -79.5]] } }] };
  const report = await validateBytes(await zipOf({ 'course.json': JSON.stringify(doc), 'vector.geojson': JSON.stringify(fc) }));
  assert.ok(codes(report, 'warning').includes('vector-axis-order'));
});

test('locate finds the span a JSON Pointer names', () => {
  const text = '{\n  "a": [1, {"b~c": "x/y", "d": {"e": true}}],\n  "f": "g"\n}';
  const at = (p) => {
    const s = locate(text, p);
    return text.slice(s.start, s.end);
  };
  assert.equal(at('/a/1/d'), '{"e": true}');
  assert.equal(at('/a/1/b~0c'), '"x/y"');
  assert.equal(at('/f'), '"g"');
  assert.equal(at('/a/1/missing'), '{"b~c": "x/y", "d": {"e": true}}');
});
