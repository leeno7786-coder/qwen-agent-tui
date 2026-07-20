/**
 * Remote sub-agent pool executor.
 *
 * The main agent can fan out work to a pool of remote models (e.g. three
 * Qwen3.5-2B instances loaded on another device's LM Studio). Each endpoint
 * becomes one parallel worker that gets the FULL local tool set (file read /
 * write, search, shell) against the same workspace, so sub-agents can actually
 * investigate and act — not just answer prompts.
 *
 * Results are collected in parallel and returned to the main agent as a single
 * tool result it can synthesise.
 */

import { createClient, chat } from "./llm";
import type { ChatMessage } from "./llm";
import { tools, toOpenAI, type Tool, type ToolExecutionHooks, type SubAgentProgressEvent } from "./tools";
import { createSecurityManager, type SecurityManager } from "./security";
import { createToolCacheManager, type ToolCacheManager } from "./tools/cache";
import { fetchLMStudioModels } from "./model-runtime";
import { access, readdir, stat } from "fs/promises";
import { resolve, join, normalize } from "path";
import type {
  Config,
  SubAgentEndpoint,
  SubAgentPoolConfig,
} from "./types";

/** Sub-agent worker context. */
interface WorkerContext {
  endpoint: SubAgentEndpoint;
  cfg: Config;
  client: ReturnType<typeof createClient>;
  security: SecurityManager;
  cache: ToolCacheManager;
}

/** Result returned by a single sub-agent. */
export interface SubAgentResult {
  name: string;
  model: string;
  baseURL: string;
  ok: boolean;
  output: string;
  durationMs: number;
  error?: string;
  toolCalls: number;
}

const SUBAGENT_SYSTEM_PROMPT = `You are a sub-agent worker running on a small remote model, assisting the main coding agent.
You have a curated READ-ONLY exploration tool set: read_file, batch_read_files, list_dir, map_project_tree, find_files, stat_path, grep_search, search_and_view, git_status, git_diff.

CRITICAL RULES — follow exactly:
- TURN BUDGET & MANDATORY WRAP-UP: You are granted a tight budget of 4-6 tool rounds. Before your final turn, you are ORDERED to STOP calling tools and immediately summarize your findings for the main agent.
- Use ONLY the tools listed above. There is NO execute_command / shell. Never try to run bash, grep, rg, cat, find, or any terminal command.
- PATH HANDLING: Use exact relative paths from the workspace root (e.g. "src/agent.ts" or "package.json"). Check list_dir or map_project_tree if unsure.
- DO NOT REPEAT TOOL CALLS: Never call read_file on a file you already read, and never execute the exact same search twice. Refer to previous outputs in conversation history.
- TIGHT SCOPE: Read only the 1-3 key files specified in your prompt. Once you have inspected them, STOP calling tools and output your report.
- IF A SEARCH HAS 0 MATCHES: Do not repeat empty searches with minor text tweaks. Move on or write your final report based on what you have already inspected.
- Keep your final answer under ~1000 words. Lead with clear findings, line numbers, and actionable recommendations for the main agent.
- Return findings as plain text / markdown. No tool-call syntax in the final answer.`;

/**
 * Build a compact shared context block for a sub-agent: the absolute workspace
 * root and a flat top-level file/dir listing. The main agent is expected to
 * gather richer context (via its own tools) and feed it into the prompt; this
 * guarantees every sub-agent at least knows the REAL workspace path so it does
 * not guess (e.g. "G:\workspace") and send bad paths to list_dir/read_file.
 */
