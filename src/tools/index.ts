import { exec, execSync } from "child_process";
import * as MemoryGraphTools from "../graph/tools";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, relative, resolve } from "path";
import { homedir, tmpdir } from "os";
import type { Config } from "../types";
import { isSmallModelFromConfig, modelIdsMatch, requiresDistinctSubAgentModels } from "../model-runtime";
import {
  parseDispatchSubAgentArgs,
  openRouterDispatchLimit,
  runExploreSubAgent,
  runSequentialSubAgents,
  type SubAgentAgentStatus,
  type SubAgentDispatchAgentRow,
  type SubAgentDispatchProgress,
} from "../subagent";
import { normalizeLens } from "../subagent-lenses";
import { fileChangeDiff } from "../lib/file-diff";
import { ToolCacheManager, createToolCacheManager, globalToolCache } from "./cache";
import type { SecurityManager } from "../security";

/** A tool that the agent can invoke. */
export interface Tool {
  /** Tool name used in LLM function calls. */
  name: string;
  /** Human-readable description for the LLM. */
  description: string;
  /** JSON Schema describing expected arguments. */
  parameters: object;
  /** Execute the tool and return a JSON string. */
  execute: (args: any, workspace: string, cfg?: Config) => string;
  /** Optional async execution (e.g. sub-agent LLM loop). */
  executeAsync?: (
    args: any,
    workspace: string,
    cfg?: Config,
    signal?: AbortSignal,
    hooks?: ToolExecutionHooks
  ) => Promise<string>;
}

export interface ToolExecutionHooks {
  onSubAgentProgress?: (progress: SubAgentDispatchProgress) => void;
}

const DEFAULT_READ_LIMIT = 200;
const SMALL_MODEL_READ_LIMIT = 100;
const MAX_READ_CHARS = 100000;
const MAX_SEARCH_RESULTS = 80;
const SKIP_DIRS = new Set([
  // Version control
  ".git", ".svn", ".hg",
  // Node.js
  "node_modules", "dist", "dist-opentui", ".next", "build", "out",
  // Python  
  ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache",
  // General build/cache
  "target", "bin", "obj", ".cache", ".vscode", ".idea", 
  // Environment
  ".env", ".env.local", ".env.development"
]);

function checkSmallModel(cfg?: Config): boolean {
  if (!cfg?.model) return false;
  return isSmallModelFromConfig(cfg);
}

/** Shorter tool descriptions for ≤8B models (full params stay in JSON schema). */
const SMALL_TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: "Read file; use offset/limit. Lines are numbered for edit_file_lines.",
  write_file: "Create or overwrite a file.",
  edit_file: "Replace exact old_text once (read file first).",
  edit_file_lines: "Replace lines start_line–end_line (1-based, from read_file).",
  list_dir: "List directory entries.",
  stat_path: "File exists? size, modified time.",
  find_files: "Find paths by name substring or regex.",
  search_and_view: "Search code; returns matching lines with context.",
  execute_command: "Run shell command in workspace (PowerShell on Windows).",
  git_status: "Short git status.",
  git_diff: "Uncommitted diff.",
  git_commit: "git add -A and commit with message.",
  change_workspace: "Change working directory.",
  manage_todos: "add | complete | remove | list subtasks.",
};

function safe(p: string, ws: string, cfg?: Config): string {
  return resolve(ws, p || ".");
}

function rel(abs: string, ws: string): string {
  const r = relative(ws, abs).replace(/\\/g, "/");
  return r && !r.startsWith("..") ? r : abs;
}

function truncate(text: string, limit = DEFAULT_READ_LIMIT): { content: string; truncated: boolean; originalLength: number } {
  const lines = text.split("\n");
  const joined = lines.slice(0, limit).join("\n");
  return { content: joined, truncated: lines.length > limit, originalLength: lines.length };
}

function walk(root: string, ws: string, cfg: Config | undefined, visit: (file: string) => boolean | void, depth = 0, maxDepth = 8): void {
  if (depth > maxDepth) return;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const p = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(p, ws, cfg, visit, depth + 1, maxDepth);
      continue;
    }
    if (entry.isFile() && visit(p) === false) return;
  }
}

function tryExecBash(): boolean {
  try {
    execSync("bash --version", {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

function resolveShell(): { usePowerShell: boolean; shell: string | undefined } {
  const isWin = process.platform === "win32";
  if (!isWin) return { usePowerShell: false, shell: undefined };

  const shellEnv = process.env.SHELL || '';
  const comspecEnv = process.env.COMSPEC || '';
  const isGitBash = comspecEnv.toLowerCase().includes('git') || shellEnv.toLowerCase().includes('git') || shellEnv.toLowerCase().includes('bash');
  const isWSL = process.env.WSL_DISTRO_NAME !== undefined;

  if (isGitBash || isWSL) {
    const isBashAvailable = tryExecBash();
    return { usePowerShell: false, shell: isBashAvailable ? "bash" : undefined };
  }

  return { usePowerShell: true, shell: "powershell.exe" };
}

function translateToPowerShell(cmd: string): string {
  // Don't translate multi-line commands or commands with pipes/semicolons —
  // the regex replacements below are line-scoped and can break compound commands.
  const isSimpleCommand = !cmd.includes("\n") && !cmd.includes("|") && !cmd.includes(";") && !cmd.includes("&&") && !cmd.includes("||");
  
  if (!isSimpleCommand) return cmd;
  
  let result = cmd;
  
  // grep → Select-String (PowerShell equivalent)
  result = result.replace(/\bgrep\s+(.*)/g, 'Select-String $1');
  
  // ls with flags → Get-ChildItem with -Force for hidden files
  result = result.replace(/\bls\s+(-[a-zA-Z]*a[a-zA-Z]*)\s+(.*)/g, 'Get-ChildItem -Force $2');
  result = result.replace(/\bls\s+(-[a-zA-Z]+)?\s*(.*)/g, 'Get-ChildItem $2');
  result = result.replace(/\bls\b/g, 'Get-ChildItem');
  
  // ll → Get-ChildItem -Force (show hidden/system files)
  result = result.replace(/\bll\s+(.*)/g, 'Get-ChildItem -Force $1');
  result = result.replace(/\bll\b/g, 'Get-ChildItem -Force');
  
  // pwd → (Get-Location).Path
  result = result.replace(/\bpwd\b/g, '(Get-Location).Path');
  
  // ps → Get-Process
  result = result.replace(/\bps\b/g, 'Get-Process');
  
  // cat → Get-Content
  result = result.replace(/\bcat\s+(.*)/g, 'Get-Content $1');
  
  // head -N file → Get-Content file | Select-Object -First N
  result = result.replace(/\bhead\s+(-\d+)\s+(.*)/g, (_, num, file) => `Get-Content ${file} | Select-Object -First ${Math.abs(parseInt(num))}`);
  
  // echo "text" → Write-Output "text" (only simple echo, not echo with redirection)
  result = result.replace(/^echo\s+([^>].*)$/m, 'Write-Output $1');
  
  return result;
}

function formatExecResult(ok: boolean, out: string, err?: string, code?: number | null): string {
  const cleanOut = (out || "").replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
  const cleanErr = (err || "").replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
  const truncatedOut = cleanOut.length > 30000
    ? cleanOut.slice(0, 30000) + `\n... [truncated, total output: ${cleanOut.length} characters]`
    : cleanOut;
  const truncatedStderr = cleanErr.length > 15000
    ? cleanErr.slice(0, 15000) + "\n... [truncated]"
    : cleanErr;
  return JSON.stringify({ ok, stdout: truncatedOut, stderr: truncatedStderr, code: code ?? null });
}

function execCmd(cmd: string, ws: string, timeoutSeconds = 60): string {
  try {
    const { usePowerShell, shell } = resolveShell();
    let finalCmd = usePowerShell ? translateToPowerShell(cmd) : cmd;
    
    // On Windows with PowerShell, use -Command flag for reliable execution
    const execOptions: any = {
      cwd: ws,
      encoding: "utf-8",
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    };
    
    if (usePowerShell && shell) {
      execOptions.shell = shell;
      // Pass command via -Command flag for proper parsing
      execOptions.env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    } else {
      execOptions.shell = shell;
    }
    
    const out = execSync(finalCmd, execOptions);
    return formatExecResult(true, out);
  } catch (e: any) {
    return formatExecResult(false, e.stdout?.toString?.() || "", e.stderr?.toString?.() || e.message, e.status ?? null);
  }
}

function execCmdAsync(cmd: string, ws: string, timeoutSeconds = 60, signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise) => {
    const { usePowerShell, shell } = resolveShell();
    const finalCmd = usePowerShell ? translateToPowerShell(cmd) : cmd;

    const child = exec(
      finalCmd,
      {
        cwd: ws,
        encoding: "utf-8",
        timeout: timeoutSeconds * 1000,
        maxBuffer: 10 * 1024 * 1024,
        shell,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolvePromise(formatExecResult(false, stdout || "", stderr || error.message, (error as any).code ?? null));
        } else {
          resolvePromise(formatExecResult(true, stdout || ""));
        }
      }
    );

    if (signal) {
      if (signal.aborted) {
        child.kill();
        resolvePromise(formatExecResult(false, "", "Command cancelled", null));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          child.kill();
          resolvePromise(formatExecResult(false, "", "Command cancelled", null));
        },
        { once: true }
      );
    }
  });
}

