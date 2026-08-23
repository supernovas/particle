/**
 * Encode the deliberately small canonical-JSON subset used by Particle.
 *
 * - object keys are sorted lexicographically at every level;
 * - array order is preserved;
 * - strings, booleans and finite numbers use JSON.stringify's encoding;
 * - undefined, non-finite numbers and other non-JSON values are rejected; and
 * - the document ends with exactly one LF.
 *
 * Keeping these rules simple makes them straightforward to reproduce in the
 * Rust worker without depending on a language-specific canonicalization crate.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, '$', new Set()) + '\n';
}

function encode(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonical JSON does not support non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError(`canonical JSON does not support undefined at ${path}`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(`canonical JSON does not support ${typeof value} at ${path}`);
    case 'object':
      break;
  }

  if (ancestors.has(value)) {
    throw new TypeError(`canonical JSON does not support circular values at ${path}`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) {
          throw new TypeError(`canonical JSON does not support sparse arrays at ${path}[${i}]`);
        }
        entries.push(encode(value[i], `${path}[${i}]`, ancestors));
      }
      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`canonical JSON only supports plain objects at ${path}`);
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(record[key], `${path}.${key}`, ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