export async function buildSubAgentContext(cfg: Config): Promise<string> {
  const ws = cfg.workspace || process.cwd();
  const lines: string[] = [];
  lines.push(`WORKSPACE ROOT (absolute): ${ws}`);
  lines.push(`You MUST use paths relative to or under that root. Never invent drive letters or other roots.`);
  try {
    const entries = (await readdir(ws, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 40)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    lines.push(`Top-level entries: ${entries.join(", ")}`);
  } catch {
    /* ignore — main agent should supply context if this fails */
  }
  return lines.join("\n");
}

/** Prepend shared context to a sub-agent task so it isn't dispatched blind. */
export async function enrichTaskWithContext(task: string, cfg: Config, focusPath?: string): Promise<string> {
  const ctx = await buildSubAgentContext(cfg);
  const focus = focusPath ? `\n\nFOCUS PATH (prefer this area): ${focusPath}` : "";
  return `=== SHARED CONTEXT ===\n${ctx}\n=== END CONTEXT ===\n\n${task}${focus}`;
}

function buildWorkerContext(
  endpoint: SubAgentEndpoint,
  base: Config
): WorkerContext {
  const cfg: Config = {
    ...base,
    baseURL: endpoint.baseURL,
    model: endpoint.model,
    apiKey: endpoint.apiKey ?? "",
    maxTokens: base.subagents?.maxTokens ?? base.maxTokens ?? 1500,
    temperature: base.subagents?.temperature ?? base.temperature ?? 0.3,
    // Small 2B models tend to over-call tools. Cap iterations tight so they
    // stop and answer once they've gathered enough context (prompt also tells
    // them to stop after ~4-8 key files).
    maxIterations: base.subagents?.maxIterations ?? 12,
    // Always treat remote small models as small model mode for concise output.
    smallModelMode: true,
    // Remote small models over a device link are slow, and exploring a large
    // codebase can chain many tool calls. Give each request generous headroom.
    timeout: base.subagents?.timeoutMs ?? 900000,
  };
  const security = createSecurityManager(
    {
      enabled: base.securityEnabled,
      validateCommands: base.securityValidateCommands,
      validateFileAccess: base.securityValidateFileAccess,
      sanitizeOutput: base.securitySanitizeOutput,
      maxFileSize: base.securityMaxFileSize,
      maxBatchFiles: base.securityMaxBatchFiles,
      allowedPaths: base.securityAllowedPaths,
      blockedPaths: base.securityBlockedPaths,
    },
    base.workspace
  );
  const cache = createToolCacheManager(base, base.workspace);
  return { endpoint, cfg, client: createClient(cfg), security, cache };
}

function parseArgs(tc: { name: string; arguments: string }): any {
  if (typeof tc.arguments !== "string") return tc.arguments;
  try {
    return JSON.parse(tc.arguments);
  } catch {
    const m = tc.arguments.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return { raw_input: tc.arguments };
  }
}

/**
 * Build a one-line result summary for a sub-agent tool call, shown in the live
 * stream (e.g. "grep: Found 100 matches" or "read_file: Read from x.ts (111
 * lines)"). Kept short so the panel stays readable.
 */
function summarizeToolResult(tool: string | undefined, raw: string): string {
  if (!tool) return "";
  let parsed: any = undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* not JSON */
  }

  const ok = parsed && parsed.ok !== false;
  if (!ok) {
    const err = parsed?.error || raw.slice(0, 80);
    return `${tool}: error ${err}`;
  }

  // grep / search style: "Found N matches"
  const matchCount =
    parsed?.matches ??
    parsed?.result?.matches ??
    parsed?.count ??
    parsed?.total ??
    (Array.isArray(parsed?.results) ? parsed.results.length : undefined) ??
    (Array.isArray(parsed?.result?.results) ? parsed.result.results.length : undefined);
  if (matchCount != null && /grep|search|find|pattern|rgit|rg/i.test(tool)) {
    return `${tool}: Found ${matchCount} matches`;
  }

  // read_file: report file + line count
  if (/read_file|batch_read|read/i.test(tool)) {
    const path = parsed?.path ?? parsed?.file ?? parsed?.result?.path ?? "";
    const lines = parsed?.line_count ?? parsed?.lines ?? parsed?.lineCount ?? parsed?.result?.line_count;
    const tail = lines != null ? ` (${lines} lines)` : "";
    const p = typeof path === "string" && path ? path.split(/[\\/]/).pop() : "";
    return p ? `${tool}: Read from ${p}${tail}` : `${tool}: read ${raw.length} bytes`;
  }

  // list_dir
  if (/list_dir|map_project|tree/i.test(tool)) {
    const n = parsed?.entries?.length ?? parsed?.count ?? parsed?.files?.length;
    return n != null ? `${tool}: listed ${n} entries` : `${tool}: ok`;
  }

  // git
  if (/git_/.test(tool)) {
    return `${tool}: ok`;
  }

  // Fallback: file + byte size
  const fp = parsed?.path ?? parsed?.file;
  if (typeof fp === "string") {
    return `${tool}: ${fp.split(/[\\/]/).pop()}`;
  }
  return `${tool}: ok (${raw.length} bytes)`;
}

