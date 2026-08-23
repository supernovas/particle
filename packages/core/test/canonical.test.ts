import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@particle/core';

describe('canonicalJson', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}\n');
  });

  it('uses JSON string escaping without ASCII-escaping unicode', () => {
    expect(canonicalJson({ z: 'line\nfeed', emoji: '🚀', accent: 'łódź' })).toBe(
      '{"accent":"łódź","emoji":"🚀","z":"line\\nfeed"}\n',
    );
  });

  it('uses ECMAScript number spelling', () => {
    expect(canonicalJson([1.0, -0, 1e20, 1e-7, 1e21, 9_007_199_254_740_993])).toBe(
      '[1,0,100000000000000000000,1e-7,1e+21,9007199254740992]\n',
    );
  });

  it.each([
    ['undefined', undefined],
    ['undefined property', { bad: undefined }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['bigint', 1n],
  ])('rejects %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('rejects circular values', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => canonicalJson(value)).toThrow(/circular/);
  });
});
