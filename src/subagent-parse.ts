/** Parsed tool call from model text (XML / legacy formats). */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Parse LFM / pythonic tool call: read_file(path="src/x.ts", limit=40) */
export function parsePythonicToolCall(
  raw: string
): { name: string; args: Record<string, unknown> } | null {
  const trimmed = raw.trim();
  const m = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/s);
  if (!m) return null;

  const name = m[1];
  const args: Record<string, unknown> = {};
  const argsBody = m[2].trim();
  if (!argsBody) return { name, args };

  const argRe =
    /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|true|false|null)/g;
  let am: RegExpExecArray | null;
  while ((am = argRe.exec(argsBody))) {
    const key = am[1];
    let val: unknown = am[2];
    if (typeof val === "string") {
      if (val.startsWith('"') || val.startsWith("'")) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
      } else if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (val === "null") val = null;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
    }
    args[key] = val;
  }

  return { name, args };
}

/**
 * Qwen 0.8B + thinking sometimes emits tools as XML inside reasoning instead of tool_calls.
 */
export function parseEmbeddedToolCalls(text: string): ParsedToolCall[] {
  if (!text?.trim()) return [];

  const calls: ParsedToolCall[] = [];
  const blocks = text.match(/<tool_call>[\s\S]*?<\/tool_call>/gi) || [];

  for (const block of blocks) {
    const fnMatch = block.match(/<function[=:\s]+([a-zA-Z0-9_]+)/i);
    if (!fnMatch) continue;

    const name = fnMatch[1];
    const args: Record<string, unknown> = {};
    const paramRe =
      /<parameter[=:\s]+([a-zA-Z0-9_]+)\s*>\s*([\s\S]*?)\s*<\/parameter>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = paramRe.exec(block))) {
      args[pm[1]] = pm[2].trim();
    }

    calls.push({
      id: `parsed_${Math.random().toString(36).slice(2, 10)}`,
      name,
      arguments: JSON.stringify(args),
    });
  }

  return calls;
}

/**
 * Liquid LFM models emit pythonic calls between special tokens instead of OpenAI tool_calls.
 * Example: <|tool_call_start|>[read_file(path="src/x.ts")]<|tool_call_end|>
 */
export function parseLfmToolCalls(text: string): ParsedToolCall[] {
  if (!text?.trim()) return [];

  const calls: ParsedToolCall[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const parsed = parsePythonicToolCall(raw);
    if (!parsed) return;
    const key = `${parsed.name}:${JSON.stringify(parsed.args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({
      id: `parsed_${Math.random().toString(36).slice(2, 10)}`,
      name: parsed.name,
      arguments: JSON.stringify(parsed.args),
    });
  };

  const tokenRe = /<\|tool_call_start\|>\[([^\]]+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text))) {
    add(m[1]);
  }

  const bareRe = /\[([a-z_][a-z0-9_]*\([^[\]\n]{1,500}\))\]/gi;
  while ((m = bareRe.exec(text))) {
    add(m[1]);
  }

  return calls;
}

/** Parse tool calls from free-form model text (LFM, Qwen XML, etc.). */
export function parseTextToolCalls(text: string): ParsedToolCall[] {
  for (const parser of [parseEmbeddedToolCalls, parseLfmToolCalls]) {
    const calls = parser(text);
    if (calls.length) return calls;
  }
  return [];
}

/** Strip XML / LFM tool blocks from reasoning so it can be used as a partial summary. */
export function stripEmbeddedToolMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<\|tool_call_start\|>[\s\S]*?(<\|tool_call_end\|>|<\|redacted_tool_call_end[^>]*>)/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\[[a-z_][a-z0-9_]*\([^[\]\n]{1,500}\)\]/gi, "")
    .trim();
}
