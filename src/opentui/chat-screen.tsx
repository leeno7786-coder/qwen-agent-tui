/** @jsxImportSource @opentui/react */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { Message, ToolResult, AgentState, ToolCall } from "../types";
import type { SubAgentProgressEvent } from "../tools";
import type { SubAgentResult } from "../subagents";
import { CommandDropdown } from "./command-dropdown";
import { getSyntaxStyle } from "./syntax-style";
import type { Theme } from "./theme";
import {
  buildToolDisplayBlock,
  type ToolDisplayBlock,
} from "./tool-display";

interface ChatScreenProps {
  theme: Theme;
  messages: Message[];
  toolResults?: ToolResult[];
  state: AgentState;
  model: string;
  todoCount: number;
  elapsedMs: number;
  currentTool?: {
    name: string;
    args: string;
  };
  lastUsage?: { input_tokens: number; output_tokens: number };
  totalUsage: { input_tokens: number; output_tokens: number };
  subAgents?: Array<{
    id: string;
    prompt: string;
    focusPath?: string;
    status: "running" | "done" | "error";
    progress?: SubAgentProgressEvent;
    result?: SubAgentResult;
  }>;
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
const ARG_BEARING = new Set([
  "/auto",
  "/cd",
  "/allow",
  "/export",
  "/theme",
  "/connect",
  "/graph",
  "/resume",
  "/delete-session",
  "/rename",
  "/copy",
  "/todo",
  "/unload",
  "/skill-load",
  "/skill",
  "/skills",
]);
const MESSAGES_PER_PAGE = 50;
const DIFF_PROPS = {
  view: "unified" as const,
  syntaxStyle,
  addedBg: "#2d4a3e",
  removedBg: "#4a2d2d",
  addedSignColor: "#9ece6a",
  removedSignColor: "#f7768e",
};

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function ChatScreen({
  theme,
  messages,
  toolResults = [],
  state,
  elapsedMs,
  currentTool,
  lastUsage,
  onSubmit,
  subAgents = [],
  selectedMessageIndex = null,
  page = 1,
  totalPages = 1,
  paginated = false,
  onPageChange,
}: ChatScreenProps) {
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const busy = state !== "idle" && state !== "error" && state !== "waiting_for_user";

  const toolMap = useMemo(() => {
    const map = new Map<string, ToolResult>();
    for (const tr of toolResults) map.set(tr.toolCallId, tr);
    return map;
  }, [toolResults]);

  const toolResultByCallId = useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === "tool" && msg.toolCallId) {
        map.set(msg.toolCallId, msg.content);
      }
    }
    return map;
  }, [messages]);

  useKeyboard((keyEvent) => {
    if (keyEvent.name === "f3" || keyEvent.name === "F3") {
      setInputValue("/auto ");
      keyEvent.preventDefault?.();
      return;
    }

    const scrollbox = scrollRef.current;
    if (!scrollbox) return;

    if (keyEvent.shift) {
      if (keyEvent.name === "up" || keyEvent.name === "ArrowUp") {
        scrollbox.scrollBy(-1, "content");
        keyEvent.preventDefault?.();
      } else if (keyEvent.name === "down" || keyEvent.name === "ArrowDown") {
        scrollbox.scrollBy(1, "content");
        keyEvent.preventDefault?.();
      } else if (keyEvent.name === "pageup" || keyEvent.name === "PageUp") {
        scrollbox.scrollBy(-0.5, "viewport");
        keyEvent.preventDefault?.();
      } else if (keyEvent.name === "pagedown" || keyEvent.name === "PageDown") {
        scrollbox.scrollBy(0.5, "viewport");
        keyEvent.preventDefault?.();
      }
      return;
    }

    if (paginated && onPageChange && totalPages > 1) {
      if (keyEvent.name === "pageup" || keyEvent.name === "PageUp") {
        onPageChange(Math.max(1, page - 1));
        keyEvent.preventDefault?.();
      } else if (keyEvent.name === "pagedown" || keyEvent.name === "PageDown") {
        onPageChange(Math.min(totalPages, page + 1));
        keyEvent.preventDefault?.();
      }
    }
  }, { release: false });

  const handleSubmitLocal = useCallback((value: string) => {
    const v = value.trim();
    if (!v) return;
    setTimeout(() => setInputValue(""), 0);
    onSubmit(v);
  }, [onSubmit]);

  // Check if dropdown is open to prevent double-handling of Enter key
  const dropdownOpen = inputValue.startsWith("/");

  const filteredMessages = useMemo(
    () =>
      messages.filter(
        (msg) =>
          msg.role !== "system" &&
          msg.role !== "tool" &&
          !(msg.role === "assistant" && !msg.toolCalls?.length && msg.content.trim() === "")
      ),
    [messages]
  );

  const visibleMessages = useMemo(() => {
    if (!paginated) return filteredMessages;
    const start = (page - 1) * MESSAGES_PER_PAGE;
    return filteredMessages.slice(start, start + MESSAGES_PER_PAGE);
  }, [filteredMessages, paginated, page]);

  const showBusy = busy && !(state === "executing_tool" && currentTool);

  useEffect(() => {
    if (selectedMessageIndex !== null && scrollRef.current) {
      try {
        scrollRef.current.scrollChildIntoView(`msg-${selectedMessageIndex}`);
      } catch {
        // Ignore if unmounted
      }
    }
  }, [selectedMessageIndex]);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minHeight={0}
      height="100%"
      overflow="hidden"
      backgroundColor={theme.bgPanel}
    >
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
        paddingX={2}
        paddingY={1}
        stickyScroll={true}
        stickyStart="bottom"
        wrapperOptions={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }}
        viewportOptions={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }}
      >
        {visibleMessages.map((msg, index) => {
          const globalIndex = paginated ? (page - 1) * MESSAGES_PER_PAGE + index : index;
          const isSelected = selectedMessageIndex === globalIndex;
          return (
            <box key={msg.id} id={`msg-${globalIndex}`} flexDirection="column">
              <MessageItem
                message={msg}
                theme={theme}
                toolMap={toolMap}
                toolResultByCallId={toolResultByCallId}
                lastUsage={lastUsage}
                state={index === visibleMessages.length - 1 ? state : undefined}
                currentTool={currentTool}
                highlighted={isSelected}
              />
            </box>
          );
        })}
         {showBusy && <text fg={theme.statusThinking}>  {spinnerFrame(elapsedMs)} thinking</text>}

         {/* Live sub-agent stream renders inline in the main chat, not a separate panel. */}
         <SubAgentPanel subAgents={subAgents} theme={theme} elapsedMs={elapsedMs} />
       </scrollbox>

       {paginated && totalPages > 1 && (
         <box flexDirection="row" height={1} flexShrink={0} paddingX={2} backgroundColor={theme.bgPanel}>
           <text fg={theme.mutedFg}>
             Page {page}/{totalPages} · PgUp/PgDn to change page · Shift+↑/↓ to scroll
           </text>
         </box>
       )}

       <CommandDropdown 
         inputValue={inputValue} 
         theme={theme} 
         onSubmit={useCallback((v: any) => { handleSubmitLocal(v); }, [handleSubmitLocal])} 
         onPick={useCallback((cmd: string) => {
          if (ARG_BEARING.has(cmd)) {
            const rest = inputValue.slice(cmd.length).trim();
            if (rest) {
              handleSubmitLocal(inputValue.trim());
            } else {
              setInputValue(cmd + " ");
            }
          } else {
            handleSubmitLocal(cmd);
          }
        }, [inputValue, handleSubmitLocal])} 
       />

      <box flexDirection="row" paddingX={2} paddingY={0} borderStyle="single" borderColor={theme.borderColor} height={3} flexShrink={0} backgroundColor={theme.bgPanel}>
        <text fg={theme.inputFg}>▶ </text>
        <input 
          flexGrow={1} 
          placeholder={busy ? "Working…" : "Type a message or / for commands…"} 
          value={inputValue} 
          onInput={setInputValue} 
          onSubmit={useCallback((v: any) => { if (!dropdownOpen && typeof v === "string" && v.trim()) handleSubmitLocal(v); }, [dropdownOpen, handleSubmitLocal])} 
          focused 
        />
      </box>
    </box>
  );
}

