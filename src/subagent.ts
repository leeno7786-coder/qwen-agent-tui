import { resolve, relative, isAbsolute } from "path";
import { createClient, chat, type ChatMessage, isLocalProvider } from "./llm";
import { tools, toOpenAI } from "./tools";
import type { Config } from "./types";
import { DEFAULT_SUB_AGENT_MAX_ITERATIONS } from "./config";
import { modelIdsMatch, requiresDistinctSubAgentModels, isSmallModelFromConfig } from "./model-runtime";
import {
  parseTextToolCalls,
  stripEmbeddedToolMarkup,
  type ParsedToolCall,
} from "./subagent-parse";
import { bootstrapContext } from "./subagent-bootstrap";
import { discoverSeedPaths, gitChangedFiles } from "./subagent-seeds";
import {
  lensSystemAddendum,
  normalizeLens,
  type SubAgentLens,
} from "./subagent-lenses";

/** Read-only tools the exploration sub-agent may use. */
export const SUB_AGENT_TOOL_NAMES = new Set([
  "read_file",
  "list_dir",
  "find_files",
  "search_and_view",
  "grep_search",
  "stat_path",
]);

const SUB_AGENT_SYSTEM = `You are a read-only investigation sub-agent. You do NOT edit files or run shell commands.

Your job: gather concrete evidence for the main agent — paths, line ranges, symbols, and behavior you actually read.

Workflow:
1. Scan preloaded excerpts, then use grep_search / search_and_view to locate relevant code
2. read_file with offset/limit to confirm details (≤120 lines per read unless necessary)
3. Follow imports or callers one level when it clarifies a finding
4. Stay within seeded paths and git-changed files unless the task requires otherwise

Rules:
- Workspace-relative paths only — never full Windows drive paths
- Do not guess — cite only what tools returned
- Prefer specific findings over generic advice
- When done, reply with plain text including a "## Summary" section
- Up to 1200 words; bullets with path + line references
- Use native tool_calls; pythonic [tool_name(arg="value")] also works on some models`;

export interface SubAgentTask {
  /** Short label from the main agent (e.g. auth-flow, api-routes). */
  name?: string;
  /** Investigation instructions authored by the main agent. */
  prompt: string;
  focus_path?: string;
  lens?: SubAgentLens | string;
}

/** Normalize main-agent dispatch payload into runnable tasks. */
export function normalizeSubAgentTasks(
  agents: unknown,
  legacyTasks?: unknown
): SubAgentTask[] {
  const raw = Array.isArray(agents)
    ? agents
    : Array.isArray(legacyTasks)
      ? legacyTasks
      : [];
  return raw
    .map((a: any) => ({
      name: a?.name ? String(a.name).trim() : undefined,
      prompt: String(a?.prompt ?? a?.task ?? "").trim(),
      focus_path: a?.focus_path ? String(a.focus_path).trim() : undefined,
      lens: a?.lens ? normalizeLens(a.lens) : undefined,
    }))
    .filter((t) => t.prompt);
}

function mergeRawToolInput(args: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...args };
  const raw = merged.raw_input;
  if (typeof raw !== "string" || !raw.trim()) return merged;

  const tryParse = (text: string) => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  let parsed = tryParse(raw.trim());
  if (!parsed) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = tryParse(match[0]);
  }
  return parsed ? { ...merged, ...parsed } : merged;
}

function parseAgentsJsonString(value: unknown): SubAgentTask[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeSubAgentTasks(parsed, undefined);
  } catch {
    return [];
  }
}

