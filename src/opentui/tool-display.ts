import { formatLineChangeSummary } from "../lib/file-diff";
import type {
  SubAgentDispatchAgentRow,
  SubAgentDispatchProgress,
} from "../subagent";

export interface ToolDisplayBlock {
  action: string;
  target: string;
  ok: boolean;
  summary: string;
  diff?: string;
  previewLines?: string[];
  subAgentLines?: string[];
  durationMs?: number;
}

function statusGlyph(status: SubAgentDispatchAgentRow["status"]): string {
  switch (status) {
    case "running":
      return "▸";
    case "done":
      return "✓";
    case "failed":
      return "✗";
    default:
      return "·";
  }
}

export function formatSubAgentMonitorLine(agent: SubAgentDispatchAgentRow): string {
  const tools = `${agent.tools_used} tool${agent.tools_used === 1 ? "" : "s"}`;
  const tok = `${agent.input_tokens}↑ ${agent.output_tokens}↓`;
  return `${statusGlyph(agent.status)} ${agent.name}: ${tools} · ${tok}`;
}

export function subAgentLinesFromProgress(
  progress?: SubAgentDispatchProgress
): string[] | undefined {
  if (!progress?.agents?.length) return undefined;
  return progress.agents.map(formatSubAgentMonitorLine);
}

export function subAgentLinesFromDispatchResult(result: any): string[] | undefined {
  if (!Array.isArray(result?.results)) return undefined;
  return result.results.map((r: any, i: number) => {
    const name = String(r?.name || r?.task || `agent-${i + 1}`);
    const tools = Array.isArray(r?.tools_used) ? r.tools_used.length : 0;
    const inp = r?.usage?.input_tokens ?? 0;
    const out = r?.usage?.output_tokens ?? 0;
    const status = r?.ok ? "done" : "failed";
    return formatSubAgentMonitorLine({
      name,
      status,
      tools_used: tools,
      input_tokens: inp,
      output_tokens: out,
      error: r?.error,
    });
  });
}

function parseJSON(value: string): any | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizePath(path?: string): string {
  if (!path) return ".";
  return String(path).replace(/\\/g, "/");
}

function shellActionLabel(): string {
  return process.platform === "win32" ? "PowerShell" : "Bash";
}

const ACTION_LABELS: Record<string, string> = {
  write_file: "Write",
  edit_file: "Update",
  edit_file_lines: "Update",
  read_file: "Read",
  batch_read_files: "Read",
  execute_command: shellActionLabel(),
  run_tests: "Test",
  run_command: "Run",
  typecheck: "Typecheck",
  install_dependencies: "Install",
  list_dir: "List",
  map_project_tree: "Tree",
  find_files: "Find",
  grep_search: "Search",
  search_and_view: "Search",
  search_files: "Search",
  git_commit: "Commit",
  git_status: "Git Status",
  git_diff: "Git Diff",
  explore_subagent: "Explore",
  dispatch_subagents: "Subagents",
  manage_todos: "Todo",
  change_workspace: "Cd",
  stat_path: "Stat",
  linear_graphql: "GraphQL",
};

function actionLabel(toolName: string, result?: any): string {
  if (toolName === "write_file") {
    if (result?.action === "update") return "Update";
    if (result?.action === "write") return "Write";
    if ((result?.removed ?? 0) > 0) return "Update";
  }
  return ACTION_LABELS[toolName] || toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function targetFromArgs(toolName: string, args: any, result?: any): string {
  if (toolName === "execute_command" || toolName === "run_command") {
    return String(args?.command || result?.command || "").trim() || "(command)";
  }
  if (toolName === "explore_subagent") {
    const task = String(args?.prompt ?? args?.task ?? "").trim();
    const name = String(args?.name ?? "").trim();
    const label = name || task;
    return label.length > 120 ? label.slice(0, 119) + "…" : label || "(prompt)";
  }
  if (toolName === "dispatch_subagents") {
    const agents = Array.isArray(args?.agents)
      ? args.agents
      : Array.isArray(args?.tasks)
        ? args.tasks
        : [];
    if (!agents.length && String(args?.mode || "") === "code_review") {
      return "code review · sequential";
    }
    if (!agents.length) return "sequential dispatch";
    const names = agents
      .map((a: any) => String(a?.name ?? "").trim())
      .filter(Boolean);
    if (names.length) return names.slice(0, 3).join(" → ") + (names.length > 3 ? "…" : "");
    return `${agents.length} agent${agents.length === 1 ? "" : "s"} · sequential`;
  }
  if (toolName === "manage_todos") {
    return [args?.action, args?.text || args?.id].filter(Boolean).join(": ") || "todo";
  }
  if (toolName === "grep_search" || toolName === "search_files") {
    const path = normalizePath(args?.path);
    const pattern = String(args?.pattern || args?.query || "");
    return `${path}: "${pattern}"`;
  }
  if (toolName === "git_commit") {
    return String(args?.message || result?.message || "").slice(0, 120) || "commit";
  }
  if (toolName === "batch_read_files" && Array.isArray(args?.paths)) {
    return args.paths.map(normalizePath).join(", ");
  }
  return normalizePath(args?.path || result?.path || args?.command || ".");
}

function firstOutputLine(data: any): string {
  const stdout = typeof data?.stdout === "string" ? data.stdout.trim() : "";
  const stderr = typeof data?.stderr === "string" ? data.stderr.trim() : "";
  const error = typeof data?.error === "string" ? data.error.trim() : "";
  const combined = stdout || stderr || error;
  if (!combined) return data?.ok === false ? "failed" : "(no output)";
  const line = combined.split("\n").find((l: string) => l.trim()) || combined;
  return line.length > 140 ? line.slice(0, 139) + "…" : line;
}

function previewLinesFromOutput(data: any, limit = 8): string[] | undefined {
  const stdout = typeof data?.stdout === "string" ? data.stdout : "";
  const stderr = typeof data?.stderr === "string" ? data.stderr : "";
  const text = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!text) return undefined;
  const lines = text.split("\n").filter((l: string) => l.trim());
  if (lines.length <= 1) return undefined;
  return lines.slice(0, limit);
}