function ToolActivityBlock({ block, theme }: { block: ToolDisplayBlock; theme: Theme }) {
  const headerColor = block.ok ? theme.toolFg : theme.errorFg;
  const duration = block.durationMs != null ? ` · ${Math.round(block.durationMs)}ms` : "";
  const agentLines = block.previewLines;

  return (
    <box flexDirection="column" marginY={0}>
      <text fg={headerColor}>
        ● {block.action}({block.target}){duration}
      </text>
      <text fg={theme.mutedFg}>  ⎿  {block.summary}</text>
      {block.diff ? (
        <box flexDirection="column" marginLeft={2} marginTop={0}>
          <diff diff={block.diff} {...DIFF_PROPS} />
        </box>
      ) : null}
      {!block.diff &&
        agentLines?.map((line: string, i: number) => (
          <text key={i} fg={theme.mutedFg}>
            {"  "}{line.length > 140 ? line.slice(0, 139) + "…" : line || " "}
          </text>
        ))}
    </box>
  );
}

const RUNNING = "running";
const DONE = "done";
const ERROR = "error";

/**
 * Live sub-agent stream, rendered inline in the chat flow (no bordered box).
 * Each sub-agent reads like a streamed transcript straight from the remote
 * endpoint — nothing is mocked:
 *
 *   Thought
 *   Running explore agent: <prompt>
 *   → grep: Found 100 matches          (one line per tool call, live)
 *   → read_file: Read from x.ts (111 lines)
 *   Agent completed in 8 turns          (one line when it finishes)
 */