/** Accept agents[], tasks[], code_review mode, single prompt, or malformed model output. */
export function parseDispatchSubAgentArgs(
  args: Record<string, unknown>,
  workspace: string
): { tasks: SubAgentTask[]; autoFallback?: "code_review" | "empty_args" } {
  const merged = mergeRawToolInput(args);

  let tasks = normalizeSubAgentTasks(merged.agents, merged.tasks);
  if (!tasks.length && merged.agents) {
    tasks = parseAgentsJsonString(merged.agents);
  }
  if (tasks.length) return { tasks };

  const mode = String(merged.mode ?? "").trim().toLowerCase();
  if (mode === "code_review") {
    return {
      tasks: buildCodeReviewTasks(workspace, {
        scope: String(merged.scope ?? "git"),
        paths: Array.isArray(merged.paths)
          ? merged.paths.map((p: unknown) => String(p))
          : undefined,
        question: String(merged.question ?? ""),
      }),
      autoFallback: "code_review",
    };
  }

  const singlePrompt = String(merged.prompt ?? merged.task ?? "").trim();
  if (singlePrompt) {
    return {
      tasks: [
        {
          name: merged.name ? String(merged.name).trim() : undefined,
          prompt: singlePrompt,
          focus_path: merged.focus_path ? String(merged.focus_path).trim() : undefined,
          lens: merged.lens ? normalizeLens(merged.lens) : undefined,
        },
      ],
    };
  }

  const keys = Object.keys(merged).filter((k) => k !== "raw_input");
  const emptyish =
    keys.length === 0 ||
    (keys.length === 1 && mode === "custom") ||
    (keys.length <= 2 && mode === "custom" && !merged.tasks);

  if (emptyish) {
    return {
      tasks: buildCodeReviewTasks(workspace, {
        scope: String(merged.scope ?? "git"),
        question: String(merged.question ?? ""),
      }).slice(0, 2),
      autoFallback: "empty_args",
    };
  }

  return { tasks: [] };
}

/** Resolve prompt text (supports legacy `task` field). */
export function resolveSubAgentPrompt(task: SubAgentTask): string {
  return String(task.prompt ?? (task as { task?: string }).task ?? "").trim();
}

export interface ExploreSubAgentOptions {
  focusPath?: string;
  lens?: SubAgentLens | string;
  name?: string;
  onProgress?: (snap: SubAgentProgressSnap) => void;
}

export interface SubAgentUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface SubAgentProgressSnap {
  name?: string;
  status: "running" | "done" | "failed";
  tools_used: number;
  input_tokens: number;
  output_tokens: number;
  iterations?: number;
  error?: string;
}

export type SubAgentAgentStatus = "pending" | "running" | "done" | "failed";

export interface SubAgentDispatchAgentRow {
  name: string;
  status: SubAgentAgentStatus;
  tools_used: number;
  input_tokens: number;
  output_tokens: number;
  error?: string;
}

export interface SubAgentDispatchProgress {
  total: number;
  index: number;
  phase: "running" | "waiting" | "done";
  agents: SubAgentDispatchAgentRow[];
}

export interface SubAgentResult {
  ok: boolean;
  summary: string;
  model: string;
  iterations: number;
  tools_used: string[];
  usage?: SubAgentUsage;
  error?: string;
  /** Set when the model stopped early without a real summary (e.g. XML tools in reasoning). */
  partial?: boolean;
  lens?: SubAgentLens;
  /** Main-agent label for this run. */
  name?: string;
  task?: string;
}

type ResolvedToolCall = ParsedToolCall;

function subAgentTools() {
  return tools.filter((t) => SUB_AGENT_TOOL_NAMES.has(t.name));
}

export function isOpenRouterBaseURL(baseURL: string): boolean {
  return baseURL.toLowerCase().includes("openrouter.ai");
}

/** OpenRouter free tier: cap agents per dispatch to avoid long 429 retry chains. */
export const DEFAULT_OPENROUTER_DISPATCH_LIMIT = 2;

const SKIPPED_RATE_LIMIT_MSG =
  "Skipped — provider rate limited. Wait a minute, then use explore_subagent for one lens at a time.";

export function openRouterDispatchLimit(cfg: Config): number | null {
  const baseURL = cfg.subAgentBaseURL ?? cfg.baseURL;
  if (!isOpenRouterBaseURL(baseURL)) return null;
  return Math.max(1, cfg.subAgentMaxPerDispatch ?? DEFAULT_OPENROUTER_DISPATCH_LIMIT);
}

