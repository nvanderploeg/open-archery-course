// Assembles the GitHub Pages site in _site/.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { packDir } from '../tools/pack.mjs';

const out = '_site';
await rm(out, { recursive: true, force: true });
await cp('validator', out, { recursive: true });
await cp('schema', `${out}/schema`, { recursive: true });
await mkdir(`${out}/examples`, { recursive: true });
await writeFile(`${out}/examples/pine-ridge.oac`, await packDir('examples/pine-ridge'));
await writeFile(`${out}/.nojekyll`, '');
console.log(`built ${out}/`);