function SubAgentPanel({
  subAgents,
  theme,
  elapsedMs,
}: {
  subAgents: Array<{
    id: string;
    prompt: string;
    focusPath?: string;
    status: "running" | "done" | "error";
    log?: SubAgentProgressEvent[];
    result?: SubAgentResult;
  }>;
  theme: Theme;
  elapsedMs: number;
}) {
  const live = subAgents.filter((s) => s.status === RUNNING);
  const finished = subAgents.filter((s) => s.status !== RUNNING);
  if (live.length === 0 && finished.length === 0) return null;

  const spin = spinnerFrame(elapsedMs);

  const renderAgent = (sa: {
    id: string;
    prompt: string;
    status: "running" | "done" | "error";
    log?: SubAgentProgressEvent[];
    result?: SubAgentResult;
  }): Array<{ key: string; color: string; text: string }> => {
    const log = sa.log ?? [];
    const turns = sa.result?.toolCalls ?? 0;
    const toolResults = log.filter((e) => e.type === "subagent_tool_result" && e.toolResult);

    const lines: Array<{ key: string; color: string; text: string }> = [];
    lines.push({
      key: `${sa.id}-h`,
      color: sa.status === DONE ? theme.toolFg : theme.statusTool,
      text:
        (sa.status === RUNNING ? `${spin} ` : "") +
        `Running explore agent: ${sa.prompt}`,
    });
    for (const e of toolResults) {
      lines.push({
        key: `${sa.id}-${e.tool}-${toolResults.indexOf(e)}`,
        color: theme.mutedFg,
        text: `  → ${e.toolResult}`,
      });
    }
    if (sa.status === DONE) {
      lines.push({
        key: `${sa.id}-d`,
        color: theme.mutedFg,
        text: `  ✓ Agent completed in ${turns} turns${sa.result?.durationMs != null ? ` · ${Math.round(sa.result.durationMs)}ms` : ""}`,
      });
    } else if (sa.status === ERROR) {
      lines.push({
        key: `${sa.id}-e`,
        color: theme.errorFg,
        text: `  ✗ Agent failed after ${turns} turns${sa.result?.error ? `: ${sa.result.error.slice(0, 100)}` : ""}`,
      });
    }

    return lines;
  };

  // Return flat <text> lines — no wrapping box — so the stream renders exactly
  // like the main agent's own tool-call lines inside the chat.
  const allLines = [...live, ...finished].flatMap(renderAgent);
  if (allLines.length === 0) return null;
  return (
    <>
      {allLines.map((l) => (
        <text key={l.key} fg={l.color}>
          {l.text}
        </text>
      ))}
    </>
  );
}