/** Split tasks when OpenRouter dispatch limit applies. */
export function capSubAgentTasks(
  tasks: SubAgentTask[],
  cfg: Config
): { runnable: SubAgentTask[]; capped: SubAgentTask[]; limit: number | null } {
  const limit = openRouterDispatchLimit(cfg);
  if (limit == null || tasks.length <= limit) {
    return { runnable: tasks, capped: [], limit };
  }
  return {
    runnable: tasks.slice(0, limit),
    capped: tasks.slice(limit),
    limit,
  };
}

function cappedDispatchSkipMessage(limit: number): string {
  return `Skipped — OpenRouter allows max ${limit} agents per dispatch. Use explore_subagent for additional lenses.`;
}

function isRateLimitMessage(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("rate limit") || lower.includes("429");
}

function subAgentConfig(cfg: Config): Config {
  const baseURL = cfg.subAgentBaseURL ?? cfg.baseURL;
  const apiKey =
    cfg.subAgentApiKey ??
    (isLocalProvider(baseURL) ? cfg.apiKey || "lm-studio" : cfg.apiKey);
  const model = cfg.subAgentModel!;
  const onOpenRouter = isOpenRouterBaseURL(baseURL);
  return {
    ...cfg,
    baseURL,
    apiKey,
    model,
    smallModelMode: isSmallModelFromConfig({ model }),
    maxIterations:
      cfg.subAgentMaxIterations ??
      (onOpenRouter ? 4 : DEFAULT_SUB_AGENT_MAX_ITERATIONS),
    maxTokens: cfg.subAgentMaxTokens ?? 4096,
    temperature: cfg.subAgentTemperature ?? 0.2,
    rateLimitMs: onOpenRouter
      ? Math.max(cfg.rateLimitMs ?? 0, 2500)
      : cfg.rateLimitMs ?? 250,
    retryCount: onOpenRouter ? 1 : cfg.retryCount ?? 3,
  };
}

/** Pause between sequential sub-agent runs (OpenRouter free tier needs more spacing). */
export function subAgentSequentialPauseMs(cfg: Config): number {
  const baseURL = cfg.subAgentBaseURL ?? cfg.baseURL;
  if (isOpenRouterBaseURL(baseURL)) return Math.max(cfg.rateLimitMs ?? 0, 5000);
  return Math.max(cfg.rateLimitMs ?? 0, 800);
}

function subAgentEnableThinking(model: string): boolean {
  return model.toLowerCase().includes("qwen");
}

/** Convert absolute paths from small models to workspace-relative paths. */
function normalizeToolArgs(
  args: Record<string, unknown>,
  workspace: string
): Record<string, unknown> {
  const ws = resolve(workspace);
  const out = { ...args };

  const fixPath = (key: string) => {
    const raw = out[key];
    if (typeof raw !== "string" || !raw.trim()) return;
    let p = raw.trim();
    if (isAbsolute(p)) {
      const rel = relative(ws, p).replace(/\\/g, "/");
      if (rel && !rel.startsWith("..")) p = rel;
    }
    out[key] = p.replace(/\\/g, "/");
  };

  fixPath("path");
  fixPath("focus_path");
  if (Array.isArray(out.paths)) {
    out.paths = out.paths.map((p) =>
      typeof p === "string" ? String(p).replace(/\\/g, "/") : p
    );
  }
  return out;
}

function resolveToolCalls(msg: {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
}): ResolvedToolCall[] {
  if (msg.tool_calls?.length) {
    return msg.tool_calls
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }))
      .filter((tc) => SUB_AGENT_TOOL_NAMES.has(tc.name));
  }

  const combined = `${msg.reasoning_content || ""}\n${msg.content || ""}`;
  return parseTextToolCalls(combined).filter((tc) =>
    SUB_AGENT_TOOL_NAMES.has(tc.name)
  );
}

function buildSummary(msg: {
  content?: string;
  reasoning_content?: string;
}): string {
  const content = (msg.content || "").trim();
  if (content) return content;

  const reasoning = stripEmbeddedToolMarkup(msg.reasoning_content || "");
  if (reasoning.length > 80) return reasoning;

  return "";
}

