const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Compiles the course schema with an Ajv 2020-12 class, the same in the browser and in Node. */
export function compileSchema(Ajv2020, schema) {
  const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: true, strictTypes: false });
  ajv.addFormat('date-time', DATE_TIME);
  const validate = ajv.compile(schema);
  return (doc) => (validate(doc) ? [] : formatErrors(validate.errors));
}

function formatErrors(errors) {
  const oneOfs = errors.filter((e) => e.keyword === 'oneOf');
  const insideOneOf = (e) =>
    oneOfs.some((o) => o !== e && e.schemaPath.startsWith(o.schemaPath + '/') && e.instancePath.startsWith(o.instancePath));
  return errors
    .filter((e) => !insideOneOf(e))
    .map((e) => ({
      level: 'error',
      code: `schema-${e.keyword}`,
      path: e.keyword === 'required' ? `${e.instancePath}/${e.params.missingProperty}` : e.instancePath,
      message: describe(e),
    }));
}

function describe(e) {
  const p = e.params;
  switch (e.keyword) {
    case 'required':
      return `Missing required "${p.missingProperty}".`;
    case 'enum':
      return `Must be one of ${p.allowedValues.map((v) => JSON.stringify(v)).join(', ')}.`;
    case 'const':
      return `Must be ${JSON.stringify(p.allowedValue)}.`;
    case 'additionalProperties':
      return `Unknown key "${p.additionalProperty}" is not allowed here.`;
    case 'type':
      return `Must be ${p.type === 'integer' ? 'an integer' : `a${/^[aeiou]/.test(p.type) ? 'n' : ''} ${p.type}`}.`;
    case 'pattern':
      return `Does not match ${p.pattern}.`;
    case 'oneOf':
      return `Must be ${branches(e.schema)}.`;
    case 'format':
      return `Must be an RFC 3339 ${p.format}, such as "2026-11-14T19:00:00Z".`;
    case 'propertyNames':
      return `Extension names are reverse-domain, such as "com.example".`;
    default:
      return `${e.message[0].toUpperCase()}${e.message.slice(1)}.`;
  }
}

function branches(node) {
  if (!Array.isArray(node)) return 'one of the allowed forms';
  return node
    .map((b) => {
      if ('const' in b) return JSON.stringify(b.const);
      if (b.required) return `{${b.required.join(', ')}}`;
      return b.type === 'integer' ? 'an integer' : `a ${b.type}`;
    })
    .join(' or ');
}

/**
 * Keys the schema doesn't name, where it leaves the object open.
 * Readers ignore them (SPEC §11), so a typo passes the schema silently.
 */
export function unknownKeys(schema, doc) {
  const out = [];
  const resolve = (s) => (s?.$ref ? resolve(s.$ref.replace(/^#\//, '').split('/').reduce((n, k) => n[k], schema)) : s);
  const walk = (s, value, path) => {
    s = resolve(s);
    if (!s || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (s.items) value.forEach((v, i) => walk(s.items, v, `${path}/${i}`));
      return;
    }
    if (!s.properties) return;
    for (const [k, v] of Object.entries(value)) {
      if (k in s.properties) walk(s.properties[k], v, `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      else if (s.additionalProperties === undefined)
        out.push({
          level: 'info',
          code: 'unknown-key',
          path: `${path}/${k}`,
          message: `"${k}" is not in format 0.1; readers ignore it. A typo, or does it belong under extensions?`,
        });
    }
  };
  walk(schema, doc, '');
  return out;
}