function renderToolCall(
  tc: ToolCall,
  toolMap: Map<string, ToolResult>,
  toolResultByCallId: Map<string, string>,
  theme: Theme
) {
  const tr = toolMap.get(tc.id);
  const resultRaw = toolResultByCallId.get(tc.id) ?? tr?.output ?? "";
  const block = buildToolDisplayBlock(tc.name, tc.arguments, resultRaw, tr?.duration);
  return <ToolActivityBlock key={tc.id} block={block} theme={theme} />;
}

function MessageItem({ message, theme, toolMap, toolResultByCallId, lastUsage, state, currentTool, highlighted = false }: {
  message: Message;
  theme: Theme;
  toolMap: Map<string, ToolResult>;
  toolResultByCallId: Map<string, string>;
  lastUsage?: { input_tokens: number; output_tokens: number };
  state?: AgentState;
  currentTool?: {
    name: string;
    args: string;
  };
  highlighted?: boolean;
}) {
  if (message.role === "system") return null;

  if (message.role === "user") {
    return (
      <box flexDirection="column" marginY={1}>
        <text fg={theme.userFg} bg={highlighted ? theme.bgSelected : undefined}>▸ You</text>
        {message.content.split("\n").map((line, i) => (
          <text key={i} fg={theme.headerFg}>{line || " "}</text>
        ))}
      </box>
    );
  }

  const displayContent = message.content || "";
  const segments = parseCodeBlocks(displayContent);
  const hasReasoning = message.reasoningContent && message.reasoningContent.trim() !== "";
  const toolCalls = message.toolCalls ?? [];

  return (
    <box flexDirection="column" marginY={1}>
      {displayContent.trim() !== "" && segments.map((seg, si) => {
        if (seg.type === "text") {
          return seg.text.split("\n").map((line, li) => (
            <text key={`${si}-${li}`} fg={theme.headerFg}>{line || " "}</text>
          ));
        }
        if (seg.lang === "diff") {
          return (
            <box key={si} flexDirection="column" marginY={1}>
              <diff diff={seg.code} {...DIFF_PROPS} />
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
          <text fg={theme.mutedFg}>Reasoning:</text>
          <box flexDirection="column" marginLeft={2}>
            {(message.reasoningContent || "").split("\n").map((line, idx) => (
              <text key={idx} fg={theme.mutedFg}>{line || " "}</text>
            ))}
          </box>
        </box>
      )}

      {/* The main agent's own explore_subagent calls are background launches — their
          live activity is shown by SubAgentPanel, so don't render the instant "ok"
          tool-call blocks here. */}
      {toolCalls
        .filter((tc) => tc.name !== "explore_subagent")
        .map((tc) => renderToolCall(tc, toolMap, toolResultByCallId, theme))}

      {message.role === "assistant" && state === "executing_tool" && currentTool && currentTool.name !== "explore_subagent" && (() => {
        const pending = buildToolDisplayBlock(currentTool.name, currentTool.args, "", undefined);
        return (
          <box flexDirection="column">
            <text fg={theme.statusTool}>
              {"  "}{spinnerFrame(Date.now())} {pending.action}({pending.target})…
            </text>
          </box>
        );
      })()}

      {message.role === "assistant" && lastUsage && (
        <text fg={theme.mutedFg}>  {formatTokens(lastUsage.input_tokens)}↑ {formatTokens(lastUsage.output_tokens)}↓</text>
      )}
    </box>
  );
}
