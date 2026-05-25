/** @jsxImportSource @opentui/react */

import { useState, useCallback, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { Message, ToolResult, AgentState } from "../types";
import { CommandDropdown } from "./command-dropdown";
import { getSyntaxStyle } from "./syntax-style";
import type { Theme } from "./theme";

interface ChatScreenProps {
  theme: Theme;
  messages: Message[];
  toolResults?: ToolResult[];
  state: AgentState;
  model: string;
  todoCount: number;
  elapsedMs: number;
  currentTool?: { name: string; args: string };
  lastUsage?: { input_tokens: number; output_tokens: number };
  totalUsage: { input_tokens: number; output_tokens: number };
  onSubmit: (text: string) => void;
  selectedMessageIndex?: number | null;
  page?: number;
  totalPages?: number;
  paginated?: boolean;
  onPageChange?: (page: number) => void;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function spinnerFrame(ms: number): string {
  return SPINNER[Math.floor(ms / 80) % SPINNER.length];
}

function parseCodeBlocks(content: string): Array<{ type: "text"; text: string } | { type: "code"; lang?: string; code: string }> {
  const segments: Array<{ type: "text"; text: string } | { type: "code"; lang?: string; code: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) segments.push({ type: "text", text: content.slice(lastIndex, match.index) });
    segments.push({ type: "code", lang: match[1] || undefined, code: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) segments.push({ type: "text", text: content.slice(lastIndex) });
  return segments;
}

const syntaxStyle = getSyntaxStyle();
const ARG_BEARING = new Set(["/auto", "/cd", "/allow", "/export", "/theme"]);
const RESULT_PREVIEW_LIMIT = 5;

function parseJSON(value: string): any | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function compactPath(path?: string): string {
  if (!path) return ".";
  return path.replace(/\\/g, "/").split("/").slice(-3).join("/");
}

const TOOL_LABELS: Record<string, string> = {
  shell: "shell",
  run_command: "shell",
  read_file: "read",
  write_file: "write",
  list_dir: "list",
  search_files: "search",
  grep_search: "search",
  batch_read_files: "read",
  git_commit: "commit",
  manage_todos: "todo",
  linear_graphql: "graphql",
};

function formatToolArgs(name: string, raw: string): string {
  const args = parseJSON(raw);
  if (!args) return raw.length > 80 ? raw.slice(0, 79) + "…" : raw;
  if (name === "list_dir") return compactPath(args.path);
  if (name === "read_file" || name === "write_file") return compactPath(args.path);
  if (name === "batch_read_files") return Array.isArray(args.paths) ? args.paths.map(compactPath).join(", ") : String(raw);
  if (name === "git_commit") return String(args.message || "").slice(0, 80);
  if (name === "run_command" || name === "shell") {
    const cmd = String(args.command || "");
    return cmd.length > 80 ? cmd.slice(0, 79) + "…" : cmd;
  }
  if (name === "grep_search" || name === "search_files") return `${compactPath(args.path)}: "${String(args.pattern || args.query || "")}"`;
  if (name === "manage_todos") return [args.action, args.text || args.id].filter(Boolean).join(": ");
  if (name === "linear_graphql") return String(args.query || "").slice(0, 80).replace(/\s+/g, " ").trim();
  const entries = Object.entries(args).slice(0, 2);
  return entries.map(([key, value]) => `${key}=${String(value).slice(0, 40)}`).join(" ");
}

function summarizeToolResult(content: string): { ok: boolean; title: string; lines: string[] } {
  const data = parseJSON(content);
  if (!data) {
    const lines = content.split("\n").filter(Boolean).slice(0, RESULT_PREVIEW_LIMIT);
    return { ok: true, title: "result", lines: lines.length ? lines : ["(empty)"] };
  }

  const ok = data.ok !== false && data.success !== false;

  if (data.results && typeof data.results === "object" && !Array.isArray(data.results)) {
    const keys = Object.keys(data.results);
    const lines = keys.slice(0, RESULT_PREVIEW_LIMIT).map(k => {
      const res = data.results[k];
      return `${compactPath(k)}: ${res.ok ? "✓" : "✗"} ${(res.content?.length || 0)} chars`;
    });
    const more = keys.length - lines.length;
    if (more > 0) lines.push(`+${more} more`);
    return { ok, title: `${keys.length} file${keys.length === 1 ? "" : "s"}`, lines };
  }

  if (Array.isArray(data.results)) {
    const shown = data.results.slice(0, RESULT_PREVIEW_LIMIT);
    const lines = shown.map((r: any) => `${compactPath(r.path)}:${r.line} ${r.text.slice(0, 100)}`);
    const more = data.results.length - shown.length;
    if (more > 0) lines.push(`+${more} more`);
    return { ok, title: `${data.results.length} match${data.results.length === 1 ? "" : "es"}`, lines };
  }

  if (Array.isArray(data.entries)) {
    const shown = data.entries.slice(0, RESULT_PREVIEW_LIMIT);
    const more = data.entries.length - shown.length;
    return {
      ok,
      title: `${data.entries.length} item${data.entries.length === 1 ? "" : "s"}`,
      lines: [shown.join("  ") + (more > 0 ? `  +${more}` : "")],
    };
  }

  if (typeof data.stdout === "string" || typeof data.stderr === "string") {
    const out = typeof data.stdout === "string" ? data.stdout.trim() : "";
    const err = typeof data.stderr === "string" ? data.stderr.trim() : "";
    const rc = data.returncode ?? data.code;
    const title = rc != null && rc !== 0 ? `exit ${rc}` : (err && !out ? "stderr" : "stdout");
    const combined = [...out.split("\n").filter(Boolean), ...err.split("\n").filter(Boolean)].slice(0, RESULT_PREVIEW_LIMIT);
    return { ok, title, lines: combined.length ? combined : ["(no output)"] };
  }

  if (typeof data.content === "string") {
    const len = data.content.length;
    const lines = data.content.split("\n").slice(0, RESULT_PREVIEW_LIMIT);
    return { ok, title: `${len} chars`, lines };
  }

  if (data.path) return { ok, title: "wrote", lines: [compactPath(data.path)] };
  if (data.error) return { ok: false, title: "error", lines: [String(data.error).slice(0, 120)] };
  if (data.matches != null) return { ok, title: `${data.matches} match${data.matches === 1 ? "" : "es"}`, lines: typeof data.results === "string" ? data.results.split("\n").slice(0, RESULT_PREVIEW_LIMIT) : [] };
  return { ok, title: "ok", lines: [] };
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function ChatScreen({ theme, messages, toolResults = [], state, elapsedMs, currentTool, lastUsage, onSubmit }: ChatScreenProps) {
  const [inputValue, setInputValue] = useState("");
  const busy = state !== "idle" && state !== "error" && state !== "waiting_for_user";

  const toolMap = useMemo(() => {
    const map = new Map<string, ToolResult>();
    for (const tr of toolResults) map.set(tr.toolCallId, tr);
    return map;
  }, [toolResults]);

  useKeyboard((keyEvent) => {
    if (keyEvent.name === "f3" || keyEvent.name === "F3") {
      setInputValue("/auto ");
      keyEvent.preventDefault?.();
    }
  }, { release: false });

  const handleSubmitLocal = useCallback((value: string) => {
    const v = value.trim();
    if (!v) return;
    setInputValue("");
    onSubmit(v);
  }, [onSubmit]);

  // Check if dropdown is open to prevent double-handling of Enter key
  const dropdownOpen = inputValue.startsWith("/");

  const visibleMessages = messages.filter(
    (msg) =>
      msg.role !== "system" &&
      !(msg.role === "assistant" && !msg.toolCalls?.length && msg.content.trim() === "")
  );
  const showBusy = busy && !(state === "executing_tool" && currentTool);

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox flexGrow={1} flexDirection="column" paddingX={2} paddingY={1} stickyScroll={true} stickyStart="bottom">
        {visibleMessages.map((msg, index) => (
          <MessageItem
            key={msg.id}
            message={msg}
            theme={theme}
            toolMap={toolMap}
            lastUsage={lastUsage}
            state={index === visibleMessages.length - 1 ? state : undefined}
            currentTool={currentTool}
          />
        ))}
        {showBusy && <text fg={theme.statusThinking}>  {spinnerFrame(elapsedMs)} thinking</text>}
      </scrollbox>

      <CommandDropdown inputValue={inputValue} theme={theme} onSubmit={(v) => { setInputValue(""); handleSubmitLocal(v); }} onPick={(cmd) => {
        if (ARG_BEARING.has(cmd)) {
          const rest = inputValue.slice(cmd.length).trim();
          if (rest) {
            setInputValue("");
            handleSubmitLocal(inputValue.trim());
          } else {
            setInputValue(cmd + " ");
          }
        } else {
          setInputValue(""); handleSubmitLocal(cmd);
        }
      }} />

      <box flexDirection="row" paddingX={2} paddingY={0} borderStyle="single" borderColor={theme.borderColor} height={3}>
        <text fg={theme.inputFg}>▶ </text>
        <input flexGrow={1} placeholder={busy ? "Working…" : "Type a message or / for commands…"} value={inputValue} onInput={setInputValue} onSubmit={(v) => { if (!dropdownOpen && typeof v === "string") handleSubmitLocal(v); }} focused />
      </box>
    </box>
  );
}

function MessageItem({ message, theme, toolMap, lastUsage, state, currentTool }: {
  message: Message;
  theme: Theme;
  toolMap: Map<string, ToolResult>;
  lastUsage?: { input_tokens: number; output_tokens: number };
  state?: AgentState;
  currentTool?: { name: string; args: string };
}) {
  if (message.role === "system") return null;

  if (message.role === "tool") {
    const tr = message.toolCallId ? toolMap.get(message.toolCallId) : undefined;
    const result = summarizeToolResult(message.content);
    const duration = tr !== undefined ? ` ${Math.round(tr.duration)}ms` : "";
    return (
      <box flexDirection="column" marginY={0}>
        <text fg={result.ok ? theme.toolFg : theme.errorFg}>
          {result.ok ? "└" : "└✗"} {result.title}{duration}
        </text>
        {result.lines.map((line, i) => (
          <text key={i} fg={theme.mutedFg}>  {line.length > 120 ? line.slice(0, 119) + "…" : line || " "}</text>
        ))}
      </box>
    );
  }

  const color = message.role === "user" ? theme.userFg : theme.agentFg;
  const prefix = message.role === "user" ? "▸ You" : "◈ Agent";
  const displayContent = message.content || "";
  const segments = parseCodeBlocks(displayContent);
  
  // Check if this message has reasoning content
  const hasReasoning = message.reasoningContent && message.reasoningContent.trim() !== "";
  
  // Keep track of whether we've shown any reasoning content
  let hasShownReasoning = false;

  return (
    <box flexDirection="column" marginY={1}>
      <text fg={color}>{prefix}</text>
      {segments.map((seg, si) => {
        if (seg.type === "text") {
          return seg.text.split("\n").map((line, li) => <text key={`${si}-${li}`} fg={theme.headerFg}>{line || " "}</text>);
        }
        if (seg.lang === "diff") {
          return (
            <box key={si} flexDirection="column" marginY={1}>
              <text fg={theme.mutedFg}>diff</text>
              <diff diff={seg.code} view="unified" syntaxStyle={syntaxStyle} addedBg="#2d4a3e" removedBg="#4a2d2d" addedSignColor="#9ece6a" removedSignColor="#f7768e" />
            </box>
          );
        }
        return (
          <box key={si} flexDirection="column" marginY={1}>
            {seg.lang && <text fg={theme.mutedFg}>{seg.lang}</text>}
            <code content={seg.code} filetype={seg.lang || "text"} syntaxStyle={syntaxStyle} />
          </box>
        );
      })}
      
      {hasReasoning && (
        <box flexDirection="column" marginY={1} borderStyle="rounded" borderColor={theme.mutedFg}>
          <text fg={theme.mutedFg}>Reasoning Chain:</text>
          <box flexDirection="column" marginLeft={2}>
            {(message.reasoningContent || "").split("\n").map((line, idx) => (
              <text key={idx} fg={theme.mutedFg}>{line || " "}</text>
            ))}
          </box>
        </box>
      )}
      
      {message.role === "assistant" && state === "executing_tool" && currentTool && (
        <text fg={theme.statusTool}>  {spinnerFrame(Date.now())} {TOOL_LABELS[currentTool.name] || currentTool.name}…</text>
      )}
      {message.toolCalls?.map((tc, ti) => {
        const label = TOOL_LABELS[tc.name] || tc.name;
        return (
          <text key={ti} fg={theme.toolFg}>  ├ {label}  {formatToolArgs(tc.name, tc.arguments)}</text>
        );
      })}
      {message.role === "assistant" && lastUsage && (
        <text fg={theme.mutedFg}>  {formatTokens(lastUsage.input_tokens)}↑ {formatTokens(lastUsage.output_tokens)}↓</text>
      )}
    </box>
  );
}
