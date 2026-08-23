#!/usr/bin/env node
import { tsImport } from 'tsx/esm/api';

const { run } = await tsImport('../src/main.ts', import.meta.url);

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(`particle: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
