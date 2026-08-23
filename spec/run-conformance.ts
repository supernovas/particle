import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  canonicalJson,
  compareEvents,
  fold,
  parseEvent,
  stateToJson,
  type ParticleEvent,
} from '../packages/core/src/index.ts';

import { referenceViewSha } from './codec.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, 'fixtures');

interface CaseManifest {
  project: string;
  materialize?: { parents: { ref: string; sha: string }[] };
}

async function readEvents(caseDir: string): Promise<ParticleEvent[]> {
  const eventsDir = path.join(caseDir, 'events');
  const files = (await readdir(eventsDir)).filter((file) => file.endsWith('.json')).sort();
  const events: ParticleEvent[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(eventsDir, file), 'utf8');
    const json = JSON.parse(raw) as unknown;
    assert.equal(
      raw,
      canonicalJson(json),
      `${path.basename(caseDir)}/${file} is not canonical JSON`,
    );
    events.push(parseEvent(json));
  }
  return events;
}

function canonicalOrder(events: ParticleEvent[]): ParticleEvent[] {
  const unique = new Set<string>();
  return [...events].sort(compareEvents).filter((event) => {
    if (unique.has(event.id)) return false;
    unique.add(event.id);
    return true;
  });
}

async function checkOrBless(file: string, actual: string, bless: boolean): Promise<void> {
  if (bless) {
    await writeFile(file, actual, 'utf8');
    return;
  }
  const expected = await readFile(file, 'utf8');
  assert.equal(actual, expected, path.relative(ROOT, file));
}

export async function runConformance(options: { bless?: boolean } = {}): Promise<string[]> {
  const names = (await readdir(FIXTURES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of names) {
    const caseDir = path.join(FIXTURES, name);
    const manifest = JSON.parse(
      await readFile(path.join(caseDir, 'case.json'), 'utf8'),
    ) as CaseManifest;
    const events = await readEvents(caseDir);
    const ordered = canonicalOrder(events);
    const state = fold(manifest.project, events);
    const stateJson = canonicalJson(stateToJson(state));
    const orderText =
      ordered.length === 0 ? '' : `${ordered.map((event) => event.id).join('\n')}\n`;

    await checkOrBless(
      path.join(caseDir, 'expected', 'state.json'),
      stateJson,
      options.bless ?? false,
    );
    await checkOrBless(
      path.join(caseDir, 'expected', 'order.txt'),
      orderText,
      options.bless ?? false,
    );

    if (manifest.materialize) {
      const sha = referenceViewSha({
        project: manifest.project,
        events: ordered,
        stateJson,
        parents: manifest.materialize.parents,
        canonicalJson,
      });
      await checkOrBless(
        path.join(caseDir, 'expected', 'view.txt'),
        `${sha}\n`,
        options.bless ?? false,
      );
    }
  }
  return names;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const bless = process.argv.slice(2).includes('--bless');
  const names = await runConformance({ bless });
  process.stdout.write(`${bless ? 'blessed' : 'passed'} ${names.length} conformance cases\n`);
}
