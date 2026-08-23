import { parseArgs } from 'node:util';
import type { CommandContext } from '../context.ts';
import { loadProjects, storeFor, type StoredProject } from '../projects.ts';

const HEADERS = ['KEY', 'TITLE', 'MSGS', 'TASKS', 'STATUS'];

function row(project: StoredProject): string[] {
  const tasks = Object.values(project.state.tasks);
  return [
    project.key,
    project.state.title,
    String(project.state.messages.length),
    `${tasks.filter((task) => task.status === 'done').length}/${tasks.length}`,
    project.state.status,
  ];
}

export function renderTable(projects: StoredProject[]): string {
  const rows = projects.map(row);
  const widths = HEADERS.map((header, index) =>
    Math.max(header.length, ...rows.map((values) => values[index]!.length)),
  );
  return [HEADERS, ...rows]
    .map((values) =>
      values
        .map((value, index) => (index === values.length - 1 ? value : value.padEnd(widths[index]!)))
        .join('  '),
    )
    .join('\n');
}

export async function status(args: string[], context: CommandContext): Promise<number> {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({ args, allowPositionals: true, strict: true }));
  } catch (error) {
    context.stderr(`particle status: ${(error as Error).message}\n`);
    return 2;
  }
  if (positionals.length > 1) {
    context.stderr('usage: particle status [<key>]\n');
    return 2;
  }
  const key = positionals[0];
  const projects = loadProjects(storeFor(context));
  const selected = key ? projects.filter((project) => project.key === key) : projects;
  if (key && selected.length === 0) {
    context.stderr(`particle status: project not found: ${key}\n`);
    return 1;
  }
  context.stdout(`${renderTable(selected)}\n`);
  return 0;
}
