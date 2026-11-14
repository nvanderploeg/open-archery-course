/**
 * Character span of the value a JSON Pointer names in `text`.
 * When the pointer runs past what exists, returns the deepest span it reached.
 */
export function locate(text, pointer) {
  const segs = pointer
    ? pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    : [];
  let i = 0;

  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const readString = () => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const skipValue = () => {
    ws();
    const c = text[i];
    if (c === '"') return void readString();
    if (c === '{' || c === '[') {
      let depth = 0;
      while (i < text.length) {
        const d = text[i];
        if (d === '"') {
          readString();
          continue;
        }
        if (d === '{' || d === '[') depth++;
        else if (d === '}' || d === ']') {
          depth--;
          if (depth === 0) {
            i++;
            return;
          }
        }
        i++;
      }
      return;
    }
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
  };
  const spanHere = () => {
    ws();
    const start = i;
    skipValue();
    const end = i;
    i = start;
    return { start, end };
  };

  try {
    let span = spanHere();
    for (const seg of segs) {
      ws();
      const open = text[i];
      let found = false;
      if (open === '{') {
        i++;
        for (;;) {
          ws();
          if (text[i] !== '"') break;
          const key = readString();
          ws();
          if (text[i] !== ':') break;
          i++;
          if (key === seg) {
            found = true;
            break;
          }
          skipValue();
          ws();
          if (text[i] !== ',') break;
          i++;
        }
      } else if (open === '[') {
        i++;
        const want = Number(seg);
        for (let k = 0; ; k++) {
          ws();
          if (text[i] === ']') break;
          if (k === want) {
            found = true;
            break;
          }
          skipValue();
          ws();
          if (text[i] !== ',') break;
          i++;
        }
      }
      if (!found) return span;
      span = spanHere();
    }
    return span;
  } catch {
    return null;
  }
}

/** 1-based line and column of a character offset. */
export function lineCol(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, col: offset - before.lastIndexOf('\n') };
}
