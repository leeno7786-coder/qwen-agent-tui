import { describe, expect, it } from "bun:test";
import {
  parseLfmToolCalls,
  parsePythonicToolCall,
  parseTextToolCalls,
} from "./subagent-parse";

describe("parsePythonicToolCall", () => {
  it("parses string and numeric args", () => {
    expect(
      parsePythonicToolCall('read_file(path="src/agent.ts", offset=1, limit=40)')
    ).toEqual({
      name: "read_file",
      args: { path: "src/agent.ts", offset: 1, limit: 40 },
    });
  });
});

describe("parseLfmToolCalls", () => {
  it("parses LFM special-token tool calls", () => {
    const text =
      'Checking file <|tool_call_start|>[grep_search(pattern="subAgent", path="src")]<|tool_call_end|>';
    const calls = parseLfmToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("grep_search");
    expect(JSON.parse(calls[0].arguments)).toEqual({
      pattern: "subAgent",
      path: "src",
    });
  });
});

describe("parseTextToolCalls", () => {
  it("prefers embedded XML then LFM", () => {
    const calls = parseTextToolCalls(
      '[list_dir(path="src")] and <|tool_call_start|>[read_file(path="a.ts")]<|tool_call_end|>'
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.name === "list_dir" || c.name === "read_file")).toBe(
      true
    );
  });
});