/** Read-only exploration tools exposed to sub-agents (small 2B models). */
const SUBAGENT_TOOLS = new Set([
  "read_file",
  "batch_read_files",
  "list_dir",
  "map_project_tree",
  "find_files",
  "stat_path",
  "grep_search",
  "search_and_view",
  "search_files",
  "git_status",
  "git_diff",
]);

/**
 * 2B models often prepend a workspace segment that's already implied by the
 * root (e.g. pass `src/agent.ts` when the root IS the project, or
 * `src/src.ts` from misreading a list_dir entry). If the literal path doesn't
 * exist but a normalized variant does, return the working one. Keeps the small
 * agents from spamming "File not found" on every read.
 */
async function normalizeSubAgentPath(p: string | undefined, ws: string): Promise<string | undefined> {
  if (typeof p !== "string" || !p) return p;
  const original = resolve(ws, normalize(p).replace(/\\/g, "/"));
  try {
    await access(original);
    return p;
  } catch {}
  // Strip a leading duplicated segment (src/src.ts -> src.ts).
  const segs = normalize(p).replace(/\\/g, "/").split("/").filter(Boolean);
  for (let drop = 1; drop <= Math.min(2, segs.length - 1); drop++) {
    const cand = resolve(ws, segs.slice(drop).join("/"));
    try {
      await access(cand);
      return segs.slice(drop).join("/");
    } catch {}
  }
  return p;
}

async function runWorkerTool(
  wctx: WorkerContext,
  tc: { name: string; arguments: string; id: string }
): Promise<string> {
  // Hard gate: never run anything outside the read-only set, even if the model
  // emits a disallowed tool name (e.g. from a stale cached schema).
  if (!SUBAGENT_TOOLS.has(tc.name)) {
    return JSON.stringify({
      ok: false,
      error: `Tool '${tc.name}' is not available to sub-agents. Use read_file, list_dir, or grep_search.`,
    });
  }
  const tool: Tool | undefined = tools.find((t) => t.name === tc.name);
  const args = parseArgs(tc);
  // Fix 2B path guesses before the real tool runs.
  if (typeof args?.path === "string") {
    args.path = (await normalizeSubAgentPath(args.path, wctx.cfg.workspace)) ?? args.path;
  }
  if (Array.isArray(args?.paths)) {
    args.paths = await Promise.all(
      args.paths.map(async (p: string) => (await normalizeSubAgentPath(p, wctx.cfg.workspace)) ?? p)
    );
  }
  const configWithSecurity: Config = {
    ...wctx.cfg,
    securityManager: wctx.security,
  };
  try {
    let out: string;
    if (tool?.executeAsync) {
      out = await tool.executeAsync(
        args,
        wctx.cfg.workspace,
        configWithSecurity,
        undefined,
        undefined as ToolExecutionHooks | undefined
      );
    } else if (tool) {
      out = tool.execute(args, wctx.cfg.workspace, configWithSecurity);
    } else {
      out = JSON.stringify({ ok: false, error: `Unknown tool: ${tc.name}` });
    }

    const sanitized = wctx.security.sanitizeOutput(out);
    // Sub-agent file read truncation: keep outputs under ~7000 chars so small models don't get overwhelmed
    if ((tc.name === "read_file" || tc.name === "batch_read_files") && sanitized.length > 7000) {
      const lines = sanitized.split("\n");
      if (lines.length > 200) {
        const head = lines.slice(0, 150).join("\n");
        const tail = lines.slice(-40).join("\n");
        return `${head}\n\n... [${lines.length - 190} middle lines omitted for sub-agent context budget. Use line ranges start_line/end_line to inspect specific sections] ...\n\n${tail}`;
      }
    }
    return sanitized;
  } catch (e: any) {
    return JSON.stringify({ ok: false, error: e?.message || String(e) });
  }
}

