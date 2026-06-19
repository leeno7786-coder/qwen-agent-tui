export function printRootHelp(): void {
  console.log(`qwen-agent — coding agent (TUI + headless)

Usage:
  qwen-agent <command> [options]

Commands:
  run       Run one task headlessly (for scripts and agents)
  models    List models from a local runtime (LM Studio)
  doctor    Check config and runtime connectivity
  tui       Interactive terminal UI (default)

Options:
  -h, --help    Show help

Examples:
  qwen-agent tui
  qwen-agent run --prompt "summarize package.json"
  echo "list src files" | qwen-agent run --stdin --workspace .
  qwen-agent models --base-url http://127.0.0.1:1234/v1
  qwen-agent doctor --json
`);
}

export function printRunHelp(): void {
  console.log(`Usage:
  qwen-agent run [options]

Options:
  -p, --prompt <text>       Task prompt (required unless --stdin)
      --stdin                 Read prompt from stdin
  -w, --workspace <path>    Working directory (default: cwd)
  -m, --model <id>          Model id
      --base-url <url>        API base URL (default: from config)
      --max-rounds <n>        Max agent rounds per invocation (default: 30)
      --max-iterations <n>    Max tool loops per round (default: from config)
      --json                  JSON output on stdout
      --quiet                 Only print the final assistant message
      --verbose               Log tool calls to stderr
  -h, --help                  Show help

Examples:
  qwen-agent run --prompt "run tests and fix failures" --workspace .
  qwen-agent run -p "what does agent.ts do?" -w ./src --quiet
  cat task.txt | qwen-agent run --stdin --workspace /repo
  qwen-agent run --prompt "status" --json --model qwen3-8b
`);
}

export function printModelsHelp(): void {
  console.log(`Usage:
  qwen-agent models [options]

Options:
      --base-url <url>    Runtime URL (default: from config)
      --json              JSON array on stdout
  -h, --help              Show help

Examples:
  qwen-agent models
  qwen-agent models --base-url http://127.0.0.1:1234/v1 --json
`);
}

export function printDoctorHelp(): void {
  console.log(`Usage:
  qwen-agent doctor [options]

Options:
      --json              JSON report on stdout
  -h, --help              Show help

Examples:
  qwen-agent doctor
  qwen-agent doctor --json
`);
}

export function printTuiHelp(): void {
  console.log(`Usage:
  qwen-agent tui

Launches the full-screen OpenTUI interface.

Examples:
  qwen-agent
  qwen-agent tui
`);
}

export function cliError(message: string, hint?: string): never {
  console.error(`Error: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}
