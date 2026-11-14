#!/usr/bin/env node
// Packs a folder into an .oac: `node tools/pack.mjs <folder> [out.oac]`.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, basename, sep } from 'node:path';
import JSZip from 'jszip';
import { MIMETYPE } from '../validator/lib/package.js';

export async function packDir(dir) {
  const zip = new JSZip();
  // JSZip writes entries in insertion order, so mimetype lands first.
  zip.file('mimetype', MIMETYPE, { compression: 'STORE', date: new Date('2026-01-01T00:00:00Z') });
  for (const path of await walk(dir)) {
    const name = relative(dir, path).split(sep).join('/');
    if (name === 'mimetype') continue;
    zip.file(name, await readFile(path), { date: new Date('2026-01-01T00:00:00Z'), createFolders: false });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (!e.name.startsWith('.')) out.push(p);
  }
  return out.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, out = `${basename(dir)}.oac`] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node tools/pack.mjs <folder> [out.oac]');
    process.exit(2);
  }
  await writeFile(out, await packDir(dir));
  console.log(`wrote ${out}`);
}