function isDangerous(cmd: string): boolean {
  return [/rm\s+-rf/i, /rm\s+--no-preserve-root/i, /dd\s+if=/i, /mkfs/i, /:\(\)\{\s*:\s*\|\s*:\s*&\s*\};\s*:/i, /wget.*-O\s+\/dev\/null/i, /curl.*-o\s+\/dev\/null/i]
    .some(p => p.test(cmd));
}

/**
 * Run a git command directly (bypasses PowerShell translation for speed on Windows).
 * Sets GIT_OPTIONAL_LOCKS=0 to avoid lock contention during read-only operations.
 */
function execGit(args: string[], ws: string, opts: { timeout?: number; maxBuffer?: number; write?: boolean } = {}): { ok: boolean; stdout: string; stderr: string; code: number | null } {
  const isWin = process.platform === "win32";
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  // Build command string. On Windows, ensure git.exe is found via PATH.
  const cmd = "git " + args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
  try {
    const out = execSync(cmd, {
      cwd: ws,
      encoding: "utf-8",
      timeout: opts.timeout ?? 30000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWin ? "cmd.exe" : undefined,
      env,
    });
    return { ok: true, stdout: (out || "").replace(/\u0000/g, ""), stderr: "", code: 0 };
  } catch (e: any) {
    const stdout = (e.stdout || "").replace(/\u0000/g, "");
    const stderr = (e.stderr || "").replace(/\u0000/g, "");
    return { ok: false, stdout, stderr: stderr || e.message, code: e.status ?? null };
  }
}

