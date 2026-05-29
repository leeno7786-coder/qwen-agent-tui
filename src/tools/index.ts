import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { homedir, tmpdir } from "os";
import type { Config } from "../types";
import { isSmallModel } from "../llm";

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
  return isSmallModel(cfg.model, cfg.maxTokens);
}

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

function execCmd(cmd: string, ws: string, timeoutSeconds = 60): string {
  try {
    const isWin = process.platform === "win32";
    
    // Detect if we're in a bash-like environment (Git Bash, WSL, etc.)
    // This is determined by checking various environment variables
    const shellEnv = process.env.SHELL || '';
    const comspecEnv = process.env.COMSPEC || '';
    const isGitBash = comspecEnv.toLowerCase().includes('git') || shellEnv.toLowerCase().includes('git') || shellEnv.toLowerCase().includes('bash');
    const isWSL = process.env.WSL_DISTRO_NAME !== undefined;
    
    let out;
    if (isWin && !isGitBash && !isWSL) {
      // Pure Windows PowerShell environment - translate common Unix commands
      let translatedCmd = cmd;
      
      // Convert common Unix commands to PowerShell equivalents
      // Enhanced with more comprehensive translations
      translatedCmd = translatedCmd
        .replace(/\bags\b/g, 'Select-String')  // alias for grep
        .replace(/\bls\s+(-[a-zA-Z]+)?\s*(.*)/g, 'Get-ChildItem -Name $2')  // ls to Get-ChildItem
        .replace(/\bll\s+(.*)/g, 'Get-ChildItem -Force $1')  // ll commonly used
        .replace(/\bls\b/g, 'Get-ChildItem')  // simple ls
        .replace(/\bpwd\b/g, '(Get-Location).Path')  // pwd to get location
        .replace(/\bps\b/g, 'Get-Process')  // ps to Get-Process
        .replace(/\bcat\s+(.*)/g, 'Get-Content $1')  // cat to Get-Content
        .replace(/\bhead\s+(-\d+)\s+(.*)/g, 'Get-Content $2 | Select-Object -First ${1#-}')  // head command
        .replace(/\btail\s+(-\d+)\s+(.*)/g, 'Get-Content $2 | Select-Object -Last ${1#-}')  // tail command
        .replace(/\bcp\s+(.*)\s+(.*)/g, 'Copy-Item $1 $2')  // cp to Copy-Item
        .replace(/\bmv\s+(.*)\s+(.*)/g, 'Move-Item $1 $2')  // mv to Move-Item
        .replace(/\brm\s+(-[a-zA-Z]+\s+)*(.*)/g, 'Remove-Item $2 -Recurse -Force')  // rm to Remove-Item
        .replace(/\bmkdir\s+(.*)/g, 'New-Item -ItemType Directory -Path $1 -Force')  // mkdir to New-Item
        .replace(/\btouch\s+(.*)/g, '$null | Out-File -FilePath $1 -Encoding ASCII -Append')  // touch equivalent
        .replace(/\becho\s+(.*)/g, 'Write-Output $1')  // echo to Write-Output
        .replace(/\bgrep\s+(.*)\s+(.*)/g, 'Select-String -Pattern $1 $2')  // grep to Select-String
        .replace(/\bfind\s+(.*)\s+-name\s+(.*)/g, 'Get-ChildItem -Path $1 -Name $2 -Recurse');  // find to Get-ChildItem
        
      out = execSync(translatedCmd, {
        cwd: ws,
        encoding: "utf-8",
        timeout: timeoutSeconds * 1000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        shell: "powershell.exe",
      });
    } else {
      // Unix-like environment (Linux/Mac) or Git Bash/WSL on Windows
      // Use the command as-is
      out = execSync(cmd, {
        cwd: ws,
        encoding: "utf-8",
        timeout: timeoutSeconds * 1000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        shell: isWin ? "bash" : undefined,  // Use bash on Windows if available
      });
    }
    
    const cleanOut = (out || "").replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
    const truncatedOut = cleanOut.length > 30000
      ? cleanOut.slice(0, 30000) + "\n... [truncated, total output: " + cleanOut.length + " characters]"
      : cleanOut;
    return JSON.stringify({ ok: true, stdout: truncatedOut });
  } catch (e: any) {
    const rawStdout = e.stdout?.toString?.() || "";
    const rawStderr = e.stderr?.toString?.() || e.message || "";
    const cleanStdout = rawStdout.replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
    const cleanStderr = rawStderr.replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
    const truncatedStdout = cleanStdout.length > 15000
      ? cleanStdout.slice(0, 15000) + "\n... [truncated]"
      : cleanStdout;
    const truncatedStderr = cleanStderr.length > 15000
      ? cleanStderr.slice(0, 15000) + "\n... [truncated]"
      : cleanStderr;
    return JSON.stringify({
      ok: false,
      stdout: truncatedStdout,
      stderr: truncatedStderr,
      code: e.status ?? null,
    });
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
      try {
        // First check if this is a git repository
        const gitCheck = execSync("git rev-parse --is-inside-work-tree", { 
          cwd: ws, 
          encoding: "utf-8", 
          timeout: 5000, 
          stdio: ["pipe", "pipe", "ignore"] 
        });
        if (gitCheck.trim() !== "true") {
          return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
        }
        
        // Get git diff
        return execCmd("git diff", ws);
      } catch (e: any) {
        const errorMsg = e.message?.toLowerCase() || "";
        if (errorMsg.includes("not a git repository") || errorMsg.includes("not recognized")) {
          return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
        }
        return JSON.stringify({ ok: false, error: `git diff failed: ${e.message}` });
      }
    }
  },
