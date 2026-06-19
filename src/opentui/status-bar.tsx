/** @jsxImportSource @opentui/react */

import type { AgentState } from "../types";
import { isSmallModelFromConfig } from "../model-runtime";
import type { Config } from "../types";
import type { Theme } from "./theme";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface StatusBarProps {
  state: AgentState;
  model: string;
  modelRuntime?: Pick<
    Config,
    "modelContextLength" | "modelParamBillions" | "smallModelMode"
  >;
  todoCount: number;
  currentTool?: { name: string; args: string };
  lastUsage?: { input_tokens: number; output_tokens: number };
  totalUsage?: { input_tokens: number; output_tokens: number };
  elapsedMs?: number;
  roundCounter?: number;
  maxRounds?: number;
  theme: Theme;
  mouseEnabled?: boolean;
}

function spinnerFrame(ms: number): string {
  return SPINNER[Math.floor(ms / 80) % SPINNER.length];
}

function fmt(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function StatusBar({
  state,
  model,
  modelRuntime,
  todoCount,
  currentTool,
  lastUsage,
  totalUsage,
  elapsedMs,
  roundCounter,
  maxRounds,
  theme,
  mouseEnabled = true,
}: StatusBarProps) {
  const cfg: Record<AgentState, { color: string; label: string }> = {
    idle: { color: theme.statusIdle, label: "idle" },
    thinking: { color: theme.statusThinking, label: "thinking" },
    executing_tool: { color: theme.statusTool, label: "tool" },
    waiting_for_user: { color: theme.statusIdle, label: "waiting" },
    reflecting: { color: theme.statusThinking, label: "reflecting" },
    error: { color: theme.statusError, label: "error" },
  };

  const s = cfg[state];
  const toolLabel = currentTool ? ` ${currentTool.name}` : "";
  const displayModel = model.length > 28 ? model.slice(0, 27) + "…" : model;

  const lastTokens = lastUsage
    ? `${fmt(lastUsage.input_tokens)}↑${fmt(lastUsage.output_tokens)}↓`
    : "";
  const totalTokens = totalUsage
    ? `${fmt(totalUsage.input_tokens + totalUsage.output_tokens)} total`
    : "";
    
  const runtimeCfg = {
    model,
    smallModelMode: modelRuntime?.smallModelMode,
    modelParamBillions: modelRuntime?.modelParamBillions,
    maxTokens: undefined,
  };
  const smallModelIndicator = isSmallModelFromConfig(runtimeCfg)
    ? " [≤8B]"
    : "";
  const ctxIndicator = modelRuntime?.modelContextLength
    ? ` · ${Math.round(modelRuntime.modelContextLength / 1000)}k`
    : "";
  const elapsed =
    elapsedMs && elapsedMs > 0 ? `${(elapsedMs / 1000).toFixed(1)}s` : "";
  const spin =
    state !== "idle" && state !== "error"
      ? spinnerFrame(elapsedMs || 0) + " "
      : "";
  
  // Round counter display
  const roundDisplay = (roundCounter !== undefined && maxRounds !== undefined)
    ? ` · ${roundCounter}/${maxRounds} rounds`
    : "";

  return (
    <box flexDirection="column" height={2} flexShrink={0} backgroundColor={theme.bgPanel}>
      <box flexDirection="row" paddingX={1} height={1}>
        <text fg={theme.headerFg}>Agent</text>
        <box flexGrow={1} />
        <text fg={theme.mutedFg}>{displayModel}{smallModelIndicator}{ctxIndicator}</text>
        {lastTokens && <text fg={theme.mutedFg}> · {lastTokens}</text>}
        {totalTokens && <text fg={theme.mutedFg}> · {totalTokens}</text>}
        {elapsed && <text fg={theme.mutedFg}> · {elapsed}</text>}
        <text fg={s.color}>
          {spin}{s.label}{toolLabel}
        </text>
        {todoCount > 0 && (
          <text fg={theme.mutedFg}> · {todoCount}</text>
        )}
        <text fg={theme.mutedFg}>{roundDisplay}</text>
      </box>
      <box flexDirection="row" paddingX={1} height={1}>
        <text fg={theme.mutedFg}>
          F1=help F2=clear F3=auto F4=todo F5=save F6=load F7=mouse F9=theme F10=exit
        </text>
        {!mouseEnabled && (
          <text fg={theme.statusError}> [MOUSE OFF — select/copy enabled]</text>
        )}
      </box>
    </box>
  );
}