/**
 * Run a single sub-agent to completion: it may chain tool calls until it
 * produces a final text answer (no tool calls).
 */
async function runSingleSubAgent(
  wctx: WorkerContext,
  task: string,
  signal?: AbortSignal,
  hooks?: ToolExecutionHooks
): Promise<SubAgentResult> {
  const emit = (e: SubAgentProgressEvent) => hooks?.onSubAgentProgress?.(e);
  const start = performance.now();
  const messages: ChatMessage[] = [
    { role: "system", content: SUBAGENT_SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  // Sub-agents are small (2B) models that botch shell commands. Give them a
  // curated READ/EXPLORE tool set only — no execute_command, no writes, no git
  // mutations. This keeps them fast, safe, and on-task.
  const toolDefs = toOpenAI(
    tools.filter((t) => SUBAGENT_TOOLS.has(t.name)),
    wctx.cfg
  );
  let toolCallCount = 0;
  const seenSignatures = new Set<string>();
  const readPaths = new Set<string>();

  emit({
    type: "subagent_start",
    agent: wctx.endpoint.name,
    model: wctx.cfg.model,
    task,
  });

  const maxIter = Math.min(wctx.cfg.maxIterations ?? 6, 6);

  for (let i = 0; i < maxIter; i++) {
    if (signal?.aborted) {
      emit({
        type: "subagent_done",
        agent: wctx.endpoint.name,
        model: wctx.cfg.model,
        ok: false,
        output: "",
        toolCalls: toolCallCount,
      });
      return {
        name: wctx.endpoint.name,
        model: wctx.cfg.model,
        baseURL: wctx.cfg.baseURL,
        ok: false,
        output: "",
        durationMs: Math.round(performance.now() - start),
        error: "aborted",
        toolCalls: toolCallCount,
      };
    }

    // Force mandatory wrap-up before final turn
    if ((i >= maxIter - 2 || toolCallCount >= 4) && toolCallCount > 0) {
      messages.push({
        role: "system",
        content: `MANDATORY ORDER: You are approaching turn ${i + 1} of your ${maxIter} round limit. You are ORDERED to STOP calling tools now and immediately output your final summary of findings for the main agent.`,
      });
    }

    const resp = await chat(
      wctx.client,
      wctx.cfg,
      messages,
      toolDefs,
      signal,
      // Thinking mode off for sub-agents: some local models emit tool calls
      // inside <think> tags which breaks the streaming-free control loop.
      { enableThinking: false }
    );

    const msg = resp.message;
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Record assistant message with tool calls, then run them.
      messages.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });
      const results = await Promise.all(msg.tool_calls.map(async (tc, index) => {
        const currentToolCallCount = toolCallCount + index + 1;
        const parsedArgs = parseArgs(tc.function);
        const sig = `${tc.function.name}:${JSON.stringify(parsedArgs)}`;
        const filePath = parsedArgs?.path || parsedArgs?.file;

        // Intercept duplicate tool call loops
        if (seenSignatures.has(sig)) {
          const dupResult = JSON.stringify({
            ok: false,
            error: `Duplicate call blocked. You already ran ${tc.function.name} with these exact inputs. Do not repeat tool calls. Output your final report now.`,
          });
          emit({
            type: "subagent_tool_result",
            agent: wctx.endpoint.name,
            model: wctx.cfg.model,
            tool: tc.function.name,
            toolArgs: tc.function.arguments,
            toolResult: `${tc.function.name}: duplicate blocked`,
            toolCalls: currentToolCallCount,
          });
          return { role: "tool" as const, content: dupResult, tool_call_id: tc.id };
        }
        seenSignatures.add(sig);

        // Intercept re-reading the exact same file
        if (tc.function.name === "read_file" && typeof filePath === "string") {
          if (readPaths.has(filePath)) {
            const reReadResult = JSON.stringify({
              ok: false,
              error: `File '${filePath}' was already read in a previous turn. Refer to its contents in your conversation history and output your final report.`,
            });
            emit({
              type: "subagent_tool_result",
              agent: wctx.endpoint.name,
              model: wctx.cfg.model,
              tool: tc.function.name,
              toolArgs: tc.function.arguments,
              toolResult: `${tc.function.name}: re-read blocked`,
              toolCalls: currentToolCallCount,
            });
            return { role: "tool" as const, content: reReadResult, tool_call_id: tc.id };
          }
          readPaths.add(filePath);
        }

        emit({
          type: "subagent_tool",
          agent: wctx.endpoint.name,
          model: wctx.cfg.model,
          tool: tc.function.name,
          toolArgs: tc.function.arguments,
          toolCalls: currentToolCallCount,
        });
        const out = await runWorkerTool(wctx, {
          name: tc.function.name,
          arguments: tc.function.arguments,
          id: tc.id,
        });
        // Emit a result summary so the TUI can show e.g. "grep: Found 100 matches".
        emit({
          type: "subagent_tool_result",
          agent: wctx.endpoint.name,
          model: wctx.cfg.model,
          tool: tc.function.name,
          toolArgs: tc.function.arguments,
          toolResult: summarizeToolResult(tc.function.name, out),
          toolCalls: currentToolCallCount,
        });
        return {
          role: "tool" as const,
          content: out,
          tool_call_id: tc.id,
        };
      }));
      
      toolCallCount += msg.tool_calls.length;
      messages.push(...results);
      continue;
    }

    // Final text answer.
    const answer = msg.content || "";
    emit({
      type: "subagent_done",
      agent: wctx.endpoint.name,
      model: wctx.cfg.model,
      ok: true,
      output: answer,
      toolCalls: toolCallCount,
    });
    return {
      name: wctx.endpoint.name,
      model: wctx.cfg.model,
      baseURL: wctx.cfg.baseURL,
      ok: true,
      output: answer,
      durationMs: Math.round(performance.now() - start),
      toolCalls: toolCallCount,
    };
  }

  emit({
    type: "subagent_done",
    agent: wctx.endpoint.name,
    model: wctx.cfg.model,
    ok: false,
    output: "",
    toolCalls: toolCallCount,
  });
  return {
    name: wctx.endpoint.name,
    model: wctx.cfg.model,
    baseURL: wctx.cfg.baseURL,
    ok: false,
    output: "",
    durationMs: Math.round(performance.now() - start),
    error: "max iterations reached without a final answer",
    toolCalls: toolCallCount,
  };
}