function parseToolOk(content: string): { ok?: boolean; error?: string } {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === "object") {
      return {
        ok: typeof (obj as any).ok === "boolean" ? (obj as any).ok : undefined,
        error: typeof (obj as any).error === "string" ? (obj as any).error : undefined,
      };
    }
  } catch {
    // ignore
  }
  return {};
}

export function buildSeededTask(
  workspace: string,
  task: string,
  options?: ExploreSubAgentOptions
): string {
  const seeds = discoverSeedPaths(workspace, options?.focusPath);
  const bootstrap = bootstrapContext(workspace, options?.focusPath);
  return [
    "Start from these entry points (read selectively — do not load the entire project):",
    ...seeds.map((s) => `- ${s}`),
    bootstrap,
    "",
    "Task:",
    task.trim(),
  ].join("\n");
}

async function runDirectSubAgentSummary(
  client: ReturnType<typeof createClient>,
  subCfg: Config,
  system: string,
  seededTask: string,
  signal?: AbortSignal
): Promise<{ text: string; usage?: SubAgentUsage }> {
  const response = await chat(
    client,
    subCfg,
    [
      {
        role: "system",
        content:
          system +
          "\n\nTools are disabled for this pass. Answer only from the preloaded excerpts and task.",
      },
      {
        role: "user",
        content:
          seededTask +
          "\n\nWrite your final answer with a ## Summary section. Use bullet findings with severity and file paths.",
      },
    ],
    undefined,
    signal,
    { enableThinking: subAgentEnableThinking(subCfg.model) }
  );
  return {
    text:
      buildSummary(response.message) ||
      stripEmbeddedToolMarkup(response.message.content || ""),
    usage: response.usage,
  };
}

/** Build parallel review tasks across standard lenses (legacy helper — prefer main-agent prompts). */
export function buildCodeReviewTasks(
  workspace: string,
  args: { scope?: string; paths?: string[]; question?: string }
): SubAgentTask[] {
  const question =
    String(args.question ?? "").trim() ||
    "Investigate the scoped code with tools. Report only evidence-backed findings: exact paths, line numbers, and what the code does. No generic best-practice advice.";
  const scope = String(args.scope ?? "git").trim().toLowerCase();

  let focusHint = "";
  if (scope === "git") {
    const changed = gitChangedFiles(workspace);
    if (changed.length) focusHint = changed.slice(0, 16).join(", ");
  } else if (args.paths?.length) {
    focusHint = args.paths.map((p) => p.replace(/\\/g, "/")).join(", ");
  } else if (scope && scope !== "git") {
    focusHint = scope.replace(/\\/g, "/");
  }

  return [
    { name: "security", lens: "security", focus_path: focusHint, prompt: question },
    { name: "performance", lens: "performance", focus_path: focusHint, prompt: question },
    { name: "correctness", lens: "correctness", focus_path: focusHint, prompt: question },
    { name: "readability", lens: "readability", focus_path: focusHint, prompt: question },
  ];
}

/**
 * Run a bounded tool loop on the configured sub-agent model (e.g. Qwen3 Next 80B on OpenRouter).
 */
