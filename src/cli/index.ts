import { printRootHelp } from './help';
import { cmdRun } from './run';
import { cmdModels } from './models';
import { cmdDoctor } from './doctor';

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printRootHelp();
    return 0;
  }

  switch (cmd) {
    case 'run':
      return cmdRun(rest);
    case 'models':
      return cmdModels(rest);
    case 'doctor':
      return cmdDoctor(rest);
    case 'tui':
      return 0; // handled by main before dispatch
    default:
      console.error(`Error: unknown command "${cmd}"\n`);
      printRootHelp();
      return 1;
  }
}
