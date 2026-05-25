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

By default the app connects to LM Studio at `http://127.0.0.1:1234/v1` using `nvidia/nemotron-3-nano-4b`.

Optional config at `~/.qwen-agent.json`:

```json
{
  "model": "qwen-coder-plus-latest",
  "workspace": "/path/to/project"
}
```

## Run

```bash
bun run start
```

## Commands

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
