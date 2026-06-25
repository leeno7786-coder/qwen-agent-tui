---
name: memory-graph
description: Build and query a graph of the codebase (files, functions, classes, types, imports, calls) to understand architecture, find dependencies, trace connections, detect communities, and analyze codebase structure.
triggers:
  - "memory graph"
  - "code graph"
  - "architecture"
  - "dependency graph"
  - "understand the codebase"
  - "codebase structure"
  - "find dependencies"
  - "trace code"
  - "community detection"
  - "god nodes"
  - "graph analysis"
  - "codebase communities"
  - "cross-community"
  - "surprising connections"
  - "graph report"
---

# Memory Graph

The memory graph captures codebase structure as a queryable graph of nodes (files, functions, classes, types, variables, imports) and edges (imports, part_of, extends, implements, calls) with extraction quality tagging.

## Available tools

### Build & Query
- **build_memory_graph** — scans the workspace and builds the graph. Run this first.
- **query_memory_graph** — query by type (`node`/`edge`/`path`/`pattern`/`semantic`)
- **get_graph_stats** — node counts by type and language

### Search
- **search_nodes_by_type** — find all nodes of a type (function, class, type, etc.)
- **search_nodes_by_name** — find nodes by name substring
- **search_nodes_by_path** — find nodes in a specific file
- **pattern_search** — regex across all node data
- **get_file_info** — all nodes in a file

### Trace
- **find_dependencies** — trace what a node depends on (up to N depth)
- **find_path** — shortest path between two nodes

### Analysis (new)
- **get_communities** — detect community clusters using Louvain modularity algorithm
- **get_god_nodes** — find the most-connected hub nodes (highest degree)
- **get_surprising_connections** — find cross-community edges (architectural boundary violations)
- **get_analysis_report** — full markdown report with stats, communities, god nodes, and surprising connections

## Edge extraction quality
Every edge is tagged with an `extraction` field:
- `'ast'` — derived from TypeScript/JS AST parser (high confidence)
- `'inferred'` — derived from heuristic/pattern matching (medium confidence)
- `'llm'` — derived from LLM analysis (lower confidence, semantic)

## Workflow

1. Run `build_memory_graph` to build the graph (may take a few seconds on large projects)
2. Use `get_graph_stats` for a quick overview
3. `query_memory_graph` for general queries, or use the specific search tools above
4. `find_path` to trace connections between two symbols
5. `find_dependencies` to understand what a module depends on
6. `get_communities` to understand codebase modularization
7. `get_god_nodes` to find central hubs
8. `get_surprising_connections` to spot architecture boundary violations
9. `get_analysis_report` for a complete analysis