function dispatchSummary(result: any): string | undefined {
  if (!Array.isArray(result?.results)) return undefined;
  const okN = result.ok_count ?? result.results.filter((r: any) => r?.ok).length;
  const total = result.count ?? result.results.length;
  const errLine =
    (Array.isArray(result.errors) && result.errors[0] && String(result.errors[0])) ||
    (typeof result.error === "string" && result.error) ||
    "";
  if (okN === 0 && errLine) {
    return `${okN}/${total} failed · ${errLine.length > 120 ? errLine.slice(0, 119) + "…" : errLine}`;
  }
  if (result.auto_fallback) {
    return `${okN}/${total} sub-agents · sequential (auto ${result.auto_fallback})`;
  }
  return `${okN}/${total} sub-agents · sequential`;
}

function buildSummary(toolName: string, args: any, result: any, ok: boolean): string {
  if (toolName === "dispatch_subagents") {
    const dispatch = dispatchSummary(result);
    if (dispatch) return dispatch;
  }

  if (toolName === "explore_subagent" && result?.usage) {
    const tools = Array.isArray(result.tools_used) ? result.tools_used.length : 0;
    const inp = result.usage.input_tokens ?? 0;
    const out = result.usage.output_tokens ?? 0;
    if (result.summary) {
      const summary = String(result.summary).trim();
      const head = summary.length > 100 ? summary.slice(0, 99) + "…" : summary;
      return `${head} · ${tools} tools · ${inp}↑ ${out}↓`;
    }
    return `${tools} tools · ${inp}↑ ${out}↓`;
  }

  if (toolName === "explore_subagent" && result?.summary) {
    const summary = String(result.summary).trim();
    return summary.length > 140 ? summary.slice(0, 139) + "…" : summary;
  }

  if (toolName === "explore_subagent" && !ok && result?.error) {
    const err = String(result.error);
    return err.length > 140 ? err.slice(0, 139) + "…" : err;
  }

  if (!ok) {
    return String(result?.error || result?.message || "failed").slice(0, 160);
  }

  if (typeof result?.added === "number" || typeof result?.removed === "number") {
    return formatLineChangeSummary(result.added ?? 0, result.removed ?? 0);
  }

  if (toolName === "read_file") {
    if (result?.total_lines != null) return `${result.total_lines} lines`;
    if (result?.content) {
      const lines = String(result.content).split("\n").length;
      return `${lines} line${lines === 1 ? "" : "s"}`;
    }
  }

  if (toolName === "grep_search" || toolName === "search_files") {
    const count = result?.matches ?? result?.results?.length;
    if (count != null) return `${count} match${count === 1 ? "" : "es"}`;
  }

  if (toolName === "list_dir" && Array.isArray(result?.entries)) {
    return `${result.entries.length} item${result.entries.length === 1 ? "" : "s"}`;
  }

  if (toolName === "git_diff" && result?.diff === "") {
    return result?.message || "clean working tree";
  }

  if (result?.stdout != null || result?.stderr != null || result?.code != null) {
    const rc = result?.code ?? result?.returncode;
    if (rc != null && rc !== 0) return `exit ${rc}`;
    return firstOutputLine(result);
  }

  if (result?.path && toolName === "write_file") {
    return formatLineChangeSummary(result.added ?? 0, result.removed ?? 0);
  }

  return "ok";
}

export function buildToolDisplayBlock(
  toolName: string,
  argsRaw: string,
  resultRaw: string,
  durationMs?: number
): ToolDisplayBlock {
  const args = parseJSON(argsRaw) ?? {};
  const result = parseJSON(resultRaw);
  const ok = result ? result.ok !== false && result.success !== false : true;

  const block: ToolDisplayBlock = {
    action: actionLabel(toolName, result),
    target: targetFromArgs(toolName, args, result),
    ok,
    summary: buildSummary(toolName, args, result ?? {}, ok),
    durationMs,
  };

  if (typeof result?.diff === "string" && result.diff.trim()) {
    block.diff = result.diff.trim();
  }

  if (!block.diff && toolName === "git_diff" && typeof result?.stdout === "string" && result.stdout.trim()) {
    block.diff = result.stdout.trim();
  }

  if (!block.diff) {
    block.previewLines = previewLinesFromOutput(result);
  }

  if (
    toolName === "dispatch_subagents" &&
    Array.isArray(result?.errors) &&
    result.errors.length &&
    !Array.isArray(result?.results)
  ) {
    block.previewLines = result.errors
      .slice(0, 6)
      .map((line: unknown) => String(line));
  }

  const agentLines =
    toolName === "dispatch_subagents" || toolName === "explore_subagent"
      ? subAgentLinesFromDispatchResult(result)
      : undefined;
  if (agentLines?.length) {
    block.subAgentLines = agentLines;
    block.previewLines = agentLines;
  }

  return block;
}