/** Built-in tools available to the agent. */
export const tools: Tool[] = [
  {
    name: "change_workspace",
    description: "Change active workspace directory (like cd)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the new directory" }
      },
      required: ["path"]
    },
    execute: (args, ws) => {
      try {
        const next = resolve(ws, args.path);
        if (!existsSync(next) || !statSync(next).isDirectory()) {
          return JSON.stringify({ ok: false, error: `Directory not found or not a directory: ${args.path}` });
        }
        return JSON.stringify({ ok: true, workspace: next, message: `Successfully changed active workspace to ${next}` });
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "batch_read_files",
    description: "Read multiple files in one call",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Array of file paths to read" }
      },
      required: ["paths"]
    },
    execute: (args, ws, cfg) => {
      try {
        const paths = args.paths;
        if (!Array.isArray(paths)) {
          return JSON.stringify({ ok: false, error: "paths must be an array of strings" });
        }
        const results: Record<string, { ok: boolean; content?: string; error?: string; truncated?: boolean; originalLength?: number }> = {};
        for (const rawPath of paths) {
          try {
            const p = safe(rawPath, ws, cfg);
            const st = statSync(p);
            if (!st.isFile()) {
              results[rawPath] = { ok: false, error: `Not a file: ${rawPath}` };
              continue;
            }
        const isSmall = checkSmallModel(cfg);
        const text = readFileSync(p, "utf-8");
        const sliced = truncate(text, isSmall ? SMALL_MODEL_READ_LIMIT : DEFAULT_READ_LIMIT);
            results[rawPath] = {
              ok: true,
              content: sliced.content,
              truncated: sliced.truncated,
              originalLength: sliced.originalLength
            };
          } catch (e: any) {
            results[rawPath] = { ok: false, error: e.message };
          }
        }
        return JSON.stringify({ ok: true, results });
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
  name: "git_diff",
    description: "View uncommitted git changes",
  parameters: { type: "object", properties: {} },
  execute: (_args, ws) => {
    const r = execGit(["rev-parse", "--is-inside-work-tree"], ws, { timeout: 5000 });
    if (!r.ok || r.stdout.trim() !== "true") {
      return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
    }

    const diff = execGit(["--no-optional-locks", "diff"], ws, { timeout: 15000 });
    if (!diff.ok) {
      return JSON.stringify({ ok: false, error: `git diff failed: ${diff.stderr?.substring(0, 200)}` });
    }
    return JSON.stringify({ ok: true, diff: diff.stdout, isGit: true });
  },
},

// File System Tools - Core file operations
  {
    name: "read_file",
    description: "Read a file from the workspace",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to read" }, offset: { type: "number", description: "Line offset to start reading from (0-indexed, optional)" }, limit: { type: "number", description: "Maximum lines to read (optional)" }, numbered: { type: "boolean", description: "Return lines with line numbers (default: auto for small models)" } }, required: ["path"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        
        // Check with security manager if available
        if (cfg?.securityManager) {
          const result = cfg.securityManager.validateFileAccess(p, 'read');
          if (!result.ok) {
            return JSON.stringify({ ok: false, error: result.error || "Access denied" });
          }
        }
      const st = statSync(p);
      if (!st.isFile()) return JSON.stringify({ ok: false, error: `Not a file: ${args.path}` });
      const text = readFileSync(p, "utf-8");
      const lines = text.split("\n");
      const offset = Math.max(0, Number(args.offset || 0));
      const isSmall = checkSmallModel(cfg);
      const limit = Math.max(1, Math.min(Number(args.limit || (isSmall ? SMALL_MODEL_READ_LIMIT : DEFAULT_READ_LIMIT)), 2000));
      const sliced = lines.slice(offset, offset + limit);
      const numbered = isSmall && args.numbered !== false;
      const content = numbered
        ? sliced
            .map((line, i) => {
              const n = offset + i + 1;
              return `${String(n).padStart(5)}| ${line}`;
            })
            .join("\n")
        : sliced.join("\n");
      const safeContent = content.length > MAX_READ_CHARS ? content.slice(0, MAX_READ_CHARS) : content;
      return JSON.stringify({
        ok: true,
        path: rel(p, ws),
        content: safeContent,
        numbered,
        truncated: offset + limit < lines.length || safeContent.length < content.length,
        offset,
        line_count: lines.length,
      });
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        try {
          const dir = dirname(safe(args.path, ws, cfg));
          const dirFiles = readdirSync(dir).filter(f => {
            const st = statSync(resolve(dir, f));
            return st.isFile() && !f.startsWith('.');
          });
          const fname = basename(safe(args.path, ws, cfg));
          const stem = fname.replace(/\.[^/.]+$/, '');
          const similar = dirFiles.filter(f => f.includes(stem) || stem.includes(f.replace(/\.[^/.]+$/, '')));
          const hint = similar.length > 0
            ? ` Did you mean one of these? ${similar.map(f => rel(resolve(dir, f), ws)).join(', ')}`
            : ` Files in ${rel(dir, ws)}: ${dirFiles.join(', ')}`;
          return JSON.stringify({ ok: false, error: `File not found: ${rel(safe(args.path, ws, cfg), ws)}.${hint}` });
        } catch {
          return JSON.stringify({ ok: false, error: `File not found: ${rel(safe(args.path, ws, cfg), ws)}. Parent directory does not exist.` });
        }
      }
      return JSON.stringify({ ok: false, error: e.message });
    }
  },
},
  {
    name: "write_file",
    description: "Write content to a file",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to write" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        
        // Check with security manager if available
        if (cfg?.securityManager) {
          const result = cfg.securityManager.validateFileAccess(p, 'write');
          if (!result.ok) {
            return JSON.stringify({ ok: false, error: result.error || "Access denied" });
          }
        }
      const relPath = rel(p, ws);
      let oldText = "";
      let existed = false;
      try {
        if (existsSync(p) && statSync(p).isFile()) {
          oldText = readFileSync(p, "utf-8");
          existed = true;
        }
      } catch {
        // new file
      }
      const newText = String(args.content ?? "");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, newText, "utf-8");
      const { added, removed, diff } = fileChangeDiff(relPath, oldText, newText);
      return JSON.stringify({
        ok: true,
        path: relPath,
        action: existed ? "update" : "write",
        added,
        removed,
        diff,
        bytes: Buffer.byteLength(newText),
      });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},
  {
    name: "edit_file",
    description: "Replace exact text in a file",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to edit" }, old_text: { type: "string", description: "Exact text to replace" }, new_text: { type: "string", description: "Replacement text" }, replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" } }, required: ["path", "old_text", "new_text"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        
        // Check with security manager if available
        if (cfg?.securityManager) {
          const result = cfg.securityManager.validateFileAccess(p, 'write');
          if (!result.ok) {
            return JSON.stringify({ ok: false, error: result.error || "Access denied" });
          }
        }
      const oldText = String(args.old_text ?? "");
      if (!oldText) return JSON.stringify({ ok: false, error: "old_text cannot be empty" });
      
    // Check file exists before reading
    if (!existsSync(p)) {
      const relPath = rel(p, ws);
      let hint = "";
      try {
        const dir = dirname(p);
        if (existsSync(dir)) {
          const dirFiles = readdirSync(dir).filter(f => {
            try { return statSync(resolve(dir, f)).isFile(); } catch { return false; }
          });
          const fname = basename(p);
          const stem = fname.replace(/\.[^/.]+$/, '');
          const similar = dirFiles.filter(f => f.includes(stem) || stem.includes(f.replace(/\.[^/.]+$/, '')));
          if (similar.length > 0) {
            hint = ` Did you mean one of these? ${similar.map(f => rel(resolve(dir, f), ws)).join(', ')}`;
          } else if (dirFiles.length > 0) {
            hint = ` Files in ${rel(dir, ws)}: ${dirFiles.slice(0, 20).join(', ')}`;
          }
        }
      } catch { /* ignore hint errors */ }
      return JSON.stringify({ ok: false, error: `File not found: ${relPath}.${hint}` });
    }
      
    const text = readFileSync(p, "utf-8");
    if (!text.includes(oldText)) {
      // Fuzzy fallback: try matching with trimmed lines
      const oldLines = oldText.split(/\r?\n/);
      const fileLines = text.split(/\r?\n/);
      let matchStart = -1;
      let matchEnd = -1;
        
      // Try to find a contiguous block where trimmed lines match
      for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
        let allMatch = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (fileLines[i + j].trim() !== oldLines[j].trim()) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          matchStart = i;
          matchEnd = i + oldLines.length;
          break;
        }
      }
        
      if (matchStart >= 0) {
        // Found a fuzzy match — use the actual file text for replacement
        const newTextValue = String(args.new_text ?? "");
        const before = fileLines.slice(0, matchStart);
        const after = fileLines.slice(matchEnd);
        const next = [...before, newTextValue, ...after].join("\n");
        writeFileSync(p, next, "utf-8");
        const relPath = rel(p, ws);
        const { added, removed, diff } = fileChangeDiff(relPath, text, next);
        return JSON.stringify({ ok: true, path: relPath, action: "update", added, removed, diff, replacements: 1, fuzzy_match: true });
      }
        
      // Provide helpful error with context
      const snippet = text.length > 500 ? text.substring(0, 500) + "..." : text;
      return JSON.stringify({ ok: false, error: `old_text not found in ${rel(p, ws)}. File has ${fileLines.length} lines. First 500 chars:\n${snippet}` });
    }
      
    const next = args.replace_all ? text.split(oldText).join(String(args.new_text ?? "")) : text.replace(oldText, String(args.new_text ?? ""));
    writeFileSync(p, next, "utf-8");
    const relPath = rel(p, ws);
    const { added, removed, diff } = fileChangeDiff(relPath, text, next);
    return JSON.stringify({ ok: true, path: relPath, action: "update", added, removed, diff, replacements: args.replace_all ? text.split(oldText).length - 1 : 1 });
  } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
},
},
  {
    name: "edit_file_lines",
    description: "Replace a range of lines in a file by line number. Use this when edit_file fails with 'old_text not found' or when you know the exact line numbers to change",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to edit" }, start_line: { type: "number", description: "First line number to replace (1-indexed, inclusive)" }, end_line: { type: "number", description: "Last line number to replace (1-indexed, inclusive)" }, new_text: { type: "string", description: "Replacement text (can be multiple lines)" } }, required: ["path", "start_line", "end_line", "new_text"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        
        // Check with security manager if available
        if (cfg?.securityManager) {
          const result = cfg.securityManager.validateFileAccess(p, 'write');
          if (!result.ok) {
            return JSON.stringify({ ok: false, error: result.error || "Access denied" });
          }
        }
      const startLine = Number(args.start_line);
      const endLine = Number(args.end_line);
      if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
        return JSON.stringify({ ok: false, error: "start_line and end_line must be numbers" });
      }
      if (startLine < 1 || endLine < startLine) {
        return JSON.stringify({ ok: false, error: "invalid line range: start_line must be >= 1 and end_line >= start_line" });
      }
      
    // Check file exists before reading
    if (!existsSync(p)) {
      const relPath = rel(p, ws);
      let hint = "";
      try {
        const dir = dirname(p);
        if (existsSync(dir)) {
          const dirFiles = readdirSync(dir).filter(f => {
            try { return statSync(resolve(dir, f)).isFile(); } catch { return false; }
          });
          const fname = basename(p);
          const stem = fname.replace(/\.[^/.]+$/, '');
          const similar = dirFiles.filter(f => f.includes(stem) || stem.includes(f.replace(/\.[^/.]+$/, '')));
          if (similar.length > 0) {
            hint = ` Did you mean one of these? ${similar.map(f => rel(resolve(dir, f), ws)).join(', ')}`;
          }
        }
      } catch { /* ignore hint errors */ }
      return JSON.stringify({ ok: false, error: `File not found: ${relPath}.${hint}` });
    }
      
    const text = readFileSync(p, "utf-8");
    const lines = text.split(/\r?\n/);
    if (startLine > lines.length) {
      return JSON.stringify({ ok: false, error: `start_line ${startLine} exceeds file length (${lines.length} lines)` });
    }
    const newText = String(args.new_text ?? "");
    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(Math.min(endLine, lines.length));
    const next = [...before, newText, ...after].join("\n");
    writeFileSync(p, next, "utf-8");
    const relPath = rel(p, ws);
    const { added, removed, diff } = fileChangeDiff(relPath, text, next);
    return JSON.stringify({
      ok: true,
      path: relPath,
      action: "update",
      added,
      removed,
      diff,
      start_line: startLine,
      end_line: Math.min(endLine, lines.length),
      lines_removed: Math.min(endLine, lines.length) - startLine + 1,
      lines_added: newText ? newText.split("\n").length : 0,
    });
  } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
},
},

