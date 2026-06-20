# qwen-agent-tui

A Claude Code-style terminal agent powered by local/remote OpenAI-compatible runtimes. Built with Bun + OpenTUI.

## Features

- **Rich TUI** — Full-screen terminal UI with chat panel, status bar, and overlays
- **State Machine** — Explicit states: idle → thinking → executing_tool → idle/error
- **Skills System** — Load skill definitions from JSON files
- **Todo List** — Track tasks with `/todo add` and `/todo`
- **Context Awareness** — Auto-detects git repo, branch, README
- **Built-in Tools** — bash, read_file, write_file, list_dir, git_status
- **Slash Commands** — `/help`, `/clear`, `/compact`, `/todo`, `/skill`, `/exit`

## Install

```bash
cd qwen-agent-tui
bun install
```

## Setup

By default the app connects to LM Studio at `http://127.0.0.1:1234/v1`.

### Recommended Local Model
For optimal performance with local models, we recommend:
- **Primary Model**: `Jackrong\Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF`
- **Runtime**: LM Studio (http://127.0.0.1:1234/v1)

This model provides excellent reasoning capabilities while being efficient for local execution.

### Configuration
Optional config at `~/.qwen-agent.json`:

```json
{
  "model": "Jackrong\Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF",
  "baseURL": "http://127.0.0.1:1234/v1",
  "workspace": "/path/to/project",
  "subAgentModel": "qwen3.5:0.8b",
  "subAgentEnabled": true,
  "subAgentMaxIterations": 6
}
```

With **two models loaded in LM Studio** (main agent + small Qwen), the app auto-detects the smaller loaded model as an exploration sub-agent. The main agent can call **`explore_subagent`** — read-only search/read on the 0.8B model, then a summary back to the main model for edits.

## Run

```bash
bun run start          # interactive TUI (default)
bun run start:tui      # same
```

### Headless CLI (for scripts and coding agents)

Non-interactive subcommands with `--help` and copy-pasteable examples on every command:

```bash
bun run src/main.ts --help
bun run src/main.ts run --help
bun run src/main.ts doctor
bun run src/main.ts models --json
bun run src/main.ts run --prompt "list files in src" --workspace . --quiet
echo "fix the typo in README" | bun run src/main.ts run --stdin -w .
```

| Command | Description |
|---------|-------------|
| `run` | One-shot agent task; use `--json` for machine-readable output |
| `models` | List LM Studio models with context / load state |
| `doctor` | Config + runtime health check |
| `tui` | Full-screen UI |

Exit codes: `0` success, `1` failure. Errors include a suggested invocation.

## TUI slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show help overlay |
| `/clear` | Clear chat history |
| `/compact` | Compact conversation |
| `/cd [path]` | Change the tool workspace |
| `/allow [path]` | Approve extra file/list/write access outside the workspace |
| `/todo` | Show todo overlay |
| `/todo add ...` | Add a todo |
| `/skill` | List loaded skills |
| `/exit` | Quit |

## Security

qwen-agent-tui includes **built-in security hardening** to protect against common risks:

- 🛡️ **Command Validation** - Blocks dangerous commands (`rm -rf`, `dd`, `sudo`, etc.)
- 📁 **File Access Control** - Restricts access to workspace and blocks sensitive paths (`.env`, `.git`, etc.)
- 🔒 **Output Sanitization** - Automatically redacts API keys, tokens, and secrets from outputs

Security is **enabled by default**. Configure via `~/.qwen-agent.json`:

```json
{
  "securityEnabled": true,
  "securityValidateCommands": true,
  "securityValidateFileAccess": true,
  "securitySanitizeOutput": true
}
```

See [SECURITY.md](SECURITY.md) for detailed documentation.

## Architecture

```
src/
├── opentui/
│   ├── index.tsx       # Entry point
│   ├── app.tsx         # Main OpenTUI app
│   ├── status-bar.tsx  # Top status bar
│   ├── chat-screen.tsx # Chat history and input
│   └── overlays.tsx    # Help/history overlays
├── types.ts            # Shared types
├── config.ts           # Config loader
├── store.ts            # Todo/session persistence
├── skills.ts           # Skill loader
├── context.ts          # Repo context detection
├── agent.ts            # Core agent + state machine
└── tools/
    └── index.ts        # Tool definitions
```

## License

MIT
