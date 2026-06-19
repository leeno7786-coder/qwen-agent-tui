import { readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { discoverSeedPaths, gitChangedFiles } from "./subagent-seeds";

const BOOTSTRAP_MAX_FILES = 10;
const BOOTSTRAP_MAX_LINES = 500;
const BOOTSTRAP_LINES_PER_FILE = 80;

function orderedSeedFiles(workspace: string, focusPath?: string): string[] {
  const gitFiles = gitChangedFiles(workspace, 20);
  const seeds = discoverSeedPaths(workspace, focusPath).filter(
    (s) => s !== "." && !s.endsWith("/")
  );
  return [...new Set([...gitFiles, ...seeds])];
}

/** Pre-read seeded / changed files so sub-agents start with real context. */
export function bootstrapContext(workspace: string, focusPath?: string): string {
  const ws = resolve(workspace);
  const ordered = orderedSeedFiles(ws, focusPath);

  const chunks: string[] = [];
  let linesUsed = 0;

  for (const rel of ordered) {
    if (chunks.length >= BOOTSTRAP_MAX_FILES || linesUsed >= BOOTSTRAP_MAX_LINES) break;

    const abs = join(ws, rel.replace(/\//g, "\\"));
    if (!existsSync(abs)) continue;
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }

    try {
      const raw = readFileSync(abs, "utf-8");
      const lines = raw.split("\n");
      const budget = Math.min(
        BOOTSTRAP_LINES_PER_FILE,
        BOOTSTRAP_MAX_LINES - linesUsed
      );
      if (budget <= 0) break;
      const slice = lines.slice(0, budget).join("\n");
      if (!slice.trim()) continue;
      const truncated = lines.length > budget ? `\n… (${lines.length - budget} more lines)` : "";
      chunks.push(`### ${rel} (${Math.min(lines.length, budget)} lines)\n${slice}${truncated}`);
      linesUsed += budget;
    } catch {
      // unreadable / binary
    }
  }

  if (!chunks.length) return "";
  return [
    "",
    "Preloaded excerpts — verify with tools; read adjacent lines if a finding depends on context:",
    ...chunks,
  ].join("\n");
}
