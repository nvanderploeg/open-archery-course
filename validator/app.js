/* global JSZip */
import { createValidator } from './lib/validate.js';
import { locate, lineCol } from './lib/locate.js';
import { sniffImage } from './lib/package.js';
import { createMapView, PEG } from './map.js';

const $ = (sel) => document.querySelector(sel);
const els = {
  file: $('#file'),
  example: $('#load-example'),
  source: $('#source'),
  sourceName: $('#source-name'),
  close: $('#close-source'),
  verdict: $('#verdict'),
  issues: $('#issues'),
  editor: $('#editor'),
  editorBox: $('#editor-box'),
  files: $('#files'),
  filesBox: $('#files-box'),
  course: $('#course'),
  others: $('#others'),
  meta: $('#course-meta'),
  stale: $('#stale'),
  drop: $('#drop'),
};

const Ajv2020 = window.ajv2020.default ?? window.ajv2020;
const schema = await fetch('schema/course/0.1/course.schema.json').then((r) => r.json());
const validator = createValidator({ Ajv2020, JSZip, schema });
const mapView = createMapView($('#map'), { onPick: selectPointer });

let pkg = null;
let assets = {};
let report = null;
let drawn = null;
let courseIndex = 0;
let runId = 0;

/* ---------- loading ---------- */

async function openFile(name, bytes) {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip && /\.json$/i.test(name)) return loadText(new TextDecoder().decode(bytes), null, name);
  const opened = await validator.openBytes(bytes);
  if (opened.failure) {
    setSource(name, null);
    els.editor.value = '';
    return showReport({ doc: null, issues: [opened.failure], accepted: false });
  }
  loadText(opened.text ?? '', opened.pkg, name);
}

function loadText(text, newPkg, name) {
  for (const url of Object.values(assets.urls ?? {})) URL.revokeObjectURL(url);
  pkg = newPkg;
  assets = pkg ? buildAssets(pkg) : {};
  setSource(name, pkg);
  els.editor.value = text;
  drawn = null;
  courseIndex = 0;
  run({ fit: true });
}

function buildAssets(p) {
  const urls = {};
  for (const [name, bytes] of p.files) {
    const type = sniffImage(bytes);
    if (type) urls[name] = URL.createObjectURL(new Blob([bytes], { type: `image/${type}` }));
  }
  return { urls };
}

function setSource(name, p) {
  els.source.hidden = !name;
  els.sourceName.textContent = name ?? '';
  els.filesBox.hidden = !p;
  if (p) renderFiles(p);
}

async function loadUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'download');
    await openFile(name, new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    showReport({ doc: null, accepted: false, issues: [{ level: 'error', code: 'fetch', path: null, message: `Could not fetch ${url}: ${e.message}` }] });
  }
}

/* ---------- validating ---------- */

async function run({ fit = false } = {}) {
  const id = ++runId;
  const text = els.editor.value;
  if (!text.trim()) {
    report = null;
    showReport(null);
    return;
  }
  const r = await validator.validateText(text, pkg);
  if (id !== runId) return;
  report = r;
  showReport(r);
  const drawable = r.doc && !r.issues.some((i) => i.code.startsWith('schema-') || i.code === 'unknown-major');
  if (drawable) {
    drawn = { doc: r.doc, vector: r.vector };
    courseIndex = Math.min(courseIndex, r.doc.courses.length - 1);
    renderCourses();
    if (fit) mapView.fit(r.doc, assets, courseIndex);
  }
  els.stale.hidden = drawable || !drawn;
  if (!drawn) {
    mapView.clear();
    els.course.innerHTML = '';
    els.course.disabled = true;
    els.meta.innerHTML = '';
  }
}

let timer;
els.editor.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(run, 250);
});

/* ---------- report ---------- */

function showReport(r) {
  const v = els.verdict;
  els.issues.innerHTML = '';
  if (!r) {
    v.className = 'verdict idle';
    v.innerHTML = '<strong>Nothing to validate yet.</strong> Open an <code>.oac</code> package or paste a <code>course.json</code>.';
    return;
  }
  const n = (level) => r.issues.filter((i) => i.level === level).length;
  const [errors, warnings, notes] = [n('error'), n('warning'), n('info')];
  const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  if (!r.accepted) {
    v.className = 'verdict bad';
    v.innerHTML = `<strong>Not valid.</strong> ${plural(errors, 'error')}${warnings ? `, ${plural(warnings, 'warning')}` : ''}. Readers reject this ${pkg ? 'package' : 'file'}.`;
  } else if (warnings) {
    v.className = 'verdict warn';
    v.innerHTML = `<strong>Valid, with ${plural(warnings, 'warning')}.</strong> Readers accept it; writers must fix the warnings.`;
  } else {
    v.className = 'verdict good';
    v.innerHTML = `<strong>Valid.</strong> Open Archery Course ${r.doc.formatVersion}, ${plural(r.doc.courses.length, 'course')}${pkg ? ', package checked' : ''}.`;
  }
  if (notes) v.innerHTML += ` <span class="muted">${plural(notes, 'note')}.</span>`;

  for (const issue of r.issues) {
    const li = document.createElement('li');
    li.className = `issue ${issue.level}`;
    const target = issue.path ?? (issue.offset !== undefined ? `char ${issue.offset}` : null);
    const clickable = issue.path !== null && issue.path !== undefined ? true : issue.offset !== undefined;
    const tag = clickable ? 'button' : 'div';
    li.innerHTML = `<${tag} class="issue-body" ${clickable ? 'type="button"' : ''}>
      <span class="level">${issue.level === 'info' ? 'note' : issue.level}</span>
      <span class="msg"></span>
      ${target ? `<code class="where"></code>` : ''}
      <span class="code"></span></${tag}>`;
    li.querySelector('.msg').textContent = issue.message;
    li.querySelector('.code').textContent = issue.code;
    if (target) li.querySelector('.where').textContent = issue.path || (issue.path === '' ? '/' : target);
    if (clickable)
      li.querySelector('button').addEventListener('click', () =>
        issue.path !== null && issue.path !== undefined ? selectPointer(issue.path) : selectRange(issue.offset, issue.offset + 1),
      );
    els.issues.append(li);
  }
}

