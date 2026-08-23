import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CommandContext } from './context.ts';
import { defaultContext } from './context.ts';
import { init } from './commands/init.ts';
import { log } from './commands/log.ts';
import { post } from './commands/post.ts';
import { status } from './commands/status.ts';

const HELP = `usage: particle <command> [options]

commands:
  init                              verify workspace setup
  post [--project <key>] <text>     create or append to a project
  status [<key>]                    show folded project state
  log <key> [--json]                show the canonical event log
`;

export async function run(argv: string[], context = defaultContext()): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'init':
      return init(args, context);
    case 'post':
      return post(args, context);
    case 'status':
      return status(args, context);
    case 'log':
      return log(args, context);
    case '-h':
    case '--help':
    case undefined:
      context.stdout(HELP);
      return 0;
    default:
      context.stderr(`particle: unknown command: ${command}\n${HELP}`);
      return 2;
  }
}

function isEntrypoint(): boolean {
  const script = process.argv[1];
  return (
    script !== undefined && realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (isEntrypoint()) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`particle: ${(error as Error).message}`);
      process.exitCode = 1;
    },
  );
}

export type { CommandContext };
