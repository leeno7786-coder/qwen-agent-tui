import { parseArgs } from 'util';
import { printModelsHelp, cliError } from './help';
import { formatModelsList, getModelsList } from './reports';

export async function cmdModels(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printModelsHelp();
    return 0;
  }

  const baseURL = values['base-url'];
  const models = await getModelsList(baseURL);

  if (models.length === 0) {
    cliError(
      `No models returned from ${baseURL || 'config base URL'}`,
      '  Ensure LM Studio is running and a model is downloaded.\n' +
        '  qwen-agent doctor\n' +
        '  qwen-agent models --base-url http://127.0.0.1:1234/v1'
    );
  }

  if (values.json) {
    console.log(JSON.stringify(models, null, 0));
    return 0;
  }

  console.log(formatModelsList(models).replace(/\n\nUse \/connect.*\nCLI:.*$/s, ''));
  return 0;
}