// Directory and Project Structure Tools
{
  name: "list_dir",
  description: "List files and directories in a given path.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Directory path to list (default: current)" }, limit: { type: "number", description: "Maximum entries to return (default: 200)" } } },
  execute: (args, ws, cfg) => {
    try {
      const p = safe(args.path || ".", ws, cfg);
      const entries = readdirSync(p, { withFileTypes: true }).slice(0, Math.max(1, Number(args.limit || 200))).map((e) => {
        const ep = resolve(p, e.name);
        const st = statSync(ep);
        return { name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other", size: st.size };
      });
      return JSON.stringify({ ok: true, path: rel(p, ws), entries });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},
{
  name: "map_project_tree",
    description: "Map project structure as a tree",
  parameters: { type: "object", properties: { path: { type: "string", default: "." }, max_depth: { type: "number", default: 5 }, include_hidden: { type: "boolean", default: false } } },
  execute: (args, ws, cfg) => {
    try {
      const root = safe(args.path || ".", ws, cfg);
      const isSmall = checkSmallModel(cfg);
      // Reduce max depth for small models to prevent overwhelming them
      const defaultMaxDepth = isSmall ? 2 : 4;
      const maxDepth = Math.min(8, Math.max(1, Number(args.max_depth || defaultMaxDepth)));
      const includeHidden = Boolean(args.include_hidden);
      
      // Helper function to build a markdown tree representation
      function buildMarkdownTree(currentPath: string, currentDepth: number, prefix = ""): string {
        if (currentDepth > maxDepth) return "";
        
        try {
          const entries = readdirSync(currentPath, { withFileTypes: true });
          let result = "";
          
          // Sort entries: directories first, then files
          entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });
          
          // Limit entries for small models
          const maxEntries = isSmall ? 20 : 50;
          const limitedEntries = entries.slice(0, maxEntries);
          
          for (let i = 0; i < limitedEntries.length; i++) {
            const entry = limitedEntries[i];
            const isLast = i === limitedEntries.length - 1;
            
            // Skip hidden files unless explicitly requested
            if (!includeHidden && entry.name.startsWith('.')) continue;
            // Skip common build/cache directories
            if (SKIP_DIRS.has(entry.name)) continue;
            
            const fullPath = resolve(currentPath, entry.name);
            
            if (entry.isDirectory()) {
              // Add directory entry
              const displayPrefix = prefix + (isLast ? "└── " : "├── ");
              result += `${displayPrefix}${entry.name}/\n`;
              
              // Recursively add subdirectories
              const subTree = buildMarkdownTree(fullPath, currentDepth + 1, prefix + (isLast ? "    " : "│   "));
              if (subTree) {
                result += subTree;
              }
            }
            // For small models, we skip files entirely to reduce token usage
            // For larger models, we can include file information
            if (!isSmall && entry.isFile()) {
              // Skip very large files for large models too
              const st = statSync(fullPath);
              if (st.size > 1000000) continue;
              
              // Focus on source code files
              const ext = entry.name.split('.').pop()?.toLowerCase() || '';
              const sourceExtensions = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'json', 'md', 'txt', 'html', 'css', 'yaml', 'yml']);
              if (!sourceExtensions.has(ext)) continue;
              
              const fileDisplayPrefix = prefix + (isLast ? "└── " : "├── ");
              result += `${fileDisplayPrefix}${entry.name} (${Math.round(st.size / 1024)}KB)\n`;
            }
          }
          
          return result;
        } catch (err) {
          // If we can't read a directory, just return empty result
          return "";
        }
      }
      
      // Generate the markdown tree
      const treeContent = buildMarkdownTree(root, 0);
      
      // For small models, we also provide the directory structure in JSON for parsing
      if (isSmall) {
        return JSON.stringify({ 
          ok: true, 
          tree: treeContent,
          small_model_optimized: true,
          note: "Small model mode: Tree structure shown in markdown format for efficiency. Only directories included."
        });
      }
      
      // For larger models, still provide the markdown tree but with more details
      return JSON.stringify({ 
        ok: true, 
        tree: treeContent,
        small_model_optimized: false,
        note: "Large model mode: Tree structure shown in markdown format with directory and file information."
      });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }
},
{
  name: "stat_path",
    description: "Check file or dir metadata",
  parameters: { type: "object", properties: { path: { type: "string", description: "Path to check" } }, required: ["path"] },
  execute: (args, ws, cfg) => {
    try {
      const p = safe(args.path, ws, cfg);
      if (!existsSync(p)) return JSON.stringify({ ok: true, exists: false, path: args.path });
      const st = statSync(p);
      return JSON.stringify({ ok: true, exists: true, path: rel(p, ws), type: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other", size: st.size, modified: st.mtime.toISOString() });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},

// Search and Analysis Tools
{
  name: "search_and_view",
    description: "Search for a pattern and show matching lines with surrounding context. Use this to find where code is defined or used, then edit with edit_file_lines",
  parameters: { type: "object", properties: { pattern: { type: "string", description: "Text or regex pattern to search for" }, path: { type: "string", description: "File or directory to search in (default: workspace root)" }, file_pattern: { type: "string", description: "Optional file filter (e.g. '*.ts', '*.py')" }, context_lines: { type: "number", description: "Lines of context before and after each match (default: 3)" }, regex: { type: "boolean", description: "Treat pattern as regex (default: false)" } }, required: ["pattern"] },
  execute: (args, ws, cfg) => {
    try {
      const root = safe(args.path || ".", ws, cfg);
      const q = String(args.pattern || "");
      if (!q) return JSON.stringify({ ok: false, error: "pattern cannot be empty" });
      const re = args.regex ? new RegExp(q, "i") : null;
      const fileFilter = String(args.file_pattern || "").toLowerCase();
      const ctxLines = Math.max(0, Math.min(20, Number(args.context_lines ?? 3)));
      const isSmall = checkSmallModel(cfg);
      const maxResults = isSmall ? 8 : 40;
      const results: Array<{ path: string; line: number; context: string[] }> = [];

      // If the user passed a file, search that file only (common small-model mistake).
      const rootStat = statSync(root);
      const searchFile = (file: string) => {
        if (fileFilter && !file.toLowerCase().includes(fileFilter)) return;
        const st = statSync(file);
        const maxSize = isSmall ? 500_000 : 2_000_000;
        if (st.size > maxSize) return;
        let text = "";
        try { text = readFileSync(file, "utf-8"); } catch { return; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hit = re ? re.test(line) : line.toLowerCase().includes(q.toLowerCase());
          if (hit) {
            const start = Math.max(0, i - ctxLines);
            const end = Math.min(lines.length, i + ctxLines + 1);
            const snippet = lines.slice(start, end);
            const annotated = snippet.map((l, idx) => {
              const lineNum = start + idx + 1;
              const marker = start + idx === i ? ">" : " ";
              return `${marker} ${String(lineNum).padStart(4, " ")}│ ${l}`;
            });
            results.push({ path: rel(file, ws), line: i + 1, context: annotated });
          }
          if (results.length >= maxResults) return false;
        }
      };

      if (rootStat.isFile()) {
        searchFile(root);
      } else {
        walk(root, ws, cfg, (file) => {
          searchFile(file);
          return results.length < maxResults;
        });
      }
      return JSON.stringify({ ok: true, results, context_lines: ctxLines, truncated: results.length >= maxResults });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},
{
  name: "find_files",
    description: "Find files by name or regex",
  parameters: { type: "object", properties: { path: { type: "string", default: "." }, query: { type: "string" }, regex: { type: "boolean", default: false }, max_depth: { type: "number", default: 10 } }, required: ["query"] },
  execute: (args, ws, cfg) => {
    try {
      const root = safe(args.path || ".", ws, cfg);
      const q = String(args.query || "");
      const re = args.regex ? new RegExp(q, "i") : null;
      const isSmall = checkSmallModel(cfg);
      // Reduce max results for small models
      const maxResults = isSmall ? 20 : MAX_SEARCH_RESULTS;
      const results: string[] = [];
      walk(root, ws, cfg, (file) => {
        const name = file.replace(/\\/g, "/");
        const hit = re ? re.test(name) : name.toLowerCase().includes(q.toLowerCase());
        if (hit) {
          if (isSmall) {
            // For small models, focus on source files only
            const ext = name.split('.').pop()?.toLowerCase() || '';
            const sourceExtensions = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'json', 'md', 'txt', 'html', 'css', 'yaml', 'yml']);
            if (!sourceExtensions.has(ext)) return true; // continue walking
          }
          results.push(rel(file, ws));
        }
        return results.length < maxResults;
      }, 0, Number(args.max_depth || (isSmall ? 5 : 10)));
      return JSON.stringify({ ok: true, results, truncated: results.length >= maxResults, small_model_optimized: isSmall });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},
{
  name: "grep_search",
    description: "Search text patterns in files",
  parameters: { type: "object", properties: { query: { type: "string", description: "Text or regex pattern to search for" }, path: { type: "string", description: "Directory to search in (default: workspace root)" }, file_glob: { type: "string", description: "File pattern filter (e.g., '*.ts', 'src/**')" }, regex: { type: "boolean", description: "Treat query as regex (default: false)" } }, required: ["query"] },
  execute: (args, ws, cfg) => {
    try {
      const root = safe(args.path || ".", ws, cfg);
      // If root is a file, search it directly instead of recursing into it
      let rootStat: ReturnType<typeof statSync>;
      try { rootStat = statSync(root); } catch {
        return JSON.stringify({ ok: false, error: `Directory not found: ${rel(root, ws)}` });
      }
      if (rootStat.isFile()) {
        const q = String(args.query || "");
        if (!q) return JSON.stringify({ ok: false, error: "query is required for grep_search" });
        const re = args.regex ? new RegExp(q, "i") : null;
        const results: Array<{ path: string; line: number; text: string }> = [];
        let text = "";
        try { text = readFileSync(root, "utf-8"); } catch {
          return JSON.stringify({ ok: false, error: `Cannot read file: ${rel(root, ws)}` });
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hit = re ? re.test(line) : line.toLowerCase().includes(q.toLowerCase());
          if (hit) {
            results.push({ path: rel(root, ws), line: i + 1, text: line.trim().slice(0, 240) });
          }
        }
        return JSON.stringify({ ok: true, results, truncated: false, single_file: true, small_model_optimized: checkSmallModel(cfg) });
      }
      const q = String(args.query || "");
      const re = args.regex ? new RegExp(q, "i") : null;
      const fileFilter = String(args.file_glob || "").toLowerCase();
      const isSmall = checkSmallModel(cfg);
      // Reduce max results for small models
      const maxResults = isSmall ? 10 : MAX_SEARCH_RESULTS;
      const results: Array<{ path: string; line: number; text: string }> = [];
      walk(root, ws, cfg, (file) => {
        if (fileFilter && !file.toLowerCase().includes(fileFilter)) return;
        
        // For small models, focus on source files only
        if (isSmall) {
          const name = file.replace(/\\/g, "/");
          const ext = name.split('.').pop()?.toLowerCase() || '';
          const sourceExtensions = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'json', 'md', 'txt', 'html', 'css', 'yaml', 'yml']);
          if (!sourceExtensions.has(ext)) return;
        }
        
        const st = statSync(file);
        // Reduce file size limit for small models
        const maxSize = isSmall ? 500_000 : 2_000_000;
        if (st.size > maxSize) return;
        let text = "";
        try { text = readFileSync(file, "utf-8"); } catch { return; }
        const lines = text.split(/\r?\n/);
        // For small models, limit lines processed per file
        const maxLines = isSmall ? 100 : lines.length;
        for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
          const line = lines[i];
          const hit = re ? re.test(line) : line.toLowerCase().includes(q.toLowerCase());
          if (hit) {
            // Reduce context for small models
            const contextLength = isSmall ? 120 : 240;
            results.push({ path: rel(file, ws), line: i + 1, text: line.trim().slice(0, contextLength) });
          }
          if (results.length >= maxResults) return false;
        }
      });
      return JSON.stringify({ ok: true, results, truncated: results.length >= maxResults, small_model_optimized: isSmall });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},

// Git and Version Control Tools
{
  name: "git_status",
    description: "Show git repository status",
  parameters: { type: "object", properties: {} },
  execute: (_args, ws) => {
    // Check working tree status (fast, no lock contention)
    const r = execGit(["rev-parse", "--is-inside-work-tree"], ws, { timeout: 5000 });
    if (!r.ok || r.stdout.trim() !== "true") {
      return JSON.stringify({ ok: true, status: "not a git repository", isGit: false });
    }

    // Get porcelain status (skip untracked files for speed)
    const status = execGit(["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"], ws, { timeout: 10000 });
    if (!status.ok) {
      return JSON.stringify({ ok: false, error: `git status failed: ${status.stderr?.substring(0, 200)}` });
    }

    const lines = status.stdout.trim();
    const hasChanges = lines.length > 0;
    return JSON.stringify({
      ok: true,
      status: hasChanges ? "has changes" : "clean",
      isGit: true,
      details: hasChanges ? lines.split('\n').filter(l => l.trim()).length + " files changed" : "no changes"
    });
  },
},
{
  name: "git_commit",
    description: "Stage all and commit changes",
  parameters: { type: "object", properties: { message: { type: "string", description: "Commit message" } }, required: ["message"] },
  execute: (args, ws) => {
    const msg = String(args.message || "");
    if (!msg) return JSON.stringify({ ok: false, error: "Commit message is required" });

    // Check we're in a git repo
    const check = execGit(["rev-parse", "--is-inside-work-tree"], ws, { timeout: 5000 });
    if (!check.ok || check.stdout.trim() !== "true") {
      return JSON.stringify({ ok: false, error: "not a git repository - cannot commit" });
    }

    // Stage all
    const add = execGit(["add", "-A"], ws, { timeout: 15000 });
    if (!add.ok) {
      return JSON.stringify({ ok: false, error: add.stderr?.substring(0, 200) || "git add failed" });
    }

    // Commit
    const commit = execGit(["commit", "-m", msg], ws, { timeout: 15000 });
    if (!commit.ok) {
      return JSON.stringify({
        ok: false,
        error: commit.stderr?.substring(0, 200) || "git commit failed",
        stdout: commit.stdout,
        stderr: commit.stderr,
      });
    }
    return JSON.stringify({ ok: true, stdout: commit.stdout });
  },
},

// Command Execution and Build Tools
  {
    name: "execute_command",
    description: "Run a shell command in the workspace",
    parameters: { type: "object", properties: { command: { type: "string", description: "Shell command to execute (e.g., 'dir', 'git status', 'bun test')" } }, required: ["command"] },
    execute: (args, ws, cfg) => {
      const cmd = String(args.command || "").trim();
      if (!cmd) return JSON.stringify({ ok: false, error: "Command cannot be empty" });
      
      // Check with security manager if available
      if (cfg?.securityManager) {
        const result = cfg.securityManager.validateCommand(cmd);
        if (!result.ok) {
          return JSON.stringify({ ok: false, error: result.error || "Command blocked for security reasons" });
        }
      } else if (isDangerous(cmd)) {
        return JSON.stringify({ ok: false, error: "Command blocked for security reasons" });
      }
      
      return execCmd(cmd, ws);
    },
    executeAsync: async (args, ws, cfg, signal) => {
      const cmd = String(args.command || "").trim();
      if (!cmd) return JSON.stringify({ ok: false, error: "Command cannot be empty" });
      
      // Check with security manager if available
      if (cfg?.securityManager) {
        const result = cfg.securityManager.validateCommand(cmd);
        if (!result.ok) {
          return JSON.stringify({ ok: false, error: result.error || "Command blocked for security reasons" });
        }
      } else if (isDangerous(cmd)) {
        return JSON.stringify({ ok: false, error: "Command blocked for security reasons" });
      }
      
      return execCmdAsync(cmd, ws, 60, signal);
    }
  },
{
  name: "run_tests",
    description: "Run project tests",
  parameters: { type: "object", properties: {} },
  execute: (_args, ws) => {
    const hasBun = existsSync(resolve(ws, "bun.lock")) || existsSync(resolve(ws, "bun.lockb"));
    const cmd = hasBun ? "bun test" : "npm test";
    return execCmd(cmd, ws);
  }
},
{
  name: "install_dependencies",
    description: "Install project dependencies",
  parameters: { type: "object", properties: {} },
  execute: (_args, ws) => {
    const hasBun = existsSync(resolve(ws, "bun.lock")) || existsSync(resolve(ws, "bun.lockb"));
    const cmd = hasBun ? "bun install" : "npm install";
    return execCmd(cmd, ws);
  }
},
{
  name: "run_command",
    description: "Run build/lint/format script",
  parameters: { type: "object", properties: { command: { type: "string", enum: ["build", "lint", "format"], description: "The lifecycle command to run" } }, required: ["command"] },
  execute: (args, ws) => {
    const allowed = new Set(["build", "lint", "format"]);
    const sub = String(args.command || "").trim();
    if (!allowed.has(sub)) {
      return JSON.stringify({ ok: false, error: `Invalid command: ${sub}. Only 'build', 'lint', and 'format' are allowed.` });
    }
    const hasBun = existsSync(resolve(ws, "bun.lock")) || existsSync(resolve(ws, "bun.lockb"));
    const runner = hasBun ? "bun run" : "npm run";
    const cmd = `${runner} ${sub}`;
    return execCmd(cmd, ws);
  }
},
{
  name: "typecheck",
    description: "Run tsc --noEmit",
  parameters: { type: "object", properties: {} },
  execute: (_args, ws) => {
    return execCmd("tsc --noEmit", ws);
  }
},

// Sub-agent exploration (main model only; uses second LM Studio model)
{
  name: "explore_subagent",
  description:
    "Delegate one read-only investigation to a sub-agent. You write the prompt — it explores with tools and returns an evidence summary. For multiple investigations, use dispatch_subagents.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Full investigation instructions (what to find, which patterns to check, expected output format)",
      },
      task: {
        type: "string",
        description: "Alias for prompt (legacy)",
      },
      name: {
        type: "string",
        description: "Optional label for this run (e.g. auth-handlers)",
      },
      focus_path: {
        type: "string",
        description: "Optional directory or file to prioritize (comma-separated ok)",
      },
      lens: {
        type: "string",
        enum: ["general", "security", "performance", "correctness", "readability", "structure"],
        description: "Optional focus hint appended to your prompt",
      },
    },
    required: [],
  },
  execute: () =>
    JSON.stringify({ ok: false, error: "explore_subagent requires async execution" }),
  executeAsync: async (args, ws, cfg, signal, hooks) => {
    if (!cfg?.subAgentModel || cfg.subAgentEnabled === false) {
      return JSON.stringify({
        ok: false,
        error:
          "Sub-agent not configured. Set OPENROUTER_API_KEY or subAgentModel in ~/.qwen-agent.json",
      });
    }
    const task = String(args.prompt ?? args.task ?? "").trim();
    if (!task) {
      return JSON.stringify({ ok: false, error: "prompt (or task) is required" });
    }
    const focus = String(args.focus_path ?? "").trim();
    const name = String(args.name ?? "").trim();
    const label = name || "explore";
    const rows: SubAgentDispatchAgentRow[] = [
      {
        name: label,
        status: "pending",
        tools_used: 0,
        input_tokens: 0,
        output_tokens: 0,
      },
    ];
    const emit = (status: SubAgentAgentStatus, snap?: {
      tools_used: number;
      input_tokens: number;
      output_tokens: number;
      error?: string;
    }) => {
      rows[0]!.status = status;
      if (snap) {
        rows[0]!.tools_used = snap.tools_used;
        rows[0]!.input_tokens = snap.input_tokens;
        rows[0]!.output_tokens = snap.output_tokens;
        if (snap.error) rows[0]!.error = snap.error;
      }
      hooks?.onSubAgentProgress?.({
        total: 1,
        index: 0,
        phase: status === "done" || status === "failed" ? "done" : "running",
        agents: rows.map((r) => ({ ...r })),
      });
    };
    emit("running");
    const result = await runExploreSubAgent(task, cfg, ws, signal, {
      focusPath: focus && focus !== "." && focus !== "./" ? focus : undefined,
      lens: args.lens ? normalizeLens(args.lens) : undefined,
      name: name || undefined,
      onProgress: (snap) => {
        emit(
          snap.status === "done" ? "done" : snap.status === "failed" ? "failed" : "running",
          snap
        );
      },
    });
    emit(result.ok ? "done" : "failed", {
      tools_used: result.tools_used.length,
      input_tokens: result.usage?.input_tokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? 0,
      error: result.error,
    });
    return JSON.stringify(result);
  },
},

{
  name: "dispatch_subagents",
  description:
    "Run read-only sub-agents sequentially. REQUIRED: pass agents array with your custom prompts. Example: {\"agents\":[{\"name\":\"security\",\"prompt\":\"Review git-changed auth code for missing checks. Return path:line bullets.\",\"focus_path\":\"src/\"}]}. On OpenRouter free tier, max 2 agents per call (extras are skipped). Legacy: mode=code_review also works. Runs one agent at a time.",
  parameters: {
    type: "object",
    properties: {
      agents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Short label (e.g. security-auth, perf-db, api-contracts)",
            },
            prompt: {
              type: "string",
              description:
                "Full investigation instructions — files, patterns, output format",
            },
            focus_path: {
              type: "string",
              description: "Optional file or directory scope (comma-separated)",
            },
            lens: {
              type: "string",
              enum: ["general", "security", "performance", "correctness", "readability", "structure"],
              description: "Optional focus hint appended to your prompt",
            },
          },
          required: ["prompt"],
        },
        description: "Sub-agents to run in order (max 8). Each must include prompt.",
      },
      mode: {
        type: "string",
        enum: ["code_review"],
        description: "Legacy: auto-builds 4 lens agents on git changes when agents omitted",
      },
      question: {
        type: "string",
        description: "Review question when using mode=code_review",
      },
      scope: {
        type: "string",
        description: "code_review scope: git (default) or directory path",
      },
      tasks: {
        type: "array",
        description: "Legacy alias for agents (items use task or prompt field)",
      },
    },
  },
  execute: () =>
    JSON.stringify({ ok: false, error: "dispatch_subagents requires async execution" }),
  executeAsync: async (args, ws, cfg, signal, hooks) => {
    if (!subAgentAvailable(cfg)) {
      return JSON.stringify({
        ok: false,
        error:
          "Sub-agents not configured. Set OPENROUTER_API_KEY or subAgentModel in ~/.qwen-agent.json",
      });
    }

    const parsed = parseDispatchSubAgentArgs(args as Record<string, unknown>, ws);
    const tasks = parsed.tasks;
    if (!tasks.length) {
      return JSON.stringify({
        ok: false,
        error:
          "No sub-agent tasks — pass agents: [{ name, prompt, focus_path? }]. Example prompt: \"Review src/subagent.ts for error handling gaps; cite path:line.\"",
        received_keys: Object.keys(args ?? {}).filter((k) => k !== "raw_input"),
        example: {
          agents: [
            {
              name: "security",
              prompt:
                "Review git-changed files for auth/injection/secrets issues. Bullet findings with path:line and severity.",
              focus_path: "src/",
            },
          ],
        },
      });
    }
    if (tasks.length > 8) {
      return JSON.stringify({ ok: false, error: "Too many agents (max 8)" });
    }

    const results = await runSequentialSubAgents(tasks, cfg!, ws, signal, {
      onProgress: hooks?.onSubAgentProgress,
    });
    const okCount = results.filter((r) => r.ok).length;
    const partialCount = results.filter(
      (r) => !r.ok && (r.summary?.length ?? 0) > 40
    ).length;
    const skippedCount = results.filter((r) =>
      (r.error ?? "").startsWith("Skipped —")
    ).length;
    const errors = results
      .filter((r) => !r.ok)
      .map((r) => {
        const label = r.name || r.task || "agent";
        return `${label}: ${r.error || r.summary || "unknown error"}`;
      })
      .slice(0, 6);
    const allFailed = okCount === 0 && partialCount === 0;
    return JSON.stringify({
      ok: okCount > 0 || partialCount > 0,
      sequential: true,
      count: results.length,
      ok_count: okCount,
      partial_count: partialCount || undefined,
      skipped_count: skippedCount || undefined,
      dispatch_limit: openRouterDispatchLimit(cfg!) ?? undefined,
      auto_fallback: parsed.autoFallback,
      error: allFailed && errors.length ? errors.join("; ") : undefined,
      errors: errors.length ? errors : undefined,
      results,
    });
  },
},

