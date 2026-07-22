# Code Review: Qwen Agent TUI

## Summary

Reviewed **13 main source modules** across the `src/` tree (graph module, config, agent, LLM, sub-agents, tools, prompt, security, context, store, MCP, app shell). Built and analyzed the **memory graph** (1863 nodes, 1924 edges). Ran typecheck (passes), lint (broken config), and test suite (298/302 pass, 4 skip, 0 fail).

---

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript (`tsc --noEmit`) | ✅ Pass |
| Tests (302 total) | ✅ 298 pass, 4 skip, 0 fail |
| Lint (ESLint) | ❌ Missing `typescript-eslint` dep |
| Graph Build | ✅ 1863 nodes, 1924 edges in 357ms |

---

## 🔴 Required Changes

### 1. ESLint configuration broken — missing `typescript-eslint` dependency

**File**: `eslint.config.js`  
**Issue**: ESLint 9 flat config imports `typescript-eslint` but it is not in `dependencies` or `devDependencies`.  
**Impact**: Linting is completely disabled. `bun run lint` crashes with `ERR_MODULE_NOT_FOUND`.  
**Fix**: `bun add -d typescript-eslint` and ensure the config imports work.

### 2. `renameSession` uses `Bun.write` without fallback

**File**: `src/store.ts:81`  
**Issue**: `renameSession()` calls `Bun.write()` directly with no try/catch. If the runtime is Node.js (not Bun), this throws a `ReferenceError`.  
**Impact**: Renaming sessions would crash the TUI.  
**Fix**: Wrap in try/catch or use `writeFileSync` consistent with the rest of the file.

### 3. `MemoryGraph` generic 20-pass Louvain loop may never converge

**File**: `src/graph/MemoryGraph.ts:1326`  
**Issue**: The `while (improved && pass < 20)` loop iterates over nodes in insertion order. For large graphs (>10k nodes), 20 passes may be insufficient or waste CPU. The modularity formula uses degree (neighbor count) rather than weighted sum.  
**Impact**: Community detection quality is non-deterministic and may produce unstable results across builds.  
**Fix**: Use weighted degree (sum of edge weights) instead of neighbor count; consider delta-modularity early-exit at 0.01% improvement.

### 4. Security manager `sanitizeOutput` has a dangerous regex on line 497

**File**: `src/security/index.ts:497`  
**Issue**: `/[a-zA-Z0-9/+]{40}/` matches any 40-char alphanumeric/+ sequence — including legitimate content like git SHAs or URLs.  
**Impact**: False positive redaction of non-secret content.  
**Fix**: Restrict the pattern to require at least 3 consecutive character classes (`/[A-Za-z]{4,}[0-9/+]{8,}[A-Za-z0-9+/]{28,}/`).

---

## 🟡 Important Improvements

### 5. Inline `FileNotFound` hint logic repeated 3× across tools

**Files**: `src/tools/index.ts` — `read_file` (~743–755), `edit_file` (~826–845), `edit_file_lines` (~925–938)  
**Issue**: The "did you mean" fuzzy file-suggestion block is copy-pasted with slight variations (lines differ).  
**Impact**: Bug fixes or improvements to the hint logic must be applied in 3 places.  
**Fix**: Extract `findSimilarFiles(path, ws)` utility function.

### 6. Conversation context token counting uses average chars/token heuristic

**File**: `src/llm.ts:146` — `Math.ceil(text.length / 4)`  
**File**: `src/opentui/app.tsx:53` — same heuristic  
**Issue**: Fallback token estimation is inaccurate for code (dense symbols, short tokens). This impacts compaction decisions.  
**Impact**: Context compaction may trigger too early or too late for code-heavy conversations.  
**Fix**: Use tiktoken's `encoding_for_model` fallback; fall through to `cl100k_base` encoding before char-based estimate.

### 7. `MemoryGraph.detectCommunities` rebuilds adjacency on every call

**File**: `src/graph/MemoryGraph.ts:1295`  
**Issue**: `detectCommunities()` calls `buildAdjacency()` which creates a new adjacency map from `this.edges` each time. `getCommunities()` calls `detectCommunities()` every time.  
**Impact**: O(E) rebuild on every community query. For large graphs this adds ~100ms+ per query.  
**Fix**: Cache the adjacency map and invalidate on edge add/remove.

### 8. `subagents.ts` File tree walker has unbounded recursion depth

**File**: `src/subagents.ts:93`  
**Issue**: `walk()` in `buildSubAgentContext` has depth limit 3 and `MAX_FILES=150`, but nested symlinks or deeply nested projects could still cause stack pressure.  
**Fix**: Use iterative stack-based traversal instead of recursion.

---

## 🟢 Nitpicks & Suggestions

### 9. Hardcoded `SUBAGENT_SYSTEM_PROMPT` reduces flexibility

**File**: `src/subagents.ts:49-76`  
**Suggestion**: Allow per-instance overrides via config or tool arguments. Currently the sub-agent workflow is locked to read-only exploration.

### 10. `MemoryGraph` processes markdown files line-by-line without YAML frontmatter awareness

**File**: `src/graph/MemoryGraph.ts:767-805`  
**Suggestion**: Skip YAML frontmatter (between `---` delimiters) before extracting headers for concept nodes.

### 11. WebSocket/Signal cleanup for MCP servers lacks disconnect handler

**File**: `src/mcp/index.ts`  
**Suggestion**: Add explicit `disconnect()` / cleanup lifecycle for remote MCP servers to prevent zombie child processes.

### 12. `PARALLEL_SAFE_TOOLS` includes `build_memory_graph` but `SEQUENTIAL_ONLY_TOOLS` also lists it (contradictory intent)

**File**: `src/tools/index.ts:1710` (parallel) vs `1742` (sequential)  
**Issue**: `build_memory_graph` appears in both sets. `groupToolsForParallelExecution` would try to execute it in both parallel and sequential batches.  
**Fix**: Remove from `PARALLEL_SAFE_TOOLS` since building mutates graph state.

---

## Graph Database Status

The **memory graph** (`.qwen-graph/`) is fully set up and operational:

- **Nodes**: 1,863 (104 files, 543 concepts, 605 modules, 147 variables, 381 functions, 71 types, 12 classes)
- **Edges**: 1,924
- **Languages**: TypeScript (1261), JavaScript (27), Markdown (18), JSON (4), Python (2), unknown (8)
- **Rebuild time**: 357ms for 104 files

Available tools for agents: `build_memory_graph`, `query_memory_graph`, `get_graph_stats`, `search_nodes_by_type`, `search_nodes_by_name`, `search_nodes_by_path`, `find_dependencies`, `find_path`, `pattern_search`, `get_file_info`, `get_communities`, `get_god_nodes`, `get_surprising_connections`, `get_analysis_report`.

---

## Test Health

```
298 pass | 4 skip | 0 fail | 699 expect() calls
302 tests across 17 files in 4.99s
```

4 skipped tests should be reviewed for relevance; either implement or remove the test placeholders.

---

## Recommendations

1. **Install missing `typescript-eslint`** to restore lint pipeline (`bun add -d typescript-eslint`)
2. **Fix `Bun.write` usage** in `store.ts` for Node.js compatibility
3. **Deduplicate file-not-found hint logic** into a shared utility
4. **Cache graph adjacency** for community detection performance
5. **Fix `build_memory_graph` parallel/sequential conflict** in tool classification
6. **Tighten `sanitizeOutput` regex** on line 497 to reduce false positives
7. **Tag the 4 skipped tests** with explicit reasons (`test.skip("reason")`)