/* ---------- editor links ---------- */

function selectPointer(pointer) {
  const span = locate(els.editor.value, pointer);
  if (span) selectRange(span.start, span.end);
  const point = pointAt(report?.doc ?? drawn?.doc, pointer);
  if (point) mapView.focus(point);
}

function selectRange(start, end) {
  const ed = els.editor;
  els.editorBox.open = true;
  ed.focus({ preventScroll: true });
  ed.setSelectionRange(start, end);
  const { line } = lineCol(ed.value, start);
  const lh = parseFloat(getComputedStyle(ed).lineHeight) || 18;
  ed.scrollTop = Math.max(0, (line - 4) * lh);
  ed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** The point nearest the end of `pointer` in `doc`, to fly the map to. */
function pointAt(doc, pointer) {
  if (!doc || !pointer) return null;
  let node = doc;
  let found = null;
  for (const seg of pointer.split('/').slice(1)) {
    node = node?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) break;
    const p = isPoint(node) ? node : isPoint(node?.point) ? node.point : Array.isArray(node?.path) && isPoint(node.path[0]) ? node.path[0] : null;
    if (p) found = p;
  }
  return found;
}
const isPoint = (p) => p && typeof p.lat === 'number' && typeof p.lon === 'number' && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/* ---------- map ---------- */

function renderCourses() {
  const { doc } = drawn;
  const previous = els.course.value;
  els.course.innerHTML = doc.courses
    .map((c, i) => `<option value="${i}">${escapeHtml(c.course.name)} (${escapeHtml(c.key)})</option>`)
    .join('');
  els.course.disabled = doc.courses.length < 2;
  els.course.value = String(courseIndex);
  if (previous === '' && els.course.value === '') els.course.value = '0';
  els.others.disabled = doc.courses.length < 2;
  mapView.render(doc, { rasterUrl: assets.urls?.[doc.map?.raster?.href], vector: drawn.vector, photoUrls: assets.urls }, { courseIndex, showOthers: els.others.checked });
  renderMeta(doc.courses[courseIndex], doc);
}

function renderMeta(entry, doc) {
  const c = entry.course;
  const chips = c.legend
    .map((e) => `<span class="chip"><span class="dot" style="--c:${PEG[e.colour]}"></span>${escapeHtml(e.label)}${e.marked ? '' : ' <span class="muted">unmarked</span>'}</span>`)
    .join('');
  const facts = [
    c.ruleset,
    `${c.stations.length} target${c.stations.length === 1 ? '' : 's'}`,
    entry.revision?.id && `revision ${escapeHtml(entry.revision.id)}`,
    entry.license && escapeHtml(entry.license),
    c.publisher?.name && escapeHtml(c.publisher.name),
  ].filter(Boolean);
  const tiles = doc.extensions?.['oac.tiles'] ? '<p class="muted small">This package has a tiled map (oac.tiles). The validator does not draw tiles, so it shows the raster fallback.</p>' : '';
  els.meta.innerHTML = `<p class="facts">${facts.join(' · ')}</p><div class="chips">${chips}</div>${tiles}`;
}

els.course.addEventListener('change', () => {
  courseIndex = Number(els.course.value);
  if (!drawn) return;
  renderCourses();
  mapView.fit(drawn.doc, assets, courseIndex);
});
els.others.addEventListener('change', () => drawn && renderCourses());

/* ---------- package files ---------- */

function renderFiles(p) {
  const roles = new Map([['mimetype', 'media type'], ['course.json', 'course data']]);
  const rows = [...p.files].map(([name, bytes]) => {
    const role = roles.get(name) ?? (name.startsWith('extensions/') ? `extension ${name.split('/')[1]}` : '');
    return `<tr><td><code>${escapeHtml(name)}</code></td><td>${escapeHtml(role)}</td><td class="num">${formatBytes(bytes.length)}</td></tr>`;
  });
  els.files.innerHTML = `<table><tbody>${rows.join('')}</tbody><tfoot><tr><td>Package</td><td></td><td class="num">${formatBytes(p.size)}</td></tr></tfoot></table>`;
}

const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------- inputs ---------- */

els.file.addEventListener('change', async () => {
  const f = els.file.files[0];
  if (f) await openFile(f.name, new Uint8Array(await f.arrayBuffer()));
  els.file.value = '';
});

els.example.addEventListener('click', () => loadUrl('examples/pine-ridge.oac'));

els.close.addEventListener('click', () => {
  loadText('', null, null);
  history.replaceState(null, '', location.pathname);
});

let depth = 0;
addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  depth++;
  els.drop.hidden = false;
});
addEventListener('dragleave', () => {
  if (--depth <= 0) {
    depth = 0;
    els.drop.hidden = true;
  }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  depth = 0;
  els.drop.hidden = true;
  const f = e.dataTransfer?.files[0];
  if (f) await openFile(f.name, new Uint8Array(await f.arrayBuffer()));
});

els.editor.addEventListener('paste', () => {
  if (!els.editor.value.trim() && !pkg) setTimeout(() => setSource('Pasted course.json', null), 0);
});

const src = new URLSearchParams(location.search).get('src');
if (src) loadUrl(src);
else showReport(null);
