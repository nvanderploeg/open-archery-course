# Open Archery Course

An open, vendor-neutral file format for archery course layouts: the stations, pegs
and targets of field and 3D courses, placed by GPS over a shared base map.

**[Validate a package in your browser →](https://nvanderploeg.github.io/open-archery-course/)**

An `.oac` file is a zip that holds every course at one venue (a 3D loop and a WA
Field course on the same ground, say) over one georeferenced map:

```
pine-ridge.oac
├── mimetype          application/vnd.oac+zip, stored first
├── course.json       the venue, its map, and one entry per course
├── raster.png        optional base image, placed by three corners
├── vector.geojson    optional base vectors (trails, water, buildings)
└── extensions/       optional, one folder per extension namespace
```

Status: **draft 0.1, open for comment.** Open an issue to propose a change.

## In this repository

| Path | What it is |
|---|---|
| [`SPEC.md`](SPEC.md) | The specification |
| [`schema/course/0.1/course.schema.json`](schema/course/0.1/course.schema.json) | JSON Schema (draft 2020-12) for `course.json` |
| [`examples/pine-ridge/`](examples/pine-ridge/) | An example venue with two courses, a hand-drawn raster, vectors and a station photo |
| [`validator/`](validator/) | The reference validator: a static HTML and JavaScript page |
| [`tools/pack.mjs`](tools/pack.mjs) | Packs a folder into an `.oac` with `mimetype` first and stored |

## The validator

<https://nvanderploeg.github.io/open-archery-course/>

- Open or drop an `.oac` package, or paste a `course.json`.
- It checks the schema, the rules beyond the schema (SPEC §10), and the package
  itself: the `mimetype` entry, the named files, their `sha256` and image types.
- It draws the courses on OpenStreetMap, with the package's raster placed by its
  corners and its vectors on top. Edit the JSON and the map follows. Click an issue
  to jump to it in the JSON and on the map.
- Everything runs in the browser, and no file is uploaded.
- Link straight to a package with `?src=<url>`, as long as its host allows
  cross-origin requests.

## Develop

```bash
npm install
npm test                               # validator unit tests, including both examples
npm run serve                          # builds _site/ and serves it at http://localhost:8080
npm run pack -- examples/pine-ridge    # writes pine-ridge.oac
```

The validator logic in `validator/lib/` is plain ES modules with no DOM. The page
and the tests run the same code, and inject Ajv and JSZip. The page loads them, and
Leaflet, from cdnjs at pinned versions with SRI hashes.

Pushing to `main` deploys the page to GitHub Pages with
`.github/workflows/pages.yml`.

## Licence

- The specification, schema and examples are licensed
  [CC-BY-4.0](LICENSE-SPEC).
- The validator and tools are licensed [MIT](LICENSE).
- Each course in a package declares its own licence.