export async function runExploreSubAgent(
  task: string,
  cfg: Config,
  workspace: string,
  signal?: AbortSignal,
  options?: ExploreSubAgentOptions
): Promise<SubAgentResult> {
  const model = cfg.subAgentModel;
  const lens = normalizeLens(options?.lens);
  const agentName = options?.name?.trim();
  const taskLabel = task.slice(0, 200);
  if (!model) {
    return {
      ok: false,
      summary: "",
      model: "",
      iterations: 0,
      tools_used: [],
      error:
        "No sub-agent model configured. Set subAgentModel or OPENROUTER_API_KEY in config.",
      lens,
      name: agentName,
      task: taskLabel,
    };
  }

  if (requiresDistinctSubAgentModels(cfg) && modelIdsMatch(model, cfg.model)) {
    return {
      ok: false,
      summary: "",
      model,
      iterations: 0,
      tools_used: [],
      error:
        "Sub-agent model matches the main model on a local runtime — load a second small model in LM Studio or point subAgentBaseURL at OpenRouter.",
      lens,
      name: agentName,
      task: taskLabel,
    };
  }

  const subCfg = subAgentConfig(cfg);
  if (!isLocalProvider(subCfg.baseURL) && !subCfg.apiKey?.trim()) {
    return {
      ok: false,
      summary: "",
      model,
      iterations: 0,
      tools_used: [],
      error:
        "Missing OpenRouter API key for sub-agents. Reconnect in the UI or set OPENROUTER_API_KEY.",
      lens,
      name: agentName,
      task: taskLabel,
    };
  }
  const client = createClient(subCfg);
  const openaiTools = toOpenAI(subAgentTools(), subCfg);
  const toolSet = subAgentTools();
  const toolsUsed: string[] = [];
  const runMeta = { lens, name: agentName, task: taskLabel };
  let usage: SubAgentUsage = { input_tokens: 0, output_tokens: 0 };

  const bumpUsage = (u?: SubAgentUsage) => {
    if (!u) return;
    usage = {
      input_tokens: usage.input_tokens + u.input_tokens,
      output_tokens: usage.output_tokens + u.output_tokens,
    };
  };

  const withUsage = (result: Omit<SubAgentResult, "usage">): SubAgentResult => ({
    ...result,
    usage: { ...usage },
  });

  const ping = (
    status: SubAgentProgressSnap["status"],
    extra?: Partial<SubAgentProgressSnap>
  ) => {
    options?.onProgress?.({
      name: agentName,
      status,
      tools_used: toolsUsed.length,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      ...extra,
    });
  };

  const seededTask = buildSeededTask(workspace, task, options);
  const system = `${SUB_AGENT_SYSTEM}${lensSystemAddendum(lens)}\n\nWorkspace: ${workspace}`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: seededTask },
  ];

  const maxIter = subCfg.maxIterations;
  const errorCounts = new Map<string, number>();

  try {
    ping("running", { iterations: 0 });
    for (let i = 0; i < maxIter; i++) {
      if (signal?.aborted) {
        return withUsage({
          ok: false,
          summary: "",
          model,
          iterations: i,
          tools_used: toolsUsed,
          error: "Cancelled",
          ...runMeta,
        });
      }

      if (i > 0 && (subCfg.rateLimitMs ?? 0) > 0) {
        await new Promise((r) => setTimeout(r, subCfg.rateLimitMs));
      }

      ping("running", { iterations: i + 1 });

      const response = await chat(
        client,
        subCfg,
        messages,
        openaiTools,
        signal,
        { enableThinking: subAgentEnableThinking(subCfg.model) }
      );
      bumpUsage(response.usage);
      ping("running", { iterations: i + 1 });
      const msg = response.message;
      const toolCalls = resolveToolCalls(msg);

      if (!toolCalls.length) {
        const summary = buildSummary(msg);
        if (summary) {
          ping("done", { iterations: i + 1 });
          return withUsage({
            ok: true,
            summary,
            model,
            iterations: i + 1,
            tools_used: toolsUsed,
            partial: i + 1 < 2,
            ...runMeta,
          });
        }

        if (i < maxIter - 1) {
          messages.push({ role: "assistant", content: msg.content || "" });
          messages.push({
            role: "user",
            content:
              "Continue exploring. Use tools or [tool_name(arg=\"value\")] syntax. End with ## Summary.",
          });
          continue;
        }

        const fallback = await runDirectSubAgentSummary(
          client,
          subCfg,
          system,
          seededTask,
          signal
        );
        bumpUsage(fallback.usage);
        if (fallback.text.length > 40) {
          ping("done", { iterations: i + 1 });
          return withUsage({
            ok: true,
            summary: fallback.text,
            model,
            iterations: i + 1,
            tools_used: toolsUsed,
            partial: true,
            ...runMeta,
          });
        }

        ping("failed", { iterations: i + 1, error: "no summary" });
        return withUsage({
          ok: false,
          summary: "",
          model,
          iterations: i + 1,
          tools_used: toolsUsed,
          partial: true,
          error:
            "Sub-agent stopped without a summary. Try again or increase subAgentMaxIterations.",
          ...runMeta,
        });
      }

      if (i >= Math.max(1, maxIter - 2)) {
        messages.push({ role: "assistant", content: msg.content || "" });
        messages.push({
          role: "user",
          content:
            "Stop using tools now. Write your final answer with ## Summary, citing exact file paths.",
        });
        continue;
      }

      messages.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of toolCalls) {
        toolsUsed.push(tc.name);
        const tool = toolSet.find((t) => t.name === tc.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }
        args = normalizeToolArgs(args, workspace);
        const output = tool
          ? tool.execute(args, workspace, subCfg)
          : JSON.stringify({ ok: false, error: `Tool not allowed: ${tc.name}` });

        const parsed = parseToolOk(output);
        if (parsed.ok === false && parsed.error) {
          const key = `${tc.name}:${parsed.error}`;
          errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
          if ((errorCounts.get(key) || 0) >= 2) {
            messages.push({
              role: "user",
              content:
                `Tool error repeated: ${parsed.error}\n` +
                "Adjust your approach. Prefer grep/search over full-file reads.",
            });
          }
        }

        messages.push({
          role: "tool",
          content: output,
          tool_call_id: tc.id,
        });
      }
      ping("running", { iterations: i + 1 });
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const summary = lastAssistant
      ? buildSummary({ content: lastAssistant.content, reasoning_content: undefined })
      : "";

    if (!summary) {
      const fallback = await runDirectSubAgentSummary(
        client,
        subCfg,
        system,
        seededTask,
        signal
      );
      bumpUsage(fallback.usage);
      if (fallback.text.length > 40) {
        ping("done", { iterations: maxIter });
        return withUsage({
          ok: true,
          summary: fallback.text,
          model,
          iterations: maxIter,
          tools_used: toolsUsed,
          partial: true,
          ...runMeta,
        });
      }
    }

    ping(summary ? "done" : "failed", { iterations: maxIter });
    return withUsage({
      ok: Boolean(summary),
      summary:
        summary ||
        `Sub-agent hit iteration limit (${maxIter}). Tools used: ${toolsUsed.join(", ") || "none"}.`,
      model,
      iterations: maxIter,
      tools_used: toolsUsed,
      partial: !summary,
      ...runMeta,
    });
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    if (!isRateLimitMessage(err)) {
      try {
        const fallback = await runDirectSubAgentSummary(
          client,
          subCfg,
          system,
          seededTask,
          signal
        );
        bumpUsage(fallback.usage);
        if (fallback.text.length > 40) {
          ping("done");
          return withUsage({
            ok: true,
            summary: fallback.text,
            model,
            iterations: toolsUsed.length,
            tools_used: toolsUsed,
            partial: true,
            ...runMeta,
          });
        }
      } catch {
        // keep original error
      }
    }
    ping("failed", { error: err });
    return withUsage({
      ok: false,
      summary: "",
      model,
      iterations: toolsUsed.length,
      tools_used: toolsUsed,
      error: err,
      ...runMeta,
    });
  }
}

