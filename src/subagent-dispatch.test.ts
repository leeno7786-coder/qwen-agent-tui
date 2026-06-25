import { describe, expect, it } from "bun:test";
import {
  capSubAgentTasks,
  cappedDispatchSkipMessage,
  DEFAULT_OPENROUTER_DISPATCH_LIMIT,
  openRouterDispatchLimit,
  type SubAgentTask,
} from "./subagent";
import type { Config } from "./types";

const openRouterCfg: Config = {
  baseURL: "http://127.0.0.1:1234/v1",
  model: "main",
  apiKey: "",
  maxIterations: 10,
  workspace: ".",
  subAgentBaseURL: "https://openrouter.ai/api/v1",
  subAgentModel: "openrouter/free",
};

const localCfg: Config = {
  baseURL: "http://127.0.0.1:1234/v1",
  model: "main",
  subAgentModel: "small",
  apiKey: "",
  maxIterations: 10,
  workspace: ".",
};

function tasks(n: number): SubAgentTask[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `agent-${i + 1}`,
    prompt: `task ${i + 1}`,
  }));
}

describe("openRouterDispatchLimit", () => {
  it("returns default limit on OpenRouter", () => {
    expect(openRouterDispatchLimit(openRouterCfg)).toBe(
      DEFAULT_OPENROUTER_DISPATCH_LIMIT
    );
  });

  it("returns null for local sub-agent provider", () => {
    expect(openRouterDispatchLimit(localCfg)).toBeNull();
  });

  it("respects subAgentMaxPerDispatch override", () => {
    expect(
      openRouterDispatchLimit({ ...openRouterCfg, subAgentMaxPerDispatch: 3 })
    ).toBe(3);
  });
});

describe("cappedDispatchSkipMessage", () => {
  it("includes agent hint when name is provided", () => {
    const msg = cappedDispatchSkipMessage(2, "performance");
    expect(msg).toContain("Skipped —");
    expect(msg).toContain("max 2");
    expect(msg).toContain('explore_subagent for "performance"');
  });

  it("omits agent hint when name is empty", () => {
    const msg = cappedDispatchSkipMessage(2);
    expect(msg).toContain("Skipped —");
    expect(msg).not.toContain("explore_subagent");
  });
});

describe("capSubAgentTasks", () => {
  it("caps to two agents on OpenRouter", () => {
    const { runnable, capped, limit } = capSubAgentTasks(tasks(4), openRouterCfg);
    expect(limit).toBe(2);
    expect(runnable).toHaveLength(2);
    expect(capped).toHaveLength(2);
    expect(runnable[0]?.name).toBe("agent-1");
    expect(capped[0]?.name).toBe("agent-3");
  });

  it("does not cap local multi-agent dispatch", () => {
    const { runnable, capped, limit } = capSubAgentTasks(tasks(4), localCfg);
    expect(limit).toBeNull();
    expect(runnable).toHaveLength(4);
    expect(capped).toHaveLength(0);
  });
});
