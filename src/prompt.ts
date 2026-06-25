import type { Config } from "./types";
import { isSmallModelFromConfig } from "./model-runtime";
import { subAgentAvailable } from "./tools";
import { openRouterDispatchLimit } from "./subagent";

export interface PromptContext {
  workspace: string;
  branch?: string;
  skillNames?: string[];
  skillInfos?: { name: string; desc: string }[];
  allowedPaths?: string[];
  platformNote?: string;
}

/**
 * System prompt for local 8B-and-smaller models.
 * Tool schemas are sent separately — this focuses on workflow, not parameter docs.
 */
export function buildSmallModelPrompt(ctx: PromptContext): string {
  return [
    `You are a coding agent. Workspace: ${ctx.workspace}`,
    "",
    "## CRITICAL: You MUST use tools",
    "You have tools available. ALWAYS use them to explore and edit files.",
    "NEVER describe what you would do — actually DO it using tools.",
    "",
    "## Workflow",
    "1. **Explore** — list_dir to see files; find_files (by name) or search_and_view (by content) to locate code",
    "2. **Read** — read_file to examine files before editing",
    "3. **Edit** — edit_file (exact old_text) or edit_file_lines (1-based line numbers)",
    "4. **Run** — execute_command for shell commands (PowerShell on Windows)",
    "5. **Track** — manage_todos for tasks with 2+ steps",
    "",
    "## Rules",
    "- ALWAYS call a tool — never just talk about what you would do",
    "- Write 1 short line describing your action, THEN call the tool",
    "- Use list_dir first when asked to review or explore code",
    "- Read before editing; never invent file contents",
    "- One focused change per edit; verify with execute_command when unsure",
    "- Short replies; put detail in tool use, not prose",
    "- git_status / git_diff / git_commit only when the user asks about git",
  ].join("\n");
}

/**
 * System prompt for larger / cloud models.
 */
export function buildLargeModelPrompt(
  ctx: PromptContext,
  cfg?: Config
): string {
  const lines = [
    `You are Qwen Agent, a senior software engineer. Workspace: ${ctx.workspace}`,
    "",
    "## Workflow",
    "1. git_diff / git_status first for review or audit tasks",
    "2. **dispatch_subagents** — you write each sub-agent's name + prompt; they run sequentially and return evidence",
    "3. read_file only for files you must verify or edit",
    "4. edit_file or edit_file_lines; run_tests / typecheck / run_command to verify",
    "",
    "## Rules",
    "- If you call tools, first write a brief preface (1–2 lines) describing the plan, then call the tool(s)",
    "- Never ask the user to paste files or say you can't see the directory — use tools instead",
    "- Avoid map_project_tree and batch_read_files unless the user explicitly wants a full tree",
    "- Detect stack from package.json, pyproject.toml, Cargo.toml, etc.",
    "- Ask when requirements are ambiguous or files contradict each other",
    "- execute_command for shell work; prefer project scripts over ad-hoc commands",
    "- manage_todos for multi-step work",
    "",
    "## Review / audit output",
    "- Synthesize sub-agent findings into a short report: Critical → High → Medium → Low",
    "- Each finding: file path, issue, suggested fix",
    "- Skip noise; dedupe overlapping lens reports",
  ];

  if (cfg && subAgentAvailable(cfg)) {
    const subBase = cfg.subAgentBaseURL ?? cfg.baseURL;
    const isMistral = subBase.toLowerCase().includes("mistral.ai");
    const isOpenRouter = subBase.toLowerCase().includes("openrouter.ai");

    lines.push(
      "",
      "## Sub-agents"
    );

    if (isMistral) {
      lines.push(
        `- Sub-agents use Mistral API with model \`${cfg.subAgentModel}\`.`
      );
    } else if (isOpenRouter) {
      lines.push(
        `- On OpenRouter, sub-agents use \`openrouter/free\` by default (random free tool-capable model). Current: \`${cfg.subAgentModel}\`. Override via \`subAgentModel\` in config.`
      );
    } else {
      lines.push(
        `- Sub-agents use model \`${cfg.subAgentModel}\`.`
      );
    }

    lines.push(
      "- **dispatch_subagents** — pass `agents: [{ name, prompt, focus_path? }]`. You craft each prompt; they run one at a time."
    );

    const limit = openRouterDispatchLimit(cfg);
    if (limit !== null) {
      lines.push(
        `- On OpenRouter free tier, dispatch **at most ${limit} agents** per call; use **explore_subagent** for additional lenses.`
      );
    }

    lines.push(
      "- **explore_subagent** — single investigation when one angle is enough.",
      "- Sub-agents gather evidence with path:line citations; you verify and apply fixes."
    );
  }

  return lines.join("\n");
}

/**
 * Shared suffix: platform, paths, git, skills, todos.
 */
export function appendPromptExtras(
  base: string,
  ctx: PromptContext,
  smallModel = false
): string {
  let system = base;

  if (ctx.allowedPaths?.length) {
    system += `\n\nExtra approved paths: ${ctx.allowedPaths.join(", ")}`;
  }
  if (ctx.branch) {
    system += `\nGit branch: ${ctx.branch}`;
  }
  if (!smallModel) {
    // Skills section is too verbose for small models — they don't use skills well
    if (ctx.skillInfos?.length) {
      system += `\n\n## Skills\nType /skill:name to load one. Skills also auto-load when you mention related keywords.\n${ctx.skillInfos.map(s => `- /skill:${s.name} — ${s.desc}`).join("\n")}`;
    } else if (ctx.skillNames?.length) {
      system += `\n\n## Skills\nType /skill:name to load one. Skills also auto-load when you mention related keywords.\nAvailable: ${ctx.skillNames.join(", ")}`;
    }
  }
  if (ctx.platformNote) {
    system += `\n\n${ctx.platformNote}`;
  }

  system += "\n\n## Todos\nBreak multi-step requests into manage_todos items. Mark complete via the tool — do not skip it.";

  return system;
}

/**
 * Build the full system prompt for the agent.
 */
export function buildSystemPrompt(cfg: Config, ctx: PromptContext): string {
  if (cfg.systemPrompt) {
    return appendPromptExtras(cfg.systemPrompt, ctx);
  }

  const small = isSmallModelFromConfig(cfg);
  const base = small
    ? buildSmallModelPrompt(ctx)
    : buildLargeModelPrompt(ctx, cfg);
  const platformNote =
    process.platform === "win32"
      ? "Platform: Windows — shell commands run in PowerShell."
      : undefined;

  return appendPromptExtras(base, { ...ctx, platformNote }, small);
}