async function runSubAgentOnce(
  task: SubAgentTask,
  cfg: Config,
  workspace: string,
  signal?: AbortSignal,
  onProgress?: (snap: SubAgentProgressSnap) => void
): Promise<SubAgentResult> {
  const prompt = resolveSubAgentPrompt(task);
  return runExploreSubAgent(prompt, cfg, workspace, signal, {
    focusPath: task.focus_path,
    lens: normalizeLens(task.lens),
    name: task.name,
    onProgress,
  });
}

function agentLabel(task: SubAgentTask, index: number): string {
  return task.name?.trim() || `agent-${index + 1}`;
}

function syncRowFromSnap(
  row: SubAgentDispatchAgentRow,
  snap: SubAgentProgressSnap,
  status: SubAgentAgentStatus
) {
  row.status = status;
  row.tools_used = snap.tools_used;
  row.input_tokens = snap.input_tokens;
  row.output_tokens = snap.output_tokens;
  if (snap.error) row.error = snap.error;
}

function syncRowFromResult(row: SubAgentDispatchAgentRow, result: SubAgentResult) {
  row.status = result.ok ? "done" : "failed";
  row.tools_used = result.tools_used.length;
  row.input_tokens = result.usage?.input_tokens ?? row.input_tokens;
  row.output_tokens = result.usage?.output_tokens ?? row.output_tokens;
  if (result.error) row.error = result.error;
}