// File System Tools - Core file operations
{
  name: "read_file",
    description: "Read a file from the workspace",
  parameters: { type: "object", properties: { path: { type: "string", description: "File path to read" }, offset: { type: "number", description: "Line offset to start reading from (0-indexed, optional)" }, limit: { type: "number", description: "Maximum lines to read (optional)" } }, required: ["path"] },
  execute: (args, ws, cfg) => {
    try {
      const p = safe(args.path, ws, cfg);
      const st = statSync(p);
      if (!st.isFile()) return JSON.stringify({ ok: false, error: `Not a file: ${args.path}` });
      const text = readFileSync(p, "utf-8");
      const lines = text.split("\n");
      const offset = Math.max(0, Number(args.offset || 0));
      const isSmall = checkSmallModel(cfg);
      const limit = Math.max(1, Math.min(Number(args.limit || (isSmall ? SMALL_MODEL_READ_LIMIT : DEFAULT_READ_LIMIT)), 2000));
      const sliced = lines.slice(offset, offset + limit);
      const content = sliced.join("\n");
      const safeContent = content.length > MAX_READ_CHARS ? content.slice(0, MAX_READ_CHARS) : content;
      return JSON.stringify({ ok: true, path: rel(p, ws), content: safeContent, truncated: offset + limit < lines.length || safeContent.length < content.length, offset, originalLength: lines.length });
    } catch (e: any) { return JSON.stringify({ ok: false, error: e.message }); }
  },
},
{
  name: "write_file",
    description: "Write content to a file",
  parameters: { type: "object", properties: { path: { type: "string", description: "File path to write" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] },
  execute: (args, ws, cfg) => {
    try {
      const p = safe(args.path, ws, cfg);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, String(args.content ?? ""), "utf-8");
      return JSON.stringify({ ok: true, path: rel(p, ws), bytes: Buffer.byteLength(String(args.content ?? "")) });
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
      const oldText = String(args.old_text ?? "");
      if (!oldText) return JSON.stringify({ ok: false, error: "old_text cannot be empty" });
      const text = readFileSync(p, "utf-8");
      if (!text.includes(oldText)) return JSON.stringify({ ok: false, error: "old_text not found" });
      const next = args.replace_all ? text.split(oldText).join(String(args.new_text ?? "")) : text.replace(oldText, String(args.new_text ?? ""));
      writeFileSync(p, next, "utf-8");
      return JSON.stringify({ ok: true, path: rel(p, ws), replacements: args.replace_all ? text.split(oldText).length - 1 : 1 });
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
      const startLine = Number(args.start_line);
      const endLine = Number(args.end_line);
      if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
        return JSON.stringify({ ok: false, error: "start_line and end_line must be numbers" });
      }
      if (startLine < 1 || endLine < startLine) {
        return JSON.stringify({ ok: false, error: "invalid line range: start_line must be >= 1 and end_line >= start_line" });
      }
      const text = readFileSync(p, "utf-8");
      const lines = text.split(/\r?\n/);
      if (startLine > lines.length) {
        return JSON.stringify({ ok: false, error: `start_line ${startLine} exceeds file length (${lines.length} lines)` });
      }
      const newText = String(args.new_text ?? "");
      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(Math.min(endLine, lines.length));
      const result = [...before, newText, ...after].join("\n");
      writeFileSync(p, result, "utf-8");
      return JSON.stringify({ ok: true, path: rel(p, ws), start_line: startLine, end_line: Math.min(endLine, lines.length), lines_removed: Math.min(endLine, lines.length) - startLine + 1, lines_added: newText ? newText.split("\n").length : 0 });
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
      walk(root, ws, cfg, (file) => {
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
            // Label the matching line with a ">" prefix
            const annotated = snippet.map((l, idx) => {
              const lineNum = start + idx + 1;
              const marker = start + idx === i ? ">" : " ";
              return `${marker} ${String(lineNum).padStart(4, " ")}│ ${l}`;
            });
            results.push({ path: rel(file, ws), line: i + 1, context: annotated });
          }
          if (results.length >= maxResults) return false;
        }
      });
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
  parameters: { type: "object", properties: { query: { type: "string", description: "Text or regex pattern to search for" }, file_glob: { type: "string", description: "File pattern filter (e.g., '*.ts', 'src/**')" }, regex: { type: "boolean", description: "Treat query as regex (default: false)" } }, required: ["query"] },
  execute: (args, ws, cfg) => {
    try {
      const root = safe(args.path || ".", ws, cfg);
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
    try {
      // First check if this is a git repository (with minimal network interaction)
      const gitCheck = execSync("git rev-parse --show-toplevel", { 
        cwd: ws, 
        encoding: "utf-8", 
        timeout: 5000, 
        stdio: ["pipe", "pipe", "pipe"] 
      });
      
      // If we get here, we're in a git repo - just get basic status without network calls
      const out = execSync("git status --porcelain --untracked-files=no", { 
        cwd: ws, 
        encoding: "utf-8", 
        timeout: 8000, 
        stdio: "pipe" 
      });
      
      const status = out.trim();
      const hasChanges = status.length > 0;
      
      return JSON.stringify({ 
        ok: true, 
        status: hasChanges ? "has changes" : "clean", 
        isGit: true,
        details: hasChanges ? status.split('\n').filter(l => l.trim()).length + " files changed" : "no changes"
      });
    } catch (e: any) {
      // Handle cases where git is not installed or other errors
      const errorMsg = e.message?.toLowerCase() || "";
      if (errorMsg.includes("not a git repository") || errorMsg.includes("fatal:") || e.stderr?.toLowerCase().includes("not a git repository")) {
        return JSON.stringify({ ok: true, status: "not a git repository", isGit: false });
      }
      // Specifically handle timeout errors
      if (errorMsg.includes("timed out") || e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM') {
        return JSON.stringify({ ok: false, error: "git status command timed out - repository may be very large or inaccessible" });
      }
      // Handle other git errors gracefully
      return JSON.stringify({ ok: true, status: "error accessing git status", isGit: true, error: e.message?.substring(0, 100) });
    }
  },
},
{
  name: "git_commit",
    description: "Stage all and commit changes",
  parameters: { type: "object", properties: { message: { type: "string", description: "Commit message" } }, required: ["message"] },
  execute: (args, ws) => {
    const msg = String(args.message || "");
    if (!msg) return JSON.stringify({ ok: false, error: "Commit message is required" });
    
    try {
      const gitCheck = execSync("git rev-parse --is-inside-work-tree", { 
        cwd: ws, 
        encoding: "utf-8", 
        timeout: 10000, 
        stdio: ["pipe", "pipe", "ignore"] 
      });
      if (gitCheck.trim() !== "true") {
        return JSON.stringify({ ok: false, error: "not a git repository - cannot commit" });
      }
      
      const isWin = process.platform === "win32";
      execSync("git add -A", { cwd: ws, stdio: ["pipe", "pipe", "pipe"] });
      const commitCmd = `git commit -m "${msg.replace(/"/g, '\\"')}"`;
      return execCmd(commitCmd, ws);
    } catch (e: any) {
      const errorMsg = e.message?.toLowerCase() || "";
      if (errorMsg.includes("not a git repository") || errorMsg.includes("not recognized")) {
        return JSON.stringify({ ok: false, error: "not a git repository - cannot commit" });
      }
      // Specifically handle timeout errors
      if (errorMsg.includes("timed out") || e.code === 'ETIMEDOUT') {
        return JSON.stringify({
          ok: false,
          error: "git commit command timed out - repository may be very large or inaccessible"
        });
      }
      return JSON.stringify({
        ok: false,
        error: e.message,
        stdout: e.stdout?.toString() || "",
        stderr: e.stderr?.toString() || ""
      });
    }
  }
},

