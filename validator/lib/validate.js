import { compileSchema, unknownKeys } from './schema.js';
import { checkRules } from './rules.js';
import { openPackage, checkContainer, readCourseJson, checkAssets, referencedFiles } from './package.js';

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * The validator, built from injected Ajv 2020 and JSZip classes so the browser page
 * and the Node tests run the same code.
 */
export function createValidator({ Ajv2020, JSZip, schema }) {
  const schemaCheck = compileSchema(Ajv2020, schema);

  /** Validates course.json text, against `pkg`'s files when it came from a package. */
  async function validateText(text, pkg = null) {
    const issues = [...(pkg?.containerIssues ?? [])];
    const done = (doc, vector = null) => {
      issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
      return { doc, vector, issues, accepted: !issues.some((i) => i.level === 'error') };
    };

    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      issues.push({ level: 'error', code: 'json', path: null, message: `Not valid JSON: ${e.message}`, ...jsonErrorAt(e.message, text) });
      return done(null);
    }

    const version = typeof doc?.formatVersion === 'string' && doc.formatVersion.match(/^(\d+)\.(\d+)$/);
    const unknownMajor = version && version[1] !== '0';
    if (unknownMajor)
      issues.push({ level: 'error', code: 'unknown-major', path: '/formatVersion', message: `Format major version ${version[1]} is unknown; this validator reads 0.x.` });

    const schemaIssues = schemaCheck(doc).filter((i) => !(unknownMajor && i.path === '/formatVersion'));
    issues.push(...schemaIssues);
    if (schemaIssues.length || unknownMajor) {
      issues.push({ level: 'info', code: 'rules-skipped', path: null, message: 'Rule and file checks run once the schema passes.' });
      return done(doc);
    }

    issues.push(...checkRules(doc), ...unknownKeys(schema, doc));
    if (!pkg) {
      const refs = referencedFiles(doc);
      if (refs.length)
        issues.push({ level: 'info', code: 'files-unchecked', path: null, message: `course.json names ${refs.map((r) => `"${r[1]}"`).join(', ')}. Open the .oac package to check those files.` });
      return done(doc);
    }
    const assets = await checkAssets(pkg, doc);
    issues.push(...assets.issues);
    return done(doc, assets.vector);
  }

  /**
   * Opens .oac bytes. Returns the package and its course.json text, or
   * `{ failure }` when there is nothing to validate.
   */
  async function openBytes(bytes) {
    let pkg;
    try {
      pkg = await openPackage(bytes, JSZip);
    } catch {
      return { failure: { level: 'error', code: 'not-zip', path: null, message: 'This is not a zip file, so it is not an .oac package.' } };
    }
    pkg.containerIssues = checkContainer(pkg);
    const bytesJson = pkg.files.get('course.json');
    if (!bytesJson) return { pkg, text: null };
    const { text, issue } = readCourseJson(bytesJson);
    if (issue) pkg.containerIssues.push(issue);
    return { pkg, text };
  }

  return { validateText, openBytes };
}

function jsonErrorAt(message, text) {
  const pos = message.match(/position (\d+)/);
  if (pos) return { offset: Number(pos[1]) };
  const lc = message.match(/line (\d+) column (\d+)/);
  if (!lc) return {};
  const lines = text.split('\n');
  const offset = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1;
  return { offset };
}
