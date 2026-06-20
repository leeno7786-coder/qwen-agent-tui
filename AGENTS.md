## Learned User Preferences

- Primary interface is the TUI (`bun run start`), not the headless CLI.
- Main agent orchestrates sub-agents: writes each prompt and dispatches sequentially via `dispatch_subagents`.
- Sub-agents default to OpenRouter `openrouter/free` (free router with tool calling); override with e.g. `qwen/qwen3-next-80b-a3b-instruct:free` in `~/.qwen-agent.json` if you want a fixed model.
- When improving local-model workflows, optimize for 8B-and-smaller models with 128k–400k context via LM Studio.
- **Recommended Local Model**: `Jackrong\Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF` for optimal performance.
- Prefers structured diff-style chat output for tool/file edits (● Update headers with line deltas).
- Attach the frontend-design skill for TUI/UI work when polishing panels and layout.

## Learned Workspace Facts

- Bun + OpenTUI agent; TUI code lives in `src/opentui/`; config at `~/.qwen-agent.json`.
- Default local backend is LM Studio at `http://127.0.0.1:1234/v1`.
- Sub-agent tools: `explore_subagent` (single investigation via `prompt`) and `dispatch_subagents` (`agents: [{ name, prompt, focus_path? }]`, sequential).
- OpenRouter free tier: max **2** agents per `dispatch_subagents`; extras are skipped. After a rate limit, remaining agents are skipped (use `explore_subagent` for one lens).
- Parallel `code_review` sub-agent mode was removed; main agent crafts per-agent prompts.
- Detects loaded model size and context from LM Studio dynamically.
- OpenRouter sub-agents reuse `OPENROUTER_API_KEY` when the main agent also uses OpenRouter.
