// src/tools/index.ts
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "fs";
import { dirname, relative, resolve } from "path";
var DEFAULT_READ_LIMIT = 20000;
var SMALL_MODEL_READ_LIMIT = 4000;
var MAX_SEARCH_RESULTS = 80;
var SKIP_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "dist-opentui",
  ".next",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "bin",
  "obj",
  ".cache",
  ".vscode",
  ".idea",
  ".env",
  ".env.local",
  ".env.development"
]);
function isSmallModel(cfg) {
  if (!cfg?.model)
    return false;
  const modelLower = cfg.model.toLowerCase();
  return modelLower.includes("4b") || modelLower.includes("nemotron") || cfg.maxTokens && cfg.maxTokens <= 8192;
}
function safe(p, ws, cfg) {
  return resolve(ws, p || ".");
}
function rel(abs, ws) {
  const r = relative(ws, abs).replace(/\\/g, "/");
  return r && !r.startsWith("..") ? r : abs;
}
function truncate(text, limit = DEFAULT_READ_LIMIT) {
  return { content: text.slice(0, limit), truncated: text.length > limit, originalLength: text.length };
}
function walk(root, ws, cfg, visit, depth = 0, maxDepth = 8) {
  if (depth > maxDepth)
    return;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const p = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name))
        walk(p, ws, cfg, visit, depth + 1, maxDepth);
      continue;
    }
    if (entry.isFile() && visit(p) === false)
      return;
  }
}
function execCmd(cmd, ws, timeoutSeconds = 60) {
  try {
    const isWin = process.platform === "win32";
    const out = execSync(cmd, {
      cwd: ws,
      encoding: "utf-8",
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWin ? "powershell.exe" : undefined
    });
    const cleanOut = (out || "").replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
    const truncatedOut = cleanOut.length > 30000 ? cleanOut.slice(0, 30000) + `
... [truncated, total output: ` + cleanOut.length + " characters]" : cleanOut;
    return JSON.stringify({ ok: true, stdout: truncatedOut });
  } catch (e) {
    const rawStdout = e.stdout?.toString?.() || "";
    const rawStderr = e.stderr?.toString?.() || e.message || "";
    const cleanStdout = rawStdout.replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
    const cleanStderr = rawStderr.replace(/\u0000/g, "").replace(/[\uFFFD]/g, "");
    const truncatedStdout = cleanStdout.length > 15000 ? cleanStdout.slice(0, 15000) + `
... [truncated]` : cleanStdout;
    const truncatedStderr = cleanStderr.length > 15000 ? cleanStderr.slice(0, 15000) + `
... [truncated]` : cleanStderr;
    return JSON.stringify({
      ok: false,
      stdout: truncatedStdout,
      stderr: truncatedStderr,
      code: e.status ?? null
    });
  }
}
var tools = [
  {
    name: "change_workspace",
    description: "Change the active workspace directory for all subsequent tool calls and command executions. (The agent's cd tool)",
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
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "batch_read_files",
    description: "Read multiple UTF-8 text files in a single tool call. More efficient than sequential read_file calls.",
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
        const results = {};
        for (const rawPath of paths) {
          try {
            const p = safe(rawPath, ws, cfg);
            const st = statSync(p);
            if (!st.isFile()) {
              results[rawPath] = { ok: false, error: `Not a file: ${rawPath}` };
              continue;
            }
            const isSmall = isSmallModel(cfg);
            const text = readFileSync(p, "utf-8");
            const sliced = truncate(text, isSmall ? SMALL_MODEL_READ_LIMIT : DEFAULT_READ_LIMIT);
            results[rawPath] = {
              ok: true,
              content: sliced.content,
              truncated: sliced.truncated,
              originalLength: sliced.originalLength
            };
          } catch (e) {
            results[rawPath] = { ok: false, error: e.message };
          }
        }
        return JSON.stringify({ ok: true, results });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "git_diff",
    description: "View current modifications if workspace is a git repository.",
    parameters: { type: "object", properties: {} },
    execute: (_args, ws) => {
      try {
        const gitCheck = execSync("git rev-parse --is-inside-work-tree", {
          cwd: ws,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "ignore"]
        });
        if (gitCheck.trim() !== "true") {
          return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
        }
        return execCmd("git diff", ws);
      } catch (e) {
        const errorMsg = e.message?.toLowerCase() || "";
        if (errorMsg.includes("not a git repository") || errorMsg.includes("not recognized")) {
          return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
        }
        return JSON.stringify({ ok: false, error: `git diff failed: ${e.message}` });
      }
    }
  },
  {
    name: "read_file",
    description: "Read a single file from the workspace. Returns content with metadata.",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to read" }, offset: { type: "number", description: "Line offset to start reading from (optional)" }, limit: { type: "number", description: "Maximum lines to read (default: 20000)" } }, required: ["path"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        const st = statSync(p);
        if (!st.isFile())
          return JSON.stringify({ ok: false, error: `Not a file: ${args.path}` });
        const text = readFileSync(p, "utf-8");
        const offset = Math.max(0, Number(args.offset || 0));
        const isSmall = isSmallModel(cfg);
        const limit = Math.max(1, Math.min(Number(args.limit || (isSmall ? SMALL_MODEL_READ_LIMIT : DEFAULT_READ_LIMIT)), 1e5));
        const sliced = truncate(text.slice(offset), limit);
        return JSON.stringify({ ok: true, path: rel(p, ws), content: sliced.content, truncated: sliced.truncated || offset + limit < text.length, offset, originalLength: text.length });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "write_file",
    description: "Write content to a file in the workspace. Creates directories if needed.",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to write" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, String(args.content ?? ""), "utf-8");
        return JSON.stringify({ ok: true, path: rel(p, ws), bytes: Buffer.byteLength(String(args.content ?? "")) });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "edit_file",
    description: "Replace exact text in an existing file. Safer than rewriting entire file.",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to edit" }, old_text: { type: "string", description: "Exact text to replace" }, new_text: { type: "string", description: "Replacement text" }, replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" } }, required: ["path", "old_text", "new_text"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        const oldText = String(args.old_text ?? "");
        if (!oldText)
          return JSON.stringify({ ok: false, error: "old_text cannot be empty" });
        const text = readFileSync(p, "utf-8");
        if (!text.includes(oldText))
          return JSON.stringify({ ok: false, error: "old_text not found" });
        const next = args.replace_all ? text.split(oldText).join(String(args.new_text ?? "")) : text.replace(oldText, String(args.new_text ?? ""));
        writeFileSync(p, next, "utf-8");
        return JSON.stringify({ ok: true, path: rel(p, ws), replacements: args.replace_all ? text.split(oldText).length - 1 : 1 });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
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
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "map_project_tree",
    description: "Map project directory structure as a tree skeleton in markdown format. For small models, shows only directories to reduce token usage.",
    parameters: { type: "object", properties: { path: { type: "string", default: "." }, max_depth: { type: "number", default: 5 }, include_hidden: { type: "boolean", default: false } } },
    execute: (args, ws, cfg) => {
      try {
        let buildMarkdownTree = function(currentPath, currentDepth, prefix = "") {
          if (currentDepth > maxDepth)
            return "";
          try {
            const entries = readdirSync(currentPath, { withFileTypes: true });
            let result = "";
            entries.sort((a, b) => {
              if (a.isDirectory() && !b.isDirectory())
                return -1;
              if (!a.isDirectory() && b.isDirectory())
                return 1;
              return a.name.localeCompare(b.name);
            });
            const maxEntries = isSmall ? 20 : 50;
            const limitedEntries = entries.slice(0, maxEntries);
            for (let i = 0;i < limitedEntries.length; i++) {
              const entry = limitedEntries[i];
              const isLast = i === limitedEntries.length - 1;
              if (!includeHidden && entry.name.startsWith("."))
                continue;
              if (SKIP_DIRS.has(entry.name))
                continue;
              const fullPath = resolve(currentPath, entry.name);
              if (entry.isDirectory()) {
                const displayPrefix = prefix + (isLast ? "└── " : "├── ");
                result += `${displayPrefix}${entry.name}/
`;
                const subTree = buildMarkdownTree(fullPath, currentDepth + 1, prefix + (isLast ? "    " : "│   "));
                if (subTree) {
                  result += subTree;
                }
              }
              if (!isSmall && entry.isFile()) {
                const st = statSync(fullPath);
                if (st.size > 1e6)
                  continue;
                const ext = entry.name.split(".").pop()?.toLowerCase() || "";
                const sourceExtensions = new Set(["ts", "tsx", "js", "jsx", "py", "json", "md", "txt", "html", "css", "yaml", "yml"]);
                if (!sourceExtensions.has(ext))
                  continue;
                const fileDisplayPrefix = prefix + (isLast ? "└── " : "├── ");
                result += `${fileDisplayPrefix}${entry.name} (${Math.round(st.size / 1024)}KB)
`;
              }
            }
            return result;
          } catch (err) {
            return "";
          }
        };
        const root = safe(args.path || ".", ws, cfg);
        const isSmall = isSmallModel(cfg);
        const defaultMaxDepth = isSmall ? 2 : 4;
        const maxDepth = Math.min(8, Math.max(1, Number(args.max_depth || defaultMaxDepth)));
        const includeHidden = Boolean(args.include_hidden);
        const treeContent = buildMarkdownTree(root, 0);
        if (isSmall) {
          return JSON.stringify({
            ok: true,
            tree: treeContent,
            small_model_optimized: true,
            note: "Small model mode: Tree structure shown in markdown format for efficiency. Only directories included."
          });
        }
        return JSON.stringify({
          ok: true,
          tree: treeContent,
          small_model_optimized: false,
          note: "Large model mode: Tree structure shown in markdown format with directory and file information."
        });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "stat_path",
    description: "Check whether a path exists and return type, size, and timestamps.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Path to check" } }, required: ["path"] },
    execute: (args, ws, cfg) => {
      try {
        const p = safe(args.path, ws, cfg);
        if (!existsSync(p))
          return JSON.stringify({ ok: true, exists: false, path: args.path });
        const st = statSync(p);
        return JSON.stringify({ ok: true, exists: true, path: rel(p, ws), type: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other", size: st.size, modified: st.mtime.toISOString() });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "find_files",
    description: "Find files by name substring or regex under a directory. Skips node_modules, .git, and build dirs.",
    parameters: { type: "object", properties: { path: { type: "string", default: "." }, query: { type: "string" }, regex: { type: "boolean", default: false }, max_depth: { type: "number", default: 10 } }, required: ["query"] },
    execute: (args, ws, cfg) => {
      try {
        const root = safe(args.path || ".", ws, cfg);
        const q = String(args.query || "");
        const re = args.regex ? new RegExp(q, "i") : null;
        const isSmall = isSmallModel(cfg);
        const maxResults = isSmall ? 20 : MAX_SEARCH_RESULTS;
        const results = [];
        walk(root, ws, cfg, (file) => {
          const name = file.replace(/\\/g, "/");
          const hit = re ? re.test(name) : name.toLowerCase().includes(q.toLowerCase());
          if (hit) {
            if (isSmall) {
              const ext = name.split(".").pop()?.toLowerCase() || "";
              const sourceExtensions = new Set(["ts", "tsx", "js", "jsx", "py", "json", "md", "txt", "html", "css", "yaml", "yml"]);
              if (!sourceExtensions.has(ext))
                return true;
            }
            results.push(rel(file, ws));
          }
          return results.length < maxResults;
        }, 0, Number(args.max_depth || (isSmall ? 5 : 10)));
        return JSON.stringify({ ok: true, results, truncated: results.length >= maxResults, small_model_optimized: isSmall });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "grep_search",
    description: "Search for text patterns in files across the project.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Text or regex pattern to search for" }, file_glob: { type: "string", description: "File pattern filter (e.g., '*.ts', 'src/**')" }, regex: { type: "boolean", description: "Treat query as regex (default: false)" } }, required: ["query"] },
    execute: (args, ws, cfg) => {
      try {
        const root = safe(args.path || ".", ws, cfg);
        const q = String(args.query || "");
        const re = args.regex ? new RegExp(q, "i") : null;
        const fileFilter = String(args.file_glob || "").toLowerCase();
        const isSmall = isSmallModel(cfg);
        const maxResults = isSmall ? 10 : MAX_SEARCH_RESULTS;
        const results = [];
        walk(root, ws, cfg, (file) => {
          if (fileFilter && !file.toLowerCase().includes(fileFilter))
            return;
          if (isSmall) {
            const name = file.replace(/\\/g, "/");
            const ext = name.split(".").pop()?.toLowerCase() || "";
            const sourceExtensions = new Set(["ts", "tsx", "js", "jsx", "py", "json", "md", "txt", "html", "css", "yaml", "yml"]);
            if (!sourceExtensions.has(ext))
              return;
          }
          const st = statSync(file);
          const maxSize = isSmall ? 500000 : 2000000;
          if (st.size > maxSize)
            return;
          let text = "";
          try {
            text = readFileSync(file, "utf-8");
          } catch {
            return;
          }
          const lines = text.split(/\r?\n/);
          const maxLines = isSmall ? 100 : lines.length;
          for (let i = 0;i < Math.min(lines.length, maxLines); i++) {
            const line = lines[i];
            const hit = re ? re.test(line) : line.toLowerCase().includes(q.toLowerCase());
            if (hit) {
              const contextLength = isSmall ? 120 : 240;
              results.push({ path: rel(file, ws), line: i + 1, text: line.trim().slice(0, contextLength) });
            }
            if (results.length >= maxResults)
              return false;
          }
        });
        return JSON.stringify({ ok: true, results, truncated: results.length >= maxResults, small_model_optimized: isSmall });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "batch_read_files",
    description: "Read multiple UTF-8 text files in a single tool call. More efficient than sequential read_file calls.",
    parameters: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "Array of file paths to read" } }, required: ["paths"] },
    execute: (args, ws, cfg) => {
      try {
        const paths = args.paths;
        if (!Array.isArray(paths)) {
          return JSON.stringify({ ok: false, error: "paths must be an array of strings" });
        }
        const results = {};
        for (const rawPath of paths) {
          try {
            const p = safe(rawPath, ws, cfg);
            const st = statSync(p);
            if (!st.isFile()) {
              results[rawPath] = { ok: false, error: `Not a file: ${rawPath}` };
              continue;
            }
            const text = readFileSync(p, "utf-8");
            const sliced = truncate(text, DEFAULT_READ_LIMIT);
            results[rawPath] = {
              ok: true,
              content: sliced.content,
              truncated: sliced.truncated,
              originalLength: sliced.originalLength
            };
          } catch (e) {
            results[rawPath] = { ok: false, error: e.message };
          }
        }
        return JSON.stringify({ ok: true, results });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "git_status",
    description: "Get git status if workspace is a git repository.",
    parameters: { type: "object", properties: {} },
    execute: (_args, ws) => {
      try {
        const gitCheck = execSync("git rev-parse --is-inside-work-tree", {
          cwd: ws,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "ignore"]
        });
        if (gitCheck.trim() !== "true") {
          return JSON.stringify({ ok: true, status: "not a git repository", isGit: false });
        }
        const out = execSync("git status --short", {
          cwd: ws,
          encoding: "utf-8",
          timeout: 1e4,
          stdio: "pipe"
        });
        const status = out.trim() || "clean";
        return JSON.stringify({ ok: true, status, isGit: true });
      } catch (e) {
        const errorMsg = e.message?.toLowerCase() || "";
        if (errorMsg.includes("not a git repository") || errorMsg.includes("not recognized")) {
          return JSON.stringify({ ok: true, status: "not a git repository", isGit: false });
        }
        return JSON.stringify({ ok: false, error: `git command failed: ${e.message}` });
      }
    }
  },
  {
    name: "git_diff",
    description: "View current modifications if workspace is a git repository.",
    parameters: { type: "object", properties: {} },
    execute: (_args, ws) => {
      try {
        const gitCheck = execSync("git rev-parse --is-inside-work-tree", {
          cwd: ws,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "ignore"]
        });
        if (gitCheck.trim() !== "true") {
          return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
        }
        return execCmd("git diff", ws);
      } catch (e) {
        const errorMsg = e.message?.toLowerCase() || "";
        if (errorMsg.includes("not a git repository") || errorMsg.includes("not recognized")) {
          return JSON.stringify({ ok: true, diff: "", isGit: false, message: "not a git repository" });
        }
        return JSON.stringify({ ok: false, error: `git diff failed: ${e.message}` });
      }
    }
  },
  {
    name: "git_commit",
    description: "Stage and commit changes if workspace is a git repository.",
    parameters: { type: "object", properties: { message: { type: "string", description: "Commit message" } }, required: ["message"] },
    execute: (args, ws) => {
      const msg = String(args.message || "");
      if (!msg)
        return JSON.stringify({ ok: false, error: "Commit message is required" });
      try {
        const gitCheck = execSync("git rev-parse --is-inside-work-tree", {
          cwd: ws,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "ignore"]
        });
        if (gitCheck.trim() !== "true") {
          return JSON.stringify({ ok: false, error: "not a git repository - cannot commit" });
        }
        const isWin = process.platform === "win32";
        execSync("git add -A", { cwd: ws, stdio: ["pipe", "pipe", "pipe"] });
        const commitCmd = `git commit -m "${msg.replace(/"/g, "\\\"")}"`;
        return execCmd(commitCmd, ws);
      } catch (e) {
        const errorMsg = e.message?.toLowerCase() || "";
        if (errorMsg.includes("not a git repository") || errorMsg.includes("not recognized")) {
          return JSON.stringify({ ok: false, error: "not a git repository - cannot commit" });
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
  {
    name: "execute_command",
    description: "Execute shell commands safely in the workspace. Use for file operations, git commands, testing, and project-specific CLI tools.",
    parameters: { type: "object", properties: { command: { type: "string", description: "Shell command to execute (e.g., 'ls -la', 'git status', 'bun test')" } }, required: ["command"] },
    execute: (args, ws) => {
      const cmd = String(args.command || "").trim();
      if (!cmd)
        return JSON.stringify({ ok: false, error: "Command cannot be empty" });
      const dangerousPatterns = [
        /rm\s+-rf/i,
        /rm\s+--no-preserve-root/i,
        /dd\s+if=/i,
        /mkfs/i,
        /:\(\)\{\s*:\s*\|\s*:\s*&\s*\};\s*:/i,
        /wget.*-O\s+\/dev\/null/i,
        /curl.*-o\s+\/dev\/null/i
      ];
      if (dangerousPatterns.some((pattern) => pattern.test(cmd))) {
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
    description: "Run the test suite using bun test or npm test.",
    parameters: { type: "object", properties: {} },
    execute: (_args, ws) => {
      const hasBun = existsSync(resolve(ws, "bun.lock")) || existsSync(resolve(ws, "bun.lockb"));
      const cmd = hasBun ? "bun test" : "npm test";
      return execCmd(cmd, ws);
    }
  },
  {
    name: "install_dependencies",
    description: "Install dependencies using bun install or npm install.",
    parameters: { type: "object", properties: {} },
    execute: (_args, ws) => {
      const hasBun = existsSync(resolve(ws, "bun.lock")) || existsSync(resolve(ws, "bun.lockb"));
      const cmd = hasBun ? "bun install" : "npm install";
      return execCmd(cmd, ws);
    }
  },
  {
    name: "run_command",
    description: "Run predefined lifecycle scripts: build, lint, format.",
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
    description: "Run TypeScript typechecking (tsc --noEmit).",
    parameters: { type: "object", properties: {} },
    execute: (_args, ws) => {
      return execCmd("tsc --noEmit", ws);
    }
  },
  {
    name: "change_workspace",
    description: "Change the active workspace directory for all subsequent tool calls and command executions.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Absolute or relative path to the new directory" } }, required: ["path"] },
    execute: (args, ws) => {
      try {
        const next = resolve(ws, args.path);
        if (!existsSync(next) || !statSync(next).isDirectory()) {
          return JSON.stringify({ ok: false, error: `Directory not found or not a directory: ${args.path}` });
        }
        return JSON.stringify({ ok: true, workspace: next, message: `Successfully changed active workspace to ${next}` });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    }
  },
  {
    name: "manage_todos",
    description: "Manage a todo list to track subtasks and progress. Actions: add, complete, remove, list.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["add", "complete", "remove", "list"] }, text: { type: "string" }, id: { type: "string" } }, required: ["action"] },
    execute: (args) => {
      if (args.action === "add" && !args.id)
        return JSON.stringify({ ok: true, action: args.action, text: args.text, id: Math.random().toString(36).slice(2, 10), done: false, createdAt: Date.now() });
      if (args.action === "list")
        return JSON.stringify({ ok: true, action: args.action, todos: [] });
      return JSON.stringify({ ok: true, action: args.action, text: args.text, id: args.id });
    }
  }
];
function toOpenAI(tools2) {
  return tools2.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}
export {
  tools,
  toOpenAI
};
