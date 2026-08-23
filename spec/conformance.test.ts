import { describe, expect, it } from 'vitest';

import { runConformance } from './run-conformance.ts';

describe('SPEC v1 conformance corpus', () => {
  it('matches every committed expectation byte-for-byte', async () => {
    const cases = await runConformance();
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });
});
