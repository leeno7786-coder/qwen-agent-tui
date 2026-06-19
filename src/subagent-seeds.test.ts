import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { discoverSeedPaths, gitChangedFiles } from "./subagent-seeds";
import { buildCodeReviewTasks, normalizeSubAgentTasks, parseDispatchSubAgentArgs } from "./subagent";

describe("discoverSeedPaths", () => {
  it("includes manifests and src when present", () => {
    const ws = process.cwd();
    const seeds = discoverSeedPaths(ws);
    if (existsSync(join(ws, "package.json"))) {
      expect(seeds).toContain("package.json");
    }
    if (existsSync(join(ws, "src"))) {
      expect(seeds.some((s) => s === "src/" || s.startsWith("src/"))).toBe(true);
    }
    expect(seeds.length).toBeGreaterThan(0);
  });

  it("honors focus_path comma list", () => {
    const seeds = discoverSeedPaths(process.cwd(), "src/agent.ts, src/tools/");
    expect(seeds).toContain("src/agent.ts");
    expect(seeds).toContain("src/tools/");
  });
});

describe("gitChangedFiles", () => {
  it("returns an array in a git repo", () => {
    const files = gitChangedFiles(process.cwd());
    expect(Array.isArray(files)).toBe(true);
  });
});

describe("buildCodeReviewTasks", () => {
  it("creates four lens tasks with prompts", () => {
    const tasks = buildCodeReviewTasks(process.cwd(), { scope: "git" });
    expect(tasks).toHaveLength(4);
    expect(tasks.map((t) => t.lens)).toEqual([
      "security",
      "performance",
      "correctness",
      "readability",
    ]);
    expect(tasks.every((t) => t.prompt.length > 0)).toBe(true);
    expect(tasks.map((t) => t.name)).toEqual([
      "security",
      "performance",
      "correctness",
      "readability",
    ]);
  });
});

describe("normalizeSubAgentTasks", () => {
  it("maps agents with prompt and legacy task", () => {
    const tasks = normalizeSubAgentTasks(
      [{ name: "auth", prompt: "Find auth handlers" }],
      undefined
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("auth");
    expect(tasks[0]?.prompt).toBe("Find auth handlers");

    const legacy = normalizeSubAgentTasks(undefined, [{ task: "Legacy task" }]);
    expect(legacy[0]?.prompt).toBe("Legacy task");
  });
});

describe("parseDispatchSubAgentArgs", () => {
  it("accepts legacy code_review mode", () => {
    const { tasks, autoFallback } = parseDispatchSubAgentArgs(
      { mode: "code_review", scope: "git" },
      process.cwd()
    );
    expect(tasks).toHaveLength(4);
    expect(autoFallback).toBe("code_review");
  });

  it("falls back when args are empty", () => {
    const { tasks, autoFallback } = parseDispatchSubAgentArgs({}, process.cwd());
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.length).toBeLessThanOrEqual(2);
    expect(autoFallback).toBe("empty_args");
  });

  it("accepts single top-level prompt", () => {
    const { tasks } = parseDispatchSubAgentArgs(
      { name: "api", prompt: "Map API routes", focus_path: "src/" },
      process.cwd()
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("api");
  });
});
