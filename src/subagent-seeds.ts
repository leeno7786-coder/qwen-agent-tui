import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";

const MANIFEST_FILES = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "README.md",
];

/** Collect git-changed paths (staged + unstaged). */
export function gitChangedFiles(workspace: string, limit = 24): string[] {
  try {
    const inside = execSync("git rev-parse --is-inside-work-tree", {
      cwd: workspace,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (inside !== "true") return [];

    const unstaged = execSync("git diff --name-only", {
      cwd: workspace,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 8000,
    });
    const staged = execSync("git diff --cached --name-only", {
      cwd: workspace,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 8000,
    });
    const names = new Set<string>();
    for (const chunk of [unstaged, staged]) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim().replace(/\\/g, "/");
        if (trimmed) names.add(trimmed);
      }
    }
    return [...names].slice(0, limit);
  } catch {
    return [];
  }
}

/** Workspace-relative entry points for a sub-agent (not project-specific). */
export function discoverSeedPaths(workspace: string, focusPath?: string): string[] {
  const ws = resolve(workspace);
  const seeds: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    const normalized = path.trim().replace(/\\/g, "/");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    seeds.push(normalized);
  };

  if (focusPath?.trim()) {
    for (const part of focusPath.split(/[,;]/)) {
      add(part);
    }
  }

  for (const manifest of MANIFEST_FILES) {
    if (existsSync(join(ws, manifest))) add(manifest);
  }

  for (const dir of ["src", "lib", "app", "tests", "test"]) {
    if (existsSync(join(ws, dir))) add(`${dir}/`);
  }

  for (const file of gitChangedFiles(ws)) {
    add(file);
    const dir = file.includes("/") ? file.split("/").slice(0, -1).join("/") : "";
    if (dir) add(`${dir}/`);
  }

  if (seeds.length === 0) add(".");

  return seeds.slice(0, 12);
}
