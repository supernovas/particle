import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, stateToJson } from '@particle/core';
import type { AgentRole, AgentRunContext } from './runner.ts';

const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL('../../../../roles/', import.meta.url));

export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  let rendered = template;
  for (const [name, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${name}}}`).join(value);
  }
  return rendered;
}

export async function writeRolePrompt(
  ctx: AgentRunContext,
  role: AgentRole,
  templatesDir = DEFAULT_TEMPLATES_DIR,
): Promise<string> {
  const template = await readFile(join(templatesDir, `${role}.md`), 'utf8');
  const task = ctx.taskId === undefined ? null : (ctx.state.tasks[ctx.taskId] ?? null);
  if (ctx.taskId !== undefined && task === null) {
    throw new Error(`task ${ctx.taskId} does not exist in project ${ctx.project}`);
  }
  const rendered = renderTemplate(template, {
    state: canonicalJson(stateToJson(ctx.state)).trimEnd(),
    task: canonicalJson(task).trimEnd(),
  });
  if (/{{(?:state|task)}}/.test(rendered)) {
    throw new Error(`role template ${role}.md contains an unresolved placeholder`);
  }

  const promptPath = isAbsolute(ctx.promptPath)
    ? ctx.promptPath
    : resolve(ctx.workdir, ctx.promptPath);
  await mkdir(dirname(promptPath), { recursive: true });
  await writeFile(promptPath, rendered.endsWith('\n') ? rendered : `${rendered}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return promptPath;
}