// Command Execution and Build Tools
{
  name: "execute_command",
    description: "Run a shell command in the workspace",
  parameters: { type: "object", properties: { command: { type: "string", description: "Shell command to execute (e.g., 'ls -la', 'git status', 'bun test')" } }, required: ["command"] },
  execute: (args, ws) => {
    const cmd = String(args.command || "").trim();
    if (!cmd) return JSON.stringify({ ok: false, error: "Command cannot be empty" });
    
    // Security: Block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf/i,
      /rm\s+--no-preserve-root/i,
      /dd\s+if=/i,
      /mkfs/i,
      /:\(\)\{\s*:\s*\|\s*:\s*&\s*\};\s*:/i, // Fork bomb
      /wget.*-O\s+\/dev\/null/i,
      /curl.*-o\s+\/dev\/null/i
    ];
    
    if (dangerousPatterns.some(pattern => pattern.test(cmd))) {
      return JSON.stringify({ 
        ok: false, 
        error: "Command blocked for security reasons" 
      });
    }
    
    return execCmd(cmd, ws);
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
];

// Tools excluded for small models to reduce decision complexity
const SMALL_MODEL_EXCLUDED = new Set([
  "typecheck", "install_dependencies", "run_command", "run_tests",
  "map_project_tree", "batch_read_files",
]);

export function toOpenAI(tools: Tool[], cfg?: Config) {
  const filtered = (cfg && checkSmallModel(cfg))
    ? tools.filter(t => !SMALL_MODEL_EXCLUDED.has(t.name))
    : tools;
  return filtered.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}