/** Format a list of sub-agent results into a single tool result string. */
export function formatSubAgentResults(results: SubAgentResult[]): string {
  const blocks = results.map((r) => {
    const header = `### ${r.name} (${r.model} @ ${r.baseURL}) — ${r.ok ? "ok" : "failed"} [${r.toolCalls} tool calls, ${r.durationMs}ms]`;
    const body = r.ok ? r.output : `ERROR: ${r.error || "unknown"}\n${r.output}`;
    return `${header}\n\n${body}`.trim();
  });
  const summary = `Sub-agent pool returned ${results.filter((r) => r.ok).length}/${results.length} successful.`;
  return JSON.stringify({
    ok: true,
    summary,
    batch_status: "COMPLETED",
    directive: "All sub-agents have finished execution. Do NOT wait for any agents. Synthesize the findings above immediately.",
    agents: results.length,
    successful: results.filter((r) => r.ok).length,
    results: blocks.join("\n\n---\n\n"),
  });
}

/**
 * Concurrency cap for parallel sub-agent dispatch. The pool can run at most
 * this many sub-agents at once; the scheduler below enforces it.
 */
export const MAX_CONCURRENT_SUBAGENTS = 3;

/**
 * Endpoint allocator for parallel dispatch.
 *
 * When the main agent emits several `explore_subagent` calls in one message,
 * the agent loop runs them concurrently. Without coordination they would all
 * resolve to `endpoints[0]` and pile onto the same remote model. This allocator
 * hands out a distinct idle endpoint per concurrent call (round-robin over the
 * pool, capped at MAX_CONCURRENT_SUBAGENTS) so the calls fan out across the
 * available workers.
 */
class SubAgentScheduler {
  private inUse = new Set<string>();
  private cursor = 0;

