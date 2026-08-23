import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASES } from './cases.ts';
import { referenceCanonicalJson } from './codec.ts';
import { runConformance } from './run-conformance.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, 'fixtures');

if (!process.argv.slice(2).includes('--bless')) {
  throw new Error('refusing to regenerate the normative corpus without --bless');
}

await mkdir(FIXTURES, { recursive: true });
for (const fixture of CASES) {
  const caseDir = path.join(FIXTURES, fixture.name);
  await rm(caseDir, { recursive: true, force: true });
  await mkdir(path.join(caseDir, 'events'), { recursive: true });
  await mkdir(path.join(caseDir, 'expected'), { recursive: true });
  await writeFile(
    path.join(caseDir, 'case.md'),
    `# ${fixture.name}\n\n${fixture.summary}\n`,
    'utf8',
  );
  await writeFile(
    path.join(caseDir, 'case.json'),
    referenceCanonicalJson({
      project: fixture.events[0]?.project ?? 'prj_00000000000000000000000001',
      ...(fixture.materialize ? { materialize: fixture.materialize } : {}),
    }),
    'utf8',
  );
  for (const [index, event] of fixture.events.entries()) {
    const filename = `${index.toString().padStart(4, '0')}-${event.id}.json`;
    await writeFile(path.join(caseDir, 'events', filename), referenceCanonicalJson(event), 'utf8');
  }
  if (fixture.events.length === 0) {
    await writeFile(path.join(caseDir, 'events', '.gitkeep'), '', 'utf8');
  }
  await writeFile(path.join(caseDir, 'expected', 'state.json'), '', 'utf8');
  await writeFile(path.join(caseDir, 'expected', 'order.txt'), '', 'utf8');
  if (fixture.materialize) {
    await writeFile(path.join(caseDir, 'expected', 'view.txt'), '', 'utf8');
  }
}

const names = await runConformance({ bless: true });
process.stdout.write(`generated and blessed ${names.length} conformance cases\n`);