// Todo Management
{
  name: "manage_todos",
    description: "Track subtasks with a todo list",
  parameters: { type: "object", properties: { action: { type: "string", enum: ["add", "complete", "remove", "list"] }, text: { type: "string" }, id: { type: "string" } }, required: ["action"] },
  execute: (args) => {
    if (args.action === "add" && !args.id) return JSON.stringify({ ok: true, action: args.action, text: args.text, id: Math.random().toString(36).slice(2, 10), done: false, createdAt: Date.now() });
    if (args.action === "list") return JSON.stringify({ ok: true, action: args.action, todos: [] });
    return JSON.stringify({ ok: true, action: args.action, text: args.text, id: args.id });
  },
},

// Memory Graph
{
  name: "build_memory_graph",
  description: "Build a memory graph from the codebase for better understanding and querying of code structure. Use when you need to understand the codebase architecture or find related code.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.build_memory_graph({ workspace: ws })),
},
{
  name: "query_memory_graph",
  description: "Query the memory graph for nodes, edges, and paths. Supported query types: 'node' (by type/name/path), 'edge' (by type/from/to), 'path' (shortest path between nodes), 'pattern' (regex search across all data), 'semantic' (related nodes).",
  parameters: { type: "object", properties: { query: { type: "object", description: "Query object with type ('node'|'edge'|'path'|'pattern'|'semantic') and query parameters" } }, required: ["query"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => {
    try {
      await MemoryGraphTools.build_memory_graph({ workspace: ws });
      return JSON.stringify(await MemoryGraphTools.query_memory_graph({ workspace: ws, query: args.query }));
    } catch (e: any) { return JSON.stringify({ error: e.message }); }
  },
},
{
  name: "get_graph_stats",
  description: "Get statistics about the memory graph (node counts by type and language).",
  parameters: { type: "object", properties: {}, required: [] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.get_graph_stats({ workspace: ws })),
},
{
  name: "search_nodes_by_type",
  description: "Search for nodes in the memory graph by type (file, function, class, type, variable, import, export, interface, enum, module).",
  parameters: { type: "object", properties: { type: { type: "string", description: "Node type to search for" }, limit: { type: "number", description: "Max results" } }, required: ["type"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.search_nodes_by_type({ workspace: ws, type: args.type, limit: args.limit })),
},
{
  name: "search_nodes_by_name",
  description: "Search for nodes in the memory graph by name (function name, class name, variable name, etc.).",
  parameters: { type: "object", properties: { name: { type: "string", description: "Name to search for" }, limit: { type: "number", description: "Max results" } }, required: ["name"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.search_nodes_by_name({ workspace: ws, name: args.name, limit: args.limit })),
},
{
  name: "search_nodes_by_path",
  description: "Search for nodes in the memory graph by file path.",
  parameters: { type: "object", properties: { path: { type: "string", description: "File path to search for" }, limit: { type: "number", description: "Max results" } }, required: ["path"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.search_nodes_by_path({ workspace: ws, path: args.path, limit: args.limit })),
},
{
  name: "find_dependencies",
  description: "Find dependencies of a node in the memory graph by node ID.",
  parameters: { type: "object", properties: { nodeId: { type: "string", description: "Node ID to find dependencies for" }, maxDepth: { type: "number", description: "Max depth to traverse" } }, required: ["nodeId"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.find_dependencies({ workspace: ws, nodeId: args.nodeId, maxDepth: args.maxDepth })),
},
{
  name: "find_path",
  description: "Find the shortest path between two nodes in the memory graph.",
  parameters: { type: "object", properties: { from: { type: "string", description: "Starting node ID" }, to: { type: "string", description: "Target node ID" }, maxDepth: { type: "number", description: "Max search depth" } }, required: ["from", "to"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.find_path({ workspace: ws, from: args.from, to: args.to, maxDepth: args.maxDepth })),
},
{
  name: "pattern_search",
  description: "Search the memory graph using a regex pattern across all node data (name, path, type, code).",
  parameters: { type: "object", properties: { pattern: { type: "string", description: "Regex pattern to search" }, limit: { type: "number", description: "Max results" } }, required: ["pattern"] },
  execute: () => JSON.stringify({ ok: false, error: "Use executeAsync for this tool" }),
  executeAsync: async (args, ws) => JSON.stringify(await MemoryGraphTools.pattern_search({ workspace: ws, pattern: args.pattern, limit: args.limit })),
},
];

// Tools excluded for ≤8B models — fewer choices, less wrong-tool drift
const SMALL_MODEL_EXCLUDED = new Set([
  "typecheck",
  "install_dependencies",
  "run_command",
  "run_tests",
  "map_project_tree",
  "batch_read_files",
  "grep_search",
]);

// Tools that can be executed in parallel (read-only, non-blocking)
const PARALLEL_SAFE_TOOLS = new Set([
  "read_file",
  "list_dir",
  "stat_path",
  "find_files",
  "grep_search",
  "search_and_view",
  "git_status",
  "git_diff",
  "map_project_tree",
  "batch_read_files",
]);

// Tools that must run sequentially (write operations, state changes)
const SEQUENTIAL_ONLY_TOOLS = new Set([
  "write_file",
  "edit_file",
  "edit_file_lines",
  "execute_command",
  "git_commit",
  "install_dependencies",
  "run_tests",
  "run_command",
  "typecheck",
  "change_workspace",
  "manage_todos",
  "explore_subagent",
  "dispatch_subagents",
]);

export function subAgentAvailable(cfg?: Config): boolean {
  if (!cfg?.subAgentModel || cfg.subAgentEnabled === false) return false;
  if (!requiresDistinctSubAgentModels(cfg)) return true;
  return !modelIdsMatch(cfg.model, cfg.subAgentModel);
}

export function toolsForConfig(all: Tool[], cfg?: Config): Tool[] {
  let filtered = all;
  if (cfg && checkSmallModel(cfg)) {
    filtered = filtered.filter((t) => !SMALL_MODEL_EXCLUDED.has(t.name));
  }
  if (!subAgentAvailable(cfg)) {
    filtered = filtered.filter(
      (t) => t.name !== "explore_subagent" && t.name !== "dispatch_subagents"
    );
  }
  return filtered;
}

export function toOpenAI(allTools: Tool[], cfg?: Config) {
  const filtered = toolsForConfig(allTools, cfg);
  const small = cfg && checkSmallModel(cfg);
  return filtered.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: (small && SMALL_TOOL_DESCRIPTIONS[t.name]) || t.description,
      parameters: t.parameters,
    },
  }));
}

// Export cache utilities
export { ToolCacheManager, createToolCacheManager, globalToolCache } from "./cache";
export type { ToolCacheEntry, ToolCacheConfig } from "./cache";

// Export parallel execution utilities
export { PARALLEL_SAFE_TOOLS, SEQUENTIAL_ONLY_TOOLS };

/**
 * Check if a tool can be executed in parallel with others.
 */
export function canRunInParallel(toolName: string): boolean {
  return PARALLEL_SAFE_TOOLS.has(toolName);
}

/**
 * Check if a tool must run sequentially.
 */
export function mustRunSequentially(toolName: string): boolean {
  return SEQUENTIAL_ONLY_TOOLS.has(toolName);
}

/**
 * Group tool calls into parallel and sequential batches.
 */
export function groupToolsForParallelExecution(
  toolCalls: Array<{ name: string; arguments: string; id: string }>
): {
  parallel: Array<{ name: string; arguments: string; index: number; id: string }>;
  sequential: Array<{ name: string; arguments: string; index: number; id: string }>;
} {
  const parallel: Array<{ name: string; arguments: string; index: number; id: string }> = [];
  const sequential: Array<{ name: string; arguments: string; index: number; id: string }> = [];

  toolCalls.forEach((tc, index) => {
    if (canRunInParallel(tc.name)) {
      parallel.push({ ...tc, index });
    } else {
      sequential.push({ ...tc, index });
    }
  });

  return { parallel, sequential };
}