  /** Borrow a free endpoint; returns undefined if all workers are busy. */
  acquire(endpoints: SubAgentEndpoint[], preferred?: string): SubAgentEndpoint | undefined {
    const usable = endpoints.filter((e) => e.baseURL && e.model);
    if (preferred) {
      const p = usable.find((e) => e.name === preferred);
      if (p && !this.inUse.has(p.name)) {
        this.inUse.add(p.name);
        return p;
      }
      if (p) {
        // Preferred endpoint is busy — fall through to any free one.
      }
    }
    const free = usable.filter((e) => !this.inUse.has(e.name));
    if (free.length === 0) return undefined;
    const ep = free[this.cursor % free.length];
    this.cursor++;
    this.inUse.add(ep.name);
    return ep;
  }

  release(name: string) {
    this.inUse.delete(name);
  }
}

const scheduler = new SubAgentScheduler();

/**
 * Run a single remote sub-agent (one endpoint) for a focused investigation.
 */
export async function exploreWithSubAgent(
  base: Config,
  pool: SubAgentPoolConfig,
  endpointName: string | undefined,
  task: string,
  signal?: AbortSignal,
  hooks?: ToolExecutionHooks
): Promise<SubAgentResult> {
  const endpoints = pool.endpoints.filter((e) => e.baseURL && e.model);
  if (endpoints.length === 0) {
    return {
      name: "pool",
      model: "",
      baseURL: "",
      ok: false,
      output: "",
      durationMs: 0,
      error: "no remote sub-agent endpoints configured",
      toolCalls: 0,
    };
  }
  // Acquire a distinct endpoint so concurrent calls fan out across the pool.
  const ep = scheduler.acquire(endpoints, endpointName);
  if (!ep) {
    return {
      name: endpointName || "pool",
      model: "",
      baseURL: "",
      ok: false,
      output: "",
      durationMs: 0,
      error: "all sub-agent workers are busy (max 3 concurrent)",
      toolCalls: 0,
    };
  }
  try {
    const wctx = buildWorkerContext(ep, base);
    return await runSingleSubAgent(wctx, task, signal, hooks);
  } finally {
    scheduler.release(ep.name);
  }
}

/**
 * Default base URL for sub-agents: this machine's LM Studio, which proxies to
 * the other device's models automatically. The three Qwen3.5-2B instances are
 * loaded here as qwen3.5-2b, qwen3.5-2b:2, qwen3.5-2b:3.
 */
const LOCAL_LMSTUDIO_URL = "http://127.0.0.1:1234/v1";

/**
 * Discover loaded Qwen3.5-2B sub-agent models from a given LM Studio base URL.
 */
async function discoverQwen2BEndpoints(
  baseURL: string
): Promise<SubAgentEndpoint[] | undefined> {
  try {
    const models = await fetchLMStudioModels(baseURL);
    const qwen2b = models
      .filter((m) => /qwen3\.5[-.]?2b/i.test(m.id))
      .map((m, i) => ({
        name: `qwen-remote-${i + 1}`,
        baseURL: baseURL.replace(/\/+$/, "").replace(/\/v1\/?$/i, "") + "/v1",
        model: m.id,
      }));
    return qwen2b.length > 0 ? qwen2b : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a pool config from the base config.
 *
 * Priority:
 *   1. Explicit `cfg.subagents` (enabled + endpoints) — user-tuned.
 *   2. `REMOTE_LMSTUDIO_URL` env var — auto-discover Qwen3.5-2B models there.
 *   3. This machine's LM Studio (127.0.0.1:1234) — auto-discover the three
 *      qwen3.5-2b* instances. LM Studio forwards to the linked device.
 */
export async function resolveSubAgentPool(
  base: Config
): Promise<SubAgentPoolConfig | undefined> {
  if (base.subagents) {
    if (base.subagents.enabled && base.subagents.endpoints.length > 0) {
      return base.subagents;
    }
    if (base.subagents.enabled === false) {
      return undefined;
    }
  }

  const candidates = [
    process.env.REMOTE_LMSTUDIO_URL,
    LOCAL_LMSTUDIO_URL,
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    const endpoints = await discoverQwen2BEndpoints(url);
    if (endpoints && endpoints.length > 0) {
      return { enabled: true, endpoints, maxIterations: 12 };
    }
  }
  return undefined;
}

