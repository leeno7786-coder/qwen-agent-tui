import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { tools, toOpenAI } from "./index";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

describe("tools", () => {
  const ws = join(tmpdir(), "qwen-tools-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(ws, { recursive: true });
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it("batch_read_files reads multiple files successfully", () => {
    writeFileSync(join(ws, "a.txt"), "hello a", "utf-8");
    writeFileSync(join(ws, "b.txt"), "hello b", "utf-8");
    const batchRead = tools.find((t) => t.name === "batch_read_files")!;
    const out = JSON.parse(batchRead.execute({ paths: ["a.txt", "b.txt"] }, ws));
    expect(out.ok).toBe(true);
    expect(out.results["a.txt"].ok).toBe(true);
    expect(out.results["a.txt"].content).toBe("hello a");
    expect(out.results["b.txt"].ok).toBe(true);
    expect(out.results["b.txt"].content).toBe("hello b");
  });

  it("batch_read_files returns error for directory or missing file", () => {
    mkdirSync(join(ws, "dir"));
    const batchRead = tools.find((t) => t.name === "batch_read_files")!;
    const out = JSON.parse(batchRead.execute({ paths: ["dir", "missing.txt"] }, ws));
    expect(out.ok).toBe(true);
    expect(out.results["dir"].ok).toBe(false);
    expect(out.results["dir"].error).toContain("Not a file");
    expect(out.results["missing.txt"].ok).toBe(false);
    expect(out.results["missing.txt"].error).toContain("ENOENT");
  });

  it("batch_read_files allows path escaping workspace", () => {
    const parentFile = join(ws, "..", "outside-batch.txt");
    writeFileSync(parentFile, "hello parent batch", "utf-8");
    try {
      const batchRead = tools.find((t) => t.name === "batch_read_files")!;
      const out = JSON.parse(batchRead.execute({ paths: ["../outside-batch.txt"] }, ws));
      expect(out.ok).toBe(true);
      expect(out.results["../outside-batch.txt"].ok).toBe(true);
      expect(out.results["../outside-batch.txt"].content).toBe("hello parent batch");
    } finally {
      try { rmSync(parentFile, { force: true }); } catch {}
    }
  });

  it("read_file returns file content", () => {
    const file = join(ws, "test.txt");
    writeFileSync(file, "hello world", "utf-8");
    const readFile = tools.find((t) => t.name === "read_file")!;
    const out = JSON.parse(readFile.execute({ path: "test.txt" }, ws));
    expect(out.ok).toBe(true);
    expect(out.content).toBe("hello world");
  });

  it("read_file truncates content over 8000 chars", () => {
    const file = join(ws, "big.txt");
    writeFileSync(file, "x".repeat(10000), "utf-8");
    const readFile = tools.find((t) => t.name === "read_file")!;
    const out = JSON.parse(readFile.execute({ path: "big.txt", limit: 8000 }, ws));
    expect(out.ok).toBe(true);
    expect(out.content.length).toBe(8000);
  });

  it("write_file creates file and returns path", () => {
    const writeFile = tools.find((t) => t.name === "write_file")!;
    const out = JSON.parse(
      writeFile.execute({ path: "new.txt", content: "data" }, ws)
    );
    expect(out.ok).toBe(true);
    expect(readFileSync(join(ws, "new.txt"), "utf-8")).toBe("data");
  });

  it("write_file creates nested directories", () => {
    const writeFile = tools.find((t) => t.name === "write_file")!;
    const out = JSON.parse(
      writeFile.execute({ path: "a/b/c.txt", content: "nested" }, ws)
    );
    expect(out.ok).toBe(true);
    expect(readFileSync(join(ws, "a", "b", "c.txt"), "utf-8")).toBe("nested");
  });

  it("list_dir returns entries", () => {
    writeFileSync(join(ws, "foo.txt"), "", "utf-8");
    const listDir = tools.find((t) => t.name === "list_dir")!;
    const out = JSON.parse(listDir.execute({ path: "." }, ws));
    expect(out.ok).toBe(true);
    expect(out.entries.map((e: any) => e.name)).toContain("foo.txt");
  });

  it("git_status returns status in a git repo", () => {
    execSync("git init", { cwd: ws, stdio: "ignore" });
    const gitStatus = tools.find((t) => t.name === "git_status")!;
    const out = JSON.parse(gitStatus.execute({}, ws));
    expect(out.ok).toBe(true);
    expect(typeof out.status).toBe("string");
  });

  it("git_diff returns differences in repo", () => {
    execSync("git init", { cwd: ws, stdio: "ignore" });
    writeFileSync(join(ws, "a.txt"), "hello", "utf-8");
    execSync("git add a.txt && git commit -m \"initial\"", { cwd: ws, stdio: "ignore" });
    writeFileSync(join(ws, "a.txt"), "hello modified", "utf-8");
    
    const gitDiff = tools.find((t) => t.name === "git_diff")!;
    const out = JSON.parse(gitDiff.execute({}, ws));
    expect(out.ok).toBe(true);
    expect(out.stdout).toContain("modified");
  });

  it("git_commit stages and commits successfully", () => {
    execSync("git init", { cwd: ws, stdio: "ignore" });
    execSync("git config user.email \"test@example.com\"", { cwd: ws, stdio: "ignore" });
    execSync("git config user.name \"Test User\"", { cwd: ws, stdio: "ignore" });
    
    writeFileSync(join(ws, "b.txt"), "new file", "utf-8");
    const gitCommit = tools.find((t) => t.name === "git_commit")!;
    const out = JSON.parse(gitCommit.execute({ message: "test commit" }, ws));
    expect(out.ok).toBe(true);
    expect(out.stdout).toBeDefined();
    
    const status = execSync("git status --short", { cwd: ws, encoding: "utf-8" });
    expect(status.trim()).toBe(""); 
  });

  it("grep_search searches query strings properly", () => {
    writeFileSync(join(ws, "searchable.txt"), "target word is here\nother line", "utf-8");
    const grep = tools.find((t) => t.name === "grep_search")!;
    const out = JSON.parse(grep.execute({ query: "target word" }, ws));
    expect(out.ok).toBe(true);
    expect(out.results.length).toBe(1);
    expect(out.results[0].text).toContain("target word");
    expect(out.results[0].path).toBe("searchable.txt");
  });

  it("run_command runs lint/format/build lifecycle hooks", () => {
    const pkg = {
      name: "test-pkg",
      scripts: {
        build: "echo build-successful"
      }
    };
    writeFileSync(join(ws, "package.json"), JSON.stringify(pkg), "utf-8");
    writeFileSync(join(ws, "bun.lock"), "", "utf-8"); 
    
    const runCmd = tools.find((t) => t.name === "run_command")!;
    const out = JSON.parse(runCmd.execute({ command: "build" }, ws));
    expect(out.ok).toBe(true);
    expect(out.stdout).toContain("build-successful");
  });

  it("run_command blocks invalid lifecycle commands", () => {
    const runCmd = tools.find((t) => t.name === "run_command")!;
    const out = JSON.parse(runCmd.execute({ command: "invalid-lifecycle" }, ws));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Invalid command");
  });

  it("read_file allows path escaping workspace by default", () => {
    const parentFile = join(ws, "..", "outside-single.txt");
    writeFileSync(parentFile, "hello parent single", "utf-8");
    try {
      const readFile = tools.find((t) => t.name === "read_file")!;
      const out = JSON.parse(readFile.execute({ path: "../outside-single.txt" }, ws));
      expect(out.ok).toBe(true);
      expect(out.content).toBe("hello parent single");
    } finally {
      try { rmSync(parentFile, { force: true }); } catch {}
    }
  });

  it("change_workspace returns new directory when valid", () => {
    const changeWs = tools.find((t) => t.name === "change_workspace")!;
    const out = JSON.parse(changeWs.execute({ path: ".." }, ws));
    expect(out.ok).toBe(true);
    expect(out.workspace).toBeDefined();
  });

  it("toOpenAI converts tools to OpenAI format", () => {
    const openai = toOpenAI(tools);
    expect(openai.length).toBe(tools.length);
    for (const def of openai) {
      expect(def.type).toBe("function");
      expect(def.function.name).toBeDefined();
      expect(def.function.description).toBeDefined();
      expect(def.function.parameters).toBeDefined();
    }
  });
});
