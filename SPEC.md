# Open Archery Course package format

**Draft 0.1, open for comment.**

An open, vendor-neutral file format for exchanging the archery courses at one venue.
A package is one zip holding a course JSON file, an optional map image and optional
map vectors. It carries one or more Courses over one shared, georeferenced base map.

- JSON Schema: [`schema/course/0.1/course.schema.json`](schema/course/0.1/course.schema.json)
- Example package: [`examples/pine-ridge/`](examples/pine-ridge/)
- Validator: <https://nvanderploeg.github.io/open-archery-course/>

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Contents

1. [Why a new format](#1-why-a-new-format)
2. [Package](#2-package)
3. [One venue, many courses](#3-one-venue-many-courses)
4. [Drawing order](#4-drawing-order)
5. [Coordinates](#5-coordinates)
6. [`course.json`](#6-coursejson)
7. [The Course object](#7-the-course-object)
8. [Rules by ruleset](#8-rules-by-ruleset)
9. [`vector.geojson`](#9-vectorgeojson)
10. [Rules beyond the schema](#10-rules-beyond-the-schema)
11. [Versioning and extensions](#11-versioning-and-extensions)
12. [Defined extensions](#12-defined-extensions)
13. [Licensing](#13-licensing)
14. [Exports (informative)](#14-exports-informative)
15. [Open questions](#15-open-questions)
16. [Example `course.json`](#16-example-coursejson)

## 1. Why a new format

*This section is informative.*

No open standard covers archery course layout. The Olympic Data Feed archery
dictionary covers results only. The nearest formats are borrowed from, not adopted:

- **IOF XML 3.0** (orienteering) has courses and controls, and an `Extensions`
  element. This format borrows the idea of namespaced extensions. IOF XML is XML and
  models orienteering, not stakes and butts.
- **KMZ** is a zip holding `doc.kml` and an image placed by its corners
  (`GroundOverlay` / `gx:LatLonQuad`). This format borrows the packaging and the corner
  placement. KML is too clunky to author against.
- **GeoJSON ([RFC 7946](https://www.rfc-editor.org/rfc/rfc7946))** is adopted as-is
  for the vector layer, so QGIS, geojson.io and every web map library can read it.
- **[simplestyle-spec](https://github.com/mapbox/simplestyle-spec)** property names
  (`stroke`, `fill` and so on) are adopted for vector styling.

## 2. Package

A package is a zip file with the extension `.oac` ("Open Archery Course") and the
media type `application/vnd.oac+zip`.

```
pine-ridge.oac
├── mimetype          first entry, stored uncompressed: application/vnd.oac+zip
├── course.json       required
├── raster.png        optional base image (PNG or JPEG)
├── vector.geojson    optional base vectors
└── extensions/       optional, one folder per extension namespace
```

- `course.json` MUST be at the zip root.
- The other files are found through the paths that `course.json` names. They are
  relative to the zip root, and the names above are the defaults. Readers MUST NOT
  follow absolute paths, `..` segments, or URLs.
- Writers MUST put `mimetype` first and store it uncompressed, with the exact media
  type as its content and no trailing newline, so a file sniffer can recognise the
  package without unzipping it (as EPUB and OpenDocument do).
- All text is UTF-8.
- A package SHOULD be under 25 MB.

## 3. One venue, many courses

A package holds every layout that shares one physical space, such as a 3D loop, a WA
Field course and an NFAA Field course on the same ground. Each layout is its own
Course with exactly one ruleset. The courses share the map.

- **Shared:** `venue`, `map.raster`, `map.vector`, and package-level extensions such
  as tiles. The large assets ship once.
- **Per course:** everything in the [Course object](#7-the-course-object) (base,
  legend, stations, walkways, POIs), plus the course's own `revision` and `license`.
- **No cross-references.** Courses never point at each other's butts, positions or
  walkways, even where a 3D target and a field butt share a lane. Butt and position
  ids are unique only within their course.
- **A single-course package** is `courses` with one entry. There is no separate
  single-course form.
- **The package is not a revision.** Each course entry carries its own revision, and
  a package can be assembled when it is downloaded. Republishing one course changes
  only that entry. Readers compare revision ids per course, and compare each shared
  layer's optional `sha256` to skip re-downloading unchanged imagery.
- A reader shows the courses as a list and the archer picks one.

## 4. Drawing order

From bottom to top:

1. The raster (`map.raster`), at `map.raster.opacity`.
2. The vectors (`map.vector`), in feature order. The first feature is drawn lowest.
3. The selected course, drawn by the reader from its `courses[]` entry: walkways,
   then POIs, then base, then positions and butts. A reader MAY draw the package's
   other courses faded, beneath the selected one.

The course layer is never baked into the raster or the vector file. Those files are
background only: trails, roads, water, buildings, contours, hand-drawn art. This keeps
the course data authoritative, and lets every reader draw stakes in its own style.

## 5. Coordinates

- All coordinates are WGS84 latitude and longitude in decimal degrees.
- **Elevation is optional everywhere.** `eleM` on any Point is metres above the
  WGS84 ellipsoid, as GPS reports it. Readers MUST work without it. When a butt and a
  position that shoots it both carry it, a reader MAY show the shot angle.
- `course.json` uses `{lat, lon}` objects. `vector.geojson` uses GeoJSON's
  `[lon, lat, ele?]` order, as RFC 7946 requires.

### 5.1 Raster placement

The raster is placed by its corners. A top-left point alone fixes position, but the
image also needs scale and rotation.

- `corners.topLeft`, `corners.topRight` and `corners.bottomLeft` are required.
  Together they define an affine mapping, so north-up, rotated and hand-drawn maps
  all work.
- Corners refer to the **outer edges** of the corner pixels, not pixel centres.
- A reader projects the three corners into a local east-north plane in metres,
  centred on `topLeft`. It maps pixel `(x, y)` of a `w × h` image to

  ```
  TL + (x / w)(TR − TL) + (y / h)(BL − TL)
  ```

- `bottomRight` is optional. When present it is a check, not a fourth control point:
  a reader SHOULD warn when it lies more than 2 % of the image diagonal from the
  derived corner `TR + BL − TL`. This version has no warping.
- Over course-sized areas (a few kilometres) the local-plane approximation is well
  inside GPS error.

## 6. `course.json`

The top level holds the venue, its shared map, and one entry per Course.

| Key | Req | Meaning |
|---|---|---|
| `format` | yes | Always `"open-archery-course"` |
| `formatVersion` | yes | `"0.1"`; see [Versioning](#11-versioning-and-extensions) |
| `generator` | no | `{name, version?}` of the writing application |
| `venue` | no | `{name, description?}` of the shared ground |
| `courses` | yes | One or more course entries, below |
| `map.raster` | no | `{href, corners, opacity?, sha256?, attribution?, license?}`, shared by every course |
| `map.vector` | no | `{href, sha256?, attribution?, license?}`, shared by every course |
| `extensions` | no | Package-level extensions, keyed by reverse-domain name |

`sha256` is the lowercase hex SHA-256 of the file's bytes as stored in the package.

Each `courses[]` entry:

| Key | Req | Meaning |
|---|---|---|
| `key` | yes | Package-local id (`3d`, `wa-field`): lowercase letters, digits and `-`, unique in the package |
| `revision` | no | `{id?, publishedAt?}` of this course; `publishedAt` is an RFC 3339 date-time |
| `license` | no | SPDX license id for this course's data, such as `CC-BY-4.0` |
| `course` | yes | A [Course](#7-the-course-object) |
| `extensions` | no | Course-level extensions |

Derived values (bounding box, station count, GPS distance from a position to its
butt) are never written. Readers compute them.

## 7. The Course object

A Course is one venue's walked layout for one ruleset.

**Store what is on the ground.** A course stores painted colours, distances exactly
as posted, and points as they were captured. Readers derive the rest.

### 7.1 Course

| Key | Req | Type | Meaning |
|---|---|---|---|
| `name` | yes | string | Course name |
| `description` | no | string | |
| `venue` | yes | string | Free text, such as `"Pine Ridge Archers range"` |
| `ruleset` | yes | Ruleset | The federation and discipline the course is built for |
| `region` | no | string | Human-readable region, such as `"Ontario, CA"` |
| `publisher` | no | `{name, id?}` | Who published the course; `id` is the publisher's own identifier |
| `base` | yes | Point | The assembly point |
| `legend` | yes | LegendEntry[] | What each peg colour means on this course |
| `stations` | yes | Station[] | Numbered 1..n; the walk order is number order |
| `walkways` | no | Walkway[] | |
| `pois` | no | Poi[] | |

### 7.2 Ruleset

| Value | Ruleset |
|---|---|
| `wa-field` | World Archery Field |
| `wa-3d` | World Archery 3D |
| `nfaa-field` | NFAA Field |
| `nfaa-3d` | NFAA 3D |
| `ifaa-field` | IFAA Field |
| `ifaa-3d` | IFAA 3D |
| `asa-3d` | Archery Shooters Association 3D |
| `ibo-3d` | International Bowhunting Organization 3D |

### 7.3 LegendEntry

One peg colour, and what it means on this course.

| Key | Req | Type | Meaning |
|---|---|---|---|
| `colour` | yes | PegColour | `white`, `red`, `yellow`, `blue`, `black`, `green`, `orange` or `pink` |
| `label` | yes | string | Such as `"Hunter (adult)"` or `"40 yd max"` |
| `round` | no | enum | `field`, `hunter`, `animal`, `3d`, `international` or `lake_of_woods` |
| `maxYd` | no | number | Maximum distance in yards, such as an ASA band or a 3D maximum |
| `marked` | yes | boolean | `false`: positions of this colour carry no distance |

### 7.4 Station

One numbered stop on the course. Readers usually label it "Target *n*".

| Key | Req | Type | Meaning |
|---|---|---|---|
| `number` | yes | integer ≥ 1 | |
| `note` | no | string | |
| `butts` | yes | Butt[] | At least one |
| `positions` | yes | Position[] | At least one |

### 7.5 Butt

Where a target face or 3D animal stands.

| Key | Req | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Unique within the course |
| `point` | yes | Point | |
| `face` | no | `{sizeCm}` or `{group}` | Face size in cm (`20`, `35`, `40`, `50`, `60`, `65`, `80`), or 3D size group `1`–`4` |
| `label` | no | string | Such as `"bear"` |

### 7.6 Position

One place to shoot from: a stake, marker or peg depending on the ruleset.

| Key | Req | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Unique within the course |
| `point` | yes | Point | |
| `colours` | yes | PegColour[] | One colour, or two for a shared marker |
| `distance` | no | `{value, unit}` | Exactly as posted; `unit` is `yd`, `ft` or `m`. Absent when unmarked |
| `shoots` | no | string[] | Ids of the butts this position shoots. Omitted means every butt in the station |
| `note` | no | string | Such as `"platform"` or `"kneel"` |

### 7.7 Walkway

One walked leg between the base and a station, or between two stations. A leg that
ends at a station ends at the station's butts.

| Key | Req | Type | Meaning |
|---|---|---|---|
| `from` | yes | `"base"` or station number | |
| `to` | yes | `"base"` or station number | |
| `path` | yes | Point[] | At least two points |
| `waypoints` | no | `{point, note}[]` | Noted points along the leg, such as a creek crossing |

### 7.8 Poi

| Key | Req | Type | Meaning |
|---|---|---|---|
| `kind` | yes | enum | `parking`, `toilet`, `water`, `shelter`, `first_aid`, `practice` or `other` |
| `point` | yes | Point | |
| `label` | no | string | |

### 7.9 Point

| Key | Req | Type | Meaning |
|---|---|---|---|
| `lat` | yes | number | WGS84 latitude, −90..90 |
| `lon` | yes | number | WGS84 longitude, −180..180 |
| `eleM` | no | number | Metres above the WGS84 ellipsoid |
| `accM` | no | number ≥ 0 | Horizontal accuracy in metres, as reported at capture |
| `src` | no | enum | How the point was captured: `gps`, `map` (placed on a map) or `manual` (typed in) |

## 8. Rules by ruleset

### 8.1 Lane rules

- **ASA:** exactly one butt per station, at most one position per colour, and no
  `shoots`.
- **IFAA:** on fans, the marker order fixes which face each marker shoots (markers
  1–2 the left butt, 3–4 the right), so `shoots` is derived and MUST NOT be stored.
  Animal positions have two markers.
- **NFAA:** `shoots` MUST be explicit on four-position shots, because the rules allow
  more than one mapping.
- Walk-up order comes from distance, longest first.

### 8.2 Distances

- A position with a marked colour carries `distance`, exactly as posted.
- A position whose colours are all unmarked carries no `distance`. Every ASA, IBO and
  WA 3D course is unmarked, so carries none.
- The GPS distance from a position to its butt is computed by readers and never
  stored.

### 8.3 Labels by ruleset (informative)

| Concept | Key | WA | NFAA | IFAA | ASA / IBO |
|---|---|---|---|---|---|
| Numbered stop | `stations[]` | Target 7 | Target 7 | Target 7 | Target 7 |
| Shooting position | `positions[]` | peg | stake | marker | stake |
| What is shot at | `butts[]` | butt | butt | butt | target |

### 8.4 Common legends (informative)

NFAA and IFAA colours name a round and an age band; ASA and IBO colours name a
maximum distance.

- **WA Field:** red, blue and yellow, each marked or unmarked per 12-target unit.
- **WA 3D:** red (5–45 m) and blue (5–30 m), always unmarked. Butts carry no size
  group.
- **IBO 3D:** blue 50, green 45, red 40, yellow 35, orange 30, white 25 and pink 20
  yd, approximate maxima, always unmarked.

## 9. `vector.geojson`

A single GeoJSON `FeatureCollection`. Every feature MAY carry these properties:

- `kind`: one of `trail`, `road`, `water`, `building`, `boundary`, `contour`,
  `vegetation`, `hazard`, `label` or `other`. Readers style by `kind` when a feature
  has no simplestyle keys.
- simplestyle keys: `stroke`, `stroke-width`, `stroke-opacity`, `fill`,
  `fill-opacity`, `title`.
- `eleM` on `contour` lines.

Course features (butts, positions, walkways) MUST NOT be in this file.

## 10. Rules beyond the schema

Writers MUST obey these rules and readers SHOULD warn when one is broken. A reader
rejects a package only when `course.json` fails the schema.

1. Course `key`s are unique in the package.
2. Within each course, station numbers run 1..n with no gaps or repeats.
3. Within each course, butt and position ids are unique.
4. `shoots` names butts in the same station.
5. Walkway ends name `base` or an existing station.
6. Every position colour appears in `legend`.
7. A position whose colours are all unmarked carries no `distance`, and a position
   with a marked colour does.
8. The [lane rules](#81-lane-rules) apply.
9. Every path the package names exists in the zip and is relative, with no `..`
   segment and no URL.
10. Each `sha256` matches its file.

## 11. Versioning and extensions

- `formatVersion` is `major.minor`. Readers reject an unknown major. Within a known
  major they ignore unknown keys, so a minor version only ever adds optional fields.
- Anything not in this spec goes under `extensions["<reverse-domain>"]` in
  `course.json`, and its files under `extensions/<reverse-domain>/`. A writer uses a
  namespace from a domain it controls, such as `com.example`.
- The `oac.` prefix is reserved for extensions defined by this spec (§12). Writers
  MUST NOT invent other `oac.*` names; a reader SHOULD warn on one it does not know.
- A reader that doesn't know an extension still draws the course from the core
  layers.

## 12. Defined extensions

These extensions use the reserved `oac.` prefix so every reader handles them the
same way. The prefix belongs to this spec, not to a domain.

### 12.1 `oac.tiles`: tiled base map

A package-level extension for venues too big for one image.

```json
"extensions": {
  "oac.tiles": {
    "href": "extensions/oac.tiles/map.pmtiles",
    "format": "pmtiles",
    "sha256": "…",
    "minZoom": 14,
    "maxZoom": 20,
    "attribution": "…",
    "license": "…"
  }
}
```

- `href` and `format` are required. `format` is `pmtiles` or `mbtiles`, and tiles use
  the Web Mercator XYZ scheme.
- A reader that understands it draws it in place of `map.raster`, in the same slot.
  Writers SHOULD still include a low-resolution raster as a fallback.

### 12.2 `oac.photos`: station photos

A package-level extension. Each photo names its course.

```json
"extensions": {
  "oac.photos": {
    "photos": [
      { "href": "extensions/oac.photos/s7-stake-red.jpg",
        "course": "3d", "station": 7, "of": "p7r", "caption": "View from red stake",
        "point": { "lat": 44.1006, "lon": -79.5005 }, "bearingDeg": 52 }
    ]
  }
}
```

- `href`, `course` (a course `key`) and `station` are required. `of` (a butt or
  position id in that course), `caption`, `point` and `bearingDeg` (degrees clockwise
  from true north) are optional.
- Photos are JPEG or WebP. Writers SHOULD strip EXIF metadata; location belongs in
  `point`.

## 13. Licensing

- This **specification and its schema** are licensed
  [CC-BY-4.0](LICENSE-SPEC). The **reference validator** is licensed [MIT](LICENSE).
- **Each course** declares its own `license`. Map layers declare theirs separately,
  because a vector layer cut from OpenStreetMap is ODbL and needs
  "© OpenStreetMap contributors" shown wherever it is drawn. Readers SHOULD show each
  drawn layer's `attribution`.

## 14. Exports (informative)

The format is built to make these conversions cheap:

- **KMZ / Google Earth:** the raster becomes a `GroundOverlay` with `gx:LatLonQuad`,
  the vectors become Placemarks, and each course becomes a folder with a sub-folder
  per station.
- **GPX:** walkways become a track, and butts and positions become waypoints.
- **Plain GeoJSON:** each course flattened into features, for GIS users.

## 15. Open questions

- Whether the spec moves to a neutral organisation. The schema `$id` resolves on
  this repository's GitHub Pages site; if the spec moves, the `$id` moves with it in
  a new major or minor version.
- Registering `application/vnd.oac+zip` with IANA.

Comments and proposals are welcome as issues on this repository.

## 16. Example `course.json`

One venue with a 3D loop and a WA Field course over the same map, trimmed to one
station each. The full example package is in [`examples/pine-ridge/`](examples/pine-ridge/).

```json
{
  "format": "open-archery-course",
  "formatVersion": "0.1",
  "generator": {"name": "Skadis Edge", "version": "1.0.0"},
  "venue": {"name": "Pine Ridge Archers range"},
  "courses": [
    {
      "key": "3d",
      "revision": {"id": "r3", "publishedAt": "2026-11-14T19:00:00Z"},
      "license": "CC-BY-4.0",
      "course": {
        "name": "Pine Ridge 3D",
        "venue": "Pine Ridge Archers range",
        "ruleset": "ibo-3d",
        "region": "Ontario, CA",
        "publisher": {"name": "Pine Ridge Archers"},
        "base": {"lat": 44.10021, "lon": -79.5011, "src": "gps"},
        "legend": [
          {"colour": "red", "label": "Hunter, 40 yd max", "maxYd": 40, "marked": false},
          {"colour": "yellow", "label": "Youth, 35 yd max", "maxYd": 35, "marked": false}
        ],
        "stations": [
          {
            "number": 1,
            "butts": [
              {
                "id": "b1",
                "point": {"lat": 44.1009, "lon": -79.5002, "eleM": 251.4, "accM": 3, "src": "gps"},
                "label": "bear"
              }
            ],
            "positions": [
              {
                "id": "p1r",
                "point": {"lat": 44.10062, "lon": -79.50051, "eleM": 247.9, "src": "gps"},
                "colours": ["red"]
              },
              {
                "id": "p1y",
                "point": {"lat": 44.1007, "lon": -79.50043, "src": "gps"},
                "colours": ["yellow"],
                "note": "kneel"
              }
            ]
          }
        ],
        "walkways": [
          {
            "from": "base",
            "to": 1,
            "path": [
              {"lat": 44.10021, "lon": -79.5011},
              {"lat": 44.1005, "lon": -79.5007},
              {"lat": 44.10062, "lon": -79.50051}
            ],
            "waypoints": [{"point": {"lat": 44.1005, "lon": -79.5007}, "note": "creek crossing"}]
          }
        ],
        "pois": [{"kind": "parking", "point": {"lat": 44.10001, "lon": -79.5015}}]
      }
    },
    {
      "key": "wa-field",
      "revision": {"id": "r1", "publishedAt": "2026-10-02T15:00:00Z"},
      "license": "CC-BY-4.0",
      "course": {
        "name": "Pine Ridge WA Field",
        "venue": "Pine Ridge Archers range",
        "ruleset": "wa-field",
        "region": "Ontario, CA",
        "publisher": {"name": "Pine Ridge Archers"},
        "base": {"lat": 44.10021, "lon": -79.5011, "src": "gps"},
        "legend": [
          {"colour": "red", "label": "Recurve & compound", "round": "field", "marked": true},
          {"colour": "blue", "label": "Barebow", "round": "field", "marked": true}
        ],
        "stations": [
          {
            "number": 1,
            "butts": [
              {
                "id": "b1",
                "point": {"lat": 44.1012, "lon": -79.502, "src": "gps"},
                "face": {"sizeCm": 80}
              }
            ],
            "positions": [
              {
                "id": "p1r",
                "point": {"lat": 44.1008, "lon": -79.5024, "src": "gps"},
                "colours": ["red"],
                "distance": {"value": 50, "unit": "m"}
              },
              {
                "id": "p1b",
                "point": {"lat": 44.10095, "lon": -79.50225, "src": "gps"},
                "colours": ["blue"],
                "distance": {"value": 35, "unit": "m"}
              }
            ]
          }
        ]
      }
    }
  ],
  "map": {
    "raster": {
      "href": "raster.png",
      "corners": {
        "topLeft": {"lat": 44.102, "lon": -79.503},
        "topRight": {"lat": 44.102, "lon": -79.498},
        "bottomLeft": {"lat": 44.099, "lon": -79.503}
      },
      "attribution": "Hand-drawn by Pine Ridge Archers"
    },
    "vector": {"href": "vector.geojson", "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0"}
  },
  "extensions": {"com.skadis": {"courseId": "c_123"}}
}
```