function makeSkippedSubAgentResult(
  task: SubAgentTask,
  cfg: Config,
  reason: string
): SubAgentResult {
  const prompt = resolveSubAgentPrompt(task);
  return {
    ok: false,
    summary: "",
    model: cfg.subAgentModel ?? "",
    iterations: 0,
    tools_used: [],
    error: reason,
    lens: task.lens ? normalizeLens(task.lens) : undefined,
    name: task.name,
    task: prompt.slice(0, 200),
  };
}

/** Run sub-agents one at a time in order (main agent defines each prompt). */
export async function runSequentialSubAgents(
  tasks: SubAgentTask[],
  cfg: Config,
  workspace: string,
  signal?: AbortSignal,
  hooks?: { onProgress?: (progress: SubAgentDispatchProgress) => void }
): Promise<SubAgentResult[]> {
  const pauseMs = subAgentSequentialPauseMs(cfg);

  const allTasks = tasks.filter((t) => resolveSubAgentPrompt(t));
  const { runnable, capped, limit } = capSubAgentTasks(allTasks, cfg);

  const rows: SubAgentDispatchAgentRow[] = allTasks.map((t, i) => ({
    name: agentLabel(t, i),
    status: "pending" as SubAgentAgentStatus,
    tools_used: 0,
    input_tokens: 0,
    output_tokens: 0,
  }));

  const emit = (index: number, phase: SubAgentDispatchProgress["phase"]) => {
    hooks?.onProgress?.({
      total: rows.length,
      index,
      phase,
      agents: rows.map((r) => ({ ...r })),
    });
  };

  if (!rows.length) return [];

  const ordered: SubAgentResult[] = new Array(allTasks.length);

  for (let i = runnable.length; i < allTasks.length; i++) {
    const row = rows[i]!;
    const task = allTasks[i]!;
    const reason =
      limit != null
        ? cappedDispatchSkipMessage(limit)
        : "Skipped — not scheduled in this dispatch.";
    row.status = "failed";
    row.error = reason;
    ordered[i] = makeSkippedSubAgentResult(task, cfg, reason);
  }

  emit(0, "running");

  let rateLimited = false;

  for (let i = 0; i < runnable.length; i++) {
    if (signal?.aborted) break;
    if (rateLimited) break;

    if (i > 0 && pauseMs > 0) {
      emit(i, "waiting");
      await new Promise((r) => setTimeout(r, pauseMs));
    }

    const next = runnable[i]!;
    const row = rows[i]!;
    row.status = "running";
    emit(i, "running");

    const result = await runSubAgentOnce(next, cfg, workspace, signal, (snap) => {
      syncRowFromSnap(row, snap, "running");
      emit(i, "running");
    });

    syncRowFromResult(row, result);
    emit(i, i === runnable.length - 1 && !capped.length ? "done" : "running");
    ordered[i] = result;

    if (!result.ok && isRateLimitMessage(result.error)) {
      rateLimited = true;
      for (let j = i + 1; j < runnable.length; j++) {
        const skipTask = runnable[j]!;
        const skipRow = rows[j]!;
        skipRow.status = "failed";
        skipRow.error = SKIPPED_RATE_LIMIT_MSG;
        ordered[j] = makeSkippedSubAgentResult(skipTask, cfg, SKIPPED_RATE_LIMIT_MSG);
      }
    }
  }

  emit(Math.max(0, rows.length - 1), "done");
  return ordered.filter((r): r is SubAgentResult => r != null);
}

/** @deprecated Use runSequentialSubAgents — sub-agents run one at a time now. */
export async function runParallelSubAgents(
  tasks: SubAgentTask[],
  cfg: Config,
  workspace: string,
  signal?: AbortSignal,
  hooks?: { onProgress?: (progress: SubAgentDispatchProgress) => void }
): Promise<SubAgentResult[]> {
  return runSequentialSubAgents(tasks, cfg, workspace, signal, hooks);
}
